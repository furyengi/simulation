import { describe, expect, it } from 'vitest';
import { OmmRecordSchema } from '@simulation/schemas';
import { Instant, Sgp4Propagator, implicitDecimal, norm, tleToOmm, vec } from '../src';

// Spacetrack Report #3 sample element set (satellite 88888), also in Vallado's verification suite.
const L1 = '1 88888U          80275.98708465  .00073094  13844-3  66816-4 0    87';
const L2 = '2 88888  72.8435 115.9689 0086731  52.6988 110.5714 16.05824518  1058';

describe('TLE parsing', () => {
  it('decodes assumed-decimal fields', () => {
    expect(implicitDecimal(' 28098-4')).toBeCloseTo(0.28098e-4, 15);
    expect(implicitDecimal('-30915-6')).toBeCloseTo(-0.30915e-6, 15);
    expect(implicitDecimal(' 00000-0')).toBe(0);
    expect(implicitDecimal(' 00000+0')).toBe(0);
    expect(() => implicitDecimal('garbage')).toThrow();
  });

  it('converts a TLE to a schema-valid OMM with the right units and epoch', () => {
    const omm = tleToOmm(L1, L2);
    expect(OmmRecordSchema.safeParse(omm).success).toBe(true);
    expect(omm.NORAD_CAT_ID).toBe(88888);
    expect(omm.INCLINATION).toBeCloseTo(72.8435, 10);
    expect(omm.ECCENTRICITY).toBeCloseTo(0.0086731, 12);
    expect(omm.MEAN_MOTION).toBeCloseTo(16.05824518, 10);
    expect(omm.BSTAR).toBeCloseTo(0.66816e-4, 15);
    expect(omm.MEAN_MOTION_DDOT).toBeCloseTo(0.13844e-3, 15);
    // day 275.98708465 of 1980 (leap year) = Oct 1 1980 23:41:24.…
    expect(omm.EPOCH.startsWith('1980-10-01T23:41:24')).toBe(true);
  });
});

describe('Sgp4Propagator', () => {
  const tle = Sgp4Propagator.fromTle(L1, L2);

  it('reports epoch (µs exact), regime and period', () => {
    expect(tle.regime).toBe('near');
    expect(tle.periodSeconds / 60).toBeGreaterThan(89);
    expect(tle.periodSeconds / 60).toBeLessThan(90.5); // 1440 / 16.058 = 89.67 min
    expect(tle.epoch.toIso().startsWith('1980-10-01T23:41:24')).toBe(true);
  });

  it('propagates to a LEO state: radius 6.6–7.0 Mm, speed ≈ 7.7 km/s, in TEME, SI units', () => {
    const r = tle.propagateMinutes(360);
    if (r.status !== 'ok') throw new Error('unexpected');
    expect(r.state.frame).toBe('TEME');
    const radius = norm(vec(r.state.position));
    const speed = norm(vec(r.state.velocity));
    expect(radius).toBeGreaterThan(6.5e6);
    expect(radius).toBeLessThan(7.0e6);
    expect(speed).toBeGreaterThan(7_500);
    expect(speed).toBeLessThan(7_900);
  });

  it('reproduces the Vallado verification value for satellite 88888 at tsince = 0', () => {
    // validation/sgp4/reference/tmatverDec2015.out (km, km/s, TEME): the full suite runs in /validation.
    const r = tle.propagateMinutes(0);
    if (r.status !== 'ok') throw new Error('unexpected');
    expect(r.state.position.x / 1000).toBeCloseTo(2328.96975262, 6);
    expect(r.state.position.y / 1000).toBeCloseTo(-5995.22051338, 6);
    expect(r.state.position.z / 1000).toBeCloseTo(1719.97297192, 6);
    expect(r.state.velocity.x / 1000).toBeCloseTo(2.912073281, 8);
    expect(r.state.velocity.y / 1000).toBeCloseTo(-0.983417956, 8);
    expect(r.state.velocity.z / 1000).toBeCloseTo(-7.09081621, 8);
  });

  it('propagate(Instant) equals propagateMinutes at the same offset', () => {
    const t = tle.epoch.plusSeconds(3 * 3600);
    const a = tle.propagate(t);
    const b = tle.propagateMinutes(180);
    expect(a).toEqual(b);
  });

  it('the OMM path agrees with the TLE path to within a millisecond of epoch (< 10 m)', () => {
    const omm = Sgp4Propagator.fromOmm(tleToOmm(L1, L2));
    for (const min of [0, 90, 720, 1440]) {
      const a = tle.propagateMinutes(min);
      const b = omm.propagateMinutes(min);
      if (a.status !== 'ok' || b.status !== 'ok') throw new Error('unexpected');
      const d = norm([
        a.state.position.x - b.state.position.x,
        a.state.position.y - b.state.position.y,
        a.state.position.z - b.state.position.z,
      ]);
      expect(d).toBeLessThan(10);
    }
  });

  it('reports decay as an error result, never as a position', () => {
    let sawError = false;
    for (let days = 1; days < 4_000 && !sawError; days += 50) {
      const r = tle.propagateMinutes(days * 1440);
      if (r.status === 'error') {
        sawError = true;
        expect(r.code).toBeGreaterThan(0);
        expect(r.message.length).toBeGreaterThan(0);
      }
    }
    expect(sawError).toBe(true);
  });

  it('rejects OMMs that are not TEME / UTC / SGP4', () => {
    const omm = tleToOmm(L1, L2);
    expect(() => Sgp4Propagator.fromOmm({ ...omm, REF_FRAME: 'ICRF' })).toThrow(/REF_FRAME/);
    expect(() => Sgp4Propagator.fromOmm({ ...omm, TIME_SYSTEM: 'TDB' })).toThrow(/TIME_SYSTEM/);
    expect(() => Sgp4Propagator.fromOmm({ ...omm, MEAN_ELEMENT_THEORY: 'SGP4-XP' })).toThrow(
      /MEAN_ELEMENT_THEORY/,
    );
  });

  it('accepts microsecond-precision CelesTrak epochs without the trailing Z', () => {
    const omm = { ...tleToOmm(L1, L2), EPOCH: '2026-09-30T08:12:41.123456' };
    const p = Sgp4Propagator.fromOmm(omm);
    expect(p.epoch.toIso()).toBe('2026-09-30T08:12:41.123456Z');
    expect(p.minutesSinceEpoch(Instant.parse('2026-09-30T09:12:41.123456Z'))).toBeCloseTo(60, 9);
  });
});
