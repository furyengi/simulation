import { Instant } from '@simulation/physics';
import type { ProviderStatus, SpaceWeatherState } from '@simulation/schemas';
import { type ResourceCache, type LoadedResource, type ResourceSpec } from '../cache';
import { statusFromResource } from '../status';

/**
 * NOAA Space Weather Prediction Center near-real-time observations (public, no key; US Government
 * work — attribute NOAA/SWPC):
 *   /products/noaa-planetary-k-index.json   3-hourly planetary Kp and a-running
 *   /json/planetary_k_index_1m.json         1-minute estimated Kp
 *   /json/f107_cm_flux.json                 F10.7 (2800 MHz) flux measurements, three per day
 *
 * These are OBSERVATIONS (or provider estimates, labelled as such) and are used for the "nowcast"
 * part of the space-weather state. They are NOT what drives NRLMSISE-00: that needs the consistent
 * daily indices from the compiled dataset. Times in the feeds are UTC without a zone suffix.
 */

export interface KpSample {
  readonly time: Instant;
  readonly kp: number;
  readonly aRunning: number | null;
}
export interface F107Sample {
  readonly time: Instant;
  readonly fluxSfu: number;
  readonly schedule: string;
  readonly ninetyDayMeanSfu: number | null;
}

const utc = (tag: string): Instant => Instant.parse(tag.endsWith('Z') ? tag : `${tag}Z`);

export function parseKp3Hourly(json: string): KpSample[] {
  const data = JSON.parse(json) as unknown;
  if (!Array.isArray(data)) throw new Error('unexpected Kp JSON');
  const out: KpSample[] = [];
  // Current format: array of objects. Legacy format: array of arrays with a header row.
  for (const item of data as unknown[]) {
    if (Array.isArray(item)) {
      if (item[0] === 'time_tag') continue;
      out.push({ time: utc(String(item[0])), kp: Number(item[1]), aRunning: Number(item[2]) });
    } else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      out.push({
        time: utc(String(o.time_tag)),
        kp: Number(o.Kp),
        aRunning: o.a_running === null || o.a_running === undefined ? null : Number(o.a_running),
      });
    }
  }
  return out.filter((s) => Number.isFinite(s.kp)).sort((a, b) => a.time.compare(b.time));
}

export function parseKp1Min(json: string): { time: Instant; kp: number }[] {
  const data = JSON.parse(json) as { time_tag: string; estimated_kp: number }[];
  if (!Array.isArray(data)) throw new Error('unexpected 1-minute Kp JSON');
  return data
    .filter((d) => Number.isFinite(d.estimated_kp))
    .map((d) => ({ time: utc(d.time_tag), kp: d.estimated_kp }))
    .sort((a, b) => a.time.compare(b.time));
}

export function parseF107(json: string): F107Sample[] {
  const data = JSON.parse(json) as {
    time_tag: string;
    flux: number;
    reporting_schedule: string;
    ninety_day_mean: number | null;
  }[];
  if (!Array.isArray(data)) throw new Error('unexpected F10.7 JSON');
  return data
    .filter((d) => Number.isFinite(d.flux))
    .map((d) => ({
      time: utc(d.time_tag),
      fluxSfu: d.flux,
      schedule: d.reporting_schedule,
      ninetyDayMeanSfu: d.ninety_day_mean ?? null,
    }))
    .sort((a, b) => a.time.compare(b.time));
}

export const NOAA_SWPC_SOURCE = {
  provider: 'noaa-swpc',
  license: 'US Government work (public domain); attribute NOAA Space Weather Prediction Center',
  attribution: 'NOAA / NWS Space Weather Prediction Center',
} as const;

const FEEDS = {
  kp3h: {
    key: 'noaa-swpc-kp3h',
    url: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
    minRefreshSeconds: 15 * 60,
    fixture: 'noaa-planetary-k-index.json',
  },
  kp1m: {
    key: 'noaa-swpc-kp1m',
    url: 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json',
    minRefreshSeconds: 5 * 60,
    fixture: 'noaa-planetary_k_index_1m.json',
  },
  f107: {
    key: 'noaa-swpc-f107',
    url: 'https://services.swpc.noaa.gov/json/f107_cm_flux.json',
    minRefreshSeconds: 30 * 60,
    fixture: 'noaa-f107_cm_flux.json',
  },
} as const;

export interface NoaaNowcast {
  readonly nowcast: NonNullable<SpaceWeatherState['nowcast']>;
  readonly retrievedAt: Instant;
}

export class NoaaSwpcProvider {
  private kp3h: KpSample[] = [];
  private kp1m: { time: Instant; kp: number }[] = [];
  private f107: F107Sample[] = [];
  private resources: Partial<Record<keyof typeof FEEDS, LoadedResource>> = {};
  private lastError: string | undefined;

  constructor(
    private readonly deps: {
      readonly cache: ResourceCache;
      /** Directory with the committed fixtures and its retrieval-time manifest, if any. */
      readonly fixtureDir?: string;
      readonly fixtureRetrievedAtUtc?: Record<string, string>;
      readonly now?: () => Instant;
    },
  ) {}

  private now(): Instant {
    return this.deps.now ? this.deps.now() : Instant.wallNow();
  }

  private spec(name: keyof typeof FEEDS): ResourceSpec {
    const f = FEEDS[name];
    const retrieved = this.deps.fixtureRetrievedAtUtc?.[f.fixture];
    return {
      key: f.key,
      providerId: NOAA_SWPC_SOURCE.provider,
      url: f.url,
      minRefreshSeconds: f.minRefreshSeconds,
      validate: (b) => {
        JSON.parse(b);
      },
      ...(this.deps.fixtureDir && retrieved
        ? { fixture: { path: `${this.deps.fixtureDir}/${f.fixture}`, retrievedAtUtc: retrieved } }
        : {}),
    };
  }

  async refresh(): Promise<void> {
    const errors: string[] = [];
    for (const name of Object.keys(FEEDS) as (keyof typeof FEEDS)[]) {
      try {
        const res = await this.deps.cache.load(this.spec(name));
        this.resources[name] = res;
        if (name === 'kp3h') this.kp3h = parseKp3Hourly(res.body);
        else if (name === 'kp1m') this.kp1m = parseKp1Min(res.body);
        else this.f107 = parseF107(res.body);
      } catch (e) {
        errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.lastError = errors.length ? errors.join('; ') : undefined;
  }

  status(): ProviderStatus {
    // Report the worst-case resource (oldest bytes) as the provider's state.
    const loaded = Object.values(this.resources).filter((r): r is LoadedResource => !!r);
    const oldest = loaded.sort((a, b) => a.retrievedAt.compare(b.retrievedAt))[0];
    return statusFromResource(
      {
        id: NOAA_SWPC_SOURCE.provider,
        label: 'Space weather observations (NOAA SWPC)',
        attribution: NOAA_SWPC_SOURCE.attribution,
        license: NOAA_SWPC_SOURCE.license,
        itemCount: this.kp3h.length + this.kp1m.length + this.f107.length,
        minRefreshSeconds: 5 * 60,
        notes: [
          'Near-real-time observations/estimates; used for the nowcast, not as model drivers.',
        ],
      },
      oldest,
      this.lastError,
      this.now(),
    );
  }

  /** Observations near `time`, if the feeds cover it. Returns undefined when nothing applies. */
  nowcastAt(time: Instant): NoaaNowcast | undefined {
    const r = this.resources.kp3h ?? this.resources.kp1m ?? this.resources.f107;
    if (!r) return undefined;
    const out: NonNullable<SpaceWeatherState['nowcast']> = {};

    // 3-hourly Kp: the interval [t0, t0+3h) containing `time`.
    const kp = this.kp3h.find(
      (s) => s.time.compare(time) <= 0 && time.secondsSince(s.time) < 3 * 3600,
    );
    if (kp) out.kp3Hourly = { timeUtc: kp.time.toIso(), kp: kp.kp, aRunning: kp.aRunning };

    // 1-minute estimated Kp: nearest sample within 2 minutes.
    const k1 = nearest(this.kp1m, time, 120);
    if (k1) out.kpEstimated1Min = { timeUtc: k1.time.toIso(), kp: k1.kp };

    // F10.7: most recent measurement at or before `time`, within 30 h (three per day).
    const f = [...this.f107].reverse().find((s) => s.time.compare(time) <= 0);
    if (f && time.secondsSince(f.time) <= 30 * 3600) {
      out.f107 = {
        timeUtc: f.time.toIso(),
        fluxSfu: f.fluxSfu,
        schedule: f.schedule,
        ninetyDayMeanSfu: f.ninetyDayMeanSfu,
      };
    }
    if (!out.kp3Hourly && !out.kpEstimated1Min && !out.f107) return undefined;
    return { nowcast: out, retrievedAt: r.retrievedAt };
  }
}

function nearest<T extends { time: Instant }>(
  items: readonly T[],
  t: Instant,
  maxSeconds: number,
): T | undefined {
  let best: T | undefined;
  let bestD = Infinity;
  for (const it of items) {
    const d = Math.abs(it.time.secondsSince(t));
    if (d < bestD) {
      bestD = d;
      best = it;
    }
  }
  return bestD <= maxSeconds ? best : undefined;
}
