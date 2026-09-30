import {
  type FrameModel,
  Instant,
  Sgp4Propagator,
  SGP4_MODEL,
  ecefToGeodetic,
  norm,
  radToDeg,
  semiMajorAxisFromPeriod,
  stateVector,
  suggestedStepSeconds,
  chooseVerifiedStep,
  measureHermiteError,
  type StateAt,
  vec,
  type Vec3,
} from '@simulation/physics';
import {
  ok,
  unavailable,
  unsupported,
  type EphemerisWindow,
  type EnvResult,
  type FrameId,
  type OrbitalCatalogEntry,
  type OrbitalElementSet,
  type OrbitalObjectState,
  type Provenance,
} from '@simulation/schemas';
import { CELESTRAK_GP_SOURCE } from '../providers/celestrak-gp';
import { makeProvenance, orbitalFreshness, toWire } from './provenance';

/**
 * Orbital objects: CelesTrak OMM element sets propagated with SGP4.
 *
 * Everything returned here is `PROPAGATED`, never `OBSERVED`: the element set was fitted to
 * observations at its epoch, and the position at any other time is the SGP4 theory's prediction.
 * Provenance records the source, the source epoch, the retrieval time, the propagation model, the
 * frame and the signed data age, and a freshness class.
 */

export const SGP4_LIMITATIONS: readonly string[] = [
  'Propagated from mean elements with SGP4: typical error ~1 km at the element epoch, growing by kilometres per day (faster for low, high-drag orbits).',
  'Not a live measurement of the object’s position.',
  'Does not model manoeuvres performed after the element epoch.',
];

interface Entry {
  readonly set: OrbitalElementSet;
  readonly propagator: Sgp4Propagator;
  readonly epoch: Instant;
  readonly semiMajorAxisM: number;
}

export class OrbitalService {
  private entries = new Map<string, Entry>();
  private failedToInit = 0;

  constructor(private readonly frames: FrameModel) {}

  /** Rebuild propagators from a fresh set of element sets (called after a provider refresh). */
  load(sets: readonly OrbitalElementSet[]): void {
    const next = new Map<string, Entry>();
    this.failedToInit = 0;
    for (const set of sets) {
      try {
        const propagator = Sgp4Propagator.fromOmm(set.omm);
        next.set(`norad:${set.omm.NORAD_CAT_ID}`, {
          set,
          propagator,
          epoch: propagator.epoch,
          semiMajorAxisM: semiMajorAxisFromPeriod(propagator.periodSeconds),
        });
      } catch {
        this.failedToInit++;
      }
    }
    this.entries = next;
  }

  get size(): number {
    return this.entries.size;
  }
  get skipped(): number {
    return this.failedToInit;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  list(): OrbitalCatalogEntry[] {
    return [...this.entries.entries()].map(([id, e]) => this.catalogEntry(id, e));
  }

  search(query: string, limit = 50): OrbitalCatalogEntry[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.list().slice(0, limit);
    const out: OrbitalCatalogEntry[] = [];
    for (const [id, e] of this.entries) {
      const o = e.set.omm;
      if (
        o.OBJECT_NAME.toLowerCase().includes(q) ||
        o.OBJECT_ID.toLowerCase().includes(q) ||
        String(o.NORAD_CAT_ID) === q ||
        id === q
      ) {
        out.push(this.catalogEntry(id, e));
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  private catalogEntry(id: string, e: Entry): OrbitalCatalogEntry {
    const o = e.set.omm;
    return {
      id,
      noradCatId: o.NORAD_CAT_ID,
      name: o.OBJECT_NAME,
      intlDesignator: o.OBJECT_ID,
      epochUtc: e.epoch.toIso(),
      periodSeconds: e.propagator.periodSeconds,
      inclinationDeg: o.INCLINATION,
      eccentricity: o.ECCENTRICITY,
      regime: e.propagator.regime,
      dataset: e.set.dataset,
    };
  }

  private provenance(id: string, e: Entry, time: Instant, frame: FrameId): Provenance {
    const retrieved = e.set.retrievedAtUtc ? Instant.parse(e.set.retrievedAtUtc) : undefined;
    const age = time.secondsSince(e.epoch);
    return makeProvenance({
      subject: id,
      stateKind: 'PROPAGATED',
      source: {
        provider: e.set.provider,
        dataset: e.set.dataset,
        ...(e.set.url ? { url: e.set.url } : {}),
        license: CELESTRAK_GP_SOURCE.license,
        attribution: CELESTRAK_GP_SOURCE.attribution,
      },
      simulationTime: time,
      sourceEpoch: e.epoch,
      ...(retrieved ? { retrievedAt: retrieved } : {}),
      model: { ...SGP4_MODEL },
      frame,
      freshness: orbitalFreshness(age),
      limitations: [
        ...SGP4_LIMITATIONS,
        'Native SGP4 output is TEME; other frames are obtained with the engine’s IAU 2006/2000B frame model.',
      ],
    });
  }

  /** Propagated state of one object at `time` in `frame` (default GCRF). */
  state(id: string, time: Instant, frame: FrameId = 'GCRF'): EnvResult<OrbitalObjectState> {
    const e = this.entries.get(id);
    if (!e) return unavailable('UNKNOWN_OBJECT', `No orbital object "${id}" is loaded`);
    const r = e.propagator.propagate(time);
    if (r.status === 'error') {
      return unsupported(
        'SGP4_ERROR',
        `SGP4 cannot propagate ${id} to ${time.toIso()}: ${r.message} (code ${r.code})`,
      );
    }
    const inFrame = this.frames.convertState(r.state, frame, time);
    const itrf = this.frames.convertPosition(r.state.position, 'ITRF', time);
    const g = ecefToGeodetic(itrf.x, itrf.y, itrf.z);
    const o = e.set.omm;
    return ok(
      {
        id,
        name: o.OBJECT_NAME,
        noradCatId: o.NORAD_CAT_ID,
        intlDesignator: o.OBJECT_ID,
        timeUtc: time.toIso(),
        frame,
        positionM: toWire(vec(inFrame.position)),
        velocityMps: toWire(vec(inFrame.velocity)),
        speedMps: norm(vec(inFrame.velocity)),
        geodetic: { latDeg: radToDeg(g.latRad), lonDeg: radToDeg(g.lonRad), heightM: g.heightM },
        elements: {
          epochUtc: e.epoch.toIso(),
          periodSeconds: e.propagator.periodSeconds,
          inclinationDeg: o.INCLINATION,
          eccentricity: o.ECCENTRICITY,
          meanMotionRevPerDay: o.MEAN_MOTION,
          raanDeg: o.RA_OF_ASC_NODE,
          argPerigeeDeg: o.ARG_OF_PERICENTER,
          meanAnomalyDeg: o.MEAN_ANOMALY,
          bstar: o.BSTAR,
          regime: e.propagator.regime,
          source: {
            provider: e.set.provider,
            dataset: e.set.dataset,
            ...(e.set.retrievedAtUtc ? { retrievedAtUtc: e.set.retrievedAtUtc } : {}),
          },
        },
      },
      this.provenance(id, e, time, frame),
    );
  }

  /**
   * Batch of ephemeris windows for client-side interpolation. Loops time-outermost so the Earth
   * orientation for each sample time is computed once for all objects.
   *
   * @param stepSeconds if omitted, sized per object so cubic-Hermite interpolation stays below
   *   `toleranceM` (the smallest step among the requested objects is used for all, so samples align).
   */
  ephemerisBatch(req: {
    ids: readonly string[];
    start: Instant;
    /** Number of samples; or give `durationSeconds` and let the engine size the step and count. */
    count?: number;
    durationSeconds?: number;
    frame: FrameId;
    stepSeconds?: number;
    toleranceM?: number;
    /**
     * Verify the step by measuring the interpolation error against direct propagation and refine it
     * until it is within tolerance. Default: on for up to 64 objects (cost ≈ 2× propagation).
     */
    verify?: boolean;
  }): EnvResult<{ windows: EphemerisWindow[]; stepSeconds: number }> {
    const { ids, start, frame } = req;
    if (req.count === undefined && req.durationSeconds === undefined) {
      return unsupported('BAD_WINDOW', 'give count or durationSeconds');
    }
    if (req.count !== undefined && (req.count < 2 || req.count > 20_000)) {
      return unsupported('BAD_WINDOW', 'count must be between 2 and 20000');
    }
    const tol = req.toleranceM ?? 10;
    const missing = ids.filter((id) => !this.entries.has(id));
    if (missing.length) {
      return unavailable('UNKNOWN_OBJECT', `Unknown object(s): ${missing.slice(0, 5).join(', ')}`);
    }
    const stateOf =
      (id: string): StateAt =>
      (t) => {
        const r = this.entries.get(id)!.propagator.propagate(t);
        return r.status === 'ok'
          ? { p: vec(r.state.position), v: vec(r.state.velocity) }
          : undefined;
      };
    const suggested = Math.min(
      ...ids.map((id) => {
        const e = this.entries.get(id)!;
        return suggestedStepSeconds(e.semiMajorAxisM, e.set.omm.ECCENTRICITY, tol);
      }),
    );
    let step = req.stepSeconds ?? suggested;
    const verify = req.stepSeconds === undefined && (req.verify ?? ids.length <= 64);
    if (verify) {
      // Refine per object against direct propagation; the smallest step is used for all so the
      // sample grids align.
      const duration = req.durationSeconds ?? ((req.count ?? 2) - 1) * suggested;
      for (const id of ids) {
        step = Math.min(
          step,
          chooseVerifiedStep(stateOf(id), start, duration, tol, suggested).stepSeconds,
        );
      }
    }
    if (!Number.isFinite(step) || step <= 0) return unsupported('BAD_STEP', 'invalid step');
    const count =
      req.count ?? Math.min(20_000, Math.max(2, Math.ceil((req.durationSeconds ?? 0) / step) + 1));

    const pos = ids.map(() => new Array<number>(count * 3).fill(0));
    const vel = ids.map(() => new Array<number>(count * 3).fill(0));
    const fails = ids.map(() => [] as EphemerisWindow['failures']);

    for (let i = 0; i < count; i++) {
      const t = start.plusSeconds(i * step);
      for (let k = 0; k < ids.length; k++) {
        const e = this.entries.get(ids[k]!)!;
        const r = e.propagator.propagate(t);
        if (r.status === 'error') {
          fails[k]!.push({ index: i, code: r.code, message: r.message });
          continue;
        }
        let p: Vec3 = vec(r.state.position);
        let v: Vec3 = vec(r.state.velocity);
        if (frame !== 'TEME') {
          const s = this.frames.convertState(stateVector('TEME', p, v), frame, t);
          p = vec(s.position);
          v = vec(s.velocity);
        }
        pos[k]![3 * i] = p[0];
        pos[k]![3 * i + 1] = p[1];
        pos[k]![3 * i + 2] = p[2];
        vel[k]![3 * i] = v[0];
        vel[k]![3 * i + 1] = v[1];
        vel[k]![3 * i + 2] = v[2];
      }
    }

    const windows: EphemerisWindow[] = ids.map((id, k) => ({
      id,
      frame,
      startUtc: start.toIso(),
      stepSeconds: step,
      count,
      positionsM: pos[k]!,
      velocitiesMps: vel[k]!,
      failures: fails[k]!,
      interpolationToleranceM: tol,
      interpolationErrorMeasuredM: verify
        ? measureHermiteError(stateOf(id), start, step, (count - 1) * step).maxErrorM
        : null,
    }));
    return ok(
      { windows, stepSeconds: step },
      ...ids.map((id) => this.provenance(id, this.entries.get(id)!, start, frame)),
    );
  }

  /** Ground track (sub-satellite points) over a span, computed via ITRF. */
  groundTrack(
    id: string,
    start: Instant,
    spanSeconds: number,
    stepSeconds: number,
  ): EnvResult<{
    id: string;
    points: { timeUtc: string; latDeg: number; lonDeg: number; heightM: number }[];
  }> {
    const e = this.entries.get(id);
    if (!e) return unavailable('UNKNOWN_OBJECT', `No orbital object "${id}" is loaded`);
    if (!(stepSeconds > 0) || spanSeconds / stepSeconds > 20_000) {
      return unsupported('BAD_WINDOW', 'stepSeconds must be positive and span/step ≤ 20000');
    }
    const points = [];
    const n = Math.floor(spanSeconds / stepSeconds);
    for (let i = 0; i <= n; i++) {
      const t = start.plusSeconds(i * stepSeconds);
      const r = e.propagator.propagate(t);
      if (r.status !== 'ok') continue;
      const p = this.frames.convertPosition(r.state.position, 'ITRF', t);
      const g = ecefToGeodetic(p.x, p.y, p.z);
      points.push({
        timeUtc: t.toIso(),
        latDeg: radToDeg(g.latRad),
        lonDeg: radToDeg(g.lonRad),
        heightM: g.heightM,
      });
    }
    return ok({ id, points }, this.provenance(id, e, start, 'ITRF'));
  }
}
