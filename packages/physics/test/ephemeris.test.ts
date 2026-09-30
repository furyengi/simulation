import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AstronomyEngineEphemeris,
  FrameModel,
  Instant,
  METERS_PER_AU,
  norm,
  subSolarPoint,
  vec,
} from '../src';

const eph = new AstronomyEngineEphemeris();
const frames = new FrameModel();

describe('AstronomyEngineEphemeris', () => {
  it('reports the installed library version in its model reference', () => {
    const pkg = JSON.parse(
      readFileSync(
        new URL('../../../node_modules/astronomy-engine/package.json', import.meta.url),
        'utf8',
      ),
    ) as { version: string };
    expect(eph.model.version).toBe(pkg.version);
  });

  it('Sun distance is between perihelion and aphelion (0.983–1.017 au) all year', () => {
    for (let m = 0; m < 12; m++) {
      const t = Instant.parse(`2026-${String(m + 1).padStart(2, '0')}-15T00:00:00Z`);
      const r = eph.state('sun', t);
      expect(r.status).toBe('ok');
      if (r.status !== 'ok') continue;
      const au = norm(vec(r.state.position)) / METERS_PER_AU;
      expect(au).toBeGreaterThan(0.983);
      expect(au).toBeLessThan(1.017);
    }
  });

  it('Sun velocity magnitude equals Earth orbital speed (28.6–30.3 km/s)', () => {
    const r = eph.state('sun', Instant.parse('2026-03-20T12:00:00Z'));
    if (r.status !== 'ok') throw new Error('unexpected');
    const v = norm(vec(r.state.velocity)) / 1000;
    expect(v).toBeGreaterThan(28.6);
    expect(v).toBeLessThan(30.3);
  });

  it('Moon distance stays within perigee/apogee limits (356 400–406 700 km) and speed ≈ 1 km/s', () => {
    for (let d = 0; d < 30; d += 3) {
      const t = Instant.parse('2026-09-01T00:00:00Z').plusSeconds(d * 86_400);
      const r = eph.state('moon', t);
      if (r.status !== 'ok') throw new Error('unexpected');
      const km = norm(vec(r.state.position)) / 1000;
      expect(km).toBeGreaterThan(356_000);
      expect(km).toBeLessThan(407_000);
      const v = norm(vec(r.state.velocity)) / 1000;
      expect(v).toBeGreaterThan(0.9);
      expect(v).toBeLessThan(1.2);
    }
  });

  it('March equinox 2026 (14:46 UTC): sub-solar latitude ≈ 0° and Sun on the equator of date', () => {
    const t = Instant.parse('2026-03-20T14:46:00Z');
    const r = eph.state('sun', t);
    if (r.status !== 'ok') throw new Error('unexpected');
    const itrf = frames.convertPosition(r.state.position, 'ITRF', t);
    const ss = subSolarPoint(vec(itrf));
    expect(Math.abs(ss.latRad)).toBeLessThan((0.05 * Math.PI) / 180);
  });

  it('June solstice: sub-solar latitude ≈ +23.4°; sub-solar longitude is near the noon meridian', () => {
    const t = Instant.parse('2026-06-21T12:00:00Z');
    const r = eph.state('sun', t);
    if (r.status !== 'ok') throw new Error('unexpected');
    const ss = subSolarPoint(vec(frames.convertPosition(r.state.position, 'ITRF', t)));
    expect((ss.latRad * 180) / Math.PI).toBeGreaterThan(23.3);
    expect((ss.latRad * 180) / Math.PI).toBeLessThan(23.5);
    // Equation of time ≤ ~16 min => ≤ 4° from the 12:00 UTC meridian (lon 0 → Sun near longitude 0).
    expect(Math.abs((ss.lonRad * 180) / Math.PI)).toBeLessThan(4);
  });

  it('returns unsupported for unknown bodies', () => {
    // @ts-expect-error deliberately outside BodyId
    expect(eph.state('pluto', Instant.parse('2026-01-01T00:00:00Z')).status).toBe('unsupported');
  });
});
