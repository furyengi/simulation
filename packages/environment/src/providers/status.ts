import type { ProviderStatus } from '@simulation/schemas';
import type { Instant } from '@simulation/physics';
import type { LoadedResource } from './cache';

const SECONDS_PER_HOUR = 3600;

export interface StatusMeta {
  readonly id: string;
  readonly label: string;
  readonly attribution?: string;
  readonly license?: string;
  readonly itemCount?: number;
  readonly minRefreshSeconds?: number;
  readonly notes?: readonly string[];
}

/** Derive the user-visible provider status from the resource actually in use. */
export function statusFromResource(
  meta: StatusMeta,
  resource: LoadedResource | undefined,
  lastError: string | undefined,
  now: Instant,
): ProviderStatus {
  const base = {
    id: meta.id,
    label: meta.label,
    ...(meta.attribution ? { attribution: meta.attribution } : {}),
    ...(meta.license ? { license: meta.license } : {}),
    ...(meta.itemCount !== undefined ? { itemCount: meta.itemCount } : {}),
    ...(meta.notes ? { notes: [...meta.notes] } : {}),
  };
  if (!resource) {
    return {
      ...base,
      state: 'unavailable',
      origin: 'none',
      ...(lastError ? { lastError } : {}),
    };
  }
  const offline = resource.refreshError?.startsWith('offline') === true;
  const state: ProviderStatus['state'] =
    resource.origin === 'fixture'
      ? 'fixture'
      : offline
        ? 'offline'
        : resource.origin === 'cache-stale'
          ? 'stale'
          : 'ok';
  const next =
    meta.minRefreshSeconds !== undefined && resource.origin !== 'fixture'
      ? resource.retrievedAt.plusSeconds(meta.minRefreshSeconds).toIso()
      : undefined;
  return {
    ...base,
    state,
    origin: resource.origin,
    url: resource.url,
    retrievedAtUtc: resource.retrievedAt.toIso(),
    retrievalAgeSeconds: now.secondsSince(resource.retrievedAt),
    ...(next ? { nextRefreshNotBeforeUtc: next } : {}),
    ...((resource.refreshError ?? lastError)
      ? { lastError: (resource.refreshError ?? lastError) as string }
      : {}),
  };
}

/** True when a dataset last refreshed more than `hours` ago (used for limitations text). */
export const olderThanHours = (retrieved: Instant, now: Instant, hours: number): boolean =>
  now.secondsSince(retrieved) > hours * SECONDS_PER_HOUR;
