import type { Vec3 } from '../frames/mat3';
import { norm } from '../frames/mat3';
import { WGS84, WGS84_B, WGS84_E2, WGS84_F } from './wgs84';

/**
 * WGS 84 **normal** gravity field.
 *
 * The normal field is the exterior gravity field of the level (equipotential) reference ellipsoid
 * defined by WGS 84's four defining parameters (a, 1/f, GM, ω). It is exactly axisymmetric, so it is
 * fully described by even zonal harmonics, which follow in closed form from the defining parameters
 * (Heiskanen & Moritz, *Physical Geodesy*, 1967, eqs. 2-91, 2-92) — no tabulated coefficients are
 * needed and none can be mistyped. Tests compare the derived J₂ₙ with the published WGS 84 values
 * and the resulting surface gravity with Somigliana's closed formula.
 *
 * NOT modelled (and stated in `GRAVITY_LIMITATIONS`): geoid undulation and gravity anomalies
 * (order 10⁻³ m/s², i.e. up to ~100 mGal ≈ 0.01 %), i.e. the difference between the real Earth
 * (EGM2008 spherical harmonics to degree 2190) and its ellipsoidal idealisation; tides; the
 * gravitation of the Sun, Moon and planets (which matters for high orbits and is a separate
 * perturbation, not part of "gravity at a point on Earth").
 */

export const GRAVITY_MODEL_NAME =
  'WGS 84 normal gravity (even zonal harmonics J2–J10, level ellipsoid)';
export const GRAVITY_MODEL_REFERENCE =
  'NGA.STND.0036_1.0.0_WGS84; Heiskanen & Moritz, Physical Geodesy (1967) eqs. 2-91, 2-92';

export const GRAVITY_LIMITATIONS: readonly string[] = [
  'Normal (ellipsoidal) field only: no geoid undulation or gravity anomalies (typically up to ~1e-3 m/s²).',
  'Earth gravitation only: Sun/Moon/planetary third-body terms and tides are not included.',
  'Valid at and above the ellipsoid (r ≥ semi-minor axis); the zonal series is not valid inside the Earth.',
];

/** Highest even degree of the zonal series. J₁₂ ≈ 2e-17·… contributes < 1e-11 m/s² at the surface. */
const MAX_DEGREE = 10;

/** Derive J₂ … J₂₀ of the level ellipsoid from the WGS 84 defining parameters. Index n → J_n (odd = 0). */
function deriveZonalJ(): readonly number[] {
  const a = WGS84.a;
  const b = WGS84_B;
  const e2 = WGS84_E2;
  const e = Math.sqrt(e2);
  const ep = Math.sqrt(e2 / (1 - e2)); // e′
  const m = (WGS84.omegaGravity ** 2 * a * a * b) / WGS84.gm;
  // q₀ = ½ [ (1 + 3/e′²) atan(e′) − 3/e′ ]   (H&M 2-57)
  const q0 = 0.5 * ((1 + 3 / (ep * ep)) * Math.atan(ep) - 3 / ep);
  // J₂ = (e²/3) (1 − (2/15) m e′ / q₀)         (H&M 2-91)
  const j2 = (e2 / 3) * (1 - (2 / 15) * ((m * ep) / q0));
  const j: number[] = new Array<number>(MAX_DEGREE + 1).fill(0);
  j[2] = j2;
  for (let n = 2; n <= MAX_DEGREE / 2; n++) {
    // J₂ₙ = (−1)^(n+1) · 3 e^(2n) / ((2n+1)(2n+3)) · (1 − n + 5 n J₂ / e²)   (H&M 2-92)
    j[2 * n] =
      (((-1) ** (n + 1) * 3 * e ** (2 * n)) / ((2 * n + 1) * (2 * n + 3))) *
      (1 - n + (5 * n * j2) / e2);
  }
  return j;
}

export const ZONAL_J: readonly number[] = deriveZonalJ();

export interface GravityVectors {
  /** Gravitational acceleration (Newtonian attraction only), m/s², in the ITRF axes. */
  readonly gravitation: Vec3;
  /** Gravity = gravitation + centrifugal acceleration of the rotating frame, m/s², in the ITRF axes. */
  readonly gravity: Vec3;
  /** |gravity|, m/s². */
  readonly gravityMagnitude: number;
}

/**
 * Normal gravity at an Earth-fixed (ITRF) position, metres. Throws for r below the ellipsoid's
 * semi-minor axis (the zonal series is invalid there).
 */
export function normalGravity(itrfM: Vec3): GravityVectors {
  const [x, y, z] = itrfM;
  const r = norm(itrfM);
  if (r < WGS84_B * (1 - 1e-9)) {
    throw new RangeError('normalGravity: position is inside the reference ellipsoid');
  }
  const s = z / r; // sin(geocentric latitude)
  const ar = WGS84.a / r;

  // Legendre P_n(s) and P_n′(s) by recurrence (n ≤ MAX_DEGREE).
  const p: number[] = [1, s];
  const dp: number[] = [0, 1];
  for (let n = 1; n < MAX_DEGREE; n++) {
    p[n + 1] = ((2 * n + 1) * s * p[n]! - n * p[n - 1]!) / (n + 1);
    dp[n + 1] = dp[n - 1]! + (2 * n + 1) * p[n]!;
  }

  // U = (GM/r)·[1 − Σ Jₙ (a/r)ⁿ Pₙ(s)]  →  ∂U/∂r and ∂U/∂s
  let sumR = 0; // Σ (n+1) Jₙ (a/r)ⁿ Pₙ
  let sumS = 0; // Σ Jₙ (a/r)ⁿ Pₙ′
  for (let n = 2; n <= MAX_DEGREE; n += 2) {
    const term = ZONAL_J[n]! * ar ** n;
    sumR += (n + 1) * term * p[n]!;
    sumS += term * dp[n]!;
  }
  const dUdr = (-WGS84.gm / (r * r)) * (1 - sumR);
  const dUds = (-WGS84.gm / r) * sumS;

  // Chain rule to Cartesian: ∂s/∂x = −z x / r³, ∂s/∂y = −z y / r³, ∂s/∂z = (r² − z²)/r³
  const r3 = r * r * r;
  const gx = dUdr * (x / r) + dUds * ((-z * x) / r3);
  const gy = dUdr * (y / r) + dUds * ((-z * y) / r3);
  const gz = dUdr * (z / r) + dUds * ((r * r - z * z) / r3);

  const w2 = WGS84.omegaGravity ** 2;
  const gravitation: Vec3 = [gx, gy, gz];
  const gravity: Vec3 = [gx + w2 * x, gy + w2 * y, gz];
  return { gravitation, gravity, gravityMagnitude: norm(gravity) };
}

/** Somigliana closed formula for normal gravity magnitude ON the ellipsoid at geodetic latitude φ (NGA.STND.0036 eq. 4-1), m/s². */
export function somiglianaSurfaceGravity(latRad: number): number {
  const gammaE = 9.7803253359; // equatorial normal gravity, m/s² (WGS 84 Table 3.4)
  const gammaP = 9.8321849378; // polar normal gravity, m/s²
  const c = Math.cos(latRad);
  const s = Math.sin(latRad);
  return (
    (WGS84.a * gammaE * c * c + WGS84_B * gammaP * s * s) /
    Math.sqrt(WGS84.a * WGS84.a * c * c + WGS84_B * WGS84_B * s * s)
  );
}

/** Flattening re-exported for documentation of the derived quantities. */
export const NORMAL_GRAVITY_FLATTENING = WGS84_F;
