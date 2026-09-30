import { EopTable, Instant, type EopLookup } from '@simulation/physics';
import type { ProviderStatus } from '@simulation/schemas';
import { type ResourceCache, type LoadedResource } from './cache';
import { statusFromResource } from './status';

/**
 * Earth Orientation Parameters (UT1−UTC, polar motion, LOD, ΔAT) from CelesTrak's `EOP-*.csv`,
 * itself derived from the IERS EOP 14 C04 series with IERS Bulletin A predictions (~180 days).
 * `DATA_TYPE` O/P (observed/predicted) is preserved per row and surfaces as `EopQuality`.
 */
export const EOP_SOURCE = {
  provider: 'iers-eop-via-celestrak',
  dataset: 'EOP-Last5Years.csv',
  url: 'https://celestrak.org/SpaceData/EOP-Last5Years.csv',
  license: 'IERS Earth Orientation Center data; redistributed by CelesTrak',
  attribution: 'International Earth Rotation and Reference Systems Service (IERS); CelesTrak',
} as const;

export class EopProvider {
  private table = EopTable.none();
  private resource: LoadedResource | undefined;
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

  async refresh(): Promise<void> {
    try {
      const res = await this.deps.cache.load({
        key: 'celestrak-eop-last5years',
        providerId: EOP_SOURCE.provider,
        url: EOP_SOURCE.url,
        // EOP series are updated daily; once per 6 h is plenty.
        minRefreshSeconds: 6 * 3600,
        validate: (b) => {
          if (!b.startsWith('DATE,')) throw new Error('unexpected response (not the EOP CSV)');
        },
        ...(this.deps.fixturePath && this.deps.fixtureRetrievedAtUtc
          ? {
              fixture: {
                path: this.deps.fixturePath,
                retrievedAtUtc: this.deps.fixtureRetrievedAtUtc,
              },
            }
          : {}),
      });
      this.table = EopTable.parseCelestrakCsv(res.body);
      this.resource = res;
      this.lastError = undefined;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
    }
  }

  /** Lookup used by the frame model. */
  readonly eop = {
    lookup: (t: Instant): EopLookup => this.table.lookup(t),
  };

  get retrievedAt(): Instant | undefined {
    return this.resource?.retrievedAt;
  }

  /** Coverage of the loaded table in UTC days: first row, last observed row, last row. */
  coverage(): { first: string; lastObserved: string; last: string } | undefined {
    const f = this.table.firstMjd;
    const l = this.table.lastMjd;
    const o = this.table.lastObservedMjd;
    if (f === undefined || l === undefined || o === undefined) return undefined;
    const iso = (mjd: number) =>
      Instant.fromUnixMillis((mjd - 40587) * 86_400_000)
        .toIso()
        .slice(0, 10);
    return { first: iso(f), lastObserved: iso(o), last: iso(l) };
  }

  status(): ProviderStatus {
    const cov = this.coverage();
    return statusFromResource(
      {
        id: EOP_SOURCE.provider,
        label: 'Earth orientation parameters (IERS via CelesTrak)',
        attribution: EOP_SOURCE.attribution,
        license: EOP_SOURCE.license,
        itemCount: this.table.size,
        minRefreshSeconds: 6 * 3600,
        notes: cov
          ? [
              `Coverage ${cov.first} … ${cov.last}; observed through ${cov.lastObserved}, predictions after.`,
              'Outside coverage the frame model uses zeros and reports UNAVAILABLE (≲ 0.4 km error).',
            ]
          : ['No EOP data loaded: frame model uses zeros (≲ 0.4 km error).'],
      },
      this.resource,
      this.lastError,
      this.now(),
    );
  }
}
