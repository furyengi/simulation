import { z } from 'zod';
import { IsoUtcSchema } from './state';

/**
 * CCSDS Orbit Mean-elements Message (OMM) record, as published by CelesTrak's GP API
 * (`FORMAT=json`). Only the fields SGP4 needs plus identifying metadata are required; unknown
 * fields are preserved.
 *
 * Mandatory-by-standard constants CelesTrak documents but does not always emit:
 * REF_FRAME=TEME, TIME_SYSTEM=UTC, MEAN_ELEMENT_THEORY=SGP4. Angles are DEGREES, mean motion is
 * revolutions/day, MEAN_MOTION_DOT is rev/day², MEAN_MOTION_DDOT is rev/day³, BSTAR is 1/Earth radii.
 * These are the native units of the source and are converted once, inside the SGP4 wrapper.
 */
export const OmmRecordSchema = z.looseObject({
  OBJECT_NAME: z.string(),
  OBJECT_ID: z.string(),
  /** Epoch of the element set, ISO-8601 UTC (CelesTrak omits the trailing Z; we normalise). */
  EPOCH: z.string(),
  MEAN_MOTION: z.coerce.number(),
  ECCENTRICITY: z.coerce.number(),
  INCLINATION: z.coerce.number(),
  RA_OF_ASC_NODE: z.coerce.number(),
  ARG_OF_PERICENTER: z.coerce.number(),
  MEAN_ANOMALY: z.coerce.number(),
  NORAD_CAT_ID: z.coerce.number().int(),
  BSTAR: z.coerce.number(),
  MEAN_MOTION_DOT: z.coerce.number(),
  MEAN_MOTION_DDOT: z.coerce.number(),
  EPHEMERIS_TYPE: z.coerce.number().optional(),
  CLASSIFICATION_TYPE: z.string().optional(),
  ELEMENT_SET_NO: z.coerce.number().optional(),
  REV_AT_EPOCH: z.coerce.number().optional(),
  REF_FRAME: z.string().optional(),
  TIME_SYSTEM: z.string().optional(),
  MEAN_ELEMENT_THEORY: z.string().optional(),
  CENTER_NAME: z.string().optional(),
});
export type OmmRecord = z.infer<typeof OmmRecordSchema>;

/** A source-tagged OMM as held by the engine: the record plus where and when it was obtained. */
export const OrbitalElementSetSchema = z.object({
  omm: OmmRecordSchema,
  /** Provider id, e.g. `celestrak`. */
  provider: z.string(),
  /** Dataset/group, e.g. `GP/stations`. */
  dataset: z.string(),
  url: z.string().optional(),
  /** Wall-clock time the record was obtained. Absent for committed fixtures with unknown fetch time. */
  retrievedAtUtc: IsoUtcSchema.optional(),
});
export type OrbitalElementSet = z.infer<typeof OrbitalElementSetSchema>;

/** Catalogue metadata shown for an orbital object. */
export const OrbitalObjectMetaSchema = z.object({
  /** Stable engine id, `norad:<catalog number>`. */
  id: z.string(),
  noradCatId: z.number().int(),
  name: z.string(),
  /** International designator (COSPAR ID), e.g. `1998-067A`. */
  intlDesignator: z.string(),
  objectType: z.string().optional(),
  countryCode: z.string().optional(),
  launchDate: z.string().optional(),
  decayDate: z.string().optional(),
  rcsSize: z.string().optional(),
});
export type OrbitalObjectMeta = z.infer<typeof OrbitalObjectMetaSchema>;
