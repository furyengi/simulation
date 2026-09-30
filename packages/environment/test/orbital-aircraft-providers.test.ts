import { describe, expect, it } from 'vitest';
import { Instant } from '@simulation/physics';
import { CelestrakGpProvider, gpUrl } from '../src/providers/celestrak-gp';
import { OpenSkyProvider, parseOpenSkyStates } from '../src/providers/opensky';
import {
  FakeClock,
  fixturePath,
  fixtureRetrievedAt,
  makeFetcher,
  newCache,
  readFixture,
  withTempDir,
} from './helpers';

const NOW = Instant.parse('2026-09-30T17:00:00Z');

describe('CelesTrak GP provider', () => {
  const fixtures = {
    stations: {
      path: fixturePath('celestrak-gp-stations.json'),
      retrievedAtUtc: fixtureRetrievedAt('celestrak-gp-stations.json'),
    },
  };

  it('loads the stations group from the fixture when offline, preserving source and retrieval time', async () => {
    await withTempDir(async (dir) => {
      const clock = new FakeClock(NOW);
      const p = new CelestrakGpProvider({
        cache: newCache(dir, { clock, offline: true }),
        groups: ['stations'],
        fixtures,
        now: clock.now,
      });
      await p.refresh();
      const iss = p.get(25544);
      expect(iss?.omm.OBJECT_NAME).toBe('ISS (ZARYA)');
      expect(iss?.provider).toBe('celestrak');
      expect(iss?.dataset).toBe('GP/stations');
      expect(iss?.retrievedAtUtc).toBe(fixtureRetrievedAt('celestrak-gp-stations.json'));
      expect(iss?.omm.INCLINATION).toBeCloseTo(51.6, 0);
      expect(p.status().state).toBe('fixture');
      expect(p.status().notes?.join(' ')).toMatch(/2 hours/);
    });
  });

  it('never requests a group more than once per 2 hours', async () => {
    await withTempDir(async (dir) => {
      const clock = new FakeClock(NOW);
      const f = makeFetcher(() => ({
        status: 200,
        text: readFixture('celestrak-gp-stations.json'),
      }));
      const make = () =>
        new CelestrakGpProvider({
          cache: newCache(dir, { clock, fetcher: f }),
          groups: ['stations'],
          now: clock.now,
        });
      await make().refresh();
      clock.advance(600);
      await make().refresh(); // a fresh process a few minutes later
      clock.advance(3000);
      await make().refresh();
      expect(f.calls).toEqual([gpUrl('stations')]);
      clock.advance(7200);
      await make().refresh();
      expect(f.calls.length).toBe(2);
    });
  });

  it('skips malformed records instead of inventing values, and reports how many', async () => {
    await withTempDir(async (dir) => {
      const clock = new FakeClock(NOW);
      const good = JSON.parse(readFixture('celestrak-gp-stations.json')) as Record<
        string,
        unknown
      >[];
      const bad = { OBJECT_NAME: 'BROKEN', NORAD_CAT_ID: 1 }; // missing elements
      const f = makeFetcher(() => ({ status: 200, text: JSON.stringify([...good, bad]) }));
      const p = new CelestrakGpProvider({
        cache: newCache(dir, { clock, fetcher: f }),
        groups: ['stations'],
        now: clock.now,
      });
      await p.refresh();
      expect(p.size).toBe(good.length);
      expect(p.status().notes?.join(' ')).toMatch(/1 malformed/);
    });
  });

  it('keeps serving the previous catalogue if a later refresh fails', async () => {
    await withTempDir(async (dir) => {
      const clock = new FakeClock(NOW);
      const f = makeFetcher(() => ({
        status: 200,
        text: readFixture('celestrak-gp-stations.json'),
      }));
      const p = new CelestrakGpProvider({
        cache: newCache(dir, { clock, fetcher: f }),
        groups: ['stations'],
        now: clock.now,
      });
      await p.refresh();
      const n = p.size;
      clock.advance(9000);
      f.respond = () => ({
        status: 403,
        text: 'GP data has not updated since your last successful download',
      });
      await p.refresh();
      expect(p.size).toBe(n);
      expect(p.status().state).toBe('stale');
      expect(p.status().lastError).toMatch(/403/);
    });
  });
});

describe('OpenSky provider', () => {
  it('parses the fixture: units, nulls and position sources are preserved', () => {
    const { time, states } = parseOpenSkyStates(readFixture('opensky-states-alps.json'));
    expect(time.toIso().startsWith('2026-09-30')).toBe(true);
    expect(states.length).toBeGreaterThan(5);
    const airborne = states.find((s) => !s.onGround && s.baroAltitudeM !== null)!;
    expect(airborne.id).toBe(`icao24:${airborne.icao24}`);
    expect(airborne.baroAltitudeM!).toBeGreaterThan(0);
    expect(airborne.groundSpeedMps!).toBeGreaterThan(50); // m/s
    expect(airborne.trackDeg!).toBeGreaterThanOrEqual(0);
    expect(airborne.trackDeg!).toBeLessThan(360);
    expect(['ADS-B', 'ASTERIX', 'MLAT', 'FLARM']).toContain(airborne.positionSource);
    expect(airborne.positionTimeUtc).toMatch(/Z$/);
    expect(states.some((s) => s.callsign === null || s.callsign.length > 0)).toBe(true);
  });

  const bbox = { latMinDeg: 45.8, lonMinDeg: 5.9, latMaxDeg: 47.8, lonMaxDeg: 10.5 };

  it('is anonymous by default and rate-limits itself', async () => {
    const clock = new FakeClock(NOW);
    const f = makeFetcher(() => ({ status: 200, text: readFixture('opensky-states-alps.json') }));
    const p = new OpenSkyProvider({
      config: { clientId: undefined, clientSecret: undefined },
      offline: false,
      fetcher: f,
      now: clock.now,
    });
    expect(p.authenticated).toBe(false);
    await p.refresh(bbox);
    clock.advance(30);
    await p.refresh(bbox); // too soon: no second request
    expect(f.calls.length).toBe(1);
    expect(f.calls[0]).toContain('lamin=45.8');
    clock.advance(400);
    await p.refresh(bbox);
    expect(f.calls.length).toBe(2);
    expect(p.status().notes?.join(' ')).toMatch(/never complete or worldwide/);
    expect(p.status().attribution).toMatch(/OpenSky/);
  });

  it('obtains an OAuth2 token with client credentials and sends it as a bearer token', async () => {
    const clock = new FakeClock(NOW);
    const seen: { url: string; auth?: string; body?: string }[] = [];
    const f = async (url: string, o: { headers?: Record<string, string>; body?: string } = {}) => {
      seen.push({
        url,
        ...(o.headers?.authorization ? { auth: o.headers.authorization } : {}),
        ...(o.body ? { body: o.body } : {}),
      });
      if (url.includes('openid-connect/token')) {
        return {
          status: 200,
          text: JSON.stringify({ access_token: 'tok123', expires_in: 1800 }),
          headers: {},
        };
      }
      return {
        status: 200,
        text: readFixture('opensky-states-alps.json'),
        headers: { 'x-rate-limit-remaining': '3999' },
      };
    };
    const p = new OpenSkyProvider({
      config: { clientId: 'id', clientSecret: 'secret' },
      offline: false,
      fetcher: f,
      now: clock.now,
    });
    await p.refresh(bbox);
    expect(seen[0]!.body).toContain('grant_type=client_credentials');
    expect(seen[1]!.auth).toBe('Bearer tok123');
    expect(p.minRefreshSeconds).toBe(60);
    expect(p.status().notes?.join(' ')).toContain('3999');
  });

  it('backs off on HTTP 429 using the provider-supplied retry time', async () => {
    const clock = new FakeClock(NOW);
    let n = 0;
    const f = async () => {
      n++;
      return { status: 429, text: '', headers: { 'x-rate-limit-retry-after-seconds': '7200' } };
    };
    const p = new OpenSkyProvider({
      config: { clientId: undefined, clientSecret: undefined },
      offline: false,
      fetcher: f,
      now: clock.now,
    });
    await p.refresh(bbox);
    clock.advance(3600);
    await p.refresh(bbox);
    expect(n).toBe(1);
    expect(p.status().lastError).toMatch(/429/);
    clock.advance(4000);
    await p.refresh(bbox);
    expect(n).toBe(2);
  });

  it('makes no request in offline mode', async () => {
    const f = makeFetcher(() => ({ status: 200, text: '{}' }));
    const p = new OpenSkyProvider({
      config: { clientId: undefined, clientSecret: undefined },
      offline: true,
      fetcher: f,
    });
    expect(await p.refresh(bbox)).toBeUndefined();
    expect(f.calls.length).toBe(0);
  });
});
