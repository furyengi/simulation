import type { ClockCommand, ClockSnapshot } from '@simulation/schemas';
import { clampInstant, Instant } from './instant';

/** Inclusive range of simulation time supported by the engine. See docs/time.md. */
export const SUPPORTED_RANGE = {
  start: Instant.parse('1972-01-01T00:00:00Z'),
  end: Instant.parse('2100-01-01T00:00:00Z'),
} as const;

/**
 * Evaluate the clock at a given wall-clock reading. This is the SINGLE definition of how
 * simulation time relates to wall time; the server clock, the web client's display extrapolation
 * and the tests all call it.
 *
 * Pure: depends only on its arguments.
 */
export function evaluateClock(
  snapshot: Pick<ClockSnapshot, 'pace' | 'paused' | 'rate' | 'anchorSimUtc' | 'anchorWallMs'>,
  wallMs: number,
): Instant {
  const anchor = Instant.parse(snapshot.anchorSimUtc);
  if (snapshot.paused || snapshot.pace === 'manual') return anchor;
  const elapsedWallS = (wallMs - snapshot.anchorWallMs) / 1000;
  return anchor.plusSeconds(elapsedWallS * snapshot.rate);
}

/** Source of wall time in ms since the Unix epoch. Injected so tests never depend on real time. */
export type WallSource = () => number;

export interface ClockOptions {
  start: Instant;
  rate?: number;
  paused?: boolean;
  pace?: 'wall' | 'manual';
  wall?: WallSource;
}

/**
 * The master simulation clock. Exactly one exists per engine; every environment subsystem takes
 * its time from `clock.now()` (or from an `Instant` the engine hands it) — never from `Date.now()`.
 *
 * Capabilities: UTC time, pause/resume, 1x real time, accelerated time, deterministic stepping
 * (`pace: 'manual'` + `step`), seeking to any supported time, and serialisable snapshots.
 *
 * Determinism: with `pace: 'manual'` the clock never reads wall time; `now()` after a sequence of
 * commands is a pure function of the commands. With `pace: 'wall'`, `now()` is a pure function of
 * the commands and the wall readings.
 */
export class SimulationClock {
  private anchorSim: Instant;
  private anchorWallMs: number;
  private rate: number;
  private paused: boolean;
  private pace: 'wall' | 'manual';
  private revision = 0;
  private readonly wall: WallSource;

  constructor(opts: ClockOptions) {
    this.wall = opts.wall ?? (() => Date.now());
    this.anchorSim = SimulationClock.assertSupported(opts.start);
    this.rate = opts.rate ?? 1;
    if (!(this.rate > 0) || !Number.isFinite(this.rate)) {
      throw new RangeError('SimulationClock: rate must be a positive finite number');
    }
    this.paused = opts.paused ?? false;
    this.pace = opts.pace ?? 'wall';
    this.anchorWallMs = this.wall();
  }

  static assertSupported(t: Instant): Instant {
    if (t.compare(SUPPORTED_RANGE.start) < 0 || t.compare(SUPPORTED_RANGE.end) > 0) {
      throw new RangeError(
        `Simulation time ${t.toIso()} is outside the supported range ` +
          `${SUPPORTED_RANGE.start.toIso()} – ${SUPPORTED_RANGE.end.toIso()}`,
      );
    }
    return t;
  }

  /** Current simulation time, clamped to the supported range. */
  now(): Instant {
    return clampInstant(
      evaluateClock(this.rawSnapshot(), this.wall()),
      SUPPORTED_RANGE.start,
      SUPPORTED_RANGE.end,
    );
  }

  /** True when running and pinned at the end of the supported range (the caller should pause). */
  atLimit(): boolean {
    return !this.paused && this.now().equals(SUPPORTED_RANGE.end);
  }

  snapshot(): ClockSnapshot {
    return { ...this.rawSnapshot(), serverWallMs: this.wall() };
  }

  private rawSnapshot(): Omit<ClockSnapshot, 'serverWallMs'> {
    return {
      revision: this.revision,
      pace: this.pace,
      paused: this.paused,
      rate: this.rate,
      anchorSimUtc: this.anchorSim.toIso(),
      anchorWallMs: this.anchorWallMs,
      supportedRange: {
        startUtc: SUPPORTED_RANGE.start.toIso(),
        endUtc: SUPPORTED_RANGE.end.toIso(),
      },
    };
  }

  /** Re-anchor at the current instant so a rate/pause change never causes a jump. */
  private reanchor(): void {
    this.anchorSim = this.now();
    this.anchorWallMs = this.wall();
  }

  pause(): void {
    if (this.paused) return;
    this.reanchor();
    this.paused = true;
    this.revision++;
  }

  resume(): void {
    if (!this.paused) return;
    this.anchorWallMs = this.wall();
    this.paused = false;
    this.revision++;
  }

  setRate(rate: number): void {
    if (!(rate > 0) || !Number.isFinite(rate)) {
      throw new RangeError('SimulationClock: rate must be a positive finite number');
    }
    this.reanchor();
    this.rate = rate;
    this.revision++;
  }

  /** Jump to a specific time. Leaves the paused/rate state unchanged. */
  seek(t: Instant): void {
    this.anchorSim = SimulationClock.assertSupported(t);
    this.anchorWallMs = this.wall();
    this.revision++;
  }

  /** Jump to the host's wall-clock UTC and run at 1x. */
  syncToWall(): void {
    this.anchorSim = SimulationClock.assertSupported(Instant.fromUnixMillis(this.wall()));
    this.anchorWallMs = this.wall();
    this.rate = 1;
    this.paused = false;
    this.pace = 'wall';
    this.revision++;
  }

  /** Advance a `manual`-pace clock by exactly `seconds` simulation seconds. */
  step(seconds: number): void {
    if (this.pace !== 'manual') {
      throw new Error('SimulationClock.step requires pace "manual" (deterministic stepping mode)');
    }
    if (!(seconds > 0) || !Number.isFinite(seconds)) {
      throw new RangeError('SimulationClock.step: seconds must be positive and finite');
    }
    this.anchorSim = SimulationClock.assertSupported(this.anchorSim.plusSeconds(seconds));
    this.revision++;
  }

  setPace(pace: 'wall' | 'manual'): void {
    if (pace === this.pace) return;
    this.reanchor();
    this.pace = pace;
    this.anchorWallMs = this.wall();
    this.revision++;
  }

  apply(cmd: ClockCommand): void {
    switch (cmd.command) {
      case 'pause':
        return this.pause();
      case 'resume':
        return this.resume();
      case 'setRate':
        return this.setRate(cmd.rate);
      case 'seek':
        return this.seek(Instant.parse(cmd.timeUtc));
      case 'syncToWall':
        return this.syncToWall();
      case 'step':
        return this.step(cmd.seconds);
      case 'setPace':
        return this.setPace(cmd.pace);
    }
  }
}

/**
 * A reproducible run: a start time and a fixed step. `at(n)` returns start + n·dt computed from
 * `n` directly (not by accumulation), so sample times are bit-identical across machines and runs.
 */
export class DeterministicRun {
  constructor(
    readonly start: Instant,
    readonly stepSeconds: number,
  ) {
    SimulationClock.assertSupported(start);
    if (!(stepSeconds > 0) || !Number.isFinite(stepSeconds)) {
      throw new RangeError('DeterministicRun: stepSeconds must be positive and finite');
    }
  }

  at(stepIndex: number): Instant {
    if (!Number.isInteger(stepIndex) || stepIndex < 0) {
      throw new RangeError('DeterministicRun.at: stepIndex must be a non-negative integer');
    }
    return SimulationClock.assertSupported(this.start.plusSeconds(stepIndex * this.stepSeconds));
  }

  *times(count: number): Generator<Instant> {
    for (let i = 0; i < count; i++) yield this.at(i);
  }
}
