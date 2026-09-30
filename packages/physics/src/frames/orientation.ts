import * as Astronomy from 'astronomy-engine';
import {
  julianCenturiesTt,
  julianDateTt,
  julianDateUt1,
  JD_J2000,
  type JulianDate,
} from '../time/scales';
import type { Instant } from '../time/instant';
import { EARTH_ROTATION_RATE } from '../earth/wgs84';
import { TWO_PI, wrapTwoPi } from '../units';
import type { EopLookup } from './eop';
import {
  biasPrecessionNutation,
  equationOfEquinoxes06,
  gmstMinusEra06,
  polarMotionMatrix,
  tioLocator,
} from './iau2006';
import { mul, rot3, type Mat3 } from './mat3';

/**
 * Earth orientation at one instant: the rotation matrices connecting GCRF, TEME and ITRF, plus the
 * angles they are built from (kept so tests and provenance can show them).
 *
 * Chain (classical equinox-based form of the IAU 2006/2000 reduction; see `./iau2006`):
 *
 *   r_ITRF = W · R3(GAST) · NPB · r_GCRF
 *   r_ITRF = W · R3(GMST82)     · r_TEME
 *   r_TEME = R3(GAST − GMST82) · NPB · r_GCRF
 *
 * with
 *   NPB    frame bias + IAU 2006 precession + IAU 2000B nutation (Fukushima–Williams form), at TT;
 *   GAST   Greenwich apparent sidereal time = ERA(UT1) + (GMST−ERA)(TT) + EqE(TT);
 *   GMST82 IAU 1982 mean sidereal time (Vallado eq. 3-47) — the sidereal angle SGP4 assumes;
 *   W      polar motion R1(−yp)·R2(−xp)·R3(s′) from the EOP (TIRS→ITRS, SOFA `iauPom00`).
 *
 * "GCRF" here is the true GCRF (frame bias included). Simplifications, all ≲ 30 mas (≈ 1 m at LEO):
 * IAU 2000B instead of 2000A nutation (≲ 1 mas); no celestial-pole offsets (dX, dY); a truncated
 * complementary-terms series in the equation of the equinoxes (≲ 0.03 mas). See docs/reference-frames.md.
 */
export interface EarthOrientation {
  readonly time: Instant;
  readonly eop: EopLookup;
  /** IAU 1982 GMST (rad, [0, 2π)). Used with TEME. */
  readonly gmst82Rad: number;
  /** IAU 2006 GMST (rad, [0, 2π)). */
  readonly gmst06Rad: number;
  /** Greenwich apparent sidereal time (rad, [0, 2π)). */
  readonly gastRad: number;
  /** Equation of the equinoxes (rad). */
  readonly eqeRad: number;
  /** Earth rotation rate ω = Ω(1 − LOD/86400), rad/s. */
  readonly rotationRateRadS: number;
  /** Position rotation GCRF → ITRF (apply to a column vector). */
  readonly itrfFromGcrf: Mat3;
  /** Position rotation TEME → ITRF. */
  readonly itrfFromTeme: Mat3;
  /** Position rotation GCRF → TEME. */
  readonly temeFromGcrf: Mat3;
}

/** Earth Rotation Angle (IAU 2000, IERS Conventions 2010 eq. 5.15), radians in [0, 2π). */
export function earthRotationAngle(ut1: JulianDate): number {
  const tu = ut1.hi - JD_J2000 + ut1.lo;
  // Split so that the large integer-day part does not swamp the fractional part.
  const frac = ((ut1.hi - JD_J2000) % 1) + ut1.lo;
  return wrapTwoPi(TWO_PI * (0.779_057_273_264_0 + 0.002_737_811_911_354_48 * tu + frac));
}

/** IAU 1982 GMST in radians (Vallado, *Fundamentals of Astrodynamics*, eq. 3-47). Input: UT1 JD. */
export function gmst82(ut1: JulianDate): number {
  const tu = (ut1.hi - JD_J2000 + ut1.lo) / 36_525;
  const seconds =
    67_310.548_41 +
    (876_600 * 3600 + 8_640_184.812_866) * tu +
    0.093_104 * tu * tu -
    6.2e-6 * tu ** 3;
  return wrapTwoPi((seconds % 86_400) * (TWO_PI / 86_400));
}

/**
 * Astronomy Engine time whose TT is exact for `t`. Used only for the Sun/Moon ephemerides, which
 * depend on TT alone. (Its UT field is derived from an internal ΔT model and MUST NOT be used.)
 */
export function astroTimeTt(t: Instant): Astronomy.AstroTime {
  const jd = julianDateTt(t);
  return Astronomy.AstroTime.FromTerrestrialTime(jd.hi - JD_J2000 + jd.lo);
}

export function computeEarthOrientation(t: Instant, eop: EopLookup): EarthOrientation {
  const { dut1S, xpRad, ypRad, lodS } = eop.params;
  const jdUt1 = julianDateUt1(t, dut1S);
  const tCent = julianCenturiesTt(t);

  const eqeRad = equationOfEquinoxes06(tCent);
  const era = earthRotationAngle(jdUt1);
  const gmst06Rad = wrapTwoPi(era + gmstMinusEra06(tCent));
  const gastRad = wrapTwoPi(gmst06Rad + eqeRad);
  const gmst82Rad = gmst82(jdUt1);

  const npb = biasPrecessionNutation(tCent);
  const w = polarMotionMatrix(xpRad, ypRad, tioLocator(tCent));

  const itrfFromGcrf = mul(w, mul(rot3(gastRad), npb));
  const itrfFromTeme = mul(w, rot3(gmst82Rad));
  // TEME's x-axis is pinned by the sidereal angle SGP4 uses (GMST82) so that
  // TEME→ITRF (direct) and TEME→GCRF→ITRF are exactly the same rotation. Relative to a "pure"
  // mean-equinox-of-date axis this offsets TEME by EqE + (GMST06 − GMST82); the second term is
  // ≈ 2.6 mas/yr after 2000 (≈ 60 mas in 2026, ≈ 2 m at LEO), far below SGP4's own error.
  const temeFromGcrf = mul(rot3(gastRad - gmst82Rad), npb);

  return {
    time: t,
    eop,
    gmst82Rad,
    gmst06Rad,
    gastRad,
    eqeRad,
    rotationRateRadS: EARTH_ROTATION_RATE * (1 - lodS / 86_400),
    itrfFromGcrf,
    itrfFromTeme,
    temeFromGcrf,
  };
}
