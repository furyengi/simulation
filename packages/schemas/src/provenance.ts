import { z } from 'zod';
import { FrameIdSchema, IsoUtcSchema, StateKindSchema } from './state';

/** Where the underlying information originally came from. */
export const SourceSchema = z.object({
  /** Short provider id, e.g. `celestrak`, `noaa-swpc`, `opensky`, `iers`, `astronomy-engine`. */
  provider: z.string(),
  /** Dataset or product within the provider, e.g. `GP/stations`, `SW-Last5Years.csv`. */
  dataset: z.string().optional(),
  url: z.string().optional(),
  license: z.string().optional(),
  /** Attribution text the provider requires us to display. */
  attribution: z.string().optional(),
});
export type Source = z.infer<typeof SourceSchema>;

/** The theory / algorithm / code that turned inputs into the value. */
export const ModelRefSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  /** Citation or documentation URL. */
  reference: z.string().optional(),
});
export type ModelRef = z.infer<typeof ModelRefSchema>;

/**
 * Freshness class of the input data relative to the simulation time it is being used for.
 * Thresholds are provider-specific and stated in the provider's documentation.
 */
export const FreshnessSchema = z.enum([
  'FRESH', // within the provider's nominal validity window
  'AGING', // usable but degrading (e.g. OMM several days old)
  'STALE', // outside the nominal validity window; result may be poor
  'PREDICTED', // the provider itself flags this value as a forecast
  'UNKNOWN', // age cannot be determined
]);
export type Freshness = z.infer<typeof FreshnessSchema>;

/**
 * Provenance: the answer to "where did this number come from?".
 * One shared schema for every feature — never re-implement per feature.
 */
export const ProvenanceSchema = z.object({
  /** The entity or quantity this provenance describes, e.g. `norad:25544`, `body:sun`. */
  subject: z.string().optional(),
  stateKind: StateKindSchema,
  source: SourceSchema,
  /** Epoch of the source data (OMM epoch, observation time, model input date). */
  sourceEpochUtc: IsoUtcSchema.optional(),
  /** When Simulation obtained the source data from the provider (wall clock). Absent for bundled data. */
  retrievedAtUtc: IsoUtcSchema.optional(),
  /** The simulation time this value was evaluated for. */
  simulationTimeUtc: IsoUtcSchema,
  model: ModelRefSchema.optional(),
  frame: FrameIdSchema.optional(),
  /**
   * Signed simulation-time minus source-epoch, in seconds. Positive = the value is an
   * extrapolation forward from the source epoch. Null when there is no meaningful epoch.
   */
  dataAgeSeconds: z.number().nullable().optional(),
  freshness: FreshnessSchema.optional(),
  /** Known limitations and simplifying assumptions that affect how this number may be used. */
  limitations: z.array(z.string()).optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;
