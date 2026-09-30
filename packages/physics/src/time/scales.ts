import { seconds, type Seconds } from '../units';
import { Instant } from './instant';

/**
 * Time scales (see docs/time.md).
 *
 *   UTC  civil time; the scale of `Instant`. Steps by leap seconds.
 *   TAI  continuous atomic time.  TAI = UTC + ΔAT (leap-second count, integer seconds since 1972).
 *   TT   Terrestrial Time.        TT  = TAI + 32.184 s (exact, by IAU definition).
 *   UT1  Earth-rotation time.     UT1 = UTC + (UT1−UTC), the latter measured by the IERS (see EOP).
 *
 * TDB differs from TT by < 2 ms (periodic); it is not distinguished in Phase 1 because every
 * consumer of TT here (precession/nutation, ephemerides) is insensitive to 2 ms.
 */

/** TT − TAI, exactly 32.184 s (IAU 1991 Resolution A4). */
export const TT_MINUS_TAI_S = 32.184;

/**
 * TAI − UTC, integer seconds, effective at 00:00:00 UTC on the given date.
 * Source: IERS Bulletin C / IANA `leap-seconds.list` (a copy is committed at
 * `packages/physics/data/leap-seconds.list`; a test asserts this table equals it).
 */
const LEAP_TABLE: ReadonlyArray<readonly [year: number, month: number, day: number, dat: number]> =
  [
    [1972, 1, 1, 10],
    [1972, 7, 1, 11],
    [1973, 1, 1, 12],
    [1974, 1, 1, 13],
    [1975, 1, 1, 14],
    [1976, 1, 1, 15],
    [1977, 1, 1, 16],
    [1978, 1, 1, 17],
    [1979, 1, 1, 18],
    [1980, 1, 1, 19],
    [1981, 7, 1, 20],
    [1982, 7, 1, 21],
    [1983, 7, 1, 22],
    [1985, 7, 1, 23],
    [1988, 1, 1, 24],
    [1990, 1, 1, 25],
    [1991, 1, 1, 26],
    [1992, 7, 1, 27],
    [1993, 7, 1, 28],
    [1994, 7, 1, 29],
    [1996, 1, 1, 30],
    [1997, 7, 1, 31],
    [1999, 1, 1, 32],
    [2006, 1, 1, 33],
    [2009, 1, 1, 34],
    [2012, 7, 1, 35],
    [2015, 7, 1, 36],
    [2017, 1, 1, 37],
  ];

const LEAP_STEPS = LEAP_TABLE.map(([y, m, d, dat]) => ({
  effectiveUnixMicros: Date.UTC(y, m - 1, d) * 1000,
  dat,
}));

/** First and last instants for which TAI−UTC is defined by the table. */
export const LEAP_TABLE_START = Instant.fromUnixMicros(LEAP_STEPS[0]!.effectiveUnixMicros);

/**
 * The leap-second list is published with an expiry (currently 2027-06-28). Beyond the last entry we
 * assume no further leap seconds — the standing state of the world since 2017 and IERS/CGPM policy
 * to stop introducing them by 2035. If a leap second is announced this table must be updated.
 */
export const LEAP_TABLE_LAST_ENTRY = LEAP_TABLE[LEAP_TABLE.length - 1]!;

/** TAI − UTC in seconds at `t`. Throws before 1972-01-01 (rubber-second era is unsupported). */
export function taiMinusUtc(t: Instant): Seconds {
  const micros = t.unixMicros;
  if (micros < LEAP_STEPS[0]!.effectiveUnixMicros) {
    throw new RangeError(`taiMinusUtc: ${t.toIso()} is before 1972-01-01 (unsupported)`);
  }
  let dat = LEAP_STEPS[0]!.dat;
  for (const step of LEAP_STEPS) {
    if (micros >= step.effectiveUnixMicros) dat = step.dat;
    else break;
  }
  return seconds(dat);
}

/**
 * A two-part Julian Date. `hi + lo` is the JD; `hi` is a multiple of 0.5 and `lo ∈ [0, 0.5)` … in
 * practice `hi` is the JD at the preceding 00:00 and `lo` the day fraction, which keeps double
 * precision at the ~10 ns level. Always tagged with its time scale.
 */
export interface JulianDate {
  readonly scale: 'UTC' | 'TAI' | 'TT' | 'UT1';
  readonly hi: number;
  readonly lo: number;
}

/** JD of the Unix epoch 1970-01-01T00:00:00 (UTC-like scales). */
const JD_UNIX_EPOCH = 2_440_587.5;
/** JD of the J2000.0 epoch, 2000-01-01T12:00:00 TT. */
export const JD_J2000 = 2_451_545.0;
export const DAYS_PER_JULIAN_CENTURY = 36_525;

const MICROS_PER_DAY = 86_400_000_000;

function toJulianDate(scale: JulianDate['scale'], posixMicrosInScale: number): JulianDate {
  const days = Math.floor(posixMicrosInScale / MICROS_PER_DAY);
  const remMicros = posixMicrosInScale - days * MICROS_PER_DAY;
  return { scale, hi: JD_UNIX_EPOCH + days, lo: remMicros / MICROS_PER_DAY };
}

export const julianDateUtc = (t: Instant): JulianDate => toJulianDate('UTC', t.unixMicros);

export const julianDateTai = (t: Instant): JulianDate =>
  toJulianDate('TAI', t.unixMicros + taiMinusUtc(t) * 1e6);

export const julianDateTt = (t: Instant): JulianDate =>
  toJulianDate('TT', t.unixMicros + Math.round((taiMinusUtc(t) + TT_MINUS_TAI_S) * 1e6));

/** UT1 = UTC + dut1. `dut1S` comes from Earth Orientation Parameters (see frames/eop). */
export const julianDateUt1 = (t: Instant, dut1S: Seconds | number): JulianDate =>
  toJulianDate('UT1', t.unixMicros + Math.round(dut1S * 1e6));

/** Julian centuries (36 525 d) of TT since J2000.0. Argument of the IAU precession/GMST polynomials. */
export function julianCenturiesTt(t: Instant): number {
  const jd = julianDateTt(t);
  return (jd.hi - JD_J2000 + jd.lo) / DAYS_PER_JULIAN_CENTURY;
}

/** Days since J2000.0 (fractional) on the JD's own scale. */
export const daysSinceJ2000 = (jd: JulianDate): number => jd.hi - JD_J2000 + jd.lo;
