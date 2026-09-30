import { Instant } from '@simulation/physics';
import type { Freshness, ProviderStatus, SpaceWeatherState } from '@simulation/schemas';
import { type ResourceCache, type LoadedResource, type ResourceSpec } from '../cache';
import { statusFromResource } from '../status';

/**
 * Space-weather indices from CelesTrak's compilation of authoritative sources
 * (https://celestrak.org/SpaceData/):
 *   Kp, Ap, Cp, C9    — GFZ German Research Centre for Geosciences, Potsdam (CC BY 4.0)
 *   F10.7             — Canadian NRC / CSA, Penticton
 *   sunspot number    — SIDC / SILSO
 *   45-day forecast   — NOAA Space Weather Prediction Center
 *   monthly prediction— NASA/MSFC
 * Each daily row carries a data-type flag (OBS / INT / PRD / PRM); we preserve it and never present
 * a forecast as an observation.
 *
 * Columns used (units as published): DATE (UTC day), KP1–KP8 (Kp × 10, 3-hourly), AP_AVG (daily Ap),
 * F10.7_OBS (sfu, observed), F10.7_ADJ (sfu, adjusted to 1 au), F10.7_OBS_CENTER81 (81-day centred mean).
 */

export type SwDataType = 'OBS' | 'INT' | 'PRD' | 'PRM';

export interface DailyIndices {
  /** `YYYY-MM-DD` (UTC). */
  readonly date: string;
  readonly dayStart: Instant;
  /** Eight 3-hourly Kp values in Kp units (0–9), null when the source row has none. */
  readonly kp: readonly (number | null)[];
  readonly apDaily: number | null;
  readonly f107Obs: number | null;
  readonly f107Adj: number | null;
  readonly f107ObsCenter81: number | null;
  readonly sunspotNumber: number | null;
  readonly dataType: SwDataType;
}

const numOrNull = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === '') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};

export function parseCelestrakSwCsv(csv: string): DailyIndices[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0]?.split(',').map((h) => h.trim());
  if (!header) throw new Error('space-weather CSV is empty');
  const idx = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`space-weather CSV is missing column "${name}"`);
    return i;
  };
  const iDate = idx('DATE');
  const iKp = Array.from({ length: 8 }, (_, k) => idx(`KP${k + 1}`));
  const iAp = idx('AP_AVG');
  const iObs = idx('F10.7_OBS');
  const iAdj = idx('F10.7_ADJ');
  const iType = idx('F10.7_DATA_TYPE');
  const iC81 = idx('F10.7_OBS_CENTER81');
  const iIsn = idx('ISN');

  const rows: DailyIndices[] = [];
  for (const line of lines.slice(1)) {
    const f = line.split(',');
    const date = f[iDate]?.trim();
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const t = f[iType]?.trim();
    const dataType: SwDataType = t === 'INT' || t === 'PRD' || t === 'PRM' ? t : 'OBS';
    rows.push({
      date,
      dayStart: Instant.parse(`${date}T00:00:00Z`),
      kp: iKp.map((i) => {
        const v = numOrNull(f[i]);
        return v === null ? null : v / 10; // published ×10
      }),
      apDaily: numOrNull(f[iAp]),
      f107Obs: numOrNull(f[iObs]),
      f107Adj: numOrNull(f[iAdj]),
      f107ObsCenter81: numOrNull(f[iC81]),
      sunspotNumber: numOrNull(f[iIsn]),
      dataType,
    });
  }
  rows.sort((a, b) => a.dayStart.unixMicros - b.dayStart.unixMicros);
  return rows;
}

const DAY_S = 86_400;

export const CELESTRAK_SW_SOURCE = {
  provider: 'celestrak-space-weather',
  dataset: 'SW-Last5Years.csv',
  url: 'https://celestrak.org/SpaceData/SW-Last5Years.csv',
  license: 'GFZ Kp/Ap: CC BY 4.0; other components per their originators (see attribution)',
  attribution:
    'Geomagnetic indices: GFZ Helmholtz Centre for Geosciences, Potsdam (CC BY 4.0). Solar flux F10.7: NRC/CSA Penticton. ' +
    'Forecasts: NOAA SWPC, NASA/MSFC. Compiled and served by CelesTrak (T.S. Kelso).',
} as const;

export type SwLookup =
  | {
      readonly status: 'ok';
      readonly state: SpaceWeatherState;
      /** Epoch the value describes (the UTC day start). */
      readonly sourceEpoch: Instant;
      readonly retrievedAt: Instant;
      readonly freshness: Freshness;
      readonly limitations: string[];
    }
  | { readonly status: 'unavailable'; readonly code: string; readonly reason: string };

export interface SpaceWeatherHistoryProvider {
  refresh(): Promise<void>;
  /** Load additional (older) data when `time` precedes current coverage. */
  ensureCovers(time: Instant): Promise<void>;
  lookup(time: Instant): SwLookup;
  status(): ProviderStatus;
}

export class CelestrakSpaceWeatherProvider implements SpaceWeatherHistoryProvider {
  private rows: DailyIndices[] = [];
  private byDate = new Map<string, DailyIndices>();
  private resource: LoadedResource | undefined;
  private extended = false;
  private lastError: string | undefined;

  constructor(
    private readonly deps: {
      readonly cache: ResourceCache;
      readonly fixturePath?: string;
      readonly fixtureRetrievedAtUtc?: string;
      readonly now?: () => Instant;
    },
  ) {}

  private now(): Instant {
    return this.deps.now ? this.deps.now() : Instant.wallNow();
  }

  private spec(all: boolean): ResourceSpec {
    const file = all ? 'SW-All.csv' : 'SW-Last5Years.csv';
    return {
      key: all ? 'celestrak-sw-all' : 'celestrak-sw-last5years',
      providerId: CELESTRAK_SW_SOURCE.provider,
      url: `https://celestrak.org/SpaceData/${file}`,
      // SW data changes at most every 3 h (forecast updates); be conservative and gentle.
      minRefreshSeconds: 3 * 3600,
      validate: (b) => {
        if (!b.startsWith('DATE,'))
          throw new Error('unexpected response (not the space-weather CSV)');
      },
      ...(!all && this.deps.fixturePath && this.deps.fixtureRetrievedAtUtc
        ? {
            fixture: {
              path: this.deps.fixturePath,
              retrievedAtUtc: this.deps.fixtureRetrievedAtUtc,
            },
          }
        : {}),
    };
  }

  private ingest(res: LoadedResource): void {
    const parsed = parseCelestrakSwCsv(res.body);
    this.rows = parsed;
    this.byDate = new Map(parsed.map((r) => [r.date, r]));
    this.resource = res;
  }

  async refresh(): Promise<void> {
    try {
      this.ingest(await this.deps.cache.load(this.spec(this.extended)));
      this.lastError = undefined;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      if (this.rows.length === 0) throw e;
    }
  }

  async ensureCovers(time: Instant): Promise<void> {
    const first = this.rows[0];
    if (this.extended || (first && time.compare(first.dayStart.plusSeconds(-DAY_S)) >= 0)) return;
    try {
      this.ingest(await this.deps.cache.load(this.spec(true)));
      this.extended = true;
      this.lastError = undefined;
    } catch (e) {
      this.lastError = `full history unavailable: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  status(): ProviderStatus {
    return statusFromResource(
      {
        id: CELESTRAK_SW_SOURCE.provider,
        label: 'Space weather indices (CelesTrak / GFZ / NRC / NOAA)',
        attribution: CELESTRAK_SW_SOURCE.attribution,
        license: CELESTRAK_SW_SOURCE.license,
        itemCount: this.rows.length,
        minRefreshSeconds: 3 * 3600,
        notes: [
          'Rows flagged PRD/PRM are forecasts, not observations.',
          this.extended
            ? 'Full history (SW-All.csv) loaded.'
            : 'Covers ~5 years; full history loads on demand.',
        ],
      },
      this.resource,
      this.lastError,
      this.now(),
    );
  }

  lookup(time: Instant): SwLookup {
    const first = this.rows[0];
    const last = this.rows[this.rows.length - 1];
    if (!first || !last || !this.resource) {
      return {
        status: 'unavailable',
        code: 'NO_SPACE_WEATHER_DATA',
        reason: 'No space-weather dataset is loaded',
      };
    }
    const day = time.toIso().slice(0, 10);
    const dayStart = Instant.parse(`${day}T00:00:00Z`);
    if (dayStart.compare(first.dayStart.plusSeconds(DAY_S)) < 0) {
      return {
        status: 'unavailable',
        code: 'BEFORE_SPACE_WEATHER_COVERAGE',
        reason: `Loaded space-weather data begins ${first.date}${this.extended ? '' : ' (full history not loaded)'}`,
      };
    }
    if (dayStart.compare(last.dayStart) > 0) {
      return {
        status: 'unavailable',
        code: 'AFTER_SPACE_WEATHER_COVERAGE',
        reason: `Space-weather predictions end ${last.date}`,
      };
    }

    // Exact daily row, else hold the most recent earlier row (monthly prediction period).
    let row = this.byDate.get(day);
    let held = false;
    if (!row) {
      let lo = 0;
      let hi = this.rows.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (this.rows[mid]!.dayStart.compare(dayStart) <= 0) lo = mid;
        else hi = mid;
      }
      row = this.rows[lo]!;
      held = true;
    }

    const prevDay = new Date(dayStart.toDate().getTime() - DAY_S * 1000).toISOString().slice(0, 10);
    const prev = this.byDate.get(prevDay) ?? (held ? row : undefined);

    const f107Prev = prev?.f107Obs ?? null;
    const f107Avg = row.f107ObsCenter81;
    const ap = row.apDaily;
    let msisInputs: SpaceWeatherState['msisInputs'] = null;
    let reason: string | undefined;
    if (f107Prev !== null && f107Avg !== null && ap !== null) {
      msisInputs = { f107Sfu: f107Prev, f107AvgSfu: f107Avg, apDaily: ap };
    } else {
      const missing = [
        f107Prev === null ? "previous day's F10.7" : undefined,
        f107Avg === null ? '81-day mean F10.7' : undefined,
        ap === null ? 'daily Ap' : undefined,
      ].filter(Boolean);
      reason =
        `${missing.join(', ')} not available for ${day}` +
        (row.dataType === 'PRM'
          ? ' (long-range monthly prediction period: no geomagnetic forecast exists)'
          : '');
    }

    const limitations: string[] = [];
    if (row.dataType === 'PRD')
      limitations.push('Forecast values (NOAA 45-day forecast), not observations.');
    if (row.dataType === 'PRM')
      limitations.push(
        'Long-range monthly prediction (NASA/MSFC); F10.7 only, held between monthly points.',
      );
    if (row.dataType === 'INT')
      limitations.push(
        'Observations missing for this day; F10.7 was linearly interpolated by the compiler.',
      );
    if (held && row.dataType !== 'PRM') limitations.push(`No row for ${day}; holding ${row.date}.`);

    const freshness: Freshness =
      row.dataType === 'OBS' ? 'FRESH' : row.dataType === 'INT' ? 'AGING' : 'PREDICTED';

    const state: SpaceWeatherState = {
      dayUtc: day,
      dataType: row.dataType,
      f107ObsSfu: row.f107Obs,
      f107PreviousDayObsSfu: f107Prev,
      f107Avg81CenteredSfu: f107Avg,
      apDaily: ap,
      kp3Hourly: [...row.kp],
      msisInputs,
      ...(reason ? { msisInputsUnavailableReason: reason } : {}),
    };
    return {
      status: 'ok',
      state,
      sourceEpoch: row.dayStart,
      retrievedAt: this.resource.retrievedAt,
      freshness,
      limitations,
    };
  }
}
