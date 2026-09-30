import { meters, radians, type Meters, type Radians } from '../units';

/**
 * WGS 84 reference ellipsoid and Earth constants.
 *
 * Source: NGA.STND.0036_1.0.0_WGS84, "Department of Defense World Geodetic System 1984" (2014),
 * Table 3.1 (defining parameters) and 3.3 (derived). Values reproduced exactly.
 */
export const WGS84 = {
  /** Semi-major axis a, m (defining). */
  a: meters(6_378_137.0),
  /** Inverse flattening 1/f (defining). */
  inverseFlattening: 298.257223563,
  /** Geocentric gravitational constant GM (incl. atmosphere), m³/s² (defining). */
  gm: 3.986004418e14,
  /** Nominal mean angular velocity of the Earth ω, rad/s (defining). Used for the gravity model. */
  omegaGravity: 7.292115e-5,
} as const;

/** Flattening f. */
export const WGS84_F = 1 / WGS84.inverseFlattening;
/** Semi-minor axis b = a(1 − f), m. */
export const WGS84_B: Meters = meters(WGS84.a * (1 - WGS84_F));
/** First eccentricity squared e² = f(2 − f). */
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);
/** Second eccentricity squared e′² = e²/(1 − e²). */
export const WGS84_EP2 = WGS84_E2 / (1 - WGS84_E2);

/**
 * Mean angular velocity of Earth's rotation, rad/s.
 * IERS Conventions (2010) Table 1.1 nominal value. The instantaneous rate is
 * `EARTH_ROTATION_RATE · (1 − LOD/86400)` with LOD from the EOP series.
 */
export const EARTH_ROTATION_RATE = 7.292115146706979e-5;

/** Geodetic (ellipsoidal) coordinates on the WGS84 ellipsoid. Latitude is geodetic, not geocentric. */
export interface Geodetic {
  readonly latRad: Radians;
  readonly lonRad: Radians;
  /** Height above the ellipsoid (NOT above the geoid / mean sea level), metres. */
  readonly heightM: Meters;
}

export const geodetic = (latRad: number, lonRad: number, heightM: number): Geodetic => ({
  latRad: radians(latRad),
  lonRad: radians(lonRad),
  heightM: meters(heightM),
});

/** Geodetic → ECEF (ITRF), metres. Closed form (NGA.STND.0036 §…, Bowring). */
export function geodeticToEcef(g: Geodetic): readonly [number, number, number] {
  const sinLat = Math.sin(g.latRad);
  const cosLat = Math.cos(g.latRad);
  const n = WGS84.a / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat); // prime-vertical radius of curvature
  return [
    (n + g.heightM) * cosLat * Math.cos(g.lonRad),
    (n + g.heightM) * cosLat * Math.sin(g.lonRad),
    (n * (1 - WGS84_E2) + g.heightM) * sinLat,
  ];
}

/**
 * ECEF (ITRF), metres → geodetic. Iterative (converges to < 1e-14 rad in ≤ 6 iterations from
 * the Bowring starting value for all heights from the geocentre neighbourhood to lunar distance).
 * Exact at the poles. Throws for the singular point at the Earth's centre.
 */
export function ecefToGeodetic(x: number, y: number, z: number): Geodetic {
  const p = Math.hypot(x, y);
  const lonRad = Math.atan2(y, x);
  if (p === 0 && z === 0) throw new RangeError('ecefToGeodetic: undefined at the Earth centre');

  // Height above the ellipsoid given latitude; uses the better-conditioned form near the poles.
  const heightAt = (lat: number): number => {
    const sinLat = Math.sin(lat);
    const n = WGS84.a / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    return Math.abs(lat) < Math.PI / 4 ? p / Math.cos(lat) - n : z / sinLat - n * (1 - WGS84_E2);
  };
  const primeVertical = (lat: number): number =>
    WGS84.a / Math.sqrt(1 - WGS84_E2 * Math.sin(lat) ** 2);

  let lat = Math.atan2(z, p * (1 - WGS84_E2));
  for (let i = 0; i < 30; i++) {
    const n = primeVertical(lat);
    const next = Math.atan2(z, p * (1 - (WGS84_E2 * n) / (n + heightAt(lat))));
    const converged = Math.abs(next - lat) < 1e-15;
    lat = next;
    if (converged) break;
  }
  return geodetic(lat, lonRad, heightAt(lat));
}
