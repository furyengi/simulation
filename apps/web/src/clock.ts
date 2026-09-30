import { type Instant, evaluateClock } from '@simulation/physics/time';
import type { ClockSnapshot } from '@simulation/schemas';

/**
 * Client view of the master clock. The SERVER owns time; this class only extrapolates the most
 * recent snapshot using the same pure function (`evaluateClock`) the server uses, with the wall
 * clock corrected by the offset observed when the snapshot arrived.
 */
export class ClientClock {
  private snap: ClockSnapshot | undefined;
  private offsetMs = 0;

  /** Adopt a snapshot if it is at least as new as the current one. */
  update(s: ClockSnapshot): void {
    if (this.snap && s.revision < this.snap.revision) return;
    this.snap = s;
    // Server wall time at serialisation minus our wall time now ≈ clock offset (+ one-way latency).
    this.offsetMs = s.serverWallMs - Date.now();
  }

  get ready(): boolean {
    return this.snap !== undefined;
  }
  get snapshot(): ClockSnapshot {
    if (!this.snap) throw new Error('clock not ready');
    return this.snap;
  }

  now(): Instant {
    return evaluateClock(this.snapshot, Date.now() + this.offsetMs);
  }

  /** Simulation time as unix milliseconds (fractional). */
  nowMs(): number {
    return this.now().unixMicros / 1000;
  }

  get rate(): number {
    return this.snapshot.rate;
  }
  get running(): boolean {
    return !this.snapshot.paused && this.snapshot.pace === 'wall';
  }
}
