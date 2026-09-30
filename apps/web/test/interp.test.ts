import { describe, expect, it } from 'vitest';
import { hermitePosition, rot3, matrixToQuaternion0 } from './helpers';
import {
  coversWindow,
  locate,
  rotateByQuaternion,
  samplePosition,
  sampleQuaternion,
} from '../src/interp';

describe('window location', () => {
  it('locates samples, rejects times outside the window', () => {
    expect(locate(1000, 100, 5, 1250)).toEqual({ i: 2, u: 0.5 });
    expect(locate(1000, 100, 5, 1400)).toEqual({ i: 3, u: 1 });
    expect(locate(1000, 100, 5, 999)).toBeUndefined();
    expect(locate(1000, 100, 5, 1401)).toBeUndefined();
    expect(coversWindow({ startMs: 0, stepMs: 10, count: 3 }, 20)).toBe(true);
    expect(coversWindow({ startMs: 0, stepMs: 10, count: 3 }, 21)).toBe(false);
  });
});

describe('Hermite position', () => {
  it('matches the physics-core implementation exactly', () => {
    const p0 = [7e6, 1e5, -2e5] as const;
    const v0 = [100, 7500, 300] as const;
    const p1 = [7.05e6, 4.5e5, -1.8e5] as const;
    const v1 = [-50, 7490, 310] as const;
    const w = {
      startMs: 0,
      stepMs: 60_000,
      count: 2,
      pos: [...p0, ...p1],
      vel: [...v0, ...v1],
    };
    for (const u of [0, 0.1, 0.5, 0.93, 1]) {
      const mine = samplePosition(w, u * 60_000)!;
      const ref = hermitePosition(p0, v0, p1, v1, 60, u);
      for (let k = 0; k < 3; k++) expect(Math.abs(mine[k]! - ref[k]!)).toBeLessThan(1e-6);
    }
  });

  it('reproduces a circular orbit to the predicted cubic-Hermite error bound', () => {
    const r = 6_778_137;
    const omega = Math.sqrt(3.986004418e14 / r ** 3);
    const step = 120;
    const n = 50;
    const pos: number[] = [];
    const vel: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = omega * step * i;
      pos.push(r * Math.cos(a), r * Math.sin(a), 0);
      vel.push(-r * omega * Math.sin(a), r * omega * Math.cos(a), 0);
    }
    const w = { startMs: 0, stepMs: step * 1000, count: n, pos, vel };
    let worst = 0;
    for (let t = 0; t <= (n - 1) * step; t += 7) {
      const p = samplePosition(w, t * 1000)!;
      const a = omega * t;
      worst = Math.max(worst, Math.hypot(p[0]! - r * Math.cos(a), p[1]! - r * Math.sin(a), p[2]!));
    }
    const bound = (r * (omega * step) ** 4) / 384;
    expect(worst).toBeLessThanOrEqual(bound * 1.05);
    expect(worst).toBeGreaterThan(bound * 0.3); // and the bound is not vacuous
  });

  it('falls back to linear interpolation without velocities', () => {
    const w = { startMs: 0, stepMs: 1000, count: 2, pos: [0, 0, 0, 10, 20, 30] };
    expect(Array.from(samplePosition(w, 500)!)).toEqual([5, 10, 15]);
  });
});

describe('quaternion window', () => {
  it('slerp of a constant-rate z rotation is exact at intermediate times', () => {
    const rate = 7.292115e-5; // rad/s
    const step = 60;
    const q: number[] = [];
    for (let i = 0; i < 4; i++) q.push(...matrixToQuaternion0(rot3(rate * step * i)));
    const w = { startMs: 0, stepMs: step * 1000, count: 4, q };
    for (const t of [0, 13.7, 59.9, 60, 101.3, 180]) {
      const s = sampleQuaternion(w, t * 1000)!;
      const e = matrixToQuaternion0(rot3(rate * t));
      for (let k = 0; k < 4; k++) expect(Math.abs(s[k]! - e[k]!)).toBeLessThan(1e-12);
    }
  });

  it('rotateByQuaternion equals the matrix rotation', () => {
    const angle = 0.7;
    const q = matrixToQuaternion0(rot3(angle));
    const v = rotateByQuaternion(q, 1, 0, 0);
    // passive rot3 maps (1,0,0) to (cos, -sin, 0)
    expect(v[0]).toBeCloseTo(Math.cos(angle), 12);
    expect(v[1]).toBeCloseTo(-Math.sin(angle), 12);
    expect(v[2]).toBeCloseTo(0, 12);
  });
});
