import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AstronomyEngineEphemeris,
  FrameModel,
  Instant,
  NRLMSISE00_LIMITATIONS,
  NRLMSISE00_MODEL,
  Nrlmsise00,
  SimulationClock,
  SUN_RADIUS_M,
  GRAVITY_LIMITATIONS,
  GRAVITY_MODEL_NAME,
  GRAVITY_MODEL_REFERENCE,
  EARTH_SHADOW_LIMITATIONS,
  earthShadowState,
  ecefToGeodetic,
  degToRad,
  geodetic,
  julianDateUt1,
  earthRotationAngle,
  normalGravity,
  norm,
  radToDeg,
  solarConditionFromElevation,
  solarElevation,
  subSolarPoint,
  vec,
  type BodyId,
  type EopLookup,
  type Position,
  type LightTime,
} from '@simulation/physics';
import {
  ok,
  unavailable,
  unsupported,
  type AircraftLayer,
  type BodiesWindow,
  type GroundStation,
  type AtmosphereSample,
  type EarthOrientationWire,
  type EclipseSample,
  type EnvResult,
  type FrameId,
  type GravitySample,
  type Illumination,
  type MoonState,
  type ProviderStatus,
  type SpaceWeatherState,
  type SunDirection,
} from '@simulation/schemas';
import { loadConfig, type EnvironmentConfig } from '../config';
import { CelestrakGpProvider } from '../providers/celestrak-gp';
import { ResourceCache } from '../providers/cache';
import { EopProvider, EOP_SOURCE } from '../providers/eop';
import type { Fetcher } from '../providers/http';
import { OpenSkyProvider, OPENSKY_SOURCE, type BoundingBox } from '../providers/opensky';
import {
  CELESTRAK_SW_SOURCE,
  CelestrakSpaceWeatherProvider,
} from '../providers/space-weather/celestrak';
import { NOAA_SWPC_SOURCE, NoaaSwpcProvider } from '../providers/space-weather/noaa-swpc';
import { OrbitalService } from './orbital';
import { computedSource, makeProvenance, matrixToQuaternion, toWire } from './provenance';

const DEFAULT_FIXTURE_DIR = fileURLToPath(new URL('../../data/fixtures/', import.meta.url));

/** Live data is valid only when the simulation clock is this close to wall time (seconds). */
export const LIVE_TOLERANCE_SECONDS = 120;

export interface EnvironmentOptions {
  readonly config?: EnvironmentConfig;
  readonly clock?: SimulationClock;
  readonly fetcher?: Fetcher;
  /** Wall clock for providers (retrieval stamps, rate limits). Defaults to the system clock. */
  readonly wallNow?: () => Instant;
  readonly fixtureDir?: string;
  /** CelesTrak GP groups to load. Default: `stations` (a controlled development set). */
  readonly orbitalGroups?: readonly string[];
  /** Skip network/cache loads at creation (tests that load providers themselves). */
  readonly skipInitialRefresh?: boolean;
}

interface FixtureManifestEntry {
  file: string;
  retrievedAtUtc: string;
}

/**
 * The environment engine: the single authoritative source of environmental state.
 *
 * Every query takes an explicit simulation `Instant` (defaulting to the master clock), returns an
 * `EnvResult` — `ok` with provenance, or explicitly `unsupported`/`unavailable` — and never
 * fabricates a value to satisfy an interface.
 */
export class Environment {
  readonly clock: SimulationClock;
  readonly config: EnvironmentConfig;
  readonly ephemeris = new AstronomyEngineEphemeris();

  private readonly eopProvider: EopProvider;
  private readonly swProvider: CelestrakSpaceWeatherProvider;
  private readonly noaa: NoaaSwpcProvider;
  private readonly gpProvider: CelestrakGpProvider;
  private readonly openSky: OpenSkyProvider;
  private readonly msis: Nrlmsise00;
  private readonly wall: () => Instant;

  readonly frames: FrameModel;
  readonly orbitalService: OrbitalService;

  private constructor(parts: {
    clock: SimulationClock;
    config: EnvironmentConfig;
    eop: EopProvider;
    sw: CelestrakSpaceWeatherProvider;
    noaa: NoaaSwpcProvider;
    gp: CelestrakGpProvider;
    openSky: OpenSkyProvider;
    msis: Nrlmsise00;
    wall: () => Instant;
  }) {
    this.clock = parts.clock;
    this.config = parts.config;
    this.eopProvider = parts.eop;
    this.swProvider = parts.sw;
    this.noaa = parts.noaa;
    this.gpProvider = parts.gp;
    this.openSky = parts.openSky;
    this.msis = parts.msis;
    this.wall = parts.wall;
    this.frames = new FrameModel(this.eopProvider.eop);
    this.orbitalService = new OrbitalService(this.frames);
  }

  static async create(opts: EnvironmentOptions = {}): Promise<Environment> {
    const config = opts.config ?? loadConfig(process.env);
    const wall = opts.wallNow ?? (() => Instant.wallNow());
    const fixtureDir = (opts.fixtureDir ?? DEFAULT_FIXTURE_DIR).replace(/[\\/]+$/, '');
    const manifest = readManifest(fixtureDir);
    const retrieved = (file: string): string | undefined => manifest[file];
    const cache = new ResourceCache({
      dir: config.cacheDir,
      offline: config.offline,
      ...(opts.fetcher ? { fetcher: opts.fetcher } : {}),
      now: wall,
    });
    const fx = (file: string) => {
      const r = retrieved(file);
      return r ? { path: `${fixtureDir}/${file}`, retrievedAtUtc: r } : undefined;
    };

    const eopFx = fx('celestrak-eop-last5years.csv');
    const swFx = fx('celestrak-sw-last5years.csv');
    const gpFx = fx('celestrak-gp-stations.json');
    const groups = opts.orbitalGroups ?? ['stations'];

    const eop = new EopProvider({
      cache,
      ...(eopFx ? { fixturePath: eopFx.path, fixtureRetrievedAtUtc: eopFx.retrievedAtUtc } : {}),
      now: wall,
    });
    const sw = new CelestrakSpaceWeatherProvider({
      cache,
      ...(swFx ? { fixturePath: swFx.path, fixtureRetrievedAtUtc: swFx.retrievedAtUtc } : {}),
      now: wall,
    });
    const noaa = new NoaaSwpcProvider({
      cache,
      fixtureDir,
      fixtureRetrievedAtUtc: manifest,
      now: wall,
    });
    const gp = new CelestrakGpProvider({
      cache,
      groups,
      ...(gpFx ? { fixtures: { stations: gpFx } } : {}),
      now: wall,
    });
    const openSky = new OpenSkyProvider({
      config: config.openSky,
      offline: config.offline,
      ...(opts.fetcher ? { fetcher: opts.fetcher } : {}),
      now: wall,
    });
    const msis = await Nrlmsise00.create();
    const clock = opts.clock ?? new SimulationClock({ start: wall() });

    const env = new Environment({ clock, config, eop, sw, noaa, gp, openSky, msis, wall });
    if (!opts.skipInitialRefresh) await env.refreshProviders();
    return env;
  }

  // ---- Providers -------------------------------------------------------------------------

  /** Refresh every provider (each honours its own rate limits and falls back gracefully). */
  async refreshProviders(): Promise<void> {
    await Promise.all([
      this.eopProvider.refresh(),
      this.swProvider.refresh().catch(() => undefined),
      this.noaa.refresh(),
      this.gpProvider.refresh(),
    ]);
    this.orbitalService.load(this.gpProvider.all());
  }

  /** Load whatever data `time` needs that is not yet loaded (e.g. older space-weather history). */
  async prepare(time: Instant): Promise<void> {
    await this.swProvider.ensureCovers(time);
  }

  providerStatuses(): ProviderStatus[] {
    return [
      this.gpProvider.status(),
      this.eopProvider.status(),
      this.swProvider.status(),
      this.noaa.status(),
      this.openSky.status(),
    ];
  }

  private t(time?: Instant): Instant {
    return time ?? this.clock.now();
  }

  // ---- Earth orientation -----------------------------------------------------------------

  private eopProvenance(time: Instant) {
    const lookup: EopLookup = this.eopProvider.eop.lookup(time);
    const status = this.eopProvider.status();
    return makeProvenance({
      subject: 'earth:orientation',
      stateKind: lookup.quality === 'UNAVAILABLE' ? 'MODELLED' : 'OBSERVED',
      source: {
        provider: EOP_SOURCE.provider,
        dataset: EOP_SOURCE.dataset,
        url: EOP_SOURCE.url,
        license: EOP_SOURCE.license,
        attribution: EOP_SOURCE.attribution,
      },
      simulationTime: time,
      ...(status.retrievedAtUtc ? { retrievedAt: Instant.parse(status.retrievedAtUtc) } : {}),
      model: { name: 'IAU 2006/2000B Earth orientation (SOFA algorithms) with IERS EOP' },
      freshness:
        lookup.quality === 'OBSERVED'
          ? 'FRESH'
          : lookup.quality === 'PREDICTED'
            ? 'PREDICTED'
            : 'UNKNOWN',
      limitations:
        lookup.quality === 'UNAVAILABLE'
          ? [
              'No IERS EOP data cover this time: UT1−UTC and polar motion were taken as zero. Earth-fixed ↔ inertial conversions may be off by up to ~0.4 km at the equator.',
            ]
          : lookup.quality === 'PREDICTED'
            ? [
                'IERS-predicted EOP (Bulletin A); accuracy degrades with distance from the last observation.',
              ]
            : [],
    });
  }

  readonly earth = {
    /** Orientation of the Earth at `time` (rotation, sidereal time, EOP). */
    orientation: (time?: Instant): EnvResult<EarthOrientationWire> => {
      const t = this.t(time);
      const o = this.frames.orientation(t);
      const ut1 = julianDateUt1(t, o.eop.params.dut1S);
      return ok(
        {
          gastRad: o.gastRad,
          gmst82Rad: o.gmst82Rad,
          eraRad: earthRotationAngle(ut1),
          eqeRad: o.eqeRad,
          rotationRateRadS: o.rotationRateRadS,
          quaternionItrfFromGcrf: matrixToQuaternion(o.itrfFromGcrf),
          eop: {
            quality: o.eop.quality,
            dut1S: o.eop.params.dut1S,
            xpArcsec: radToDeg(o.eop.params.xpRad) * 3600,
            ypArcsec: radToDeg(o.eop.params.ypRad) * 3600,
            lodS: o.eop.params.lodS,
          },
        },
        this.eopProvenance(t),
      );
    },
  };

  // ---- Sun and Moon ----------------------------------------------------------------------

  private bodyGcrf(body: BodyId, t: Instant, lightTime?: LightTime) {
    return this.ephemeris.state(body, t, lightTime);
  }

  private bodyProvenance(body: BodyId, t: Instant, frame: FrameId, lightTime: LightTime) {
    return makeProvenance({
      subject: `body:${body}`,
      stateKind: 'MODELLED',
      source: {
        provider: 'astronomy-engine',
        dataset: 'VSOP87 / truncated lunar theory',
        url: this.ephemeris.model.reference,
        license: 'MIT',
      },
      simulationTime: t,
      model: this.ephemeris.model,
      frame,
      freshness: 'FRESH',
      limitations: [
        this.ephemeris.accuracyStatement,
        `Light-time convention: ${lightTime}.`,
        'Frame bias (~20 mas) between J2000 mean equator and GCRF is not applied to ephemeris positions.',
      ],
    });
  }

  readonly sun = {
    /**
     * Direction to the Sun from `pos` (unit vector in `pos.frame`), distance, geocentric Sun
     * position, and the sub-solar point.
     */
    direction: (pos: Position, time?: Instant): EnvResult<SunDirection> => {
      const t = this.t(time);
      const r = this.bodyGcrf('sun', t);
      if (r.status !== 'ok') return unsupported('SUN_UNAVAILABLE', r.reason);
      const frame = pos.frame;
      const sunInFrame = this.frames.convertPosition(r.state.position, frame, t);
      const from = vec(pos);
      const to = vec(sunInFrame);
      const d: [number, number, number] = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
      const dist = norm(d);
      const sunItrf = this.frames.convertPosition(r.state.position, 'ITRF', t);
      const ss = subSolarPoint(vec(sunItrf));
      const prov = [this.bodyProvenance('sun', t, frame, r.state.lightTime)];
      if (frame !== 'GCRF') prov.push(this.eopProvenance(t));
      return ok(
        {
          frame,
          direction: [d[0] / dist, d[1] / dist, d[2] / dist],
          distanceM: dist,
          geocentricPositionM: toWire(to),
          lightTime: r.state.lightTime,
          subSolarPoint: { latDeg: radToDeg(ss.latRad), lonDeg: radToDeg(ss.lonRad) },
        },
        ...prov,
      );
    },

    /** Solar elevation and day/night/twilight condition at a site on the ellipsoid. */
    illumination: (
      site: { latDeg: number; lonDeg: number; heightM?: number },
      time?: Instant,
    ): EnvResult<Illumination> => {
      const t = this.t(time);
      const r = this.bodyGcrf('sun', t);
      if (r.status !== 'ok') return unsupported('SUN_UNAVAILABLE', r.reason);
      const sunItrf = this.frames.convertPosition(r.state.position, 'ITRF', t);
      const el = solarElevation(
        geodetic(degToRad(site.latDeg), degToRad(site.lonDeg), site.heightM ?? 0),
        vec(sunItrf),
      );
      return ok(
        { solarElevationRad: el, condition: solarConditionFromElevation(el) },
        this.bodyProvenance('sun', t, 'ITRF', r.state.lightTime),
        this.eopProvenance(t),
      );
    },
  };

  readonly moon = {
    state: (time?: Instant, frame: FrameId = 'GCRF'): EnvResult<MoonState> => {
      const t = this.t(time);
      const r = this.bodyGcrf('moon', t);
      if (r.status !== 'ok') return unsupported('MOON_UNAVAILABLE', r.reason);
      const p = this.frames.convertState(
        { frame: 'GCRF', position: r.state.position, velocity: r.state.velocity },
        frame,
        t,
      );
      const itrf = this.frames.convertPosition(r.state.position, 'ITRF', t);
      const sl = subSolarPoint(vec(itrf)); // same construction: point where the body is at the zenith
      const prov = [this.bodyProvenance('moon', t, frame, r.state.lightTime)];
      if (frame !== 'GCRF') prov.push(this.eopProvenance(t));
      return ok(
        {
          frame,
          positionM: toWire(vec(p.position)),
          velocityMps: toWire(vec(p.velocity)),
          distanceM: norm(vec(p.position)),
          lightTime: r.state.lightTime,
          subLunarPoint: { latDeg: radToDeg(sl.latRad), lonDeg: radToDeg(sl.lonRad) },
        },
        ...prov,
      );
    },
  };

  // ---- Eclipse ---------------------------------------------------------------------------

  readonly eclipse = {
    /** Earth-shadow state of a point in space. */
    state: (pos: Position, time?: Instant): EnvResult<EclipseSample> => {
      const t = this.t(time);
      const r = this.bodyGcrf('sun', t);
      if (r.status !== 'ok') return unsupported('SUN_UNAVAILABLE', r.reason);
      const sun = this.frames.convertPosition(r.state.position, pos.frame, t);
      try {
        const s = earthShadowState(vec(pos), vec(sun), SUN_RADIUS_M);
        const prov = makeProvenance({
          subject: 'eclipse:earth-shadow',
          stateKind: 'MODELLED',
          source: computedSource('conical shadow model'),
          simulationTime: t,
          model: {
            name: 'Conical Earth shadow (Montenbruck & Gill, Satellite Orbits, §3.4.2)',
            reference: 'https://doi.org/10.1007/978-3-642-58351-3',
          },
          frame: pos.frame,
          freshness: 'FRESH',
          limitations: EARTH_SHADOW_LIMITATIONS,
        });
        return ok({ ...s }, prov, this.bodyProvenance('sun', t, pos.frame, r.state.lightTime));
      } catch (e) {
        return unsupported('INSIDE_EARTH', e instanceof Error ? e.message : String(e));
      }
    },
  };

  // ---- Gravity ---------------------------------------------------------------------------

  readonly gravity = {
    /** WGS 84 normal gravity at a position (vectors in ITRF axes). */
    at: (pos: Position, time?: Instant): EnvResult<GravitySample> => {
      const t = this.t(time);
      const itrf = this.frames.convertPosition(pos, 'ITRF', t);
      try {
        const g = normalGravity(vec(itrf));
        const prov = makeProvenance({
          subject: 'earth:gravity',
          stateKind: 'MODELLED',
          source: computedSource('WGS 84 normal gravity'),
          simulationTime: t,
          model: { name: GRAVITY_MODEL_NAME, reference: GRAVITY_MODEL_REFERENCE },
          frame: 'ITRF',
          freshness: 'FRESH',
          limitations: GRAVITY_LIMITATIONS,
        });
        return ok(
          {
            gravitationItrf: toWire(g.gravitation),
            gravityItrf: toWire(g.gravity),
            gravityMagnitude: g.gravityMagnitude,
            field: GRAVITY_MODEL_NAME,
          },
          prov,
          ...(pos.frame === 'ITRF' ? [] : [this.eopProvenance(t)]),
        );
      } catch (e) {
        return unsupported('BELOW_ELLIPSOID', e instanceof Error ? e.message : String(e));
      }
    },
  };

  // ---- Space weather ---------------------------------------------------------------------

  readonly spaceWeather = {
    at: (time?: Instant): EnvResult<SpaceWeatherState> => {
      const t = this.t(time);
      const r = this.swProvider.lookup(t);
      if (r.status !== 'ok') return unavailable(r.code, r.reason);
      const provs = [
        makeProvenance({
          subject: 'space-weather:daily-indices',
          stateKind:
            r.state.dataType === 'OBS' || r.state.dataType === 'INT' ? 'OBSERVED' : 'MODELLED',
          source: { ...CELESTRAK_SW_SOURCE },
          simulationTime: t,
          sourceEpoch: r.sourceEpoch,
          retrievedAt: r.retrievedAt,
          ...(r.state.dataType === 'PRD'
            ? { model: { name: 'NOAA SWPC 45-day forecast' } }
            : r.state.dataType === 'PRM'
              ? { model: { name: 'NASA/MSFC monthly solar-cycle prediction' } }
              : {}),
          freshness: r.freshness,
          limitations: [
            ...r.limitations,
            ...(this.swProvider.status().state === 'fixture'
              ? ['Dataset is a committed snapshot, not refreshed at run time.']
              : []),
          ],
        }),
      ];
      const now = this.noaa.nowcastAt(t);
      const state: SpaceWeatherState = { ...r.state, ...(now ? { nowcast: now.nowcast } : {}) };
      if (now) {
        provs.push(
          makeProvenance({
            subject: 'space-weather:nowcast',
            stateKind: 'OBSERVED',
            source: { ...NOAA_SWPC_SOURCE, dataset: 'planetary K-index, F10.7 flux' },
            simulationTime: t,
            retrievedAt: now.retrievedAt,
            ...(now.nowcast.kp3Hourly
              ? { sourceEpoch: Instant.parse(now.nowcast.kp3Hourly.timeUtc) }
              : {}),
            freshness: 'FRESH',
            limitations: [
              'Near-real-time observations/estimates; Kp 1-minute values are provisional estimates.',
            ],
          }),
        );
      }
      return ok(state, ...provs);
    },
  };

  // ---- Atmosphere ------------------------------------------------------------------------

  readonly atmosphere = {
    /**
     * NRLMSISE-00 atmosphere at a position and time. Inputs (F10.7, Ap) come from the space-weather
     * service; when they are unavailable for the time, the answer is `unavailable`, never a guess.
     */
    sample: (pos: Position, time?: Instant): EnvResult<AtmosphereSample> => {
      const t = this.t(time);
      const sw = this.spaceWeather.at(t);
      if (sw.status !== 'ok') return sw;
      const inputs = sw.value.msisInputs;
      if (!inputs) {
        return unavailable(
          'NO_MODEL_INPUTS',
          sw.value.msisInputsUnavailableReason ??
            'Space-weather drivers are unavailable for this time',
          sw.provenance,
        );
      }
      const itrf = this.frames.convertPosition(pos, 'ITRF', t);
      let g;
      try {
        g = ecefToGeodetic(itrf.x, itrf.y, itrf.z);
      } catch (e) {
        return unsupported('INVALID_POSITION', e instanceof Error ? e.message : String(e));
      }
      const r = this.msis.sample(g, t, inputs);
      if (r.status !== 'ok') return unsupported(r.code, r.reason);
      const s = r.sample;
      const swProv = sw.provenance[0]!;
      const prov = makeProvenance({
        subject: 'atmosphere:nrlmsise-00',
        stateKind: 'MODELLED',
        source: computedSource('NRLMSISE-00 (WASM)', NRLMSISE00_MODEL.reference),
        simulationTime: t,
        ...(swProv.sourceEpochUtc ? { sourceEpoch: Instant.parse(swProv.sourceEpochUtc) } : {}),
        ...(swProv.retrievedAtUtc ? { retrievedAt: Instant.parse(swProv.retrievedAtUtc) } : {}),
        model: { ...NRLMSISE00_MODEL },
        frame: 'ITRF',
        ...(swProv.freshness ? { freshness: swProv.freshness } : {}),
        limitations: [
          ...NRLMSISE00_LIMITATIONS,
          'Model input epoch (sourceEpochUtc) is that of the F10.7/Ap indices used, not of the model.',
          ...(swProv.limitations ?? []),
        ],
      });
      return ok(
        {
          totalMassDensityKgM3: s.totalMassDensityKgM3,
          temperatureK: s.temperatureK,
          exosphericTemperatureK: s.exosphericTemperatureK,
          pressurePa: s.pressurePa,
          numberDensityM3: { ...s.numberDensityM3 },
          geodetic: {
            latDeg: s.modelArguments.geodeticLatDeg,
            lonDeg: s.modelArguments.longitudeDeg,
            heightM: g.heightM,
          },
          modelInputs: {
            f107Sfu: inputs.f107Sfu,
            f107AvgSfu: inputs.f107AvgSfu,
            apDaily: inputs.apDaily,
            localSolarTimeHours: s.modelArguments.localSolarTimeHours,
          },
        },
        prov,
        ...sw.provenance,
        ...(pos.frame === 'ITRF' ? [] : [this.eopProvenance(t)]),
      );
    },
  };

  // ---- Orbital objects -------------------------------------------------------------------

  readonly orbital = {
    list: () => this.orbitalService.list(),
    search: (q: string, limit?: number) => this.orbitalService.search(q, limit),
    state: (id: string, time?: Instant, frame: FrameId = 'GCRF') =>
      this.orbitalService.state(id, this.t(time), frame),
    ephemerisBatch: (req: Parameters<OrbitalService['ephemerisBatch']>[0]) =>
      this.orbitalService.ephemerisBatch(req),
    groundTrack: (id: string, start: Instant, spanSeconds: number, stepSeconds: number) =>
      this.orbitalService.groundTrack(id, start, spanSeconds, stepSeconds),
  };

  // ---- Windows for client-side interpolation ---------------------------------------------

  readonly windows = {
    /** Earth orientation and Sun/Moon ITRF positions over a span. Sample times are start + i·step. */
    bodies: (req: {
      start: Instant;
      count: number;
      stepSeconds: number;
    }): EnvResult<BodiesWindow> => {
      const { start, count, stepSeconds } = req;
      if (count < 2 || count > 20_000 || !(stepSeconds > 0)) {
        return unsupported('BAD_WINDOW', 'count must be 2–20000 and stepSeconds positive');
      }
      const q = new Array<number>(count * 4);
      const sun = new Array<number>(count * 3);
      const moon = new Array<number>(count * 3);
      for (let i = 0; i < count; i++) {
        const t = start.plusSeconds(i * stepSeconds);
        const o = this.frames.orientation(t);
        const quat = matrixToQuaternion(o.itrfFromGcrf);
        // Keep successive quaternions in the same hemisphere so interpolation takes the short arc.
        if (
          i > 0 &&
          quat[0] * q[4 * (i - 1)]! +
            quat[1] * q[4 * (i - 1) + 1]! +
            quat[2] * q[4 * (i - 1) + 2]! +
            quat[3] * q[4 * (i - 1) + 3]! <
            0
        ) {
          for (let k = 0; k < 4; k++) quat[k] = -quat[k]!;
        }
        q.splice(4 * i, 4, ...quat);
        const s = this.bodyGcrf('sun', t);
        const m = this.bodyGcrf('moon', t);
        if (s.status !== 'ok' || m.status !== 'ok')
          return unsupported('EPHEMERIS_UNAVAILABLE', 'Sun/Moon ephemeris failed');
        const sI = vec(this.frames.convertPosition(s.state.position, 'ITRF', t));
        const mI = vec(this.frames.convertPosition(m.state.position, 'ITRF', t));
        sun.splice(3 * i, 3, ...sI);
        moon.splice(3 * i, 3, ...mI);
      }
      const prov = [
        this.eopProvenance(start),
        this.bodyProvenance('sun', start, 'ITRF', 'astrometric'),
        this.bodyProvenance('moon', start, 'ITRF', 'geometric'),
      ];
      return ok(
        {
          startUtc: start.toIso(),
          stepSeconds,
          count,
          earthQuaternionsItrfFromGcrf: q,
          sunItrfM: sun,
          moonItrfM: moon,
        },
        ...prov,
      );
    },
  };

  // ---- Ground stations -------------------------------------------------------------------

  readonly groundStations = {
    /** A small curated reference set: NASA Deep Space Network complexes (approximate public coordinates). */
    list: (): EnvResult<GroundStation[]> =>
      ok(
        GROUND_STATIONS.map((g) => ({ ...g })),
        makeProvenance({
          subject: 'ground-stations',
          stateKind: 'OBSERVED',
          source: {
            provider: 'nasa-dsn-public-site-descriptions',
            dataset: 'DSN complex coordinates (manually entered)',
            url: 'https://www.nasa.gov/directorates/somd/space-communications-navigation-program/what-is-the-deep-space-network/',
            license: 'NASA media usage guidelines (factual site coordinates)',
          },
          simulationTime: this.clock.now(),
          freshness: 'UNKNOWN',
          limitations: [
            'Approximate site coordinates (about ±0.01°) transcribed from public descriptions; not survey-grade.',
            'Ellipsoidal height is not specified and is set to 0.',
            'Static reference data; not a full network or an operational status.',
          ],
        }),
      ),
  };

  // ---- Aircraft --------------------------------------------------------------------------

  /**
   * Live aircraft data is only semantically valid when the simulation is showing "now": clock
   * running at 1×, in wall pace, within a couple of minutes of real UTC. Otherwise the layer is
   * disabled rather than showing present-day aircraft against a past or future Earth.
   */
  aircraftAvailability(): { available: boolean; reason?: string } {
    const s = this.clock.snapshot();
    const simNow = this.clock.now();
    const offset = Math.abs(simNow.secondsSince(this.wall()));
    if (s.pace !== 'wall')
      return { available: false, reason: 'Simulation clock is in manual (stepped) mode.' };
    if (s.paused) return { available: false, reason: 'Simulation clock is paused.' };
    if (s.rate !== 1)
      return { available: false, reason: `Simulation is running at ${s.rate}× real time.` };
    if (offset > LIVE_TOLERANCE_SECONDS) {
      return {
        available: false,
        reason: `Simulation time differs from real UTC by ${Math.round(offset)} s (live data is valid only within ${LIVE_TOLERANCE_SECONDS} s).`,
      };
    }
    return { available: true };
  }

  readonly aircraft = {
    availability: () => this.aircraftAvailability(),

    /** Fetch (rate-limited) and return the current aircraft layer for a bounding box. */
    refresh: async (bbox: BoundingBox | null): Promise<void> => {
      if (!this.aircraftAvailability().available) return;
      await this.openSky.refresh(bbox);
    },

    /** The most recent aircraft snapshot, with provenance — or an explicit refusal. */
    snapshot: (): EnvResult<AircraftLayer> => {
      const avail = this.aircraftAvailability();
      if (!avail.available) {
        return unavailable('LIVE_DATA_INVALID_FOR_SIMULATION_TIME', avail.reason ?? 'not live');
      }
      const snap = this.openSky.current();
      if (!snap) {
        return unavailable(
          'NO_AIRCRAFT_DATA',
          this.openSky.status().lastError ?? 'No aircraft data has been retrieved yet',
        );
      }
      const t = this.clock.now();
      const age = t.secondsSince(snap.observedAt);
      return ok(
        {
          observedAtUtc: snap.observedAt.toIso(),
          retrievedAtUtc: snap.retrievedAt.toIso(),
          bbox: snap.bbox,
          count: snap.states.length,
          aircraft: snap.states.map((s) => ({ ...s })),
          coverageNotice:
            'Only aircraft received by OpenSky Network receivers are shown. Coverage is incomplete and is not worldwide.',
        },
        makeProvenance({
          subject: 'aircraft:opensky',
          stateKind: 'OBSERVED',
          source: { ...OPENSKY_SOURCE },
          simulationTime: t,
          sourceEpoch: snap.observedAt,
          retrievedAt: snap.retrievedAt,
          freshness: age <= 60 ? 'FRESH' : age <= 300 ? 'AGING' : 'STALE',
          limitations: [
            'Each aircraft carries its own report time; positions are last-reported, not interpolated.',
            'Barometric altitude is pressure altitude; geometric altitude is GNSS (ellipsoidal) where reported.',
            'Coverage is limited to OpenSky receivers: incomplete, not worldwide.',
          ],
        }),
      );
    },
  };
}

const GROUND_STATIONS: readonly GroundStation[] = [
  {
    id: 'dsn:goldstone',
    name: 'Goldstone DSCC',
    network: 'NASA DSN',
    latDeg: 35.4267,
    lonDeg: -116.89,
    heightM: 0,
  },
  {
    id: 'dsn:madrid',
    name: 'Madrid DSCC',
    network: 'NASA DSN',
    latDeg: 40.4314,
    lonDeg: -4.2481,
    heightM: 0,
  },
  {
    id: 'dsn:canberra',
    name: 'Canberra DSCC',
    network: 'NASA DSN',
    latDeg: -35.4014,
    lonDeg: 148.9831,
    heightM: 0,
  },
];

function readManifest(dir: string): Record<string, string> {
  try {
    const m = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8')) as FixtureManifestEntry[];
    return Object.fromEntries(m.map((e) => [e.file, e.retrievedAtUtc]));
  } catch {
    return {};
  }
}
