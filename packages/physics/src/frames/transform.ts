import type { FrameId } from '@simulation/schemas';
import type { Instant } from '../time/instant';
import { meters, metersPerSecond, type Meters, type MetersPerSecond } from '../units';
import { EopTable, type EopLookup } from './eop';
import { apply, cross, sub, add, transpose, type Mat3, type Vec3 } from './mat3';
import { computeEarthOrientation, type EarthOrientation } from './orientation';

/** A Cartesian position (metres) tagged with the frame it is expressed in. */
export interface Position<F extends FrameId = FrameId> {
  readonly frame: F;
  readonly x: Meters;
  readonly y: Meters;
  readonly z: Meters;
}

/** A Cartesian velocity (m/s) tagged with the frame it is expressed in. Velocity of the body relative to the frame. */
export interface Velocity<F extends FrameId = FrameId> {
  readonly frame: F;
  readonly x: MetersPerSecond;
  readonly y: MetersPerSecond;
  readonly z: MetersPerSecond;
}

/** Position and velocity in one frame at one instant. */
export interface StateVector<F extends FrameId = FrameId> {
  readonly frame: F;
  readonly position: Position<F>;
  readonly velocity: Velocity<F>;
}

export const position = <F extends FrameId>(frame: F, v: Vec3): Position<F> => ({
  frame,
  x: meters(v[0]),
  y: meters(v[1]),
  z: meters(v[2]),
});
export const velocity = <F extends FrameId>(frame: F, v: Vec3): Velocity<F> => ({
  frame,
  x: metersPerSecond(v[0]),
  y: metersPerSecond(v[1]),
  z: metersPerSecond(v[2]),
});
export const stateVector = <F extends FrameId>(frame: F, r: Vec3, v: Vec3): StateVector<F> => ({
  frame,
  position: position(frame, r),
  velocity: velocity(frame, v),
});

export const vec = (p: { x: number; y: number; z: number }): Vec3 => [p.x, p.y, p.z];

/**
 * Rotation from `from` to `to` for position vectors, and whether the pair involves the rotating
 * (Earth-fixed) frame — in which case velocities need the ω × r transport term.
 */
function rotationBetween(o: EarthOrientation, from: FrameId, to: FrameId): Mat3 {
  if (from === to) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const key = `${from}>${to}` as const;
  switch (key) {
    case 'GCRF>ITRF':
      return o.itrfFromGcrf;
    case 'ITRF>GCRF':
      return transpose(o.itrfFromGcrf);
    case 'TEME>ITRF':
      return o.itrfFromTeme;
    case 'ITRF>TEME':
      return transpose(o.itrfFromTeme);
    case 'GCRF>TEME':
      return o.temeFromGcrf;
    case 'TEME>GCRF':
      return transpose(o.temeFromGcrf);
    default:
      throw new Error(`No transform defined for ${key}`);
  }
}

const isRotating = (f: FrameId): boolean => f === 'ITRF';

/**
 * The reference-frame service. All frame conversions in Simulation go through here; nothing else
 * may rotate a position or velocity between GCRF, TEME and ITRF.
 *
 * Conversions are explicit (`from` and `to` are frame ids carried by the value), unit-safe (SI
 * metres and m/s in, SI out) and time-tagged (each takes an `Instant`).
 *
 * Velocity conversions between an inertial frame (GCRF, TEME) and ITRF include the transport term:
 *   v_ITRF = R·(v_in − ω × r_in),    ω = (0, 0, rotationRate) expressed in the inertial frame.
 * ω is taken along the CIP/Z axis (polar-motion and precession-nutation rates are neglected, ≲ 1e-9).
 * GCRF ↔ TEME are both quasi-inertial: no transport term (their relative angular rate is ~1e-12 rad/s).
 */
export class FrameModel {
  private lastKey: number | undefined;
  private last: EarthOrientation | undefined;

  constructor(private readonly eop: { lookup(t: Instant): EopLookup } = EopTable.none()) {}

  /** Earth orientation at `t`. Memoised for the most recent instant (batch callers share one time). */
  orientation(t: Instant): EarthOrientation {
    if (this.last && this.lastKey === t.unixMicros) return this.last;
    const o = computeEarthOrientation(t, this.eop.lookup(t));
    this.last = o;
    this.lastKey = t.unixMicros;
    return o;
  }

  convertPosition<F extends FrameId, T extends FrameId>(
    p: Position<F>,
    to: T,
    t: Instant,
  ): Position<T> {
    const m = rotationBetween(this.orientation(t), p.frame, to);
    return position(to, apply(m, vec(p)));
  }

  convertState<F extends FrameId, T extends FrameId>(
    s: StateVector<F>,
    to: T,
    t: Instant,
  ): StateVector<T> {
    const o = this.orientation(t);
    const from = s.frame;
    const m = rotationBetween(o, from, to);
    const r = vec(s.position);
    const v = vec(s.velocity);
    const omega = o.rotationRateRadS;

    let vOut: Vec3;
    if (isRotating(to) && !isRotating(from)) {
      // inertial → rotating: subtract ω × r (ω along +Z of the inertial-frame-of-date)…
      // ω must be expressed in the *inertial* frame. For GCRF/TEME sources ω ≈ ẑ_of_date, which in
      // the source frame is the third row of the (gcrf|teme)→PEF rotation; we use the ẑ image below.
      const zAxisInSource = zAxisOfEarthInInertial(o, from);
      const omegaVec: Vec3 = [
        zAxisInSource[0] * omega,
        zAxisInSource[1] * omega,
        zAxisInSource[2] * omega,
      ];
      vOut = apply(m, sub(v, cross(omegaVec, r)));
    } else if (!isRotating(to) && isRotating(from)) {
      const zAxisInTarget = zAxisOfEarthInInertial(o, to);
      const omegaVec: Vec3 = [
        zAxisInTarget[0] * omega,
        zAxisInTarget[1] * omega,
        zAxisInTarget[2] * omega,
      ];
      const rInertial = apply(m, r);
      vOut = add(apply(m, v), cross(omegaVec, rInertial));
    } else {
      vOut = apply(m, v);
    }
    return stateVector(to, apply(m, r), vOut);
  }
}

/** Earth's rotation axis (≈ CIP; polar motion neglected) as a unit vector in an inertial frame. */
function zAxisOfEarthInInertial(o: EarthOrientation, frame: FrameId): Vec3 {
  if (frame === 'GCRF') {
    // Third row of GCRF→TOD is TOD-ẑ expressed in GCRF: (itrfFromGcrf without W and R3) — recover
    // it from temeFromGcrf whose third row is the same true pole (R3 does not change z).
    const m = o.temeFromGcrf;
    return [m[6], m[7], m[8]];
  }
  if (frame === 'TEME') return [0, 0, 1];
  throw new Error(`zAxisOfEarthInInertial: ${frame} is not inertial`);
}
