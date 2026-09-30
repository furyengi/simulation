import type { Instant } from '@simulation/physics';
import type {
  Freshness,
  FrameId,
  ModelRef,
  Provenance,
  Source,
  StateKind,
} from '@simulation/schemas';

export interface ProvenanceInput {
  readonly subject?: string;
  readonly stateKind: StateKind;
  readonly source: Source;
  /** The simulation time the value is for. */
  readonly simulationTime: Instant;
  readonly sourceEpoch?: Instant;
  readonly retrievedAt?: Instant;
  readonly model?: ModelRef;
  readonly frame?: FrameId;
  readonly freshness?: Freshness;
  readonly limitations?: readonly string[];
}

/** Build a `Provenance`, computing the signed data age (simulation time − source epoch). */
export function makeProvenance(i: ProvenanceInput): Provenance {
  return {
    ...(i.subject !== undefined ? { subject: i.subject } : {}),
    stateKind: i.stateKind,
    source: i.source,
    ...(i.sourceEpoch ? { sourceEpochUtc: i.sourceEpoch.toIso() } : {}),
    ...(i.retrievedAt ? { retrievedAtUtc: i.retrievedAt.toIso() } : {}),
    simulationTimeUtc: i.simulationTime.toIso(),
    ...(i.model ? { model: i.model } : {}),
    ...(i.frame ? { frame: i.frame } : {}),
    dataAgeSeconds: i.sourceEpoch ? i.simulationTime.secondsSince(i.sourceEpoch) : null,
    ...(i.freshness ? { freshness: i.freshness } : {}),
    ...(i.limitations && i.limitations.length ? { limitations: [...i.limitations] } : {}),
  };
}

/** Source descriptor for values that come from Simulation's own implementation of a published model. */
export const computedSource = (dataset: string, url?: string): Source => ({
  provider: 'simulation-engine',
  dataset,
  ...(url ? { url } : {}),
  license: 'Apache-2.0',
});

/**
 * Freshness of an orbital element set when used at a given simulation time, from the signed data age.
 *
 * Policy (documented in docs/provenance.md): SGP4 accuracy degrades with distance from the element
 * epoch in either direction. |age| ≤ 3 d → FRESH; ≤ 14 d → AGING; beyond → STALE. These thresholds
 * are conventions for display, not error bounds; LEO objects in a solar-active period can decay
 * faster than this suggests.
 */
export function orbitalFreshness(ageSeconds: number): Freshness {
  const days = Math.abs(ageSeconds) / 86_400;
  return days <= 3 ? 'FRESH' : days <= 14 ? 'AGING' : 'STALE';
}

/** Convert a rotation matrix (row-major, acting on column vectors) to a unit quaternion [x, y, z, w]. */
export function matrixToQuaternion(
  m: readonly [number, number, number, number, number, number, number, number, number],
): [number, number, number, number] {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const trace = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  const n = Math.hypot(x, y, z, w);
  return [x / n, y / n, z / n, w / n];
}

/** Readonly internal vector → mutable wire tuple. */
export const toWire = (v: readonly [number, number, number]): [number, number, number] => [
  v[0],
  v[1],
  v[2],
];
