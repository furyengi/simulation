import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Instant,
  SimulationClock,
  degToRad,
  geodetic,
  geodeticToEcef,
  norm,
  position,
  somiglianaSurfaceGravity,
} from '@simulation/physics';
import { Environment, matrixToQuaternion } from '../src';
import type { EnvResult } from '@simulation/schemas';

const WALL = Instant.parse('2026-09-30T17:00:00Z');
let env: Environment;
let dir: string;

function value<T>(r: EnvResult<T>): T {
  if (r.status !== 'ok') {
    throw new Error(`expected ok, got ${r.status}: ${'reason' in r ? r.reason : ''}`);
  }
  return r.value;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sim-env-'));
  env = await Environment.create({
    config: {
      cacheDir: dir,
      offline: true,
      openSky: { clientId: undefined, clientSecret: undefined },
    },
    clock: new SimulationClock({
      start: Instant.parse('2026-09-27T12:00:00Z'),
      pace: 'manual',
      wall: () => WALL.unixMicros / 1000,
    }),
    wallNow: () => WALL,
  });
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('Environment: providers offline', () => {
  it('runs entirely from committed fixtures and says so', () => {
    const st = Object.fromEntries(env.providerStatuses().map((s) => [s.id, s]));
    expect(st['celestrak']!.state).toBe('fixture');
    expect(st['celestrak-space-weather']!.state).toBe('fixture');
    expect(st['iers-eop-via-celestrak']!.state).toBe('fixture');
    expect(st['celestrak']!.retrievedAtUtc).toBeDefined();
    expect(st['opensky']!.state).toBe('unavailable');
  });
});

describe('Environment: Earth, Sun, Moon', () => {
  it('reports Earth orientation with provenance and a unit quaternion', () => {
    const r = env.earth.orientation();
    const v = value(r);
    expect(v.eop.quality).toBe('OBSERVED');
    expect(Math.abs(v.eop.dut1S)).toBeLessThan(0.9);
    expect(Math.hypot(...v.quaternionItrfFromGcrf)).toBeCloseTo(1, 12);
    if (r.status === 'ok') {
      expect(r.provenance[0]!.stateKind).toBe('OBSERVED');
      expect(r.provenance[0]!.source.provider).toBe('iers-eop-via-celestrak');
    }
  });

  it('Sun direction: unit vector, ~1 au, sub-solar latitude near the equator at the September equinox', () => {
    const t = Instant.parse('2026-09-23T00:05:00Z'); // equinox ≈ 2026-09-23 00:05 UTC
    const p = position('ITRF', geodeticToEcef(geodetic(0.3, 0.4, 400_000)));
    const r = env.sun.direction(p, t);
    const v = value(r);
    expect(norm(v.direction)).toBeCloseTo(1, 12);
    expect(v.distanceM / 1.495978707e11).toBeGreaterThan(0.99);
    expect(v.distanceM / 1.495978707e11).toBeLessThan(1.01);
    expect(Math.abs(v.subSolarPoint.latDeg)).toBeLessThan(0.1);
    expect(v.frame).toBe('ITRF');
    if (r.status === 'ok') {
      const prov = r.provenance.find((x) => x.subject === 'body:sun')!;
      expect(prov.stateKind).toBe('MODELLED');
      expect(prov.model?.name).toMatch(/Astronomy Engine/);
      expect(prov.frame).toBe('ITRF');
    }
  });

  it('Sun direction in GCRF and ITRF describe the same physical direction (angles preserved)', () => {
    const t = Instant.parse('2026-09-27T12:00:00Z');
    const g = value(env.sun.direction(position('GCRF', [7e6, 0, 0]), t));
    const i = value(env.sun.direction(position('ITRF', [7e6, 0, 0]), t));
    expect(norm(g.geocentricPositionM)).toBeCloseTo(norm(i.geocentricPositionM), 3);
    expect(g.distanceM).not.toBe(i.distanceM); // different physical points (x-axes differ)
  });

  it('Moon is at lunar distance and has provenance with light-time convention', () => {
    const r = env.moon.state(Instant.parse('2026-09-27T12:00:00Z'), 'GCRF');
    const v = value(r);
    expect(v.distanceM / 1000).toBeGreaterThan(356_000);
    expect(v.distanceM / 1000).toBeLessThan(407_000);
    expect(v.lightTime).toBe('geometric');
    if (r.status === 'ok') expect(r.provenance[0]!.limitations?.join(' ')).toMatch(/Light-time/);
  });

  it('illumination: noon at the sub-solar point is DAY, the antipode is NIGHT', () => {
    const t = Instant.parse('2026-09-27T12:00:00Z');
    const sun = value(env.sun.direction(position('ITRF', [0, 0, 0.0001]), t));
    const day = value(
      env.sun.illumination(
        { latDeg: sun.subSolarPoint.latDeg, lonDeg: sun.subSolarPoint.lonDeg },
        t,
      ),
    );
    expect(day.condition).toBe('DAY');
    expect(day.solarElevationRad).toBeGreaterThan(degToRad(89));
    const night = value(
      env.sun.illumination(
        { latDeg: -sun.subSolarPoint.latDeg, lonDeg: sun.subSolarPoint.lonDeg + 180 },
        t,
      ),
    );
    expect(night.condition).toBe('NIGHT');
  });
});

describe('Environment: eclipse and gravity', () => {
  const t = Instant.parse('2026-09-27T12:00:00Z');
  it('eclipse: sunward point is sunlit, anti-sunward LEO point is in umbra', () => {
    const sun = value(env.sun.direction(position('GCRF', [0, 0, 0.001]), t));
    const s = sun.direction;
    const sunward = position('GCRF', [s[0] * 7e6, s[1] * 7e6, s[2] * 7e6]);
    const anti = position('GCRF', [-s[0] * 7e6, -s[1] * 7e6, -s[2] * 7e6]);
    expect(value(env.eclipse.state(sunward, t)).condition).toBe('SUNLIT');
    const e = env.eclipse.state(anti, t);
    expect(value(e).condition).toBe('UMBRA');
    if (e.status === 'ok') expect(e.provenance[0]!.limitations?.join(' ')).toMatch(/oblateness/);
  });

  it('eclipse: a point inside the Earth is explicitly unsupported', () => {
    expect(env.eclipse.state(position('GCRF', [1000, 0, 0]), t)).toMatchObject({
      status: 'unsupported',
      code: 'INSIDE_EARTH',
    });
  });

  it('gravity at the surface equals Somigliana normal gravity, with model provenance', () => {
    const lat = degToRad(45);
    const p = position('ITRF', geodeticToEcef(geodetic(lat, 0.2, 0)));
    const r = env.gravity.at(p, t);
    const v = value(r);
    expect(Math.abs(v.gravityMagnitude - somiglianaSurfaceGravity(lat))).toBeLessThan(1e-7);
    if (r.status === 'ok') {
      expect(r.provenance[0]!.stateKind).toBe('MODELLED');
      expect(r.provenance[0]!.limitations?.join(' ')).toMatch(/geoid/);
    }
  });

  it('gravity accepts inertial positions (converted through the frame model) and refuses points below the ellipsoid', () => {
    expect(env.gravity.at(position('GCRF', [7e6, 1e6, 2e6]), t).status).toBe('ok');
    expect(env.gravity.at(position('ITRF', [1e6, 0, 0]), t)).toMatchObject({
      status: 'unsupported',
      code: 'BELOW_ELLIPSOID',
    });
  });
});

describe('Environment: space weather and atmosphere', () => {
  it('space weather for an observed day carries OBSERVED provenance with source epoch, retrieval time and freshness', () => {
    const r = env.spaceWeather.at(Instant.parse('2026-09-27T12:00:00Z'));
    const v = value(r);
    expect(v.dataType).toBe('OBS');
    expect(v.msisInputs).toEqual({ f107Sfu: 101.0, f107AvgSfu: 104.8, apDaily: 8 });
    if (r.status === 'ok') {
      const p = r.provenance[0]!;
      expect(p.stateKind).toBe('OBSERVED');
      expect(p.source.provider).toBe('celestrak-space-weather');
      expect(p.sourceEpochUtc).toBe('2026-09-27T00:00:00.000Z');
      expect(p.retrievedAtUtc).toBeDefined();
      expect(p.freshness).toBe('FRESH');
      expect(p.limitations?.join(' ')).toMatch(/snapshot/);
    }
  });

  it('a forecast day is MODELLED and PREDICTED, never OBSERVED', () => {
    const r = env.spaceWeather.at(Instant.parse('2026-10-05T12:00:00Z'));
    expect(value(r).dataType).toBe('PRD');
    if (r.status === 'ok') {
      expect(r.provenance[0]!.stateKind).toBe('MODELLED');
      expect(r.provenance[0]!.freshness).toBe('PREDICTED');
    }
  });

  it('atmosphere at ISS altitude: physically plausible density, full provenance chain', () => {
    const t = Instant.parse('2026-09-27T12:00:00Z');
    const p = position('ITRF', geodeticToEcef(geodetic(degToRad(30), degToRad(40), 410_000)));
    const r = env.atmosphere.sample(p, t);
    const v = value(r);
    expect(v.totalMassDensityKgM3).toBeGreaterThan(1e-13);
    expect(v.totalMassDensityKgM3).toBeLessThan(1e-10);
    expect(v.modelInputs.f107Sfu).toBe(101.0);
    expect(v.geodetic.heightM).toBeCloseTo(410_000, 3);
    if (r.status === 'ok') {
      const model = r.provenance.find((x) => x.subject === 'atmosphere:nrlmsise-00')!;
      expect(model.stateKind).toBe('MODELLED');
      expect(model.model?.name).toBe('NRLMSISE-00');
      expect(model.sourceEpochUtc).toBe('2026-09-27T00:00:00.000Z'); // the input epoch
      expect(r.provenance.some((x) => x.source.provider === 'celestrak-space-weather')).toBe(true);
    }
  });

  it('atmosphere refuses instead of inventing: above range, no Ap in monthly-prediction era, outside coverage', () => {
    const t = Instant.parse('2026-09-27T12:00:00Z');
    expect(
      env.atmosphere.sample(position('ITRF', geodeticToEcef(geodetic(0, 0, 1_200_000))), t),
    ).toMatchObject({ status: 'unsupported', code: 'ABOVE_MODEL_RANGE' });
    const leo = position('ITRF', geodeticToEcef(geodetic(0, 0, 400_000)));
    expect(env.atmosphere.sample(leo, Instant.parse('2026-12-15T00:00:00Z'))).toMatchObject({
      status: 'unavailable',
      code: 'NO_MODEL_INPUTS',
    });
    expect(env.atmosphere.sample(leo, Instant.parse('2015-01-01T00:00:00Z'))).toMatchObject({
      status: 'unavailable',
      code: 'BEFORE_SPACE_WEATHER_COVERAGE',
    });
  });
});

describe('Environment: orbital objects', () => {
  it('loads the development set and finds the ISS', () => {
    expect(env.orbital.list().length).toBeGreaterThan(5);
    const hits = env.orbital.search('ISS');
    expect(hits.some((h) => h.id === 'norad:25544')).toBe(true);
  });

  it('ISS state near epoch: plausible LEO, PROPAGATED provenance with epoch, retrieval time, model, frame, age', () => {
    const t = Instant.parse('2026-09-30T04:00:00Z'); // ~35 min after the fixture element epoch
    const r = env.orbital.state('norad:25544', t, 'GCRF');
    const v = value(r);
    expect(v.geodetic.heightM).toBeGreaterThan(380_000);
    expect(v.geodetic.heightM).toBeLessThan(440_000);
    expect(v.speedMps).toBeGreaterThan(7_500);
    expect(v.speedMps).toBeLessThan(7_800);
    expect(Math.abs(v.geodetic.latDeg)).toBeLessThanOrEqual(51.7);
    if (r.status === 'ok') {
      const p = r.provenance[0]!;
      expect(p.stateKind).toBe('PROPAGATED');
      expect(p.source.provider).toBe('celestrak');
      expect(p.sourceEpochUtc).toMatch(/^2026-09-30T03:25:12/);
      expect(p.retrievedAtUtc).toBeDefined();
      expect(p.model?.name).toMatch(/SGP4/);
      expect(p.frame).toBe('GCRF');
      expect(p.dataAgeSeconds).toBeGreaterThan(2000);
      expect(p.dataAgeSeconds).toBeLessThan(2300);
      expect(p.freshness).toBe('FRESH');
    }
  });

  it('data age is signed and freshness degrades away from the epoch, in both directions', () => {
    const past = env.orbital.state('norad:25544', Instant.parse('2026-09-10T00:00:00Z'));
    const far = env.orbital.state('norad:25544', Instant.parse('2026-12-01T00:00:00Z'));
    if (past.status !== 'ok' || far.status !== 'ok') throw new Error('unexpected');
    expect(past.provenance[0]!.dataAgeSeconds!).toBeLessThan(0);
    expect(past.provenance[0]!.freshness).toBe('STALE');
    expect(far.provenance[0]!.dataAgeSeconds!).toBeGreaterThan(0);
    expect(far.provenance[0]!.freshness).toBe('STALE');
  });

  it('unknown objects are unavailable, not exceptions', () => {
    expect(env.orbital.state('norad:1', Instant.parse('2026-09-30T00:00:00Z'))).toMatchObject({
      status: 'unavailable',
      code: 'UNKNOWN_OBJECT',
    });
  });

  it('ephemeris windows: frame, sample times and Hermite-interpolated midpoints agree with direct propagation', () => {
    const start = Instant.parse('2026-09-30T04:00:00Z');
    const r = env.orbital.ephemerisBatch({
      ids: ['norad:25544'],
      start,
      count: 40,
      frame: 'GCRF',
      toleranceM: 5,
    });
    const { windows, stepSeconds } = value(r);
    const w = windows[0]!;
    expect(w.positionsM.length).toBe(120);
    // ≤ 64 objects: the step was verified, and the measured interpolation error is reported.
    expect(w.interpolationErrorMeasuredM).not.toBeNull();
    expect(w.interpolationErrorMeasuredM!).toBeLessThanOrEqual(5);
    expect(stepSeconds).toBeGreaterThan(5);
    // sample 10 equals a direct state query
    const direct = value(
      env.orbital.state('norad:25544', start.plusSeconds(10 * stepSeconds), 'GCRF'),
    );
    expect(Math.abs(w.positionsM[30]! - direct.positionM[0])).toBeLessThan(1e-6);
  });

  it('ground track is computed through ITRF and stays within the orbit inclination', () => {
    const r = env.orbital.groundTrack(
      'norad:25544',
      Instant.parse('2026-09-30T04:00:00Z'),
      5400,
      60,
    );
    const v = value(r);
    expect(v.points.length).toBe(91);
    expect(Math.max(...v.points.map((p) => Math.abs(p.latDeg)))).toBeLessThan(51.8);
  });
});

describe('Environment: aircraft layer validity', () => {
  it('is disabled when the clock is not live, with a reason', () => {
    const r = env.aircraft.snapshot();
    expect(r).toMatchObject({
      status: 'unavailable',
      code: 'LIVE_DATA_INVALID_FOR_SIMULATION_TIME',
    });
    expect(env.aircraftAvailability().reason).toMatch(/manual/);
  });

  it('is enabled only at 1× near real UTC, and then reports honestly that no data has been fetched', async () => {
    const wallMs = WALL.unixMicros / 1000;
    const live = await Environment.create({
      config: {
        cacheDir: dir,
        offline: true,
        openSky: { clientId: undefined, clientSecret: undefined },
      },
      clock: new SimulationClock({ start: WALL, wall: () => wallMs }),
      wallNow: () => WALL,
      skipInitialRefresh: true,
    });
    expect(live.aircraftAvailability().available).toBe(true);
    expect(live.aircraft.snapshot()).toMatchObject({
      status: 'unavailable',
      code: 'NO_AIRCRAFT_DATA',
    });
    live.clock.setRate(60);
    expect(live.aircraftAvailability()).toMatchObject({ available: false });
    expect(live.aircraftAvailability().reason).toMatch(/60×/);
    live.clock.setRate(1);
    live.clock.seek(Instant.parse('2026-09-30T16:00:00Z'));
    expect(live.aircraftAvailability().reason).toMatch(/differs from real UTC/);
  });
});

describe('Environment: determinism', () => {
  it('identical queries at the same time give identical results', () => {
    const t = Instant.parse('2026-09-27T12:00:00Z');
    const p = position('ITRF', geodeticToEcef(geodetic(0.5, 1, 350_000)));
    expect(env.atmosphere.sample(p, t)).toEqual(env.atmosphere.sample(p, t));
    expect(env.sun.direction(p, t)).toEqual(env.sun.direction(p, t));
    expect(env.orbital.state('norad:25544', t)).toEqual(env.orbital.state('norad:25544', t));
  });
});

describe('matrixToQuaternion', () => {
  it('reproduces the rotation: q v q* equals R v for arbitrary rotations', async () => {
    const { rot1, rot2, rot3, mul, apply } = await import('@simulation/physics');
    for (const [a, b, c] of [
      [0.3, -1.2, 2.5],
      [3.1, 0.001, -0.7],
      [-2.9, 1.5, 0.2],
      [0, 0, 0],
      [Math.PI, 0, 0],
    ] as const) {
      const R = mul(rot3(c), mul(rot2(b), rot1(a)));
      const [x, y, z, w] = matrixToQuaternion(R);
      expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 12);
      const v = [0.3, -0.8, 0.5] as const;
      // v' = v + 2w(q×v) + 2 q×(q×v)
      const qv = [x, y, z] as const;
      const cross = (u: readonly number[], t: readonly number[]) =>
        [
          u[1]! * t[2]! - u[2]! * t[1]!,
          u[2]! * t[0]! - u[0]! * t[2]!,
          u[0]! * t[1]! - u[1]! * t[0]!,
        ] as const;
      const t1 = cross(qv, v);
      const t2 = cross(qv, t1);
      const rotated = [
        v[0] + 2 * w * t1[0] + 2 * t2[0],
        v[1] + 2 * w * t1[1] + 2 * t2[1],
        v[2] + 2 * w * t1[2] + 2 * t2[2],
      ];
      const expected = apply(R, v);
      for (let i = 0; i < 3; i++) expect(rotated[i]).toBeCloseTo(expected[i]!, 12);
    }
  });
});

describe('Environment: windows and ground stations', () => {
  it('bodies window: unit quaternions on the short arc, Sun ≈ 1 au, Moon at lunar distance, earth turns 15°/h', () => {
    const start = Instant.parse('2026-09-27T12:00:00Z');
    const w = value(env.windows.bodies({ start, count: 61, stepSeconds: 60 }));
    expect(w.earthQuaternionsItrfFromGcrf.length).toBe(61 * 4);
    let prev: number[] | undefined;
    for (let i = 0; i < 61; i++) {
      const q = w.earthQuaternionsItrfFromGcrf.slice(4 * i, 4 * i + 4);
      expect(Math.hypot(...q)).toBeCloseTo(1, 12);
      if (prev)
        expect(
          q[0]! * prev[0]! + q[1]! * prev[1]! + q[2]! * prev[2]! + q[3]! * prev[3]!,
        ).toBeGreaterThan(0.99999);
      prev = q;
    }
    const sunR = Math.hypot(w.sunItrfM[0]!, w.sunItrfM[1]!, w.sunItrfM[2]!) / 1.495978707e11;
    expect(sunR).toBeGreaterThan(0.98);
    expect(sunR).toBeLessThan(1.02);
    // Over one hour the Sun's ITRF longitude decreases by ≈ 15° (Earth rotation).
    const lon = (i: number) => Math.atan2(w.sunItrfM[3 * i + 1]!, w.sunItrfM[3 * i]!);
    const dLon = ((lon(0) - lon(60)) * 180) / Math.PI;
    expect(dLon).toBeGreaterThan(14.9);
    expect(dLon).toBeLessThan(15.1);
    const moonKm = Math.hypot(w.moonItrfM[0]!, w.moonItrfM[1]!, w.moonItrfM[2]!) / 1000;
    expect(moonKm).toBeGreaterThan(356_000);
    expect(moonKm).toBeLessThan(407_000);
  });

  it('bodies window refuses absurd requests', () => {
    expect(env.windows.bodies({ start: WALL, count: 1, stepSeconds: 60 }).status).toBe(
      'unsupported',
    );
    expect(env.windows.bodies({ start: WALL, count: 10, stepSeconds: -1 }).status).toBe(
      'unsupported',
    );
  });

  it('ground stations carry provenance that states their approximate, curated nature', () => {
    const r = env.groundStations.list();
    expect(value(r).length).toBe(3);
    if (r.status === 'ok') expect(r.provenance[0]!.limitations?.join(' ')).toMatch(/Approximate/);
  });
});
