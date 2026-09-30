/* eslint-disable no-loss-of-precision -- SOFA/ERFA reference values are quoted verbatim (19 digits) */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  Instant,
  biasPrecessionNutation,
  computeEarthOrientation,
  earthRotationAngle,
  equationOfEquinoxes06,
  fukushimaWilliams06,
  gmstMinusEra06,
  maxAbsDiff,
  meanObliquity06,
  nutation00b,
  nutation06b,
  polarMotionMatrix,
  type Mat3,
} from '../src';
import { NUT00B_TERMS } from '../src/frames/nut00b-data';

/**
 * Reference values: the IAU SOFA / ERFA library test suite (`t_erfa_c.c`), which is itself the
 * authoritative regression set for the IAU 2000/2006 algorithms. Dates are given there as
 * two-part Julian dates (date1 + date2), TT unless stated.
 *
 * SOFA's `pnm06a`, `nut06a`, `ee06a`, `gst06a`, `c2t06a` use IAU **2000A** nutation; we use
 * **2000B**, which agrees to ≈ 1 mas (5e-9 rad). Those comparisons use a 2e-8 rad tolerance and the
 * measured differences are stated in the test names. Functions whose SOFA counterparts are
 * model-identical (`nut00b`, `pfw06`, `obl06`, `gmst06`, `era00`, `pom00`) are compared to 1e-12 or better.
 */

const tCenturies = (date1: number, date2: number): number => (date1 - 2_451_545.0 + date2) / 36_525;
const T_2006 = tCenturies(2_400_000.5, 53_736.0);
const T_1996 = tCenturies(2_400_000.5, 50_123.9999);

describe('IAU 2000B nutation table', () => {
  it('has 77 luni-solar terms and is unmodified from the ERFA source (checksum)', () => {
    expect(NUT00B_TERMS.length).toBe(77);
    const sum = createHash('sha256').update(JSON.stringify(NUT00B_TERMS)).digest('hex');
    expect(sum).toBe('19e0dd3faa0da50014e475f67833a8e5d3bac0e01267aa2f53392209dc4840c1');
  });
});

describe('SOFA/ERFA reference vectors', () => {
  it('nut00b (model-identical): dpsi, deps at TT 2006-01-01', () => {
    const { dpsi, deps } = nutation00b(T_2006);
    expect(dpsi).toBeCloseTo(-0.9632552291148362783e-5, 13);
    expect(deps).toBeCloseTo(0.4063197106621159367e-4, 13);
  });

  it('nut06a-style adjustment is within 1 mas of SOFA nut06a (2000A)', () => {
    const { dpsi, deps } = nutation06b(T_2006);
    expect(Math.abs(dpsi - -0.9630912025820308797e-5)).toBeLessThan(1e-8);
    expect(Math.abs(deps - 0.4063238496887249798e-4)).toBeLessThan(1e-8);
  });

  it('pfw06 (model-identical): Fukushima–Williams angles', () => {
    const t = T_1996;
    const { gamb, phib, psib, epsa } = fukushimaWilliams06(t);
    expect(Math.abs(gamb - -0.224338767099799569e-5)).toBeLessThan(1e-16);
    expect(Math.abs(phib - 0.4091014602391312808)).toBeLessThan(1e-12);
    expect(Math.abs(psib - -0.9501954178013031895e-3)).toBeLessThan(1e-14);
    expect(Math.abs(epsa - 0.4091014316587367491)).toBeLessThan(1e-12);
  });

  it('obl06 (model-identical): mean obliquity', () => {
    expect(
      Math.abs(meanObliquity06(tCenturies(2_400_000.5, 54_388.0)) - 0.4090749229387258204),
    ).toBeLessThan(1e-14);
  });

  it('pnm06a: bias-precession-nutation matrix within 1e-8 of SOFA (2000A vs 2000B)', () => {
    const expected: Mat3 = [
      0.9999995832794205484, 0.8372382772630962111e-3, 0.3639684771140623099e-3,
      -0.8372533744743683605e-3, 0.9999996486492861646, 0.4132905944611019498e-4,
      -0.3639337469629464969e-3, -0.4163377605910663999e-4, 0.9999999329094260057,
    ];
    const m = biasPrecessionNutation(T_1996);
    expect(maxAbsDiff(m, expected)).toBeLessThan(1e-8);
  });

  it('era00 (model-identical): Earth rotation angle', () => {
    const era = earthRotationAngle({ scale: 'UT1', hi: 2_454_388.5, lo: 0 });
    expect(Math.abs(era - 0.4022837240028158102)).toBeLessThan(1e-12);
  });

  it('gmst06 (model-identical): ERA + polynomial at TT = UT1 = 2006-01-01', () => {
    const era = earthRotationAngle({ scale: 'UT1', hi: 2_453_736.5, lo: 0 });
    const gmst = era + gmstMinusEra06(T_2006);
    expect(Math.abs(gmst - 1.754174971870091203)).toBeLessThan(1e-12);
  });

  it('ee06a: equation of the equinoxes within 1e-8 rad of SOFA (2000A vs 2000B)', () => {
    expect(Math.abs(equationOfEquinoxes06(T_2006) - -0.8834195072043790156e-5)).toBeLessThan(1e-8);
  });

  it('gst06a: apparent sidereal time within 1e-8 rad of SOFA', () => {
    const era = earthRotationAngle({ scale: 'UT1', hi: 2_453_736.5, lo: 0 });
    const gast = era + gmstMinusEra06(T_2006) + equationOfEquinoxes06(T_2006);
    expect(Math.abs(gast - 1.754166137675019159)).toBeLessThan(1e-8);
  });

  it('pom00 (model-identical): polar-motion matrix', () => {
    const expected: Mat3 = [
      0.9999999999999674721, -0.1367174580728846989e-10, 0.2550602379999972345e-6,
      0.1414624947957029801e-10, 0.9999999999982695317, -0.1860359246998866389e-5,
      -0.2550602379741215021e-6, 0.1860359247002414021e-5, 0.9999999999982370039,
    ];
    const m = polarMotionMatrix(2.55060238e-7, 1.860359247e-6, -0.136717458072889146e-10);
    expect(maxAbsDiff(m, expected)).toBeLessThan(1e-16);
  });

  it('c2t06a: full GCRS→ITRS matrix within 2e-9 of SOFA (measured 0.15 mas ≈ 5 mm at the surface)', () => {
    // TT = UT1 = JD 2453736.5. UTC = TT − (ΔAT 33 s + 32.184 s) → dut1 = UT1 − UTC = 65.184 s.
    const t = Instant.parse('2005-12-31T23:58:54.816Z');
    const o = computeEarthOrientation(t, {
      quality: 'OBSERVED',
      params: { dut1S: 65.184, xpRad: 2.55060238e-7, ypRad: 1.860359247e-6, lodS: 0 },
    });
    const expected: Mat3 = [
      -0.1810332128305897282, 0.9834769806938592296, 0.6555550962998436505e-4,
      -0.9834768134136214897, -0.1810332203649130832, 0.574980084490559411e-3,
      0.5773474024748545878e-3, 0.3961816829632690581e-4, 0.9999998325501747785,
    ];
    expect(maxAbsDiff(o.itrfFromGcrf, expected)).toBeLessThan(2e-9);
  });
});
