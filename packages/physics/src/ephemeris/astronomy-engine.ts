import * as Astronomy from 'astronomy-engine';
import { astroTimeTt } from '../frames/orientation';
import { position, velocity } from '../frames/transform';
import { type Instant } from '../time/instant';
import { METERS_PER_AU } from '../units';
import type { BodyId, Ephemeris, EphemerisResult, EphemerisState, LightTime } from './types';

/** IAU 2015 Resolution B3 nominal solar radius, m (exact by definition). */
export const SUN_RADIUS_M = 6.957e8;
/** IAU mean lunar radius, m (Archinal et al. 2018: 1737.4 km). */
export const MOON_RADIUS_M = 1.7374e6;

/** Half-width of the central-difference stencil used for velocities, s. */
const VELOCITY_HALF_STEP_S = 30;

const RADIUS_M: Record<BodyId, number> = { sun: SUN_RADIUS_M, moon: MOON_RADIUS_M };
const LIGHT_TIME: Record<BodyId, LightTime> = { sun: 'astrometric', moon: 'geometric' };

/** Geocentric position in metres, J2000 mean equator/equinox axes (treated as GCRF; see below). */
function geocentricM(body: BodyId, t: Instant): readonly [number, number, number] {
  const tt = astroTimeTt(t);
  // Astronomy Engine returns au in EQJ. EQJ differs from GCRF by the ~20 mas frame bias — 12 km at
  // the Sun, 3 cm at the Moon — far below the theory's own error, so it is not applied here.
  const v =
    body === 'sun'
      ? Astronomy.GeoVector(Astronomy.Body.Sun, tt, false) // light-time corrected, no aberration
      : Astronomy.GeoMoon(tt); // geometric
  return [v.x * METERS_PER_AU, v.y * METERS_PER_AU, v.z * METERS_PER_AU];
}

/**
 * Sun and Moon from Astronomy Engine (Don Cross, MIT): VSOP87 planetary theory and a truncated
 * lunar theory, documented by its author as agreeing with JPL to about one arcminute.
 * ADR 0006. Accuracy against JPL Horizons is measured in `/validation/ephemeris`.
 */
export class AstronomyEngineEphemeris implements Ephemeris {
  readonly model = {
    name: 'Astronomy Engine (VSOP87 Sun; truncated lunar series)',
    version: '2.1.19',
    reference: 'https://github.com/cosinekitty/astronomy',
  };
  readonly accuracyStatement =
    'Analytical theory; typically within ~1 arcminute of JPL DE (see validation/ephemeris for measured values).';

  state(body: BodyId, time: Instant): EphemerisResult {
    if (body !== 'sun' && body !== 'moon') {
      return { status: 'unsupported', reason: `Body "${String(body)}" is not implemented` };
    }
    const p = geocentricM(body, time);
    const before = geocentricM(body, time.plusSeconds(-VELOCITY_HALF_STEP_S));
    const after = geocentricM(body, time.plusSeconds(VELOCITY_HALF_STEP_S));
    const k = 1 / (2 * VELOCITY_HALF_STEP_S);
    const state: EphemerisState = {
      body,
      time,
      position: position('GCRF', p),
      velocity: velocity('GCRF', [
        (after[0] - before[0]) * k,
        (after[1] - before[1]) * k,
        (after[2] - before[2]) * k,
      ]),
      lightTime: LIGHT_TIME[body],
      radiusM: RADIUS_M[body],
    };
    return { status: 'ok', state };
  }
}
