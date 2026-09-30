import { seconds, type Seconds } from '../units';

const MICROS_PER_SECOND = 1_000_000;
const MICROS_PER_DAY = 86_400 * MICROS_PER_SECOND;

const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$/;

/**
 * An instant in UTC, stored as an integer number of microseconds since 1970-01-01T00:00:00Z on the
 * POSIX time scale (every day is exactly 86 400 s; leap seconds are not representable as distinct
 * instants — see docs/time.md).
 *
 * `Instant` is the ONLY notion of time that crosses subsystem boundaries. Subsystems receive an
 * `Instant` from the master clock and derive any other time scale (TAI, TT, UT1) from it via
 * `./scales`. Never pass a `Date`, an epoch-ms number or a Julian date between subsystems.
 *
 * Range: integer microseconds are exact in a double up to ±2^53 µs ≈ ±285 years around 1970,
 * i.e. until the year 2255. The engine's supported range (1972–2100) is well inside that.
 */
export class Instant {
  private constructor(readonly unixMicros: number) {}

  static fromUnixMicros(micros: number): Instant {
    if (!Number.isSafeInteger(micros)) {
      throw new RangeError(`Instant: microsecond count must be a safe integer, got ${micros}`);
    }
    return new Instant(micros);
  }

  static fromUnixMillis(ms: number): Instant {
    return Instant.fromUnixMicros(Math.round(ms * 1000));
  }

  static fromDate(d: Date): Instant {
    const ms = d.getTime();
    if (Number.isNaN(ms)) throw new RangeError('Instant: invalid Date');
    return Instant.fromUnixMillis(ms);
  }

  /** Parse a strict ISO-8601 UTC timestamp (`YYYY-MM-DDTHH:mm:ss[.ffffff]Z`). */
  static parse(iso: string): Instant {
    const m = ISO_UTC.exec(iso);
    if (!m) throw new RangeError(`Instant: not an ISO-8601 UTC timestamp ending in Z: "${iso}"`);
    const [, y, mo, d, h, mi, s, frac] = m;
    if (s === '60') {
      throw new RangeError('Instant: leap-second timestamps (:60) are not representable');
    }
    const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
    // Date.UTC silently rolls over invalid calendar fields; reject them.
    const check = new Date(ms);
    if (
      check.getUTCFullYear() !== Number(y) ||
      check.getUTCMonth() !== Number(mo) - 1 ||
      check.getUTCDate() !== Number(d)
    ) {
      throw new RangeError(`Instant: invalid calendar date in "${iso}"`);
    }
    const fracMicros = frac ? Number(frac.padEnd(6, '0')) : 0;
    return Instant.fromUnixMicros(ms * 1000 + fracMicros);
  }

  /** The host's wall-clock UTC. Only the master clock and providers (for retrieval stamps) call this. */
  static wallNow(): Instant {
    return Instant.fromUnixMillis(Date.now());
  }

  /** ISO-8601 UTC. Millisecond precision when exact, else microsecond precision. */
  toIso(): string {
    const days = Math.floor(this.unixMicros / MICROS_PER_DAY);
    const remMicros = this.unixMicros - days * MICROS_PER_DAY;
    const wholeMs = days * 86_400_000 + Math.floor(remMicros / 1000);
    const iso = new Date(wholeMs).toISOString(); // YYYY-MM-DDTHH:mm:ss.mmmZ
    const subMs = remMicros % 1000;
    return subMs === 0 ? iso : `${iso.slice(0, -1)}${String(subMs).padStart(3, '0')}Z`;
  }

  toDate(): Date {
    return new Date(Math.round(this.unixMicros / 1000));
  }

  /** POSIX seconds since 1970-01-01T00:00:00Z (fractional). */
  get unixSeconds(): number {
    return this.unixMicros / MICROS_PER_SECOND;
  }

  plusSeconds(s: Seconds | number): Instant {
    return Instant.fromUnixMicros(this.unixMicros + Math.round(s * MICROS_PER_SECOND));
  }

  /** `this − other`, in seconds (POSIX seconds; ignores leap seconds between the two). */
  secondsSince(other: Instant): Seconds {
    return seconds((this.unixMicros - other.unixMicros) / MICROS_PER_SECOND);
  }

  compare(other: Instant): -1 | 0 | 1 {
    return this.unixMicros < other.unixMicros ? -1 : this.unixMicros > other.unixMicros ? 1 : 0;
  }

  equals(other: Instant): boolean {
    return this.unixMicros === other.unixMicros;
  }

  toString(): string {
    return this.toIso();
  }
}

export const clampInstant = (t: Instant, min: Instant, max: Instant): Instant =>
  t.compare(min) < 0 ? min : t.compare(max) > 0 ? max : t;
