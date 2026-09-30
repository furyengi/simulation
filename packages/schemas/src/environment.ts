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

// ---- Orbital objects ---------------------------------------------------------------------

export const OrbitalElementsSummarySchema = z.object({
  epochUtc: IsoUtcSchema,
  periodSeconds: z.number(),
  inclinationDeg: z.number(),
  eccentricity: z.number(),
  meanMotionRevPerDay: z.number(),
  raanDeg: z.number(),
  argPerigeeDeg: z.number(),
  meanAnomalyDeg: z.number(),
  bstar: z.number(),
  regime: z.enum(['near', 'deep']),
  source: z.object({
    provider: z.string(),
    dataset: z.string(),
    retrievedAtUtc: IsoUtcSchema.optional(),
  }),
});
export type OrbitalElementsSummary = z.infer<typeof OrbitalElementsSummarySchema>;

export const OrbitalObjectStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  noradCatId: z.number().int(),
  intlDesignator: z.string(),
  timeUtc: IsoUtcSchema,
  frame: FrameIdSchema,
  positionM: Vec3Schema,
  velocityMps: Vec3Schema,
  speedMps: z.number(),
  /** Sub-satellite point and height above the WGS84 ellipsoid (derived via ITRF). */
  geodetic: z.object({ latDeg: z.number(), lonDeg: z.number(), heightM: z.number() }),
  elements: OrbitalElementsSummarySchema,
});
export type OrbitalObjectState = z.infer<typeof OrbitalObjectStateSchema>;

export const OrbitalCatalogEntrySchema = z.object({
  id: z.string(),
  noradCatId: z.number().int(),
  name: z.string(),
  intlDesignator: z.string(),
  epochUtc: IsoUtcSchema,
  periodSeconds: z.number(),
  inclinationDeg: z.number(),
  eccentricity: z.number(),
  regime: z.enum(['near', 'deep']),
  dataset: z.string(),
});
export type OrbitalCatalogEntry = z.infer<typeof OrbitalCatalogEntrySchema>;

/**
 * A window of engine-computed samples for one object, for client-side interpolation.
 * `positionsM` / `velocitiesMps` are flat [x0,y0,z0,x1,…]; sample i is at
 * `startUtc + i·stepSeconds` (computed from i, not accumulated). Samples where SGP4 reported an
 * error are NaN-free: they are listed in `failures` and their slots hold 0.
 */
export const EphemerisWindowSchema = z.object({
  id: z.string(),
  frame: FrameIdSchema,
  startUtc: IsoUtcSchema,
  stepSeconds: z.number(),
  count: z.number().int(),
  positionsM: z.array(z.number()),
  velocitiesMps: z.array(z.number()),
  failures: z.array(
    z.object({ index: z.number().int(), code: z.number().int(), message: z.string() }),
  ),
  /** Worst-case cubic-Hermite interpolation error the step was sized for, m (an estimate, see docs). */
  interpolationToleranceM: z.number(),
});
export type EphemerisWindow = z.infer<typeof EphemerisWindowSchema>;

// ---- Aircraft (separate from simulated objects) -------------------------------------------

export const AircraftStateSchema = z.object({
  id: z.string(),
  icao24: z.string(),
  callsign: z.string().nullable(),
  originCountry: z.string(),
  positionTimeUtc: IsoUtcSchema.nullable(),
  lastContactUtc: IsoUtcSchema.nullable(),
  lonDeg: z.number().nullable(),
  latDeg: z.number().nullable(),
  baroAltitudeM: z.number().nullable(),
  geoAltitudeM: z.number().nullable(),
  onGround: z.boolean(),
  groundSpeedMps: z.number().nullable(),
  trackDeg: z.number().nullable(),
  verticalRateMps: z.number().nullable(),
  squawk: z.string().nullable(),
  positionSource: z.enum(['ADS-B', 'ASTERIX', 'MLAT', 'FLARM', 'UNKNOWN']),
});
export type AircraftStateWire = z.infer<typeof AircraftStateSchema>;

export const AircraftLayerSchema = z.object({
  observedAtUtc: IsoUtcSchema,
  retrievedAtUtc: IsoUtcSchema,
  bbox: z
    .object({
      latMinDeg: z.number(),
      lonMinDeg: z.number(),
      latMaxDeg: z.number(),
      lonMaxDeg: z.number(),
    })
    .nullable(),
  count: z.number().int(),
  aircraft: z.array(AircraftStateSchema),
  /** Always present: coverage is limited to the provider's receivers. */
  coverageNotice: z.string(),
});
export type AircraftLayer = z.infer<typeof AircraftLayerSchema>;

// ---- Bodies window (Earth orientation, Sun, Moon) for client interpolation -----------------

/**
 * Engine-computed samples of Earth orientation and the Sun/Moon geocentric positions, for the
 * viewer to interpolate between. Sample i is at `startUtc + i·stepSeconds`.
 */
export const BodiesWindowSchema = z.object({
  startUtc: IsoUtcSchema,
  stepSeconds: z.number(),
  count: z.number().int(),
  /** Flat [x,y,z,w, …]: unit quaternions rotating GCRF coordinates into ITRF coordinates. */
  earthQuaternionsItrfFromGcrf: z.array(z.number()),
  /** Flat [x,y,z, …]: geocentric positions in ITRF, metres. Sun: astrometric; Moon: geometric. */
  sunItrfM: z.array(z.number()),
  moonItrfM: z.array(z.number()),
});
export type BodiesWindow = z.infer<typeof BodiesWindowSchema>;

export const GroundStationSchema = z.object({
  id: z.string(),
  name: z.string(),
  network: z.string(),
  latDeg: z.number(),
  lonDeg: z.number(),
  heightM: z.number(),
});
export type GroundStation = z.infer<typeof GroundStationSchema>;
