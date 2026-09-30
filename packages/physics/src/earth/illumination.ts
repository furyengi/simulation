import type { Vec3 } from '../frames/mat3';
import { dot, norm, normalize, sub } from '../frames/mat3';
import { radians, type Radians } from '../units';
import { ecefToGeodetic, geodeticToEcef, type Geodetic } from './wgs84';

/**
 * Sun illumination geometry on and above the Earth's surface. Pure functions of Earth-fixed (ITRF)
 * vectors in metres; the caller obtains the Sun position from an ephemeris and the frame model.
 */

/** Unit vector from `from` towards `to` (any common frame; metres) and the distance between them. */
export function directionTo(from: Vec3, to: Vec3): { unit: Vec3; distanceM: number } {
  const d = sub(to, from);
  return { unit: normalize(d), distanceM: norm(d) };
}

/**
 * Sub-solar point: the geodetic latitude and longitude at which the Sun is at the zenith.
 * `sunItrf` is the geocentric Sun position (or direction) in ITRF. Because the geodetic surface
 * normal is (cosφ·cosλ, cosφ·sinλ, sinφ), the sub-solar point follows directly from the direction.
 */
export function subSolarPoint(sunItrf: Vec3): { latRad: Radians; lonRad: Radians } {
  const s = normalize(sunItrf);
  return {
    latRad: radians(Math.atan2(s[2], Math.hypot(s[0], s[1]))),
    lonRad: radians(Math.atan2(s[1], s[0])),
  };
}

/** Geodetic "up" unit vector (ellipsoid normal) in ITRF at longitude/latitude. */
export function geodeticUp(latRad: number, lonRad: number): Vec3 {
  const c = Math.cos(latRad);
  return [c * Math.cos(lonRad), c * Math.sin(lonRad), Math.sin(latRad)];
}

/**
 * Geometric elevation of the Sun's centre above the local horizon plane at `site`, radians.
 * Uses the actual site-to-Sun vector (parallax included) and the ellipsoid normal as "up".
 * Atmospheric refraction is not included here; see `solarConditionFromElevation`.
 */
export function solarElevation(site: Geodetic, sunItrf: Vec3): Radians {
  const siteEcef = geodeticToEcef(site);
  const toSun = directionTo(siteEcef, sunItrf).unit;
  const up = geodeticUp(site.latRad, site.lonRad);
  return radians(Math.asin(Math.max(-1, Math.min(1, dot(toSun, up)))));
}

/** Elevation of the Sun's centre at conventional sunrise/sunset: −50′ (refraction 34′ + semi-diameter 16′). USNO convention. */
export const SUNRISE_ELEVATION_RAD = (-50 / 60) * (Math.PI / 180);

export type SolarCondition =
  'DAY' | 'CIVIL_TWILIGHT' | 'NAUTICAL_TWILIGHT' | 'ASTRONOMICAL_TWILIGHT' | 'NIGHT';

const DEG = Math.PI / 180;

/**
 * Classify a site by the geometric elevation of the Sun's centre using the standard twilight
 * thresholds (sunrise −50′; civil −6°; nautical −12°; astronomical −18°). This is a _convention_
 * applied to a geometric quantity, not a photometric model of sky brightness.
 */
export function solarConditionFromElevation(elevationRad: number): SolarCondition {
  if (elevationRad >= SUNRISE_ELEVATION_RAD) return 'DAY';
  if (elevationRad >= -6 * DEG) return 'CIVIL_TWILIGHT';
  if (elevationRad >= -12 * DEG) return 'NAUTICAL_TWILIGHT';
  if (elevationRad >= -18 * DEG) return 'ASTRONOMICAL_TWILIGHT';
  return 'NIGHT';
}

/** Convenience: geodetic coordinates of an ITRF point. */
export const geodeticOf = (itrf: Vec3): Geodetic => ecefToGeodetic(itrf[0], itrf[1], itrf[2]);
