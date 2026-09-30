// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- ambient module declaration for an untyped package; must travel with this file
/// <reference path="./nrlmsise-00.d.ts" />
import nrlmsiseFactory, { type NrlmsiseModel } from 'nrlmsise-00';
import { ecefToGeodetic, type Geodetic } from '../earth/wgs84';
import type { Instant } from '../time/instant';
import { RAD_PER_DEG } from '../units';
import type { Vec3 } from '../frames/mat3';

/**
 * NRLMSISE-00 empirical atmosphere (Picone, Hedin, Drob, Aikin, J. Geophys. Res. 107(A12), 2002).
 *
 * Implementation: the `nrlmsise-00` npm package — a WebAssembly build of Dominik Brodowski's C
 * translation of the official NRL Fortran code (Apache-2.0 wrapper). The model itself is an
 * empirical fit; it is a MODEL, not a measurement, and it does not forecast weather.
 *
 * Inputs the model needs (and which we never invent): time (UT), geodetic position, the previous
 * day's F10.7 solar radio flux, its 81-day centred average, and the daily geomagnetic index Ap.
 * The caller (the environment engine) obtains the space-weather values from the space-weather
 * provider and passes them in with their provenance.
 *
 * Limitations, all reported in `NRLMSISE00_LIMITATIONS`:
 *  - Valid range 0–1000 km altitude (queries outside it are `unsupported`, not extrapolated).
 *  - Daily-Ap mode only: the WASM wrapper does not expose the 3-hourly ap array, so storm-time
 *    response is smoothed relative to full NRLMSISE-00 use.
 *  - Empirical climatology below ~60 km: no weather (fronts, jet stream, day-to-day variability).
 *  - Atmospheric drag users should be aware NRLMSISE-00 densities have ~10–20 % 1σ scatter
 *    (larger during storms), which dominates orbital-decay prediction error.
 *
 * Units at the wrapper boundary: the package takes kilometres and degrees; this module accepts SI
 * (`Geodetic` in radians/metres) and converts once, here.
 */

export const NRLMSISE00_MODEL = {
  name: 'NRLMSISE-00',
  version: 'nrlmsise-00 npm 1.0.10 (WASM build of the C port)',
  reference: 'https://doi.org/10.1029/2002JA009430',
} as const;

export const NRLMSISE00_LIMITATIONS: readonly string[] = [
  'Empirical model (NRLMSISE-00): a statistical fit, not a measurement; typical density scatter is 10–20 % (1σ), larger in geomagnetic storms.',
  'Daily Ap only (no 3-hourly ap history), so short-lived storm response is smoothed.',
  'Valid 0–1000 km geodetic altitude; no values are produced outside that range.',
  'Below ~60 km this is a climatological mean: no weather.',
];

/** Altitude limits of the supported range, metres (geodetic height above the WGS84 ellipsoid). */
export const NRLMSISE00_MIN_ALTITUDE_M = 0;
export const NRLMSISE00_MAX_ALTITUDE_M = 1_000_000;

/** Boltzmann constant, J/K (exact, SI 2019). */
const K_BOLTZMANN = 1.380649e-23;

/** Solar and geomagnetic drivers of the model. */
export interface Nrlmsise00Inputs {
  /** Daily F10.7 solar radio flux of the PREVIOUS day, sfu (10⁻²² W m⁻² Hz⁻¹). */
  readonly f107Sfu: number;
  /** 81-day centred average of F10.7, sfu. */
  readonly f107AvgSfu: number;
  /** Daily planetary equivalent amplitude Ap, dimensionless (2 nT units). */
  readonly apDaily: number;
}

export interface Nrlmsise00Sample {
  /** Total mass density incl. anomalous oxygen, kg/m³. */
  readonly totalMassDensityKgM3: number;
  /** Neutral temperature at the sample altitude, K. */
  readonly temperatureK: number;
  /** Exospheric temperature, K. */
  readonly exosphericTemperatureK: number;
  /**
   * Total pressure, Pa — DERIVED (not a model output): p = k_B · T · Σ nᵢ from the model's species
   * number densities via the ideal-gas law. Anomalous oxygen is excluded from the sum.
   */
  readonly pressurePa: number;
  /** Species number densities, m⁻³. */
  readonly numberDensityM3: {
    readonly He: number;
    readonly O: number;
    readonly N2: number;
    readonly O2: number;
    readonly Ar: number;
    readonly H: number;
    readonly N: number;
    readonly anomalousO: number;
  };
  /** The exact model arguments used, for provenance/reproducibility. */
  readonly modelArguments: {
    readonly dayOfYear: number;
    readonly secondsOfDayUt: number;
    readonly altitudeKm: number;
    readonly geodeticLatDeg: number;
    readonly longitudeDeg: number;
    readonly localSolarTimeHours: number;
    readonly f107Sfu: number;
    readonly f107AvgSfu: number;
    readonly apDaily: number;
  };
}

export type Nrlmsise00Result =
  | { readonly status: 'ok'; readonly sample: Nrlmsise00Sample }
  | { readonly status: 'unsupported'; readonly code: string; readonly reason: string };

/** UTC day-of-year (1–366) and seconds of the UT day for an instant. */
export function dayOfYearAndSeconds(t: Instant): { doy: number; sec: number } {
  const d = t.toDate(); // ms resolution is ample: model resolution ≫ 1 ms
  const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 1);
  const msIntoYear = d.getTime() - startOfYear;
  const doy = Math.floor(msIntoYear / 86_400_000) + 1;
  const sec = (msIntoYear % 86_400_000) / 1000;
  return { doy, sec };
}

export class Nrlmsise00 {
  private constructor(private readonly model: NrlmsiseModel) {}

  /** Instantiates the WASM module (async, once). */
  static async create(): Promise<Nrlmsise00> {
    const mod = await nrlmsiseFactory();
    return new Nrlmsise00(new mod.NrlmsiseModel());
  }

  /** Evaluate the model at a geodetic position. */
  sample(
    position: Geodetic,
    time: Instant,
    inputs: Nrlmsise00Inputs,
    options: {
      /**
       * Override the local apparent solar time (hours). For reproducing published reference cases
       * that pass an arbitrary value; normally derived from UT and longitude.
       */
      localSolarTimeHours?: number;
    } = {},
  ): Nrlmsise00Result {
    const altM = position.heightM;
    if (!Number.isFinite(altM)) {
      return { status: 'unsupported', code: 'INVALID_POSITION', reason: 'Non-finite altitude' };
    }
    if (altM < NRLMSISE00_MIN_ALTITUDE_M) {
      return {
        status: 'unsupported',
        code: 'BELOW_MODEL_RANGE',
        reason: `NRLMSISE-00 is defined from 0 km; got ${(altM / 1000).toFixed(3)} km`,
      };
    }
    if (altM > NRLMSISE00_MAX_ALTITUDE_M) {
      return {
        status: 'unsupported',
        code: 'ABOVE_MODEL_RANGE',
        reason:
          `NRLMSISE-00 is valid up to 1000 km; got ${(altM / 1000).toFixed(1)} km. ` +
          'Density there is not modelled (no extrapolation is attempted).',
      };
    }
    for (const [name, v] of Object.entries(inputs)) {
      if (!Number.isFinite(v) || v < 0) {
        return {
          status: 'unsupported',
          code: 'INVALID_SPACE_WEATHER',
          reason: `Space-weather input ${name} must be a finite non-negative number, got ${v}`,
        };
      }
    }

    const { doy, sec } = dayOfYearAndSeconds(time);
    const latDeg = position.latRad / RAD_PER_DEG;
    let lonDeg = position.lonRad / RAD_PER_DEG;
    lonDeg = ((((lonDeg + 180) % 360) + 360) % 360) - 180;
    // Local apparent solar time, hours, wrapped to [0, 24).
    const lst = options.localSolarTimeHours ?? (((sec / 3600 + lonDeg / 15) % 24) + 24) % 24;
    const altKm = altM / 1000;

    this.model.run_model(
      doy,
      sec,
      altKm,
      latDeg,
      lonDeg,
      lst,
      inputs.f107AvgSfu,
      inputs.f107Sfu,
      inputs.apDaily,
    );
    const m = this.model;
    const n = {
      He: m.HE,
      O: m.O,
      N2: m.N2,
      O2: m.O2,
      Ar: m.AR,
      H: m.H,
      N: m.N,
      anomalousO: m.AnomalousOxygen,
    };
    const total = n.He + n.O + n.N2 + n.O2 + n.Ar + n.H + n.N;
    const sample: Nrlmsise00Sample = {
      totalMassDensityKgM3: m.TotalMassDensity,
      temperatureK: m.TemperatureAtAlt,
      exosphericTemperatureK: m.ExosphericTemp,
      pressurePa: K_BOLTZMANN * m.TemperatureAtAlt * total,
      numberDensityM3: n,
      modelArguments: {
        dayOfYear: doy,
        secondsOfDayUt: sec,
        altitudeKm: altKm,
        geodeticLatDeg: latDeg,
        longitudeDeg: lonDeg,
        localSolarTimeHours: lst,
        f107Sfu: inputs.f107Sfu,
        f107AvgSfu: inputs.f107AvgSfu,
        apDaily: inputs.apDaily,
      },
    };
    if (!Number.isFinite(sample.totalMassDensityKgM3) || sample.totalMassDensityKgM3 <= 0) {
      return {
        status: 'unsupported',
        code: 'MODEL_FAILURE',
        reason: 'NRLMSISE-00 returned a non-physical density for these inputs',
      };
    }
    return { status: 'ok', sample };
  }

  /** Convenience for ITRF positions (metres). */
  sampleItrf(itrfM: Vec3, time: Instant, inputs: Nrlmsise00Inputs): Nrlmsise00Result {
    return this.sample(ecefToGeodetic(itrfM[0], itrfM[1], itrfM[2]), time, inputs);
  }
}
