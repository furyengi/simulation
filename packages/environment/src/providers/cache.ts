import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Instant } from '@simulation/physics';
import { defaultFetcher, ProviderUnavailableError, type Fetcher } from './http';

/**
 * Disk-backed cache for external resources with rate-limit-aware refresh.
 *
 * Behaviour for `load(spec)`:
 *  1. A cached copy younger than `minRefreshSeconds` is returned without touching the network.
 *     This is how CelesTrak's "at most once per 2 hours" rule is honoured — across process restarts,
 *     because the retrieval time is persisted with the body.
 *  2. Otherwise (and unless offline) the resource is fetched; success replaces the cache.
 *  3. If the fetch fails, or we are offline, the last good copy is served and flagged `stale`.
 *  4. With no cache, a committed fixture is used (flagged `fixture`, with its own honest retrieval
 *     time), so the engine stays usable without a network.
 *  5. Only if none of these exist is `ProviderUnavailableError` thrown.
 *
 * Every result carries the retrieval time of the bytes actually served, never "now".
 */

export interface ResourceSpec {
  /** Cache key; also the file name stem. Must be filesystem-safe. */
  readonly key: string;
  readonly providerId: string;
  readonly url: string;
  /** Do not hit the network again before this many seconds have passed since the last success. */
  readonly minRefreshSeconds: number;
  readonly headers?: Readonly<Record<string, string>>;
  /** Committed fallback. `retrievedAtUtc` is when the fixture was downloaded. */
  readonly fixture?: { readonly path: string; readonly retrievedAtUtc: string };
  /** Validate the body before it is cached (e.g. reject an HTML error page served with HTTP 200). */
  readonly validate?: (body: string) => void;
}

export type ResourceOrigin = 'network' | 'cache' | 'cache-stale' | 'fixture';

export interface LoadedResource {
  readonly key: string;
  readonly body: string;
  /** When these bytes were obtained from the provider. */
  readonly retrievedAt: Instant;
  readonly origin: ResourceOrigin;
  readonly url: string;
  /** Why a refresh was not possible, when `origin` is `cache-stale` or `fixture`. */
  readonly refreshError?: string;
}

interface CacheMeta {
  readonly url: string;
  readonly retrievedAtUtc: string;
}

export class ResourceCache {
  constructor(
    private readonly options: {
      readonly dir: string;
      readonly offline: boolean;
      readonly fetcher?: Fetcher;
      /** Wall clock, injectable for tests. */
      readonly now?: () => Instant;
    },
  ) {}

  private get fetcher(): Fetcher {
    return this.options.fetcher ?? defaultFetcher;
  }
  private now(): Instant {
    return this.options.now ? this.options.now() : Instant.wallNow();
  }
  private paths(key: string): { body: string; meta: string } {
    return {
      body: join(this.options.dir, `${key}.body`),
      meta: join(this.options.dir, `${key}.meta.json`),
    };
  }

  private async readCached(key: string): Promise<{ body: string; meta: CacheMeta } | undefined> {
    const p = this.paths(key);
    try {
      const [body, meta] = await Promise.all([readFile(p.body, 'utf8'), readFile(p.meta, 'utf8')]);
      return { body, meta: JSON.parse(meta) as CacheMeta };
    } catch {
      return undefined;
    }
  }

  private async writeCached(key: string, body: string, meta: CacheMeta): Promise<void> {
    const p = this.paths(key);
    await mkdir(dirname(p.body), { recursive: true });
    // Write-then-rename so a crash never leaves a half-written cache entry.
    await writeFile(`${p.body}.tmp`, body);
    await writeFile(`${p.meta}.tmp`, JSON.stringify(meta));
    await rename(`${p.body}.tmp`, p.body);
    await rename(`${p.meta}.tmp`, p.meta);
  }

  async load(spec: ResourceSpec): Promise<LoadedResource> {
    const cached = await this.readCached(spec.key);
    const now = this.now();
    let cachedAt: Instant | undefined;
    if (cached) {
      try {
        cachedAt = Instant.parse(cached.meta.retrievedAtUtc);
      } catch {
        cachedAt = undefined;
      }
    }

    if (cached && cachedAt) {
      const ageS = now.secondsSince(cachedAt);
      if (ageS >= 0 && ageS < spec.minRefreshSeconds) {
        return {
          key: spec.key,
          body: cached.body,
          retrievedAt: cachedAt,
          origin: 'cache',
          url: spec.url,
        };
      }
    }

    let refreshError: string | undefined;
    if (this.options.offline) {
      refreshError = 'offline mode (SIM_OFFLINE=1)';
    } else {
      try {
        const res = await this.fetcher(spec.url, spec.headers ? { headers: spec.headers } : {});
        if (res.status < 200 || res.status >= 300) {
          throw new Error(
            `HTTP ${res.status}${res.text.length < 200 ? `: ${res.text.trim()}` : ''}`,
          );
        }
        spec.validate?.(res.text);
        const retrievedAt = this.now();
        await this.writeCached(spec.key, res.text, {
          url: spec.url,
          retrievedAtUtc: retrievedAt.toIso(),
        });
        return { key: spec.key, body: res.text, retrievedAt, origin: 'network', url: spec.url };
      } catch (e) {
        refreshError = e instanceof Error ? e.message : String(e);
      }
    }

    if (cached && cachedAt) {
      return {
        key: spec.key,
        body: cached.body,
        retrievedAt: cachedAt,
        origin: 'cache-stale',
        url: spec.url,
        ...(refreshError ? { refreshError } : {}),
      };
    }
    if (spec.fixture) {
      const body = await readFile(spec.fixture.path, 'utf8');
      return {
        key: spec.key,
        body,
        retrievedAt: Instant.parse(spec.fixture.retrievedAtUtc),
        origin: 'fixture',
        url: spec.url,
        ...(refreshError ? { refreshError } : {}),
      };
    }
    throw new ProviderUnavailableError(spec.providerId, refreshError ?? 'no data available');
  }
}
