import type { OmmRecord } from '@simulation/schemas';
import { Instant } from '../time/instant';

/**
 * Convert a classic two-line element set into the equivalent OMM record (CelesTrak JSON
 * conventions: angles in degrees, mean motion in rev/day, BSTAR in 1/Earth radii, MEAN_MOTION_DOT
 * and MEAN_MOTION_DDOT exactly as they appear in the TLE fields).
 *
 * The TLE format is fixed-column; see https://celestrak.org/NORAD/documentation/tle-fmt.php.
 * TLE epochs carry ~1e-8 day (≈ 1 ms) resolution; OMM epochs are more precise, so an OMM and a TLE
 * for the same element set can differ by a millisecond of epoch — about 7 m along track.
 */
export function tleToOmm(line1: string, line2: string): OmmRecord {
  if (line1.length < 69 || line2.length < 69) {
    throw new Error('TLE lines must be 69 characters');
  }
  const yy = Number(line1.slice(18, 20));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  const dayOfYear = Number(line1.slice(20, 32));
  const epoch = Instant.parse(`${year}-01-01T00:00:00Z`).plusSeconds((dayOfYear - 1) * 86_400);

  const num = (s: string): number => {
    const v = Number(s);
    if (!Number.isFinite(v)) throw new Error(`Malformed TLE numeric field "${s}"`);
    return v;
  };

  return {
    OBJECT_NAME: 'TLE',
    OBJECT_ID: line1.slice(9, 17).trim(),
    EPOCH: epoch.toIso().replace(/Z$/, ''),
    MEAN_MOTION: num(line2.slice(52, 63)),
    ECCENTRICITY: num(`0.${line2.slice(26, 33).trim()}`),
    INCLINATION: num(line2.slice(8, 16)),
    RA_OF_ASC_NODE: num(line2.slice(17, 25)),
    ARG_OF_PERICENTER: num(line2.slice(34, 42)),
    MEAN_ANOMALY: num(line2.slice(43, 51)),
    EPHEMERIS_TYPE: Number(line1.slice(62, 63)) || 0,
    CLASSIFICATION_TYPE: line1.slice(7, 8),
    NORAD_CAT_ID: num(line1.slice(2, 7)),
    ELEMENT_SET_NO: num(line1.slice(64, 68)),
    REV_AT_EPOCH: num(line2.slice(63, 68)),
    BSTAR: implicitDecimal(line1.slice(53, 61)),
    MEAN_MOTION_DOT: num(line1.slice(33, 43)),
    MEAN_MOTION_DDOT: implicitDecimal(line1.slice(44, 52)),
  };
}

/** TLE "assumed decimal point" fields, e.g. ` 28098-4` → 0.28098e-4, `-30915-6` → −0.30915e-6. */
export function implicitDecimal(field: string): number {
  const s = field.trim();
  if (s === '' || /^[+-]?0+[+-]0$/.test(s)) return 0;
  const m = /^([+-]?)(\d+)([+-]\d+)$/.exec(s);
  if (!m) throw new Error(`Malformed TLE implicit-decimal field "${field}"`);
  return Number(`${m[1]}0.${m[2]}e${m[3]}`);
}
