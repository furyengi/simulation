import { RAD_PER_ARCSEC, TWO_PI } from '../units';
import { mul, rot1, rot2, rot3, type Mat3 } from './mat3';
import { NUT00B_TERMS } from './nut00b-data';

/**
 * IAU 2006 precession + IAU 2000B nutation (with the IAU 2006 J2-rate adjustments), bias included.
 *
 * Implementation follows the published algorithms in the IAU SOFA / ERFA libraries
 * (`eraPfw06`, `eraObl06`, `eraNut00b`, `eraNut06a`'s P03 adjustment, `eraFw2m`, `eraEe06a`,
 * `eraGmst06`, `eraPom00`, `eraSp00`). Those libraries are © IAU SOFA Board / ERFA developers, BSD-3-Clause.
 * Numerical agreement with the SOFA/ERFA test vectors is asserted in `test/iau2006.test.ts`.
 *
 * All angles radians; `t` is Julian centuries of TT since J2000.0 (see `julianCenturiesTt`).
 *
 * Accuracy: IAU 2000B nutation reproduces IAU 2000A to ≲ 1 mas (≈ 3 cm at the surface). Celestial
 * pole offsets (dX, dY) are not applied.
 */

const ARCSEC = RAD_PER_ARCSEC;
const TURN_ARCSEC = 1_296_000;

/** Mean obliquity of the ecliptic, IAU 2006 (Capitaine et al. 2003) — SOFA `eraObl06`. */
export const meanObliquity06 = (t: number): number =>
  (84_381.406 +
    (-46.836_769 +
      (-0.000_183_1 + (0.002_003_40 + (-0.000_000_576 + -0.000_000_043_4 * t) * t) * t) * t) *
      t) *
  ARCSEC;

/** Fukushima–Williams bias-precession angles (P03) — SOFA `eraPfw06`. */
export function fukushimaWilliams06(t: number): {
  gamb: number;
  phib: number;
  psib: number;
  epsa: number;
} {
  const gamb =
    (-0.052_928 +
      (10.556_378 +
        (0.493_204_4 + (-0.000_312_38 + (-0.000_002_788 + 0.000_000_026_0 * t) * t) * t) * t) *
        t) *
    ARCSEC;
  const phib =
    (84_381.412_819 +
      (-46.811_016 +
        (0.051_126_8 + (0.000_532_89 + (-0.000_000_44 + -0.000_000_017_6 * t) * t) * t) * t) *
        t) *
    ARCSEC;
  const psib =
    (-0.041_775 +
      (5_038.481_484 +
        (1.558_417_5 + (-0.000_185_22 + (-0.000_026_452 + -0.000_000_014_8 * t) * t) * t) * t) *
        t) *
    ARCSEC;
  return { gamb, phib, psib, epsa: meanObliquity06(t) };
}

/** Delaunay fundamental arguments (Simon et al. 1994), linear in t as used by IAU 2000B. */
function delaunay(t: number): { el: number; elp: number; f: number; d: number; om: number } {
  const arg = (a0: number, a1: number): number => ((a0 + a1 * t) % TURN_ARCSEC) * ARCSEC;
  return {
    el: arg(485_868.249_036, 1_717_915_923.2178), // mean anomaly of the Moon
    elp: arg(1_287_104.793_05, 129_596_581.0481), // mean anomaly of the Sun
    f: arg(335_779.526_232, 1_739_527_262.8478), // mean argument of latitude of the Moon
    d: arg(1_072_260.703_69, 1_602_961_601.209), // mean elongation of the Moon from the Sun
    om: arg(450_160.398_036, -6_962_890.5431), // mean longitude of the Moon's ascending node
  };
}

/** Units of 0.1 µas → rad. */
const U2R = ARCSEC / 1e7;
/** Fixed offsets in lieu of the planetary terms (SOFA `eraNut00b`), radians. */
const DPPLAN = -0.135e-3 * ARCSEC;
const DEPLAN = 0.388e-3 * ARCSEC;

/** IAU 2000B nutation in longitude and obliquity — SOFA `eraNut00b`. */
export function nutation00b(t: number): { dpsi: number; deps: number } {
  const { el, elp, f, d, om } = delaunay(t);
  let dp = 0;
  let de = 0;
  for (let i = NUT00B_TERMS.length - 1; i >= 0; i--) {
    const [nl, nlp, nf, nd, nom, ps, pst, pc, ec, ect, es] = NUT00B_TERMS[i]!;
    const arg = (nl * el + nlp * elp + nf * f + nd * d + nom * om) % TWO_PI;
    const s = Math.sin(arg);
    const c = Math.cos(arg);
    dp += (ps + pst * t) * s + pc * c;
    de += (ec + ect * t) * c + es * s;
  }
  return { dpsi: dp * U2R + DPPLAN, deps: de * U2R + DEPLAN };
}

/**
 * IAU 2000B nutation adjusted for IAU 2006 precession (Wallace & Capitaine 2006, eqs. 5) —
 * the same adjustment SOFA's `eraNut06a` applies to IAU 2000A.
 */
export function nutation06b(t: number): { dpsi: number; deps: number } {
  const { dpsi, deps } = nutation00b(t);
  const fj2 = -2.7774e-6 * t;
  return { dpsi: dpsi + dpsi * (0.4697e-6 + fj2), deps: deps + deps * fj2 };
}

/** Rotation matrix from Fukushima–Williams angles — SOFA `eraFw2m`. */
export const fw2m = (gamb: number, phib: number, psi: number, eps: number): Mat3 =>
  mul(rot1(-eps), mul(rot3(-psi), mul(rot1(phib), rot3(gamb))));

/**
 * Frame-bias + precession + nutation matrix: GCRS → true equator and equinox of date
 * (IAU 2006/2000B). Equivalent to SOFA `eraPnm06a` with 2000B nutation.
 */
export function biasPrecessionNutation(t: number): Mat3 {
  const { gamb, phib, psib, epsa } = fukushimaWilliams06(t);
  const { dpsi, deps } = nutation06b(t);
  return fw2m(gamb, phib, psib + dpsi, epsa + deps);
}

/**
 * Equation of the equinoxes, IAU 2006/2000B: Δψ·cos ε_A + principal complementary terms.
 * The full SOFA `eraEect00` series has 33 further terms, each ≤ 12 µas (≤ 0.4 mm); we include
 * the two largest (2641 µas·sinΩ, 63.5 µas·sin2Ω), leaving a residual ≲ 0.03 mas.
 */
export function equationOfEquinoxes06(t: number): number {
  const { dpsi } = nutation06b(t);
  const omega =
    ((450_160.398_036 + (-6_962_890.5431 + (7.4722 + (0.007_702 - 0.000_059_39 * t) * t) * t) * t) %
      TURN_ARCSEC) *
    ARCSEC;
  const complementary =
    (2640.96e-6 - 0.39e-6 * t) * Math.sin(omega) + 63.52e-6 * Math.sin(2 * omega);
  return dpsi * Math.cos(meanObliquity06(t)) + complementary * ARCSEC;
}

/** GMST − ERA polynomial, IAU 2006 (SOFA `eraGmst06`), radians. */
export const gmstMinusEra06 = (t: number): number =>
  (0.014_506 +
    (4_612.156_534 +
      (1.391_581_7 + (-0.000_000_44 + (-0.000_029_956 + -0.000_000_036_8 * t) * t) * t) * t) *
      t) *
  ARCSEC;

/** TIO locator s′ (SOFA `eraSp00`), radians. */
export const tioLocator = (t: number): number => -47e-6 * t * ARCSEC;

/** Polar-motion matrix TIRS → ITRS — SOFA `eraPom00`: R1(−yp)·R2(−xp)·R3(s′). */
export const polarMotionMatrix = (xp: number, yp: number, sp: number): Mat3 =>
  mul(rot1(-yp), mul(rot2(-xp), rot3(sp)));
