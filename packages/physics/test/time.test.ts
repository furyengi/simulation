import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DeterministicRun,
  Instant,
  SimulationClock,
  SUPPORTED_RANGE,
  evaluateClock,
  julianCenturiesTt,
  julianDateTai,
  julianDateTt,
  julianDateUt1,
  julianDateUtc,
  taiMinusUtc,
} from '../src/time';

describe('Instant', () => {
  it('round-trips ISO strings at ms and µs precision', () => {
    for (const iso of [
      '2026-09-30T12:34:56.000Z',
      '2026-09-30T12:34:56.789Z',
      '2026-09-30T12:34:56.789123Z',
      '1972-01-01T00:00:00.000Z',
      '2099-12-31T23:59:59.999999Z',
    ]) {
      expect(Instant.parse(iso).toIso()).toBe(iso);
    }
  });

  it('parses timestamps without fractional seconds', () => {
    expect(Instant.parse('2000-01-01T12:00:00Z').unixMicros).toBe(946_728_000_000_000);
  });

  it('rejects malformed, non-UTC, leap-second and impossible calendar inputs', () => {
    expect(() => Instant.parse('2026-09-30 12:00:00')).toThrow();
    expect(() => Instant.parse('2026-09-30T12:00:00+02:00')).toThrow();
    expect(() => Instant.parse('2016-12-31T23:59:60Z')).toThrow(/leap-second/);
    expect(() => Instant.parse('2026-02-30T00:00:00Z')).toThrow(/invalid calendar/);
  });

  it('adds and subtracts seconds exactly at µs resolution', () => {
    const t = Instant.parse('2026-01-01T00:00:00Z');
    const u = t.plusSeconds(0.000001);
    expect(u.toIso()).toBe('2026-01-01T00:00:00.000001Z');
    expect(u.secondsSince(t)).toBeCloseTo(1e-6, 12);
    expect(t.plusSeconds(86_400 * 365).toIso()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('leap seconds and time scales', () => {
  it('matches the committed IANA/IERS leap-seconds.list exactly', () => {
    const NTP_TO_UNIX = 2_208_988_800;
    const lines = readFileSync(new URL('../data/leap-seconds.list', import.meta.url), 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('#'));
    expect(lines.length).toBe(28);
    for (const line of lines) {
      const [ntp, dat] = line.split(/\s+/);
      const effective = Instant.fromUnixMicros((Number(ntp) - NTP_TO_UNIX) * 1_000_000);
      // From the effective instant on, TAI−UTC must equal the listed value…
      expect(taiMinusUtc(effective)).toBe(Number(dat));
      // …and immediately before it the previous value (one second less after 1972-01-01).
      if (Number(dat) > 10) {
        expect(taiMinusUtc(effective.plusSeconds(-0.000001))).toBe(Number(dat) - 1);
      }
    }
  });

  it('TAI−UTC is 37 s from 2017-01-01 onwards and 10 s at 1972-01-01', () => {
    expect(taiMinusUtc(Instant.parse('2026-09-30T00:00:00Z'))).toBe(37);
    expect(taiMinusUtc(Instant.parse('2016-12-31T23:59:59Z'))).toBe(36);
    expect(taiMinusUtc(Instant.parse('1972-01-01T00:00:00Z'))).toBe(10);
    expect(() => taiMinusUtc(Instant.parse('1971-12-31T23:59:59Z'))).toThrow(/before 1972/);
  });

  it('J2000.0: 2000-01-01T11:58:55.816Z UTC is exactly JD 2451545.0 TT', () => {
    // TT − UTC = 32 s (leap) + 32.184 s = 64.184 s at J2000.0.
    const t = Instant.parse('2000-01-01T11:58:55.816Z');
    const jd = julianDateTt(t);
    expect(jd.scale).toBe('TT');
    expect(jd.hi + jd.lo).toBeCloseTo(2_451_545.0, 9);
    expect(julianCenturiesTt(t)).toBeCloseTo(0, 12);
  });

  it('two-part Julian dates keep sub-microsecond resolution', () => {
    const a = julianDateUtc(Instant.parse('2026-09-30T12:00:00Z'));
    const b = julianDateUtc(Instant.parse('2026-09-30T12:00:00.000001Z'));
    expect((b.lo - a.lo) * 86_400).toBeCloseTo(1e-6, 12);
  });

  it('JD of known UTC epochs', () => {
    const jd = (iso: string) => {
      const j = julianDateUtc(Instant.parse(iso));
      return j.hi + j.lo;
    };
    expect(jd('1970-01-01T00:00:00Z')).toBe(2_440_587.5);
    expect(jd('2000-01-01T12:00:00Z')).toBe(2_451_545.0);
    expect(jd('2026-09-30T18:00:00Z')).toBeCloseTo(2_461_314.25, 9);
  });

  it('TAI, TT and UT1 offsets are applied with the right sign', () => {
    const t = Instant.parse('2026-01-01T00:00:00Z');
    const utc = julianDateUtc(t);
    const offsetS = (jd: { hi: number; lo: number }) =>
      (jd.hi - utc.hi + (jd.lo - utc.lo)) * 86_400;
    expect(offsetS(julianDateTai(t))).toBeCloseTo(37, 6);
    expect(offsetS(julianDateTt(t))).toBeCloseTo(37 + 32.184, 6);
    expect(offsetS(julianDateUt1(t, -0.1))).toBeCloseTo(-0.1, 6);
  });
});

describe('SimulationClock', () => {
  const T0 = Instant.parse('2026-06-01T00:00:00Z');
  const makeClock = (opts: { rate?: number; paused?: boolean; pace?: 'wall' | 'manual' } = {}) => {
    let wall = 1_000_000;
    const clock = new SimulationClock({ start: T0, wall: () => wall, ...opts });
    return {
      clock,
      advanceWall: (ms: number) => {
        wall += ms;
      },
    };
  };

  it('runs at 1x real time', () => {
    const { clock, advanceWall } = makeClock();
    advanceWall(10_000);
    expect(clock.now().toIso()).toBe('2026-06-01T00:00:10.000Z');
  });

  it('accelerates without jumping when the rate changes', () => {
    const { clock, advanceWall } = makeClock();
    advanceWall(5_000);
    clock.setRate(1000);
    expect(clock.now().toIso()).toBe('2026-06-01T00:00:05.000Z');
    advanceWall(2_000);
    expect(clock.now().toIso()).toBe('2026-06-01T00:33:25.000Z'); // 5 s + 2 s · 1000
  });

  it('pauses and resumes exactly', () => {
    const { clock, advanceWall } = makeClock();
    advanceWall(3_000);
    clock.pause();
    advanceWall(60_000);
    expect(clock.now().toIso()).toBe('2026-06-01T00:00:03.000Z');
    clock.resume();
    advanceWall(1_000);
    expect(clock.now().toIso()).toBe('2026-06-01T00:00:04.000Z');
  });

  it('seeks to an arbitrary supported time and keeps running from there', () => {
    const { clock, advanceWall } = makeClock({ rate: 60 });
    clock.seek(Instant.parse('2000-01-01T12:00:00Z'));
    advanceWall(1_000);
    expect(clock.now().toIso()).toBe('2000-01-01T12:01:00.000Z');
  });

  it('rejects seeks outside the supported range', () => {
    const { clock } = makeClock();
    expect(() => clock.seek(Instant.parse('1971-12-31T23:59:59Z'))).toThrow(/supported range/);
    expect(() => clock.seek(Instant.parse('2100-01-01T00:00:01Z'))).toThrow(/supported range/);
  });

  it('clamps at the end of the range and reports atLimit', () => {
    const { clock, advanceWall } = makeClock({ rate: 1e6 });
    clock.seek(Instant.parse('2099-12-31T23:59:00Z'));
    advanceWall(1_000_000);
    expect(clock.now().equals(SUPPORTED_RANGE.end)).toBe(true);
    expect(clock.atLimit()).toBe(true);
  });

  it('manual pace ignores wall time and steps deterministically', () => {
    const { clock, advanceWall } = makeClock({ pace: 'manual' });
    advanceWall(999_999);
    expect(clock.now().equals(T0)).toBe(true);
    clock.step(0.5);
    clock.step(0.5);
    expect(clock.now().toIso()).toBe('2026-06-01T00:00:01.000Z');
    expect(() => makeClock().clock.step(1)).toThrow(/manual/);
  });

  it('increments the snapshot revision on every state change', () => {
    const { clock } = makeClock();
    const r0 = clock.snapshot().revision;
    clock.pause();
    clock.resume();
    clock.setRate(10);
    expect(clock.snapshot().revision).toBe(r0 + 3);
  });

  it('client-side evaluateClock(snapshot, wall) agrees with the server clock', () => {
    const { clock, advanceWall } = makeClock({ rate: 250 });
    advanceWall(4_321);
    const snap = clock.snapshot();
    expect(evaluateClock(snap, snap.serverWallMs).equals(clock.now())).toBe(true);
  });
});

describe('DeterministicRun', () => {
  it('produces bit-identical times independent of accumulation order', () => {
    const run = new DeterministicRun(Instant.parse('2026-01-01T00:00:00Z'), 0.1);
    let accumulated = Instant.parse('2026-01-01T00:00:00Z');
    for (let i = 0; i < 1000; i++) accumulated = accumulated.plusSeconds(0.1);
    expect(run.at(1000).equals(accumulated)).toBe(true);
    expect(run.at(1000).toIso()).toBe('2026-01-01T00:01:40.000Z');
    expect([...run.times(3)].map((t) => t.toIso())).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.100Z',
      '2026-01-01T00:00:00.200Z',
    ]);
  });
});
