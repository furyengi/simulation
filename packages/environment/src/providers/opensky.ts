import { Instant } from '@simulation/physics';
import type { ProviderStatus } from '@simulation/schemas';
import type { EnvironmentConfig } from '../config';
import { defaultFetcher, type Fetcher } from './http';
import { statusFromResource } from './status';

/**
 * Live aircraft state vectors from the OpenSky Network REST API (research use).
 * https://openskynetwork.github.io/opensky-api/rest.html
 *
 * Facts that shape this module:
 *  - OAuth2 client-credentials is the only authenticated mode (basic auth is no longer accepted);
 *    tokens last 30 min. Anonymous access exists with a very small quota (400 credits/day,
 *    10 s resolution, current data only). An authenticated standard account gets 4 000 credits/day
 *    and 5 s resolution. A states query costs 1–4 credits depending on bounding-box size.
 *  - Coverage is limited to OpenSky's receiver network: it is NEVER complete or worldwide. Aircraft
 *    without ADS-B/Mode-S/MLAT reception, or over oceans and remote areas, are absent. This
 *    provider says so in its status notes and consumers must not imply otherwise.
 *  - These are OBSERVED reports (position source ADS-B / ASTERIX / MLAT / FLARM), with their own
 *    report times; we preserve them and add nothing.
 *  - Attribution to the OpenSky Network is displayed in the UI. Check their terms before any
 *    non-research use.
 *
 * Aircraft are entities separate from simulated objects: ids are `icao24:<hex>`.
 */

const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const STATES_URL = 'https://opensky-network.org/api/states/all';

export const OPENSKY_SOURCE = {
  provider: 'opensky',
  dataset: 'REST /states/all',
  url: 'https://opensky-network.org',
  license: 'OpenSky Network terms of use (research/non-commercial unless licensed)',
  attribution:
    'Aircraft data: The OpenSky Network, https://opensky-network.org. Coverage is limited to OpenSky receivers.',
} as const;

export type PositionSource = 'ADS-B' | 'ASTERIX' | 'MLAT' | 'FLARM' | 'UNKNOWN';

export interface AircraftState {
  /** `icao24:<hex>` */
  readonly id: string;
  readonly icao24: string;
  readonly callsign: string | null;
  readonly originCountry: string;
  /** Time of last position report (UTC), or null. */
  readonly positionTimeUtc: string | null;
  /** Time of last message of any kind (UTC). */
  readonly lastContactUtc: string | null;
  readonly lonDeg: number | null;
  readonly latDeg: number | null;
  /** Barometric altitude, m (pressure altitude relative to ISA sea level — NOT height above ellipsoid). */
  readonly baroAltitudeM: number | null;
  /** Geometric (GNSS) altitude, m — above the WGS84 ellipsoid per ADS-B convention. */
  readonly geoAltitudeM: number | null;
  readonly onGround: boolean;
  /** Ground speed, m/s. */
  readonly groundSpeedMps: number | null;
  /** True track over ground, degrees clockwise from north. (Heading is not reported by the feed.) */
  readonly trackDeg: number | null;
  /** Vertical rate, m/s (positive = climbing). */
  readonly verticalRateMps: number | null;
  readonly squawk: string | null;
  readonly positionSource: PositionSource;
}

const SOURCES: PositionSource[] = ['ADS-B', 'ASTERIX', 'MLAT', 'FLARM'];
const iso = (unixS: unknown): string | null =>
  typeof unixS === 'number' && Number.isFinite(unixS)
    ? Instant.fromUnixMillis(unixS * 1000).toIso()
    : null;
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** Parse an OpenSky `/states/all` response body. Indices per the API documentation. */
export function parseOpenSkyStates(body: string): { time: Instant; states: AircraftState[] } {
  const j = JSON.parse(body) as { time?: unknown; states?: unknown };
  if (typeof j.time !== 'number') throw new Error('OpenSky response has no "time"');
  const rows = Array.isArray(j.states) ? (j.states as unknown[][]) : [];
  const states: AircraftState[] = rows.map((s) => {
    const icao24 = String(s[0]);
    const cs = typeof s[1] === 'string' ? s[1].trim() : '';
    const src = numOrNull(s[16]);
    return {
      id: `icao24:${icao24}`,
      icao24,
      callsign: cs === '' ? null : cs,
      originCountry: String(s[2]),
      positionTimeUtc: iso(s[3]),
      lastContactUtc: iso(s[4]),
      lonDeg: numOrNull(s[5]),
      latDeg: numOrNull(s[6]),
      baroAltitudeM: numOrNull(s[7]),
      geoAltitudeM: numOrNull(s[13]),
      onGround: s[8] === true,
      groundSpeedMps: numOrNull(s[9]),
      trackDeg: numOrNull(s[10]),
      verticalRateMps: numOrNull(s[11]),
      squawk: typeof s[14] === 'string' ? s[14] : null,
      positionSource: src !== null && src >= 0 && src < SOURCES.length ? SOURCES[src]! : 'UNKNOWN',
    };
  });
  return { time: Instant.fromUnixMillis(j.time * 1000), states };
}

export interface BoundingBox {
  readonly latMinDeg: number;
  readonly lonMinDeg: number;
  readonly latMaxDeg: number;
  readonly lonMaxDeg: number;
}

export interface AircraftSnapshot {
  /** OpenSky's own timestamp for the response. */
  readonly observedAt: Instant;
  readonly retrievedAt: Instant;
  readonly states: readonly AircraftState[];
  readonly bbox: BoundingBox | null;
}

export class OpenSkyProvider {
  private token: { value: string; expires: Instant } | undefined;
  private snapshot: AircraftSnapshot | undefined;
  private lastAttempt: Instant | undefined;
  private backoffUntil: Instant | undefined;
  private lastError: string | undefined;
  private creditsRemaining: number | undefined;

  constructor(
    private readonly deps: {
      readonly config: EnvironmentConfig['openSky'];
      readonly offline: boolean;
      readonly fetcher?: Fetcher;
      readonly now?: () => Instant;
    },
  ) {}

  private now(): Instant {
    return this.deps.now ? this.deps.now() : Instant.wallNow();
  }
  private get fetcher(): Fetcher {
    return this.deps.fetcher ?? defaultFetcher;
  }

  get authenticated(): boolean {
    return !!(this.deps.config.clientId && this.deps.config.clientSecret);
  }

  /**
   * Minimum seconds between requests: conservative multiples of the documented quotas —
   * anonymous 400 credits/day ≈ one 1–4-credit request per ~4 min at worst; authenticated
   * 4 000/day ≈ one per ~22 s at 1 credit, we use 60 s.
   */
  get minRefreshSeconds(): number {
    return this.authenticated ? 60 : 300;
  }

  private async bearer(): Promise<Record<string, string>> {
    const { clientId, clientSecret } = this.deps.config;
    if (!clientId || !clientSecret) return {};
    const now = this.now();
    if (this.token && this.token.expires.compare(now.plusSeconds(60)) > 0) {
      return { authorization: `Bearer ${this.token.value}` };
    }
    const res = await this.fetcher(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
    if (res.status !== 200) throw new Error(`OpenSky token request failed: HTTP ${res.status}`);
    const j = JSON.parse(res.text) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new Error('OpenSky token response has no access_token');
    this.token = { value: j.access_token, expires: now.plusSeconds(j.expires_in ?? 1800) };
    return { authorization: `Bearer ${j.access_token}` };
  }

  /**
   * Fetch a fresh snapshot for a bounding box (or the whole world — 4 credits — if null), unless the
   * rate limit policy forbids it, in which case the last snapshot is returned unchanged.
   */
  async refresh(bbox: BoundingBox | null): Promise<AircraftSnapshot | undefined> {
    const now = this.now();
    if (this.deps.offline) {
      this.lastError = 'offline mode (SIM_OFFLINE=1)';
      return this.snapshot;
    }
    if (this.backoffUntil && now.compare(this.backoffUntil) < 0) return this.snapshot;
    if (this.lastAttempt && now.secondsSince(this.lastAttempt) < this.minRefreshSeconds) {
      return this.snapshot;
    }
    this.lastAttempt = now;
    try {
      const headers = await this.bearer();
      const q = bbox
        ? `?lamin=${bbox.latMinDeg}&lomin=${bbox.lonMinDeg}&lamax=${bbox.latMaxDeg}&lomax=${bbox.lonMaxDeg}`
        : '';
      const res = await this.fetcher(`${STATES_URL}${q}`, { headers });
      const remaining = res.headers['x-rate-limit-remaining'];
      if (remaining !== undefined && Number.isFinite(Number(remaining))) {
        this.creditsRemaining = Number(remaining);
      }
      if (res.status === 429) {
        const wait = Number(res.headers['x-rate-limit-retry-after-seconds']);
        this.backoffUntil = now.plusSeconds(Number.isFinite(wait) && wait > 0 ? wait : 3600);
        throw new Error(`rate limited (HTTP 429); retry after ${this.backoffUntil.toIso()}`);
      }
      if (res.status === 401) this.token = undefined;
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const parsed = parseOpenSkyStates(res.text);
      this.snapshot = {
        observedAt: parsed.time,
        retrievedAt: this.now(),
        states: parsed.states,
        bbox,
      };
      this.lastError = undefined;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
    }
    return this.snapshot;
  }

  current(): AircraftSnapshot | undefined {
    return this.snapshot;
  }

  status(): ProviderStatus {
    const now = this.now();
    const base = statusFromResource(
      {
        id: OPENSKY_SOURCE.provider,
        label: 'Live aircraft (OpenSky Network)',
        attribution: OPENSKY_SOURCE.attribution,
        license: OPENSKY_SOURCE.license,
        ...(this.snapshot ? { itemCount: this.snapshot.states.length } : {}),
        minRefreshSeconds: this.minRefreshSeconds,
        notes: [
          this.authenticated
            ? 'Authenticated (OAuth2): 4 000 credits/day, 5 s resolution.'
            : 'Anonymous access: 400 credits/day, 10 s resolution. Set OPENSKY_CLIENT_ID/SECRET for more.',
          'Coverage is limited to OpenSky receivers — it is never complete or worldwide.',
          ...(this.creditsRemaining !== undefined
            ? [`API credits remaining: ${this.creditsRemaining}`]
            : []),
        ],
      },
      this.snapshot
        ? {
            key: 'opensky',
            body: '',
            retrievedAt: this.snapshot.retrievedAt,
            origin: 'network',
            url: STATES_URL,
          }
        : undefined,
      this.lastError,
      now,
    );
    return base;
  }
}
