import type { OmmRecord } from '@simulation/schemas';
import { json2satrec, sgp4, twoline2satrec, type SatRec } from 'satellite.js';
import { stateVector, type StateVector } from '../frames/transform';
import { Instant } from '../time/instant';
import { tleToOmm } from './tle';
import { kmToM } from '../units';

/**
 * SGP4/SDP4 propagation of NORAD mean elements (TLE or CCSDS OMM), implemented by `satellite.js`
 * (a maintained port of David Vallado's reference implementation, "Revisiting Spacetrack Report #3").
 *
 * What this is, and is not
 * ------------------------
 * The output is a **propagated** state: mean elements fitted to observations at the element epoch,
 * advanced by the SGP4 theory. It is NOT a measurement of the object's current position. Typical
 * accuracy is about 1 km at epoch, degrading by a few km/day (much faster at low altitude during
 * solar-active periods). Positions are in TEME; velocity likewise.
 *
 * Units: elements arrive in their native OMM/TLE units and are converted once, inside satellite.js.
 * Everything returned by this module is SI (metres, m/s).
 *
 * Time: satellite.js's OMM epoch parser truncates the epoch to milliseconds. We therefore use our
 * own microsecond-exact epoch and call the low-level `sgp4(satrec, tsince)` with `tsince` computed
 * from `Instant`s, so propagation time is exact. The <1 ms difference in the epoch used for the
 * initialisation of deep-space luni-solar terms is far below the theory's error.
 */

const SGP4_ERRORS: Readonly<Record<number, string>> = {
  1: 'mean eccentricity out of range (0 ≤ e < 1)',
  2: 'mean motion fell below zero',
  3: 'perturbed eccentricity out of range (0 ≤ e < 1)',
  4: 'semi-latus rectum fell below zero',
  6: 'satellite has decayed (position is below the Earth surface)',
};

export type Sgp4Result =
  | { readonly status: 'ok'; readonly state: StateVector<'TEME'> }
  | {
      readonly status: 'error';
      /** satellite.js / Vallado SGP4 error code (1–6). */
      readonly code: number;
      readonly message: string;
    };

export const SGP4_MODEL = {
  name: 'SGP4/SDP4 (Vallado et al., AIAA 2006-6753) via satellite.js',
  version: '7.1.0',
  reference: 'https://celestrak.org/publications/AIAA/2006-6753/',
} as const;

export interface Sgp4Options {
  /** Mode of operation: `i` improved (default), `a` legacy AFSPC. */
  opsMode?: 'a' | 'i';
}

export class Sgp4Propagator {
  private constructor(
    private readonly satrec: SatRec,
    /** Epoch of the element set, UTC, microsecond exact. */
    readonly epoch: Instant,
    /** Orbital period from the mean motion, seconds. */
    readonly periodSeconds: number,
    /** `deep` for SDP4 (period ≥ 225 min), `near` for SGP4. */
    readonly regime: 'near' | 'deep',
  ) {}

  static fromOmm(omm: OmmRecord, options: Sgp4Options = {}): Sgp4Propagator {
    if (omm.REF_FRAME !== undefined && omm.REF_FRAME !== 'TEME') {
      throw new Error(
        `OMM ${omm.NORAD_CAT_ID}: unsupported REF_FRAME "${omm.REF_FRAME}" (need TEME)`,
      );
    }
    if (omm.TIME_SYSTEM !== undefined && omm.TIME_SYSTEM !== 'UTC') {
      throw new Error(
        `OMM ${omm.NORAD_CAT_ID}: unsupported TIME_SYSTEM "${omm.TIME_SYSTEM}" (need UTC)`,
      );
    }
    if (omm.MEAN_ELEMENT_THEORY !== undefined && omm.MEAN_ELEMENT_THEORY !== 'SGP4') {
      throw new Error(
        `OMM ${omm.NORAD_CAT_ID}: unsupported MEAN_ELEMENT_THEORY "${omm.MEAN_ELEMENT_THEORY}"`,
      );
    }
    const epochIso = omm.EPOCH.endsWith('Z') ? omm.EPOCH : `${omm.EPOCH}Z`;
    const epoch = Instant.parse(normaliseFraction(epochIso));
    const satrec = json2satrec(omm as Parameters<typeof json2satrec>[0], options.opsMode ?? 'i');
    return Sgp4Propagator.wrap(satrec, epoch);
  }

  /** From a classic two-line element set. */
  static fromTle(line1: string, line2: string, options: Sgp4Options = {}): Sgp4Propagator {
    if (options.opsMode === 'a') {
      // satellite.js's TLE parser has no operation-mode switch; go through the equivalent OMM.
      return Sgp4Propagator.fromOmm(tleToOmm(line1, line2), options);
    }
    const satrec = twoline2satrec(line1, line2);
    // Epoch: 2-digit year (57–99 → 19xx, 00–56 → 20xx) and fractional day-of-year, µs exact.
    const yy = satrec.epochyr;
    const year = yy < 57 ? 2000 + yy : 1900 + yy;
    const start = Instant.parse(`${year}-01-01T00:00:00Z`);
    const epoch = start.plusSeconds((satrec.epochdays - 1) * 86_400);
    return Sgp4Propagator.wrap(satrec, epoch);
  }

  private static wrap(satrec: SatRec, epoch: Instant): Sgp4Propagator {
    const noRadPerMin = satrec.no; // kozai-adjusted mean motion, rad/min
    const periodSeconds = ((2 * Math.PI) / noRadPerMin) * 60;
    return new Sgp4Propagator(
      satrec,
      epoch,
      periodSeconds,
      satrec.method === 'd' ? 'deep' : 'near',
    );
  }

  get noradId(): string {
    return this.satrec.satnum;
  }

  /** Minutes from the element epoch to `t` (negative before). */
  minutesSinceEpoch(t: Instant): number {
    return t.secondsSince(this.epoch) / 60;
  }

  /** Propagate to an arbitrary instant. Returns TEME position (m) and velocity (m/s). */
  propagate(t: Instant): Sgp4Result {
    return this.propagateMinutes(this.minutesSinceEpoch(t));
  }

  /** Propagate to `tsince` minutes after the epoch (used by the reference-vector tests). */
  propagateMinutes(tsinceMin: number): Sgp4Result {
    const r = sgp4(this.satrec, tsinceMin);
    if (!r) {
      const code = this.satrec.error as number;
      return { status: 'error', code, message: SGP4_ERRORS[code] ?? `SGP4 error ${code}` };
    }
    const p = r.position;
    const v = r.velocity;
    return {
      status: 'ok',
      state: stateVector(
        'TEME',
        [kmToM(p.x), kmToM(p.y), kmToM(p.z)],
        [kmToM(v.x), kmToM(v.y), kmToM(v.z)],
      ),
    };
  }
}

/** ISO fraction of 1–6 digits → the strict form `Instant.parse` accepts. */
function normaliseFraction(iso: string): string {
  return iso.replace(/\.(\d+)Z$/, (_m, f: string) => `.${f.slice(0, 6)}Z`);
}
