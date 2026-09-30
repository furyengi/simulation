/**
 * Interpolation between SERVER-SUPPLIED samples. This is rendering arithmetic, not physics: the
 * engine decides the states; the viewer only fills in the frames between them.
 *
 * The cubic Hermite scheme and its error bound are validated against direct SGP4 propagation in
 * `validation/interpolation` (the server sizes its sample step so the error stays within the
 * requested tolerance).
 */

export interface Window3 {
  /** Simulation time of sample 0, unix ms. */
  readonly startMs: number;
  readonly stepMs: number;
  readonly count: number;
  /** Flat [x0,y0,z0, x1,…] positions. */
  readonly pos: ArrayLike<number>;
  /** Flat velocities, per second; omit for linear interpolation. */
  readonly vel?: ArrayLike<number> | undefined;
}

export interface WindowQuat {
  readonly startMs: number;
  readonly stepMs: number;
  readonly count: number;
  /** Flat [x0,y0,z0,w0, …] unit quaternions, successive samples in the same hemisphere. */
  readonly q: ArrayLike<number>;
}

/** Index and fraction of `t` within a window, or undefined if outside [start, end]. */
export function locate(
  startMs: number,
  stepMs: number,
  count: number,
  t: number,
): { i: number; u: number } | undefined {
  const x = (t - startMs) / stepMs;
  if (x < 0 || x > count - 1) return undefined;
  const i = Math.min(Math.floor(x), count - 2);
  return { i, u: x - i };
}

export function coversWindow(
  w: { startMs: number; stepMs: number; count: number },
  t: number,
): boolean {
  return t >= w.startMs && t <= w.startMs + (w.count - 1) * w.stepMs;
}

/** Cubic Hermite position at time `t` (unix ms), or linear if the window has no velocities. */
export function samplePosition(
  w: Window3,
  t: number,
  out: Float64Array | number[] = [0, 0, 0],
): typeof out | undefined {
  const loc = locate(w.startMs, w.stepMs, w.count, t);
  if (!loc) return undefined;
  const { i, u } = loc;
  const a = 3 * i;
  const b = 3 * (i + 1);
  if (!w.vel) {
    for (let k = 0; k < 3; k++) out[k] = w.pos[a + k]! * (1 - u) + w.pos[b + k]! * u;
    return out;
  }
  const h = w.stepMs / 1000; // velocities are per second
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  for (let k = 0; k < 3; k++) {
    out[k] =
      h00 * w.pos[a + k]! + h10 * h * w.vel[a + k]! + h01 * w.pos[b + k]! + h11 * h * w.vel[b + k]!;
  }
  return out;
}

/** Spherical linear interpolation of the quaternion window at time `t`. */
export function sampleQuaternion(
  w: WindowQuat,
  t: number,
  out: number[] = [0, 0, 0, 1],
): number[] | undefined {
  const loc = locate(w.startMs, w.stepMs, w.count, t);
  if (!loc) return undefined;
  const { i, u } = loc;
  const a = 4 * i;
  const b = 4 * (i + 1);
  let dot = 0;
  for (let k = 0; k < 4; k++) dot += w.q[a + k]! * w.q[b + k]!;
  let s0: number;
  let s1: number;
  if (dot > 1 - 1e-12) {
    s0 = 1 - u;
    s1 = u;
  } else {
    const theta = Math.acos(Math.min(1, Math.max(-1, dot)));
    const sin = Math.sin(theta);
    s0 = Math.sin((1 - u) * theta) / sin;
    s1 = Math.sin(u * theta) / sin;
  }
  let n = 0;
  for (let k = 0; k < 4; k++) {
    out[k] = s0 * w.q[a + k]! + s1 * w.q[b + k]!;
    n += out[k]! * out[k]!;
  }
  n = Math.sqrt(n);
  for (let k = 0; k < 4; k++) out[k] = out[k]! / n;
  return out;
}

/** Rotate (x,y,z) by unit quaternion q = [qx,qy,qz,qw]: v' = q v q*. */
export function rotateByQuaternion(
  q: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  out: Float64Array | number[] = [0, 0, 0],
): typeof out {
  const qx = q[0]!;
  const qy = q[1]!;
  const qz = q[2]!;
  const qw = q[3]!;
  // t = 2 (q_v × v); v' = v + w t + q_v × t
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  out[0] = x + qw * tx + (qy * tz - qz * ty);
  out[1] = y + qw * ty + (qz * tx - qx * tz);
  out[2] = z + qw * tz + (qx * ty - qy * tx);
  return out;
}
