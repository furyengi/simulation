import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FrameModel,
  Instant,
  Sgp4Propagator,
  ecefToGeodetic,
  geodetic,
  geodeticToEcef,
  norm,
  stateVector,
  sub,
  vec,
  type EopLookup,
  type StateVector,
  type Vec3,
} from '@simulation/physics';

/** Cross-implementation comparison with Orekit. See README.md for the full write-up. */

const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

export interface OrekitState {
  name: string;
  timeIso: string;
  frame: 'TEME' | 'ITRF' | 'GCRF';
  r: Vec3;
  v: Vec3;
}
export interface OrekitEop {
  name: string;
  timeIso: string;
  dut1S: number;
  xpRad: number;
  ypRad: number;
  lodS: number;
}
export interface OrekitGeo {
  name: string;
  latRad: number;
  lonRad: number;
  heightM: number;
  ecef: Vec3;
}

export function loadOrekit(): { states: OrekitState[]; eops: OrekitEop[]; geos: OrekitGeo[] } {
  const states: OrekitState[] = [];
  const eops: OrekitEop[] = [];
  const geos: OrekitGeo[] = [];
  for (const line of readFileSync(here('./reference/orekit-reference.csv'), 'utf8').split(
    /\r?\n/,
  )) {
    if (!line || line.startsWith('#')) continue;
    const f = line.split(',');
    if (f[0] === 'state') {
      states.push({
        name: f[1]!,
        timeIso: `${f[2]!}Z`,
        frame: f[3] as OrekitState['frame'],
        r: [Number(f[4]), Number(f[5]), Number(f[6])],
        v: [Number(f[7]), Number(f[8]), Number(f[9])],
      });
    } else if (f[0] === 'eop') {
      eops.push({
        name: f[1]!,
        timeIso: `${f[2]!}Z`,
        dut1S: Number(f[3]),
        xpRad: Number(f[4]),
        ypRad: Number(f[5]),
        lodS: Number(f[6]),
      });
    } else if (f[0] === 'geo') {
      geos.push({
        name: f[1]!,
        latRad: Number(f[2]),
        lonRad: Number(f[3]),
        heightM: Number(f[4]),
        ecef: [Number(f[5]), Number(f[6]), Number(f[7])],
      });
    }
  }
  return { states, eops, geos };
}

/** The TLEs fed to Orekit (name, line 1, line 2). */
export function loadTles(): { name: string; l1: string; l2: string }[] {
  const lines = readFileSync(here('./inputs/tles.txt'), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean);
  const out = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    out.push({ name: lines[i]!, l1: lines[i + 1]!, l2: lines[i + 2]! });
  }
  return out;
}

/** A frame model fed with exactly the EOP values Orekit used at each instant. */
export function frameModelWithOrekitEop(eops: OrekitEop[]): FrameModel {
  const byTime = new Map(eops.map((e) => [Instant.parse(e.timeIso).unixMicros, e]));
  return new FrameModel({
    lookup: (t): EopLookup => {
      const e = byTime.get(t.unixMicros);
      if (!e) throw new Error(`no Orekit EOP row for ${t.toIso()}`);
      return {
        quality: 'OBSERVED',
        params: { dut1S: e.dut1S, xpRad: e.xpRad, ypRad: e.ypRad, lodS: e.lodS },
      };
    },
  });
}

export interface Stat {
  n: number;
  maxPosM: number;
  maxVelMps: number;
}
const stat = (): Stat => ({ n: 0, maxPosM: 0, maxVelMps: 0 });
function accumulate(s: Stat, a: StateVector, b: { r: Vec3; v: Vec3 }): void {
  s.n++;
  s.maxPosM = Math.max(s.maxPosM, norm(sub(vec(a.position), b.r)));
  s.maxVelMps = Math.max(s.maxVelMps, norm(sub(vec(a.velocity), b.v)));
}

export interface Comparison {
  sgp4Teme: Stat;
  temeToItrf: Stat;
  temeToGcrf: Stat;
  /** Pure frame-algorithm check: the Orekit ITRF state through our frames to GCRF, vs the Orekit GCRF state. */
  itrfToGcrf: Stat;
  /** The reverse direction. */
  gcrfToItrf: Stat;
  perCase: Record<string, { sgp4Teme: number; temeToGcrf: number }>;
}

export function compareStates(): Comparison {
  const { states, eops } = loadOrekit();
  const frames = frameModelWithOrekitEop(eops);
  const props = new Map(loadTles().map((t) => [t.name, Sgp4Propagator.fromTle(t.l1, t.l2)]));

  const out: Comparison = {
    sgp4Teme: stat(),
    temeToItrf: stat(),
    temeToGcrf: stat(),
    itrfToGcrf: stat(),
    gcrfToItrf: stat(),
    perCase: {},
  };
  const group = new Map<string, Partial<Record<OrekitState['frame'], OrekitState>>>();
  for (const s of states) {
    const k = `${s.name}|${s.timeIso}`;
    const g = group.get(k) ?? {};
    g[s.frame] = s;
    group.set(k, g);
  }

  for (const [k, g] of group) {
    const [name, iso] = k.split('|') as [string, string];
    const t = Instant.parse(iso);
    const teme = g.TEME!;
    const itrf = g.ITRF!;
    const gcrf = g.GCRF!;
    const ours = props.get(name)!.propagate(t);
    if (ours.status !== 'ok') throw new Error(`our SGP4 failed for ${k}`);
    accumulate(out.sgp4Teme, ours.state, teme);

    // The Orekit TEME state carried through OUR frame model.
    const temeState = stateVector('TEME', teme.r, teme.v);
    accumulate(out.temeToItrf, frames.convertState(temeState, 'ITRF', t), itrf);
    const viaGcrf = frames.convertState(temeState, 'GCRF', t);
    accumulate(out.temeToGcrf, viaGcrf, gcrf);

    // Isolated frame algorithm (no TEME involved).
    accumulate(
      out.itrfToGcrf,
      frames.convertState(stateVector('ITRF', itrf.r, itrf.v), 'GCRF', t),
      gcrf,
    );
    accumulate(
      out.gcrfToItrf,
      frames.convertState(stateVector('GCRF', gcrf.r, gcrf.v), 'ITRF', t),
      itrf,
    );

    const c = (out.perCase[name] ??= { sgp4Teme: 0, temeToGcrf: 0 });
    c.sgp4Teme = Math.max(c.sgp4Teme, norm(sub(vec(ours.state.position), teme.r)));
    c.temeToGcrf = Math.max(c.temeToGcrf, norm(sub(vec(viaGcrf.position), gcrf.r)));
  }
  return out;
}

export interface GeoComparison {
  n: number;
  maxForwardM: number;
  maxInverseLatRad: number;
  maxInverseLonRad: number;
  maxInverseHeightM: number;
}

export function compareGeodetic(): GeoComparison {
  const { geos } = loadOrekit();
  const res: GeoComparison = {
    n: 0,
    maxForwardM: 0,
    maxInverseLatRad: 0,
    maxInverseLonRad: 0,
    maxInverseHeightM: 0,
  };
  for (const g of geos) {
    // Forward: our ECEF of Orekit's (round-tripped) geodetic triple vs Orekit's ECEF.
    const ours = geodeticToEcef(geodetic(g.latRad, g.lonRad, g.heightM));
    res.maxForwardM = Math.max(res.maxForwardM, norm(sub(ours, g.ecef)));
    // Inverse: our geodetic of Orekit's ECEF vs Orekit's own round-trip result.
    const inv = ecefToGeodetic(g.ecef[0], g.ecef[1], g.ecef[2]);
    res.maxInverseLatRad = Math.max(res.maxInverseLatRad, Math.abs(inv.latRad - g.latRad));
    const dLon = Math.abs(
      Math.atan2(Math.sin(inv.lonRad - g.lonRad), Math.cos(inv.lonRad - g.lonRad)),
    );
    // Longitude is meaningless at the poles; compare it only away from them.
    if (Math.abs(g.latRad) < 1.5) res.maxInverseLonRad = Math.max(res.maxInverseLonRad, dLon);
    res.maxInverseHeightM = Math.max(res.maxInverseHeightM, Math.abs(inv.heightM - g.heightM));
    res.n++;
  }
  return res;
}
