import { z } from 'zod';
import { IsoUtcSchema } from './state';

/**
 * Serialisable state of the master simulation clock.
 *
 * The clock is a pure function of this snapshot and a wall-clock reading:
 *
 *   paused  → simTime(w) = anchorSimUtc
 *   running → simTime(w) = anchorSimUtc + rate · (w − anchorWallMs) / 1000
 *
 * Clients extrapolate from the snapshot for display only; the server remains authoritative and
 * publishes a new snapshot (with a higher `revision`) on every state change.
 *
 * `pace: 'manual'` clocks ignore wall time entirely and advance only through explicit steps. They
 * are used for deterministic, reproducible runs.
 */
export const ClockSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  pace: z.enum(['wall', 'manual']),
  paused: z.boolean(),
  /** Simulation seconds elapsed per wall-clock second while running. Always > 0. */
  rate: z.number().positive(),
  /** Simulation time at the anchor. */
  anchorSimUtc: IsoUtcSchema,
  /** Server wall time (ms since Unix epoch) at the anchor. Meaningless for `manual` pace. */
  anchorWallMs: z.number(),
  /** Server wall time (ms since Unix epoch) when this snapshot was serialised. */
  serverWallMs: z.number(),
  /** Inclusive limits of simulation time the engine supports (see docs/supported-time-range.md). */
  supportedRange: z.object({ startUtc: IsoUtcSchema, endUtc: IsoUtcSchema }),
});
export type ClockSnapshot = z.infer<typeof ClockSnapshotSchema>;

export const ClockCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('pause') }),
  z.object({ command: z.literal('resume') }),
  z.object({ command: z.literal('setRate'), rate: z.number().positive().max(1e7) }),
  z.object({ command: z.literal('seek'), timeUtc: IsoUtcSchema }),
  /** Seek to the server's current wall-clock UTC and run at 1x. */
  z.object({ command: z.literal('syncToWall') }),
  /** Advance a `manual` clock by exactly `seconds` simulation seconds. */
  z.object({ command: z.literal('step'), seconds: z.number().positive() }),
  z.object({ command: z.literal('setPace'), pace: z.enum(['wall', 'manual']) }),
]);
export type ClockCommand = z.infer<typeof ClockCommandSchema>;
