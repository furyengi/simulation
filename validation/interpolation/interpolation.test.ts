import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  Sgp4Propagator,
  chooseVerifiedStep,
  hermitePosition,
  semiMajorAxisFromPeriod,
  suggestedStepSeconds,
  type Instant,
  type Vec3,
} from '@simulation/physics';

/**
 * The viewer animates between server-supplied samples with cubic Hermite interpolation, and the
 * server sizes the sample step with `suggestedStepSeconds` so that the interpolation error stays
 * below a requested tolerance. This case measures the ACTUAL error against direct SGP4
 * propagation, for orbits from LEO to GEO and for highly eccentric orbits.
 *
 * Method: for each orbit, sample SGP4 (TEME position + velocity) on the suggested grid over two
 * days from the element epoch, interpolate at 7 fractions inside every interval and compare with
 * direct SGP4 at the same instants. Error = 3-D position difference in metres.
 */

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

function tlesFrom(text: string): { name: string; l1: string; l2: string }[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean);
  const out: { name: string; l1: string; l2: string }[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3)
    out.push({ name: lines[i]!, l1: lines[i + 1]!, l2: lines[i + 2]! });
  return out;
}

const orekitInputs = tlesFrom(read('../orekit/inputs/tles.txt'));
// Two eccentric orbits from Vallado's verification set (e = 0.73, Molniya-like; e = 0.56).
const ver = read('../sgp4/reference/SGP4-VER.TLE').split(/\r?\n/);
const verTle = (satnum: string, name: string) => {
  const i = ver.findIndex((l) => l.startsWith(`1 ${satnum}`));
  return { name, l1: ver[i]!.slice(0, 69), l2: ver[i + 1]!.slice(0, 69) };
};
const CASES = [
  ...orekitInputs,
  verTle('11801', 'Vallado 11801 (e=0.73)'),
  verTle('16925', 'Vallado 16925 (e=0.56)'),
];

const TOLERANCE_M = 25;
const DAYS = 2;

interface Result {
  name: string;
  stepS: number;
  maxErrM: number;
  samples: number;
}

function measure(
  c: { name: string; l1: string; l2: string },
  tolM: number,
  verified = false,
): Result {
  const prop = Sgp4Propagator.fromTle(c.l1, c.l2);
  const a = semiMajorAxisFromPeriod(prop.periodSeconds);
  const e = Number(`0.${c.l2.slice(26, 33).trim()}`);
  const closedForm = suggestedStepSeconds(a, e, tolM);
  const stateAt = (t: Instant) => {
    const r = prop.propagate(t);
    return r.status === 'ok'
      ? {
          p: [r.state.position.x, r.state.position.y, r.state.position.z] as Vec3,
          v: [r.state.velocity.x, r.state.velocity.y, r.state.velocity.z] as Vec3,
        }
      : undefined;
  };
  const step = verified
    ? chooseVerifiedStep(stateAt, prop.epoch, DAYS * 86_400, tolM, closedForm).stepSeconds
    : closedForm;
  const n = Math.floor((DAYS * 86_400) / step);
  const sample = (k: number) => stateAt(prop.epoch.plusSeconds(k * step));
  let max = 0;
  let count = 0;
  let prev = sample(0);
  for (let k = 1; k <= n; k++) {
    const next = sample(k);
    if (prev && next) {
      for (const u of [0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9]) {
        const est = hermitePosition(prev.p, prev.v, next.p, next.v, step, u);
        const direct = stateAt(prop.epoch.plusSeconds((k - 1 + u) * step));
        if (!direct) continue;
        max = Math.max(
          max,
          Math.hypot(est[0] - direct.p[0], est[1] - direct.p[1], est[2] - direct.p[2]),
        );
        count++;
      }
    }
    prev = next;
  }
  return { name: c.name, stepS: step, maxErrM: max, samples: count };
}

const results = CASES.map((c) => measure(c, TOLERANCE_M));
const verified = CASES.map((c) => measure(c, TOLERANCE_M, true));

describe('Hermite interpolation of SGP4 samples', () => {
  it('measures every orbit (closed-form step vs verified step)', () => {
    expect(results.length).toBe(5);
    for (const r of results) expect(r.samples).toBeGreaterThan(50);
    const fmt = (rs: Result[]) =>
      rs
        .map(
          (r) =>
            `${r.name.padEnd(26)} step ${r.stepS.toFixed(1).padStart(6)} s  max error ${r.maxErrM.toFixed(3).padStart(9)} m  (${r.samples} checks)`,
        )
        .join('\n');
    console.log(`CLOSED-FORM step\n${fmt(results)}\nVERIFIED step\n${fmt(verified)}`);
  });

  it('closed-form step: within ~1 % of tolerance for near-Keplerian orbits (LEO, GEO, GPS)', () => {
    for (const r of results.slice(0, 3))
      expect(r.maxErrM, r.name).toBeLessThanOrEqual(TOLERANCE_M * 1.02);
  });

  it('closed-form step UNDER-delivers for the heavy-drag, rapidly decaying eccentric orbits (why steps are verified)', () => {
    for (const r of results.slice(3)) {
      expect(r.maxErrM, r.name).toBeGreaterThan(TOLERANCE_M);
      expect(r.maxErrM, r.name).toBeLessThan(TOLERANCE_M * 4);
    }
  });

  it(`verified step: every orbit, including the decaying ones, is within the requested ${TOLERANCE_M} m`, () => {
    for (const r of verified) expect(r.maxErrM, r.name).toBeLessThanOrEqual(TOLERANCE_M);
  });

  it('the step sizing is not wildly conservative: LEO uses steps of minutes, not seconds', () => {
    const iss = verified.find((r) => r.name.startsWith('ISS'))!;
    expect(iss.stepS).toBeGreaterThan(60);
  });

  it('a 4× coarser step really does violate the tolerance (the bound is meaningful)', () => {
    const coarse = measure(CASES[0]!, TOLERANCE_M * 256);
    expect(coarse.maxErrM).toBeGreaterThan(TOLERANCE_M);
  });
});
