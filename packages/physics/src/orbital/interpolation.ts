import type { Vec3 } from '../frames/mat3';

/**
 * Cubic Hermite interpolation of a position between two samples that carry velocities.
 * This is the scheme the web client uses to animate between server-supplied ephemeris samples,
 * so its error must be known and bounded — see `suggestedStepSeconds` and the validation case
 * `validation/interpolation`.
 *
 * @param p0 position at t0 (m)   @param v0 velocity at t0 (m/s)
 * @param p1 position at t1 (m)   @param v1 velocity at t1 (m/s)
 * @param h  t1 − t0 (s)          @param u  fraction of the interval in [0, 1]
 */
export function hermitePosition(
  p0: Vec3,
  v0: Vec3,
  p1: Vec3,
  v1: Vec3,
  h: number,
  u: number,
): Vec3 {
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return [
    h00 * p0[0] + h10 * h * v0[0] + h01 * p1[0] + h11 * h * v1[0],
    h00 * p0[1] + h10 * h * v0[1] + h01 * p1[1] + h11 * h * v1[1],
    h00 * p0[2] + h10 * h * v0[2] + h01 * p1[2] + h11 * h * v1[2],
  ];
}

/** Earth's gravitational parameter used to relate period and radius for step sizing (WGS84 GM), m³/s². */
const GM = 3.986004418e14;

/**
 * A sample step for which cubic Hermite interpolation of a Kepler-like orbit stays below
 * `toleranceM`.
 *
 * Derivation: the interpolation error of cubic Hermite is bounded by h⁴/384 · max|x⁗|. For motion
 * with angular rate ω at radius r, |x⁗| ≤ r ω⁴ (exact for circles); for eccentric orbits the
 * worst case is at perigee (r_p, ω_p = v_p / r_p). We size for perigee and then clamp.
 *
 * @param semiMajorAxisM   a (m)           @param eccentricity e
 * @returns step in seconds, clamped to [1, 600]
 */
export function suggestedStepSeconds(
  semiMajorAxisM: number,
  eccentricity: number,
  toleranceM: number,
): number {
  const rp = semiMajorAxisM * (1 - eccentricity);
  const vp = Math.sqrt(GM * (2 / rp - 1 / semiMajorAxisM));
  const omega = vp / rp;
  const bound = rp * omega ** 4; // m/s⁴
  const h = Math.pow((384 * toleranceM) / bound, 0.25);
  return Math.min(600, Math.max(1, h));
}

/** Semi-major axis from an orbital period via Kepler's third law (m). */
export const semiMajorAxisFromPeriod = (periodSeconds: number): number =>
  Math.cbrt((GM * periodSeconds * periodSeconds) / (4 * Math.PI * Math.PI));
