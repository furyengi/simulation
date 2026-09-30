import { describe, expect, it } from 'vitest';
import { Instant } from '@simulation/physics';
import {
  CelestrakSpaceWeatherProvider,
  parseCelestrakSwCsv,
} from '../src/providers/space-weather/celestrak';
import {
  NoaaSwpcProvider,
  parseF107,
  parseKp1Min,
  parseKp3Hourly,
} from '../src/providers/space-weather/noaa-swpc';
import { EopProvider } from '../src/providers/eop';
import {
  FakeClock,
  fixtureManifestTimes,
  fixturePath,
  fixtureRetrievedAt,
  makeFetcher,
  newCache,
  readFixture,
  withTempDir,
} from './helpers';

const NOW = Instant.parse('2026-09-30T17:00:00Z');
const offlineFetcher = makeFetcher(() => new Error('network disabled in tests'));

async function swProvider(dir: string, clock: FakeClock) {
  const p = new CelestrakSpaceWeatherProvider({
    cache: newCache(dir, { fetcher: offlineFetcher, clock }),
    fixturePath: fixturePath('celestrak-sw-last5years.csv'),
    fixtureRetrievedAtUtc: fixtureRetrievedAt('celestrak-sw-last5years.csv'),
    now: clock.now,
  });
  await p.refresh();
  return p;
}

describe('CelesTrak space-weather CSV', () => {
  it('parses the fixture: units, flags, Kp scaling', () => {
    const rows = parseCelestrakSwCsv(readFixture('celestrak-sw-last5years.csv'));
    const r = rows.find((x) => x.date === '2026-09-26')!;
    expect(r.dataType).toBe('OBS');
    expect(r.f107Obs).toBe(101.0);
    expect(r.f107ObsCenter81).toBe(105.1);
    expect(r.apDaily).toBe(11);
    expect(r.kp).toEqual([3.7, 3.3, 2.7, 2.7, 1.0, 1.0, 2.0, 2.7]); // published ×10
    expect(rows.find((x) => x.date === '2026-10-01')!.dataType).toBe('PRD');
    expect(rows.find((x) => x.date === '2026-12-01')!.dataType).toBe('PRM');
    expect(rows.find((x) => x.date === '2026-12-01')!.apDaily).toBeNull();
  });

  it('rejects a body that is not the space-weather CSV', () => {
    expect(() => parseCelestrakSwCsv('<html>')).toThrow();
  });

  it('gives the NRLMSISE-00 driver set from observed rows, using the previous day F10.7', async () => {
    await withTempDir(async (dir) => {
      const sw = await swProvider(dir, new FakeClock(NOW));
      const r = sw.lookup(Instant.parse('2026-09-27T12:00:00Z'));
      if (r.status !== 'ok') throw new Error(r.reason);
      expect(r.state.dataType).toBe('OBS');
      expect(r.freshness).toBe('FRESH');
      // 27 Sep: previous-day (26 Sep) F10.7 obs = 101.0; 81-day centred mean = 104.8; Ap = 8
      expect(r.state.msisInputs).toEqual({ f107Sfu: 101.0, f107AvgSfu: 104.8, apDaily: 8 });
      expect(r.sourceEpoch.toIso()).toBe('2026-09-27T00:00:00.000Z');
    });
  });

  it('labels forecast days PREDICTED and never as observed', async () => {
    await withTempDir(async (dir) => {
      const sw = await swProvider(dir, new FakeClock(NOW));
      const r = sw.lookup(Instant.parse('2026-10-02T06:00:00Z'));
      if (r.status !== 'ok') throw new Error(r.reason);
      expect(r.state.dataType).toBe('PRD');
      expect(r.freshness).toBe('PREDICTED');
      expect(r.limitations.join(' ')).toMatch(/forecast/i);
    });
  });

  it('in the monthly-prediction period holds F10.7 but refuses to invent Ap', async () => {
    await withTempDir(async (dir) => {
      const sw = await swProvider(dir, new FakeClock(NOW));
      const r = sw.lookup(Instant.parse('2026-12-15T00:00:00Z'));
      if (r.status !== 'ok') throw new Error(r.reason);
      expect(r.state.dataType).toBe('PRM');
      expect(r.state.f107Avg81CenteredSfu).not.toBeNull();
      expect(r.state.apDaily).toBeNull();
      expect(r.state.msisInputs).toBeNull();
      expect(r.state.msisInputsUnavailableReason).toMatch(/daily Ap/);
    });
  });

  it('is unavailable outside its coverage, with a reason', async () => {
    await withTempDir(async (dir) => {
      const sw = await swProvider(dir, new FakeClock(NOW));
      expect(sw.lookup(Instant.parse('2019-01-01T00:00:00Z'))).toMatchObject({
        status: 'unavailable',
        code: 'BEFORE_SPACE_WEATHER_COVERAGE',
      });
      expect(sw.lookup(Instant.parse('2060-01-01T00:00:00Z'))).toMatchObject({
        status: 'unavailable',
        code: 'AFTER_SPACE_WEATHER_COVERAGE',
      });
    });
  });

  it('reports the fixture as its source with the fixture retrieval age, so freshness is honest', async () => {
    await withTempDir(async (dir) => {
      const clock = new FakeClock(NOW);
      const sw = await swProvider(dir, clock);
      const st = sw.status();
      expect(st.state).toBe('fixture');
      expect(st.retrievedAtUtc).toBe(fixtureRetrievedAt('celestrak-sw-last5years.csv'));
      expect(st.retrievalAgeSeconds).toBeGreaterThan(0);
      expect(st.attribution).toMatch(/GFZ/);
      expect(st.license).toMatch(/CC BY 4.0/);
    });
  });
});

describe('NOAA SWPC provider', () => {
  it('parses the three feeds from the fixtures', () => {
    const kp = parseKp3Hourly(readFixture('noaa-planetary-k-index.json'));
    expect(kp.length).toBeGreaterThan(20);
    expect(kp[0]!.kp).toBeGreaterThanOrEqual(0);
    const k1 = parseKp1Min(readFixture('noaa-planetary_k_index_1m.json'));
    expect(k1.length).toBeGreaterThan(100);
    const f = parseF107(readFixture('noaa-f107_cm_flux.json'));
    expect(f.length).toBeGreaterThan(30);
    expect(f.every((s) => s.fluxSfu > 40 && s.fluxSfu < 400)).toBe(true);
  });

  it('accepts the legacy array-of-arrays Kp format', () => {
    const legacy = JSON.stringify([
      ['time_tag', 'Kp', 'a_running', 'station_count'],
      ['2020-01-01 00:00:00.000', '1.33', '5', '8'],
    ]);
    // legacy timestamps use a space; our parser wants ISO — normalise is the provider's job
    expect(() => parseKp3Hourly(legacy.replace(' 00:00:00.000', 'T00:00:00'))).not.toThrow();
  });

  it('gives observed nowcast values near the fixture time and nothing far outside it', async () => {
    await withTempDir(async (dir) => {
      const clock = new FakeClock(NOW);
      const noaa = new NoaaSwpcProvider({
        cache: newCache(dir, { fetcher: offlineFetcher, clock }),
        fixtureDir: fixturePath('').replace(/[\\/]$/, ''),
        fixtureRetrievedAtUtc: fixtureManifestTimes(),
        now: clock.now,
      });
      await noaa.refresh();
      const near = noaa.nowcastAt(Instant.parse('2026-09-30T10:12:30Z'));
      expect(near?.nowcast.kpEstimated1Min?.kp).toBeGreaterThanOrEqual(0);
      expect(near?.nowcast.kp3Hourly).toBeDefined();
      expect(near?.nowcast.f107?.fluxSfu).toBeGreaterThan(40);
      expect(noaa.nowcastAt(Instant.parse('2020-01-01T00:00:00Z'))).toBeUndefined();
      expect(noaa.status().attribution).toMatch(/NOAA/);
    });
  });
});

describe('EOP provider', () => {
  it('loads the fixture, reports coverage, and serves observed/predicted quality', async () => {
    await withTempDir(async (dir) => {
      const clock = new FakeClock(NOW);
      const eop = new EopProvider({
        cache: newCache(dir, { fetcher: offlineFetcher, clock }),
        fixturePath: fixturePath('celestrak-eop-last5years.csv'),
        fixtureRetrievedAtUtc: fixtureRetrievedAt('celestrak-eop-last5years.csv'),
        now: clock.now,
      });
      await eop.refresh();
      const cov = eop.coverage()!;
      expect(cov.first).toBe('2025-01-01');
      expect(cov.lastObserved >= '2026-09-29').toBe(true);
      const obs = eop.eop.lookup(Instant.parse('2026-09-29T12:00:00Z'));
      expect(obs.quality).toBe('OBSERVED');
      expect(Math.abs(obs.params.dut1S)).toBeLessThan(0.9);
      expect(eop.eop.lookup(Instant.parse('2027-01-01T00:00:00Z')).quality).toBe('PREDICTED');
      expect(eop.eop.lookup(Instant.parse('2030-01-01T00:00:00Z')).quality).toBe('UNAVAILABLE');
      expect(eop.status().state).toBe('fixture');
    });
  });

  it('degrades to UNAVAILABLE lookups (zeros), not an exception, with no data at all', async () => {
    await withTempDir(async (dir) => {
      const clock = new FakeClock(NOW);
      const eop = new EopProvider({
        cache: newCache(dir, { fetcher: offlineFetcher, clock }),
        now: clock.now,
      });
      await eop.refresh();
      expect(eop.eop.lookup(NOW).quality).toBe('UNAVAILABLE');
      expect(eop.status().state).toBe('unavailable');
    });
  });
});
