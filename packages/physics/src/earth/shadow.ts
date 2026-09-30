import type { Vec3 } from '../frames/mat3';
import { dot, norm, sub } from '../frames/mat3';
import { WGS84 } from './wgs84';

/**
 * Earth-shadow (eclipse) geometry for a point in space: the conical umbra/penumbra model of
 * Montenbruck & Gill, *Satellite Orbits* (2000), §3.4.2, eqs. 3.85–3.92.
 *
 * The Sun and Earth are treated as spheres seen from the point; the fraction of the solar disc that
 * remains visible is one minus the area of overlap of the two discs divided by the solar disc area.
 *
 * Modelled: Earth as a sphere of radius `earthRadiusM` (default: WGS84 equatorial radius).
 * NOT modelled (reported in `limitations`): Earth's oblateness (shadow-boundary error of order
 * 20 km), atmospheric refraction/absorption (which extends the effective shadow), and the Moon's
 * shadow (solar eclipses of a spacecraft).
 */

export type EclipseCondition =
  /** The whole solar disc is visible. */
  | 'SUNLIT'
  /** Part of the solar disc is hidden by the Earth. */
  | 'PENUMBRA'
  /** The entire solar disc is hidden (only possible when the Earth appears larger than the Sun). */
  | 'UMBRA'
  /** The Earth appears smaller than the Sun and is centred on it: a ring of Sun remains (far from Earth). */
  | 'ANTUMBRA';

export interface EclipseState {
  readonly condition: EclipseCondition;
  /** Fraction of the solar disc (by area) that is visible, in [0, 1]. */
  readonly illuminatedFraction: number;
  /** Angular radius of the Sun as seen from the point, radians. */
  readonly sunAngularRadiusRad: number;
  /** Angular radius of the Earth as seen from the point, radians. */
  readonly earthAngularRadiusRad: number;
  /** Angular separation of the Earth's and Sun's centres as seen from the point, radians. */
  readonly separationRad: number;
}

export const EARTH_SHADOW_LIMITATIONS: readonly string[] = [
  'Earth modelled as a sphere of the WGS84 equatorial radius; oblateness shifts the shadow boundary by up to ~20 km.',
  'Geometric shadow only: atmospheric refraction and absorption, which extend the effective shadow, are not modelled.',
  "Lunar shadow (solar eclipses seen from the point) is not modelled: reports the Earth's shadow only.",
];

/** Area of overlap of two discs of angular radii a and b whose centres are separated by c (all radians, small-angle planar approximation). */
function discOverlapArea(a: number, b: number, c: number): number {
  if (c >= a + b) return 0;
  if (c <= Math.abs(a - b)) return Math.PI * Math.min(a, b) ** 2;
  const x = (c * c + a * a - b * b) / (2 * c);
  const y = Math.sqrt(Math.max(0, a * a - x * x));
  return a * a * Math.acos(x / a) + b * b * Math.acos((c - x) / b) - c * y;
}

/**
 * Eclipse state of a point.
 * @param pointM     position of the point, metres, in any inertial or Earth-fixed frame …
 * @param sunM       … Sun's geocentric position, metres, in the SAME frame (Earth centre at the origin)
 * @param sunRadiusM Sun's physical radius, metres
 */
export function earthShadowState(
  pointM: Vec3,
  sunM: Vec3,
  sunRadiusM: number,
  earthRadiusM: number = WGS84.a,
): EclipseState {
  const r = norm(pointM);
  if (r <= earthRadiusM) {
    // Inside the Earth: not a physically meaningful point for an unobstructed-sky geometry.
    throw new RangeError('earthShadowState: point is inside the Earth sphere');
  }
  const toSun = sub(sunM, pointM);
  const sunDist = norm(toSun);
  const a = Math.asin(Math.min(1, sunRadiusM / sunDist)); // Sun's apparent radius
  const b = Math.asin(Math.min(1, earthRadiusM / r)); // Earth's apparent radius
  const cosC = dot([-pointM[0], -pointM[1], -pointM[2]], toSun) / (r * sunDist);
  const c = Math.acos(Math.max(-1, Math.min(1, cosC))); // separation of centres

  let condition: EclipseCondition;
  let fraction: number;
  if (c >= a + b) {
    condition = 'SUNLIT';
    fraction = 1;
  } else if (b > a && c <= b - a) {
    condition = 'UMBRA';
    fraction = 0;
  } else if (a > b && c <= a - b) {
    condition = 'ANTUMBRA';
    fraction = 1 - (Math.PI * b * b) / (Math.PI * a * a);
  } else {
    condition = 'PENUMBRA';
    fraction = 1 - discOverlapArea(a, b, c) / (Math.PI * a * a);
  }
  return {
    condition,
    illuminatedFraction: fraction,
    sunAngularRadiusRad: a,
    earthAngularRadiusRad: b,
    separationRad: c,
  };
}
