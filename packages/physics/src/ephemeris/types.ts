import type { ModelRef } from '@simulation/schemas';
import type { Instant } from '../time/instant';
import type { Position, Velocity } from '../frames/transform';

/**
 * Solar-system bodies the engine can locate. Extending this union (and an `Ephemeris`
 * implementation) is how additional bodies are introduced later without redesigning the core.
 */
export type BodyId = 'sun' | 'moon';

/**
 * How light-travel time is treated in a position:
 *  - `astrometric`: the body's retarded position — where the light arriving now left it.
 *    Appropriate for "where is the Sun in the sky / which way does illumination come from".
 *  - `geometric`:   the body's position at the instant itself (no light-time correction).
 *    Appropriate for "where is the Moon now" (its 1.3 s light-time is ≈ 1.3 km of motion).
 */
export type LightTime = 'astrometric' | 'geometric';

export interface EphemerisState {
  readonly body: BodyId;
  readonly time: Instant;
  /** Geocentric position, metres, in GCRF. */
  readonly position: Position<'GCRF'>;
  /** Geocentric velocity, m/s, in GCRF (numerical derivative of the position series). */
  readonly velocity: Velocity<'GCRF'>;
  readonly lightTime: LightTime;
  /** Physical mean radius used for angular-size computations, metres. */
  readonly radiusM: number;
}

export type EphemerisResult =
  | { readonly status: 'ok'; readonly state: EphemerisState }
  | { readonly status: 'unsupported'; readonly reason: string };

/**
 * A source of geocentric body positions. Implementations are replaceable: the Astronomy Engine
 * analytical theory today; JPL DE440 (via SPICE) is the intended authoritative upgrade.
 */
export interface Ephemeris {
  readonly model: ModelRef;
  /** Human-readable accuracy statement for provenance. */
  readonly accuracyStatement: string;
  state(body: BodyId, time: Instant, lightTime?: LightTime): EphemerisResult;
}
