import { z } from 'zod';
import { FrameIdSchema, IsoUtcSchema } from './state';
import { ProvenanceSchema } from './provenance';

/** Wire schemas for environment query results. Values are SI unless a field name says otherwise. */

export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3Wire = z.infer<typeof Vec3Schema>;

export const ProviderStatusSchema = z.object({
  id: z.string(),
  label: z.string(),
  /**
   * ok       — data current with respect to the provider's refresh policy
   * stale    — serving the last good data because a refresh failed or is not yet due
   * fixture  — serving a committed snapshot (never fetched at run time)
   * offline  — network disabled by configuration
   * unavailable — no data at all
   */
  state: z.enum(['ok', 'stale', 'fixture', 'offline', 'unavailable']),
  origin: z.enum(['network', 'cache', 'cache-stale', 'fixture', 'none']),
  url: z.string().optional(),
  /** When the bytes currently in use were obtained from the provider. */
  retrievedAtUtc: IsoUtcSchema.optional(),
  /** Wall-clock seconds since `retrievedAtUtc`, evaluated when the status was produced. */
  retrievalAgeSeconds: z.number().optional(),
  /** Earliest time the next network refresh is permitted (rate-limit policy). */
  nextRefreshNotBeforeUtc: IsoUtcSchema.optional(),
  lastError: z.string().optional(),
  itemCount: z.number().int().optional(),
  attribution: z.string().optional(),
  license: z.string().optional(),
  notes: z.array(z.string()).optional(),
});
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

export const SpaceWeatherDataTypeSchema = z.enum([
  'OBS', // observed
  'INT', // linearly interpolated over a gap in observations
  'PRD', // 45-day forecast
  'PRM', // monthly long-range prediction
]);

export const SpaceWeatherStateSchema = z.object({
  /** UTC calendar day these indices describe. */
  dayUtc: z.string(),
  dataType: SpaceWeatherDataTypeSchema,
  /** F10.7 observed for this UTC day, sfu. */
  f107ObsSfu: z.number().nullable(),
  /** F10.7 observed for the previous UTC day, sfu (the value NRLMSISE-00 expects). */
  f107PreviousDayObsSfu: z.number().nullable(),
  /** 81-day centred average of observed F10.7, sfu. */
  f107Avg81CenteredSfu: z.number().nullable(),
  /** Daily mean planetary equivalent amplitude Ap (2 nT units). */
  apDaily: z.number().nullable(),
  /** Eight 3-hourly planetary Kp values for the day (0–9 scale), null where not available. */
  kp3Hourly: z.array(z.number().nullable()).length(8),
  /** Complete NRLMSISE-00 driver set, or null when any element is unavailable for this date. */
  msisInputs: z
    .object({ f107Sfu: z.number(), f107AvgSfu: z.number(), apDaily: z.number() })
    .nullable(),
  /** Why msisInputs is null, when it is. */
  msisInputsUnavailableReason: z.string().optional(),
  /** Near-real-time observations from NOAA SWPC, present only when they exist for this time. */
  nowcast: z
    .object({
      kp3Hourly: z
        .object({ timeUtc: IsoUtcSchema, kp: z.number(), aRunning: z.number().nullable() })
        .optional(),
      kpEstimated1Min: z.object({ timeUtc: IsoUtcSchema, kp: z.number() }).optional(),
      f107: z
        .object({
          timeUtc: IsoUtcSchema,
          fluxSfu: z.number(),
          schedule: z.string(),
          ninetyDayMeanSfu: z.number().nullable(),
        })
        .optional(),
    })
    .optional(),
});
export type SpaceWeatherState = z.infer<typeof SpaceWeatherStateSchema>;

export const AtmosphereSampleSchema = z.object({
  totalMassDensityKgM3: z.number(),
  temperatureK: z.number(),
  exosphericTemperatureK: z.number(),
  pressurePa: z.number(),
  numberDensityM3: z.object({
    He: z.number(),
    O: z.number(),
    N2: z.number(),
    O2: z.number(),
    Ar: z.number(),
    H: z.number(),
    N: z.number(),
    anomalousO: z.number(),
  }),
  /** Position the sample was taken at (echoed so results are self-describing). */
  geodetic: z.object({ latDeg: z.number(), lonDeg: z.number(), heightM: z.number() }),
  modelInputs: z.object({
    f107Sfu: z.number(),
    f107AvgSfu: z.number(),
    apDaily: z.number(),
    localSolarTimeHours: z.number(),
  }),
});
export type AtmosphereSample = z.infer<typeof AtmosphereSampleSchema>;

export const GravitySampleSchema = z.object({
  /** Newtonian gravitational acceleration in ITRF axes, m/s². */
  gravitationItrf: Vec3Schema,
  /** Gravity (gravitation + centrifugal of the rotating frame) in ITRF axes, m/s². */
  gravityItrf: Vec3Schema,
  gravityMagnitude: z.number(),
  field: z.string(),
});
export type GravitySample = z.infer<typeof GravitySampleSchema>;

export const EclipseSampleSchema = z.object({
  condition: z.enum(['SUNLIT', 'PENUMBRA', 'UMBRA', 'ANTUMBRA']),
  illuminatedFraction: z.number(),
  sunAngularRadiusRad: z.number(),
  earthAngularRadiusRad: z.number(),
  separationRad: z.number(),
});
export type EclipseSample = z.infer<typeof EclipseSampleSchema>;

export const SunDirectionSchema = z.object({
  frame: FrameIdSchema,
  /** Unit vector from the query position towards the Sun. */
  direction: Vec3Schema,
  distanceM: z.number(),
  /** Geocentric Sun position, m, in `frame`. */
  geocentricPositionM: Vec3Schema,
  lightTime: z.enum(['astrometric', 'geometric']),
  subSolarPoint: z.object({ latDeg: z.number(), lonDeg: z.number() }),
});
export type SunDirection = z.infer<typeof SunDirectionSchema>;

export const MoonStateSchema = z.object({
  frame: FrameIdSchema,
  positionM: Vec3Schema,
  velocityMps: Vec3Schema,
  distanceM: z.number(),
  lightTime: z.enum(['astrometric', 'geometric']),
  subLunarPoint: z.object({ latDeg: z.number(), lonDeg: z.number() }),
});
export type MoonState = z.infer<typeof MoonStateSchema>;

export const EarthOrientationSchema = z.object({
  gastRad: z.number(),
  gmst82Rad: z.number(),
  eraRad: z.number().optional(),
  eqeRad: z.number(),
  rotationRateRadS: z.number(),
  /** Unit quaternion [x, y, z, w] rotating GCRF coordinates into ITRF coordinates. */
  quaternionItrfFromGcrf: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  eop: z.object({
    quality: z.enum(['OBSERVED', 'PREDICTED', 'UNAVAILABLE']),
    dut1S: z.number(),
    xpArcsec: z.number(),
    ypArcsec: z.number(),
    lodS: z.number(),
  }),
});
export type EarthOrientationWire = z.infer<typeof EarthOrientationSchema>;

export const IlluminationSchema = z.object({
  solarElevationRad: z.number(),
  condition: z.enum([
    'DAY',
    'CIVIL_TWILIGHT',
    'NAUTICAL_TWILIGHT',
    'ASTRONOMICAL_TWILIGHT',
    'NIGHT',
  ]),
});
export type Illumination = z.infer<typeof IlluminationSchema>;

/** A single query result on the wire: value + provenance, or an explicit refusal. */
export const WireResultSchema = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('ok'), value, provenance: z.array(ProvenanceSchema) }),
    z.object({ status: z.literal('unsupported'), code: z.string(), reason: z.string() }),
    z.object({
      status: z.literal('unavailable'),
      code: z.string(),
      reason: z.string(),
      provenance: z.array(ProvenanceSchema).optional(),
    }),
  ]);
