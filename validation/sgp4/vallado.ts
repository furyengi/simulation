import { readFileSync } from 'node:fs';
import { Sgp4Propagator } from '@simulation/physics';

/**
 * Vallado's SGP4 verification suite (Vallado, Crawford, Hujsak, Kelso, "Revisiting Spacetrack
 * Report #3", AIAA 2006-6753). `SGP4-VER.TLE` holds 33 element sets covering near-Earth,
 * deep-space (12 h and 24 h resonances, Molniya, lunar-solar) and pathological cases;
 * `tmatverDec2015.out` holds the reference position/velocity (km, km/s, TEME) at listed minutes
 * since epoch. See reference/SOURCE.md.
 */

export interface VerRow {
  readonly tsinceMin: number;
  readonly r: readonly [number, number, number]; // km
  readonly v: readonly [number, number, number]; // km/s
}

export interface VerCase {
  readonly satnum: string;
  readonly line1: string;
  readonly line2: string;
  readonly rows: readonly VerRow[];
}

export function loadVerificationCases(tlePath: string, outPath: string): VerCase[] {
  const tle = readFileSync(tlePath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.startsWith('1 ') || l.startsWith('2 '));
  const sets: { satnum: string; line1: string; line2: string }[] = [];
  for (let i = 0; i + 1 < tle.length; i += 2) {
    const l1 = tle[i]!;
    const l2 = tle[i + 1]!;
    // Lines carry trailing start/stop/step fields after column 69; keep the classic 69 columns.
    sets.push({
      satnum: String(Number(l1.slice(2, 7))),
      line1: l1.slice(0, 69),
      line2: l2.slice(0, 69),
    });
  }
  // Some element sets (20413) appear twice with different time spans; blocks in the reference
  // output follow the TLE file order, so match sequentially rather than by catalogue number.
  let cursor = 0;

  const cases: VerCase[] = [];
  let current: { satnum: string; rows: VerRow[] } | undefined;
  for (const line of readFileSync(outPath, 'utf8').split(/\r?\n/)) {
    const header = /^\s*(\d+)\s+xx\s*$/.exec(line);
    if (header) {
      if (current) cursor = pushCase(cases, sets, current, cursor);
      current = { satnum: String(Number(header[1])), rows: [] };
      continue;
    }
    if (!current) continue;
    const f = line.trim().split(/\s+/).map(Number);
    const last = current.rows[current.rows.length - 1];
    // The reference file's final line is a fragment of another record (tsince 120, 240, …) glued onto
    // the last block; rows within a block are strictly increasing in tsince, so reject regressions.
    if (last && f[0]! <= last.tsinceMin) continue;
    if (f.length >= 7 && f.slice(0, 7).every(Number.isFinite)) {
      current.rows.push({
        tsinceMin: f[0]!,
        r: [f[1]!, f[2]!, f[3]!],
        v: [f[4]!, f[5]!, f[6]!],
      });
    }
  }
  if (current) pushCase(cases, sets, current, cursor);
  return cases;
}

function pushCase(
  out: VerCase[],
  sets: { satnum: string; line1: string; line2: string }[],
  c: { satnum: string; rows: VerRow[] },
  cursor: number,
): number {
  let i = cursor;
  while (i < sets.length && sets[i]!.satnum !== c.satnum) i++;
  const found = sets[i];
  if (!found) throw new Error(`No TLE for reference block ${c.satnum}`);
  out.push({ satnum: c.satnum, line1: found.line1, line2: found.line2, rows: c.rows });
  return i + 1;
}

export interface CaseResult {
  readonly satnum: string;
  readonly regime: 'near' | 'deep';
  readonly rows: number;
  readonly maxPositionErrorM: number;
  readonly maxVelocityErrorMps: number;
}

export function runCase(c: VerCase, opsMode: 'a' | 'i' = 'i'): CaseResult {
  const prop =
    opsMode === 'i'
      ? Sgp4Propagator.fromTle(c.line1, c.line2)
      : Sgp4Propagator.fromTle(c.line1, c.line2, { opsMode });
  let maxR = 0;
  let maxV = 0;
  let n = 0;
  for (const row of c.rows) {
    const res = prop.propagateMinutes(row.tsinceMin);
    if (res.status !== 'ok') continue; // reference rows exist only where SGP4 succeeded
    const p = res.state.position;
    const v = res.state.velocity;
    maxR = Math.max(
      maxR,
      Math.hypot(p.x - row.r[0] * 1000, p.y - row.r[1] * 1000, p.z - row.r[2] * 1000),
    );
    maxV = Math.max(
      maxV,
      Math.hypot(v.x - row.v[0] * 1000, v.y - row.v[1] * 1000, v.z - row.v[2] * 1000),
    );
    n++;
  }
  return {
    satnum: c.satnum,
    regime: prop.regime,
    rows: n,
    maxPositionErrorM: maxR,
    maxVelocityErrorMps: maxV,
  };
}
