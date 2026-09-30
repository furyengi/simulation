import { describe, expect, it } from 'vitest';
import { Instant } from '@simulation/physics';
import { ProviderUnavailableError } from '../src/providers/http';
import { statusFromResource } from '../src/providers/status';
import { FakeClock, makeFetcher, newCache, withTempDir } from './helpers';

const T0 = Instant.parse('2026-09-30T12:00:00Z');
const spec = {
  key: 'unit',
  providerId: 'test',
  url: 'https://example.invalid/data',
  minRefreshSeconds: 7200,
};

describe('ResourceCache', () => {
  it('fetches once, then serves the cache inside the minimum refresh interval', async () => {
    await withTempDir(async (dir) => {
      const clock = new FakeClock(T0);
      const f = makeFetcher(() => ({ status: 200, text: 'v1' }));
      const cache = newCache(dir, { fetcher: f, clock });
      const a = await cache.load(spec);
      expect(a).toMatchObject({ body: 'v1', origin: 'network' });
      clock.advance(3600);
      const b = await cache.load(spec);
      expect(b).toMatchObject({ body: 'v1', origin: 'cache' });
      expect(b.retrievedAt.equals(T0)).toBe(true); // retrieval time is that of the bytes, not "now"
      expect(f.calls.length).toBe(1);
    });
  });

  it('honours the rate limit across process restarts (cache is on disk)', async () => {
    await withTempDir(async (dir) => {
      const clock = new FakeClock(T0);
      const f1 = makeFetcher(() => ({ status: 200, text: 'v1' }));
      await newCache(dir, { fetcher: f1, clock }).load(spec);
      clock.advance(600);
      const f2 = makeFetcher(() => ({ status: 200, text: 'v2' }));
      const second = await newCache(dir, { fetcher: f2, clock }).load(spec);
      expect(second.body).toBe('v1');
      expect(f2.calls.length).toBe(0);
    });
  });

  it('refreshes after the interval elapses', async () => {
    await withTempDir(async (dir) => {
      const clock = new FakeClock(T0);
      let n = 0;
      const f = makeFetcher(() => ({ status: 200, text: `v${++n}` }));
      const cache = newCache(dir, { fetcher: f, clock });
      await cache.load(spec);
      clock.advance(7201);
      const r = await cache.load(spec);
      expect(r).toMatchObject({ body: 'v2', origin: 'network' });
    });
  });

  it('serves the last good copy, flagged stale, when a refresh fails', async () => {
    await withTempDir(async (dir) => {
      const clock = new FakeClock(T0);
      const f = makeFetcher(() => ({ status: 200, text: 'good' }));
      const cache = newCache(dir, { fetcher: f, clock });
      await cache.load(spec);
      clock.advance(10_000);
      f.respond = () => new Error('connect ETIMEDOUT');
      const r = await cache.load(spec);
      expect(r).toMatchObject({ body: 'good', origin: 'cache-stale' });
      expect(r.refreshError).toMatch(/ETIMEDOUT/);
      expect(r.retrievedAt.equals(T0)).toBe(true);
      const st = statusFromResource({ id: 't', label: 'T' }, r, undefined, clock.now());
      expect(st.state).toBe('stale');
      expect(st.retrievalAgeSeconds).toBe(10_000);
    });
  });

  it('treats HTTP errors and validation failures as failed refreshes, never caching them', async () => {
    await withTempDir(async (dir) => {
      const clock = new FakeClock(T0);
      const f = makeFetcher(() => ({
        status: 403,
        text: 'GP data has not updated since your last successful download',
      }));
      const cache = newCache(dir, { fetcher: f, clock });
      await expect(cache.load(spec)).rejects.toBeInstanceOf(ProviderUnavailableError);
      f.respond = () => ({ status: 200, text: '<html>oops</html>' });
      await expect(
        cache.load({
          ...spec,
          validate: (b) => {
            if (!b.startsWith('{')) throw new Error('not JSON');
          },
        }),
      ).rejects.toThrow(/not JSON/);
    });
  });

  it('falls back to a committed fixture when there is no cache and no network, with its own age', async () => {
    await withTempDir(async (dir) => {
      const clock = new FakeClock(T0);
      const f = makeFetcher(() => new Error('ENOTFOUND'));
      const cache = newCache(dir, { fetcher: f, clock });
      const r = await cache.load({
        ...spec,
        fixture: {
          path: new URL('../data/fixtures/manifest.json', import.meta.url).pathname.replace(
            /^\/([A-Za-z]:)/,
            '$1',
          ),
          retrievedAtUtc: '2026-09-30T16:16:31.435Z',
        },
      });
      expect(r.origin).toBe('fixture');
      expect(r.retrievedAt.toIso()).toBe('2026-09-30T16:16:31.435Z');
      expect(r.refreshError).toMatch(/ENOTFOUND/);
    });
  });

  it('never touches the network in offline mode', async () => {
    await withTempDir(async (dir) => {
      const clock = new FakeClock(T0);
      const f = makeFetcher(() => ({ status: 200, text: 'x' }));
      const cache = newCache(dir, { fetcher: f, clock, offline: true });
      await expect(cache.load(spec)).rejects.toBeInstanceOf(ProviderUnavailableError);
      expect(f.calls.length).toBe(0);
    });
  });

  it('reports offline status when serving cache in offline mode', async () => {
    await withTempDir(async (dir) => {
      const clock = new FakeClock(T0);
      await newCache(dir, { fetcher: makeFetcher(() => ({ status: 200, text: 'x' })), clock }).load(
        spec,
      );
      clock.advance(99_999);
      const off = await newCache(dir, { clock, offline: true }).load(spec);
      expect(off.origin).toBe('cache-stale');
      expect(statusFromResource({ id: 't', label: 'T' }, off, undefined, clock.now()).state).toBe(
        'offline',
      );
    });
  });
});
