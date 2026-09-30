import { z } from 'zod';

/**
 * The four epistemic classes of information in Simulation.
 *
 * Every state that leaves the environment engine carries exactly one of these. They must never be
 * conflated: a propagated position is NOT an observation, a modelled density is NOT a measurement.
 *
 * - OBSERVED:   a value measured by an instrument or reported by a data provider, at a real time.
 * - PROPAGATED: an observed/derived initial condition advanced in time by a published theory
 *               (e.g. SGP4 applied to a CelesTrak OMM). Accuracy degrades with distance from epoch.
 * - MODELLED:   evaluated from a mathematical model of the environment (gravity field, atmosphere
 *               model, ephemeris theory, Earth-orientation model, geometric shadow model).
 * - SIMULATED:  produced by Simulation's own dynamics integrator for a simulated entity.
 *               (Reserved: nothing in Phase 1 produces this.)
 */
export const StateKindSchema = z.enum(['OBSERVED', 'PROPAGATED', 'MODELLED', 'SIMULATED']);
export type StateKind = z.infer<typeof StateKindSchema>;

/** Reference frames recognised by Simulation. See docs/reference-frames.md. */
export const FrameIdSchema = z.enum([
  /** Geocentric Celestial Reference Frame (treated as ICRF axes, Earth-centred). Inertial. */
  'GCRF',
  /** True Equator Mean Equinox of date. The native frame of SGP4/OMM/TLE output. Quasi-inertial. */
  'TEME',
  /** Earth-fixed frame (ITRF realisation via IERS Earth Orientation Parameters). a.k.a. ECEF. */
  'ITRF',
]);
export type FrameId = z.infer<typeof FrameIdSchema>;

/** Time scales recognised by Simulation. */
export const TimeScaleSchema = z.enum(['UTC', 'UT1', 'TAI', 'TT']);
export type TimeScale = z.infer<typeof TimeScaleSchema>;

/** ISO-8601 UTC timestamp with a trailing `Z`, e.g. `2026-09-30T12:00:00.000Z`. */
export const IsoUtcSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/, {
  message: 'Expected an ISO-8601 UTC timestamp ending in Z',
});
export type IsoUtc = z.infer<typeof IsoUtcSchema>;
