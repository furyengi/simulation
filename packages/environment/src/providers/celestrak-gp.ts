import { Instant } from '@simulation/physics';
import { OmmRecordSchema, type OrbitalElementSet, type ProviderStatus } from '@simulation/schemas';
import { type ResourceCache, type LoadedResource } from './cache';
import { statusFromResource } from './status';

/**
 * Orbital element sets from CelesTrak's GP API in CCSDS OMM JSON
 * (https://celestrak.org/NORAD/documentation/gp-data-formats.php).
 *
 * Usage policy (https://celestrak.org/usage-policy.php): GP data are regenerated once every
 * 2 hours; downloading more often gains nothing and since 2026-03-26 a second request before the
 * next update is answered with HTTP 403, and abusive clients are blocked. So each group is fetched at
 * most once per 2 hours (persisted across restarts by the resource cache) and the last good copy
 * is served if a refresh fails.
 *
 * An OMM is a set of *mean elements fitted to observations* at its epoch, meant to be propagated
 * with SGP4. It is not a live position report.
 */

export const CELESTRAK_GP_MIN_REFRESH_SECONDS = 2 * 3600;

export const CELESTRAK_GP_SOURCE = {
  provider: 'celestrak',
  license:
    'CelesTrak GP data derive from the US Space Force 18th/18th SDS catalogue; free to use — see celestrak.org for terms',
  attribution: 'CelesTrak (T.S. Kelso); orbital data originate with the U.S. Space Force',
} as const;

export const gpUrl = (group: string): string =>
  `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=json`;

export interface GpGroupFixture {
  readonly path: string;
  readonly retrievedAtUtc: string;
}

export class CelestrakGpProvider {
  private sets = new Map<number, OrbitalElementSet>();
  private resources = new Map<string, LoadedResource>();
  private errors: string[] = [];
  private invalidRecords = 0;

  constructor(
    private readonly deps: {
      readonly cache: ResourceCache;
      /** CelesTrak GP group names, e.g. `stations`, `gps-ops`, `active`. */
      readonly groups: readonly string[];
      readonly fixtures?: Readonly<Record<string, GpGroupFixture>>;
      readonly now?: () => Instant;
    },
  ) {}

  private now(): Instant {
    return this.deps.now ? this.deps.now() : Instant.wallNow();
  }

  async refresh(): Promise<void> {
    this.errors = [];
    const next = new Map<number, OrbitalElementSet>();
    this.invalidRecords = 0;
    for (const group of this.deps.groups) {
      try {
        const fx = this.deps.fixtures?.[group];
        const res = await this.deps.cache.load({
          key: `celestrak-gp-${group}`,
          providerId: CELESTRAK_GP_SOURCE.provider,
          url: gpUrl(group),
          minRefreshSeconds: CELESTRAK_GP_MIN_REFRESH_SECONDS,
          validate: (b) => {
            const parsed: unknown = JSON.parse(b);
            if (!Array.isArray(parsed)) throw new Error('GP response is not a JSON array');
          },
          ...(fx ? { fixture: fx } : {}),
        });
        this.resources.set(group, res);
        for (const raw of JSON.parse(res.body) as unknown[]) {
          const p = OmmRecordSchema.safeParse(raw);
          if (!p.success) {
            this.invalidRecords++;
            continue;
          }
          const omm = p.data;
          const prev = next.get(omm.NORAD_CAT_ID);
          // Same object in several groups: keep the newest element set.
          if (
            !prev ||
            Instant.parse(iso(omm.EPOCH)).compare(Instant.parse(iso(prev.omm.EPOCH))) > 0
          ) {
            next.set(omm.NORAD_CAT_ID, {
              omm,
              provider: CELESTRAK_GP_SOURCE.provider,
              dataset: `GP/${group}`,
              url: gpUrl(group),
              retrievedAtUtc: res.retrievedAt.toIso(),
            });
          }
        }
      } catch (e) {
        this.errors.push(`${group}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (next.size > 0 || this.sets.size === 0) this.sets = next;
  }

  all(): OrbitalElementSet[] {
    return [...this.sets.values()];
  }
  get(noradId: number): OrbitalElementSet | undefined {
    return this.sets.get(noradId);
  }
  get size(): number {
    return this.sets.size;
  }

  status(): ProviderStatus {
    const loaded = [...this.resources.values()].sort((a, b) =>
      a.retrievedAt.compare(b.retrievedAt),
    );
    const notes = [
      `Groups: ${this.deps.groups.join(', ')}. Refreshed at most once per 2 hours (CelesTrak policy).`,
      'Element sets are mean elements to be propagated with SGP4 — not live positions.',
    ];
    if (this.invalidRecords) notes.push(`${this.invalidRecords} malformed records were skipped.`);
    return statusFromResource(
      {
        id: CELESTRAK_GP_SOURCE.provider,
        label: 'Orbital elements (CelesTrak GP, OMM)',
        attribution: CELESTRAK_GP_SOURCE.attribution,
        license: CELESTRAK_GP_SOURCE.license,
        itemCount: this.sets.size,
        minRefreshSeconds: CELESTRAK_GP_MIN_REFRESH_SECONDS,
        notes,
      },
      loaded[0],
      this.errors.length ? this.errors.join('; ') : undefined,
      this.now(),
    );
  }
}

/** CelesTrak omits the trailing Z on OMM epochs. */
export const iso = (epoch: string): string => {
  const z = epoch.endsWith('Z') ? epoch : `${epoch}Z`;
  return z.replace(/\.(\d+)Z$/, (_m, f: string) => `.${f.slice(0, 6)}Z`);
};
