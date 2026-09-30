import type { EphemerisWindow } from '@simulation/schemas';
import { api } from './api';
import type { ClientClock } from './clock';
import {
  coversWindow,
  samplePosition,
  sampleQuaternion,
  type Window3,
  type WindowQuat,
} from './interp';

/**
 * Keeps server-computed sample windows ahead of the playback position.
 *
 * The viewer never computes physical state: it asks the server for windows (Earth orientation,
 * Sun/Moon, orbital objects) that cover the near future of simulation time, and interpolates
 * between the samples for smooth frames. The window length scales with the simulation rate so that
 * accelerated time requests proportionally more simulation time per request.
 */

export interface BodiesWin extends WindowQuat {
  readonly sun: Float64Array; // ITRF m, flat
  readonly moon: Float64Array;
}

interface ObjWin extends Window3 {
  readonly id: string;
  readonly failures: Set<number>;
}

const MIN_HORIZON_S = 600;
const MAX_HORIZON_S = 86_400;
/** Request a new window when less than this fraction of the current one remains. */
const REFRESH_FRACTION = 0.3;

const horizonFor = (rate: number): number =>
  Math.min(MAX_HORIZON_S, Math.max(MIN_HORIZON_S, rate * 25));

export class TrackManager {
  private bodies: BodiesWin | undefined;
  private bodiesPending = false;
  private objects = new Map<string, ObjWin>();
  private objectsPending = false;
  private objectIds: string[] = [];
  private lastRate = 1;
  /** Bumped on seek/rate/id changes so late responses for stale requests are dropped. */
  private epoch = 0;
  error: string | undefined;
  /** Interpolation tolerance requested for object windows (m). */
  readonly toleranceM = 25;

  setObjectIds(ids: string[]): void {
    if (ids.length === this.objectIds.length && ids.every((v, i) => v === this.objectIds[i]))
      return;
    this.objectIds = ids;
    this.objects.clear();
    this.epoch++;
  }

  /** Forget everything (seek, rate change). */
  invalidate(): void {
    this.bodies = undefined;
    this.objects.clear();
    this.epoch++;
  }

  /** Call every frame (cheap); triggers fetches as needed. */
  tick(clock: ClientClock): void {
    if (!clock.ready) return;
    const t = clock.nowMs();
    const rate = clock.running ? clock.rate : 1;
    if (rate !== this.lastRate) {
      this.lastRate = rate;
      this.invalidate();
    }
    const horizonMs = horizonFor(rate) * 1000;

    if (!this.bodiesPending && this.needs(this.bodies, t, horizonMs))
      void this.fetchBodies(t, horizonMs);
    if (this.objectIds.length && !this.objectsPending && this.needsObjects(t, horizonMs)) {
      void this.fetchObjects(t, horizonMs);
    }
  }

  private needs(w: WindowQuat | undefined, t: number, horizonMs: number): boolean {
    if (!w) return true;
    const end = w.startMs + (w.count - 1) * w.stepMs;
    if (t < w.startMs || t > end) return true;
    return end - t < horizonMs * REFRESH_FRACTION;
  }

  private needsObjects(t: number, horizonMs: number): boolean {
    for (const id of this.objectIds) {
      const w = this.objects.get(id);
      if (!w) return true;
      const end = w.startMs + (w.count - 1) * w.stepMs;
      if (t < w.startMs || t > end || end - t < horizonMs * REFRESH_FRACTION) return true;
    }
    return false;
  }

  private async fetchBodies(t: number, horizonMs: number): Promise<void> {
    this.bodiesPending = true;
    const epoch = this.epoch;
    try {
      const step = Math.max(30, Math.ceil(horizonMs / 1000 / 300));
      const count = Math.ceil(horizonMs / 1000 / step) + 2;
      const start = t - 2 * step * 1000;
      const r = await api.bodiesWindow(new Date(start).toISOString(), count, step);
      if (epoch !== this.epoch) return;
      if (r.status !== 'ok') {
        this.error = `bodies window: ${r.reason}`;
        return;
      }
      const v = r.value;
      this.bodies = {
        startMs: Date.parse(v.startUtc),
        stepMs: v.stepSeconds * 1000,
        count: v.count,
        q: Float64Array.from(v.earthQuaternionsItrfFromGcrf),
        sun: Float64Array.from(v.sunItrfM),
        moon: Float64Array.from(v.moonItrfM),
      };
      this.error = undefined;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.bodiesPending = false;
    }
  }

  private async fetchObjects(t: number, horizonMs: number): Promise<void> {
    this.objectsPending = true;
    const epoch = this.epoch;
    try {
      const ids = this.objectIds.slice(0, 2000);
      const startMs = Math.floor(t - 30_000);
      const r = await api.ephemeris({
        ids,
        start: new Date(startMs).toISOString(),
        durationSeconds: horizonMs / 1000 + 30,
        frame: 'GCRF',
        toleranceMeters: this.toleranceM,
      });
      if (epoch !== this.epoch) return;
      if (r.status !== 'ok') {
        this.error = `ephemeris: ${r.reason}`;
        return;
      }
      for (const w of r.value.windows) this.objects.set(w.id, toWin(w));
      this.error = undefined;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.objectsPending = false;
    }
  }

  // ---- sampling ---------------------------------------------------------------------------

  /** True when a bodies window covers time `t`. */
  hasBodies(t: number): boolean {
    return !!this.bodies && coversWindow(this.bodies, t);
  }

  earthQuaternion(t: number, out?: number[]): number[] | undefined {
    return this.bodies ? sampleQuaternion(this.bodies, t, out) : undefined;
  }

  /** Geocentric ITRF position of the Sun (m), interpolated linearly between server samples. */
  sunItrf(t: number, out: number[] = [0, 0, 0]): number[] | undefined {
    return this.bodies
      ? (samplePosition({ ...this.bodies, pos: this.bodies.sun }, t, out) as number[] | undefined)
      : undefined;
  }

  moonItrf(t: number, out: number[] = [0, 0, 0]): number[] | undefined {
    return this.bodies
      ? (samplePosition({ ...this.bodies, pos: this.bodies.moon }, t, out) as number[] | undefined)
      : undefined;
  }

  /** GCRF position of an object at `t`, or undefined if no window covers it or SGP4 failed there. */
  objectGcrf(id: string, t: number, out: number[] = [0, 0, 0]): number[] | undefined {
    const w = this.objects.get(id);
    if (!w || !coversWindow(w, t)) return undefined;
    const i = Math.floor((t - w.startMs) / w.stepMs);
    if (w.failures.has(i) || w.failures.has(i + 1)) return undefined;
    return samplePosition(w, t, out) as number[] | undefined;
  }

  windowFor(id: string): ObjWin | undefined {
    return this.objects.get(id);
  }
}

function toWin(w: EphemerisWindow): ObjWin {
  return {
    id: w.id,
    startMs: Date.parse(w.startUtc),
    stepMs: w.stepSeconds * 1000,
    count: w.count,
    pos: Float64Array.from(w.positionsM),
    vel: Float64Array.from(w.velocitiesMps),
    failures: new Set(w.failures.map((f) => f.index)),
  };
}
