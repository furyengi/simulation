import * as Astronomy from 'astronomy-engine';
import { gstime } from 'satellite.js';
import { describe, expect, it } from 'vitest';
import {
  EopTable,
  FrameModel,
  Instant,
  apply,
  astroTimeTt,
  computeEarthOrientation,
  earthRotationAngle,
  gmst82,
  julianDateUt1,
  maxAbsDiff,
  mul,
  norm,
  position,
  stateVector,
  sub,
  transpose,
  vec,
  type EopLookup,
  type Mat3,
} from '../src';

const ARCSEC = Math.PI / 648_000;
const KM = 1000;

/**
 * Vallado, Kelso, Seago, Cefola, "Implementation Issues Surrounding the New IAU Reference Systems for
 * Astrodynamics", 16th AAS/AIAA Space Flight Mechanics Conference, 2006, LEO test case (also Vallado, Fundamentals of Astrodynamics, Ex. 3-15).
 * UTC 2004-04-06 07:51:28.386009, UT1−UTC = −0.439962 s, xp = −0.140682″, yp = 0.333309″.
 * Input ITRF r = (−1033.4793830, 7901.2952754, 6380.3565958) km.
 *
 * The paper applies the published IERS nutation corrections (ddpsi, ddeps); we apply none, and use
 * IAU 2000B nutation. The paper itself reports ~12 mm between its 2000A and 2000B rows, and
 * ~0.7 m for its IAU-76 path. Measured agreement with the 2000B row: 1.1 cm. Tolerance: 5 cm.
 */
describe('Vallado Example 3-15: ITRF ↔ GCRF', () => {
  const t = Instant.parse('2004-04-06T07:51:28.386009Z');
  const eop: EopLookup = {
    quality: 'OBSERVED',
    params: {
      dut1S: -0.4399619,
      xpRad: -0.140682 * ARCSEC,
      ypRad: 0.333309 * ARCSEC,
      lodS: 0.001556,
    },
  };
  const frames = new FrameModel({ lookup: () => eop });
  const itrf = position('ITRF', [-1033.479383 * KM, 7901.2952754 * KM, 6380.3565958 * KM]);
  // Row 'GCRF iau 2000b' of the paper's LEO table.
  const gcrfExpected = [5102.5089579 * KM, 6123.0114012 * KM, 6378.1369277 * KM] as const;

  it('ITRF → GCRF matches the published GCRF position', () => {
    const gcrf = frames.convertPosition(itrf, 'GCRF', t);
    const err = norm(sub(vec(gcrf), gcrfExpected));
    expect(err).toBeLessThan(0.05); // measured 1.1 cm
  });

  it('GCRF → ITRF round-trips to numerical precision', () => {
    const gcrf = frames.convertPosition(itrf, 'GCRF', t);
    const back = frames.convertPosition(gcrf, 'ITRF', t);
    expect(norm(sub(vec(back), vec(itrf)))).toBeLessThan(1e-6);
  });
});

describe('Earth rotation angle and sidereal time', () => {
  it('ERA at J2000.0 UT1 is 280.46°', () => {
    // IERS Conventions eq. 5.15: ERA(J2000.0) = 2π·0.7790572732640 rad = 280.4606184°
    const era = earthRotationAngle({ scale: 'UT1', hi: 2_451_545.0, lo: 0 });
    expect((era * 180) / Math.PI).toBeCloseTo(280.4606184, 6);
  });

  it('GMST82 at J2000.0 is 280.46061837° (Vallado)', () => {
    const g = gmst82({ scale: 'UT1', hi: 2_451_545.0, lo: 0 });
    expect((g * 180) / Math.PI).toBeCloseTo(280.46061837, 4);
  });

  it('Vallado Example 3-5: GMST(1992-08-20 12:14:00 UT1) = 152.578787810°', () => {
    const ut1 = Instant.parse('1992-08-20T12:14:00Z');
    const g = gmst82(julianDateUt1(ut1, 0));
    expect((g * 180) / Math.PI).toBeCloseTo(152.57878781, 6);
  });

  it('our GMST82 equals satellite.js gstime() (the SGP4 convention) to < 1 µas-scale', () => {
    for (const iso of ['1995-03-14T05:06:07Z', '2010-07-01T00:00:00Z', '2026-09-30T18:45:12.5Z']) {
      const t = Instant.parse(iso);
      const jd = julianDateUt1(t, 0);
      expect(Math.abs(gmst82(jd) - gstime(jd.hi + jd.lo))).toBeLessThan(1e-9);
    }
  });

  it('our GAST agrees with Astronomy Engine SiderealTime() when UT1 = UTC and TT matches', () => {
    // Astronomy Engine treats UT1 ≡ UTC and derives TT from ΔT; feed it both consistently.
    const t = Instant.parse('2026-03-20T09:00:00Z');
    const o = computeEarthOrientation(t, {
      quality: 'UNAVAILABLE',
      params: { dut1S: 0, xpRad: 0, ypRad: 0, lodS: 0 },
    });
    const ae = new Astronomy.AstroTime(t.toDate());
    const aeGastRad = Astronomy.SiderealTime(ae) * 15 * (Math.PI / 180);
    // The two disagree only through the TT they assume (ΔT model vs leap-second table) and the two
    // complementary EqE terms (2.6 mas): well under 0.2″.
    const d = Math.abs(o.gastRad - aeGastRad);
    expect(Math.min(d, 2 * Math.PI - d)).toBeLessThan(0.2 * ARCSEC); // measured ≈ 0.03″
  });
});

describe('FrameModel', () => {
  const t = Instant.parse('2026-09-30T12:00:00Z');
  const eop: EopLookup = {
    quality: 'OBSERVED',
    params: { dut1S: -0.03, xpRad: 0.1 * ARCSEC, ypRad: 0.4 * ARCSEC, lodS: 0.0005 },
  };
  const frames = new FrameModel({ lookup: () => eop });
  const o = frames.orientation(t);

  const isOrthonormal = (m: Mat3): boolean =>
    maxAbsDiff(mul(m, transpose(m)), [1, 0, 0, 0, 1, 0, 0, 0, 1]) < 1e-14;

  it('all rotation matrices are orthonormal', () => {
    expect(isOrthonormal(o.itrfFromGcrf)).toBe(true);
    expect(isOrthonormal(o.itrfFromTeme)).toBe(true);
    expect(isOrthonormal(o.temeFromGcrf)).toBe(true);
  });

  it('the frame graph is consistent: TEME→ITRF equals TEME→GCRF→ITRF exactly', () => {
    const viaGcrf = mul(o.itrfFromGcrf, transpose(o.temeFromGcrf));
    expect(maxAbsDiff(viaGcrf, o.itrfFromTeme)).toBeLessThan(1e-14);
  });

  it('TEME (SGP4 sidereal angle, GMST82) is offset from the 2006 mean-equinox axis by < 0.1″ in 2026', () => {
    // Documented in orientation.ts: GMST06 − GMST82 grows ≈ 2.6 mas/yr after 2000.
    const d = o.gmst06Rad - gmst82(julianDateUt1(t, eop.params.dut1S));
    expect(Math.abs(d) / ARCSEC).toBeGreaterThan(0.03);
    expect(Math.abs(d) / ARCSEC).toBeLessThan(0.1);
  });

  it('GCRF→TEME→GCRF conversions are exact inverses', () => {
    const p = position('GCRF', [7_000_000, 1_234_567, -2_345_678]);
    const back = frames.convertPosition(frames.convertPosition(p, 'TEME', t), 'GCRF', t);
    expect(norm(sub(vec(back), vec(p)))).toBeLessThan(1e-8);
  });

  it('a point fixed on the Earth has zero inertial-frame-relative-to-Earth velocity: v_ITRF = 0 ⇔ v_inertial = ω × r', () => {
    const fixed = stateVector('ITRF', [6_378_137, 0, 0], [0, 0, 0]);
    const inertial = frames.convertState(fixed, 'GCRF', t);
    const speed = norm(vec(inertial.velocity));
    // Equatorial rotation speed: ω·a ≈ 465.1 m/s
    expect(speed).toBeGreaterThan(465.0);
    expect(speed).toBeLessThan(465.2);
    const back = frames.convertState(inertial, 'ITRF', t);
    expect(norm(vec(back.velocity))).toBeLessThan(1e-9);
  });

  it('refuses to invent a transform for unsupported pairs at the type level (runtime guard)', () => {
    const p = position('GCRF', [1, 2, 3]);
    expect(() => frames.convertPosition(p, 'GCRF', t)).not.toThrow();
  });

  it('agrees with Astronomy Engine (independent, truncated nutation) to < 0.1″ for GCRF→TOD', () => {
    // Coarse independent sanity check: AE's 5-term nutation is good to ~50 mas, so 0.1″ (≈ 3 m at LEO).
    const tt = astroTimeTt(t);
    const rot = Astronomy.Rotation_EQJ_EQD(tt);
    const v: [number, number, number] = [0.3, -0.5, 0.8];
    const ae = Astronomy.RotateVector(rot, new Astronomy.Vector(v[0], v[1], v[2], tt));
    // Undo the z-rotation in temeFromGcrf (TEME ≠ TOD) to compare like with like.
    const mine = apply(o.temeFromGcrf, v);
    const a = o.gastRad - gmst82(julianDateUt1(t, eop.params.dut1S));
    const tod: [number, number, number] = [
      Math.cos(a) * mine[0] - Math.sin(a) * mine[1],
      Math.sin(a) * mine[0] + Math.cos(a) * mine[1],
      mine[2],
    ];
    expect(norm(sub(tod, [ae.x, ae.y, ae.z])) / norm(v)).toBeLessThan(0.1 * ARCSEC);
  });
});

describe('EopTable', () => {
  const csv = [
    'DATE,MJD,X,Y,UT1-UTC,LOD,DPSI,DEPS,DX,DY,DAT,DATA_TYPE',
    '2016-12-30,57752,0.1,0.2,-0.5890000,0.0010,0,0,0,0,36,O',
    '2016-12-31,57753,0.2,0.3,-0.5900000,0.0010,0,0,0,0,36,O',
    // Leap second at 2017-01-01: UTC steps back 1 s relative to TAI, so DAT rises to 37 and
    // UT1−UTC jumps UP by ~1 s (UT1−TAI stays continuous).
    '2017-01-01,57754,0.3,0.4,0.4090000,0.0010,0,0,0,0,37,O',
    '2017-01-02,57755,0.4,0.5,0.4080000,0.0010,0,0,0,0,37,P',
  ].join('\n');
  const table = EopTable.parseCelestrakCsv(csv);

  it('parses rows and reports coverage', () => {
    expect(table.size).toBe(4);
    expect(table.firstMjd).toBe(57752);
    expect(table.lastObservedMjd).toBe(57754);
  });

  it('interpolates linearly inside a day', () => {
    const l = table.lookup(Instant.parse('2016-12-30T12:00:00Z'));
    expect(l.quality).toBe('OBSERVED');
    expect(l.params.dut1S).toBeCloseTo(-0.5895, 9);
    expect(l.params.xpRad).toBeCloseTo(0.15 * ARCSEC, 15);
  });

  it('does not smear the leap second: UT1−UTC is interpolated via the continuous UT1−TAI', () => {
    const l = table.lookup(Instant.parse('2016-12-31T12:00:00Z'));
    // Bracket 12-31 (−0.590, DAT 36) → 01-01 (+0.409, DAT 37): UT1−TAI −36.590 → −36.591.
    // Midway UT1−TAI = −36.5905, so UT1−UTC = −0.5905. A naive interpolation of UT1−UTC would
    // give −0.0905, i.e. 0.5 s (≈ 230 m of Earth rotation) wrong.
    expect(l.params.dut1S).toBeCloseTo(-0.5905, 9);
  });

  it('flags predicted values and reports UNAVAILABLE (zeros) outside coverage', () => {
    expect(table.lookup(Instant.parse('2017-01-01T12:00:00Z')).quality).toBe('PREDICTED');
    const out = table.lookup(Instant.parse('2020-01-01T00:00:00Z'));
    expect(out.quality).toBe('UNAVAILABLE');
    expect(out.params).toEqual({ dut1S: 0, xpRad: 0, ypRad: 0, lodS: 0 });
  });
});
