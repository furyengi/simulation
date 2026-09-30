import { z } from 'zod';

/**
 * Unit symbols permitted on the wire and in provenance. Deliberately a closed list: a number
 * without one of these units is not allowed to cross a package boundary.
 *
 * Internal scientific code uses SI base units (m, s, kg, rad, K, Pa) — see docs/units-policy.md.
 */
export const UnitSchema = z.enum([
  'm',
  'km',
  'm/s',
  'km/s',
  'm/s2',
  's',
  'day',
  'rad',
  'deg',
  'arcsec',
  'K',
  'Pa',
  'kg/m3',
  '1/m3',
  'sfu', // solar flux unit, 1e-22 W m-2 Hz-1 (F10.7)
  'nT',
  '1', // dimensionless
]);
export type Unit = z.infer<typeof UnitSchema>;

/** A number with an explicit unit. */
export const QuantitySchema = z.object({
  value: z.number(),
  unit: UnitSchema,
});
export type Quantity = z.infer<typeof QuantitySchema>;

export const q = (value: number, unit: Unit): Quantity => ({ value, unit });
