/**
 * Units policy (see docs/units-policy.md)
 * ---------------------------------------
 *
 * 1. The scientific core computes in SI base units: metres, seconds, kilograms, radians, kelvin,
 *    pascals. Angles are radians. There are no exceptions inside `@simulation/physics`.
 * 2. Other units (km, degrees, arcseconds, hours, AU) exist only at boundaries — parsing external
 *    data, and serialising for humans/the wire — and every conversion goes through this module.
 * 3. Public function signatures use the branded types below (or unit-suffixed names such as
 *    `heightM`, `speedMps`) so a unit mismatch is a compile error or, at worst, a review-visible
 *    naming error. A bare `number` in a public physics signature is a defect unless it is
 *    dimensionless (and then it should be named so).
 * 4. Constants carry their unit in the name and cite their source.
 *
 * Branding is erased at runtime. It is a compile-time guard, not a runtime one: arithmetic on a
 * branded value yields a plain `number`, so re-brand the result explicitly with the constructors.
 */

declare const unitTag: unique symbol;
export type Branded<U extends string> = number & { readonly [unitTag]: U };

export type Meters = Branded<'m'>;
export type Kilometers = Branded<'km'>;
export type Seconds = Branded<'s'>;
export type Radians = Branded<'rad'>;
export type Degrees = Branded<'deg'>;
export type Arcseconds = Branded<'arcsec'>;
export type MetersPerSecond = Branded<'m/s'>;
export type MetersPerSecond2 = Branded<'m/s2'>;
export type Kelvin = Branded<'K'>;
export type Pascals = Branded<'Pa'>;
export type KgPerM3 = Branded<'kg/m3'>;

export const meters = (v: number): Meters => v as Meters;
export const kilometers = (v: number): Kilometers => v as Kilometers;
export const seconds = (v: number): Seconds => v as Seconds;
export const radians = (v: number): Radians => v as Radians;
export const degrees = (v: number): Degrees => v as Degrees;
export const arcseconds = (v: number): Arcseconds => v as Arcseconds;
export const metersPerSecond = (v: number): MetersPerSecond => v as MetersPerSecond;
export const metersPerSecond2 = (v: number): MetersPerSecond2 => v as MetersPerSecond2;
export const kelvin = (v: number): Kelvin => v as Kelvin;
export const pascals = (v: number): Pascals => v as Pascals;
export const kgPerM3 = (v: number): KgPerM3 => v as KgPerM3;

// ---- Exact conversion factors -------------------------------------------------------------

export const SECONDS_PER_DAY = 86_400;
export const SECONDS_PER_JULIAN_CENTURY = 36_525 * SECONDS_PER_DAY;
export const METERS_PER_KILOMETER = 1_000;
/** IAU 2012 Resolution B2: 1 au = 149 597 870 700 m (exact). */
export const METERS_PER_AU = 149_597_870_700;
export const DEG_PER_RAD = 180 / Math.PI;
export const RAD_PER_DEG = Math.PI / 180;
export const RAD_PER_ARCSEC = Math.PI / (180 * 3600);
export const TWO_PI = 2 * Math.PI;

// ---- Conversions --------------------------------------------------------------------------

export const degToRad = (d: Degrees | number): Radians => (d * RAD_PER_DEG) as Radians;
export const radToDeg = (r: Radians | number): Degrees => (r * DEG_PER_RAD) as Degrees;
export const arcsecToRad = (a: Arcseconds | number): Radians => (a * RAD_PER_ARCSEC) as Radians;
export const kmToM = (km: Kilometers | number): Meters => (km * METERS_PER_KILOMETER) as Meters;
export const mToKm = (m: Meters | number): Kilometers => (m / METERS_PER_KILOMETER) as Kilometers;
export const auToM = (au: number): Meters => (au * METERS_PER_AU) as Meters;

/** Wrap an angle to [0, 2π). */
export const wrapTwoPi = (r: number): Radians => {
  const w = r % TWO_PI;
  return (w < 0 ? w + TWO_PI : w) as Radians;
};

/** Wrap an angle to (−π, π]. */
export const wrapPi = (r: number): Radians => {
  let w = wrapTwoPi(r) as number;
  if (w > Math.PI) w -= TWO_PI;
  return w as Radians;
};
