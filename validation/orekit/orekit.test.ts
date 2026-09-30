import { describe, expect, it } from 'vitest';
import { compareGeodetic, compareStates, temeSiderealAngleDifferenceRad } from './orekit';

const c = compareStates();
const g = compareGeodetic();

/** GEO radius, m: converts a position difference to an angle. */
const R_GEO = 42_164_000;
const MAS = Math.PI / 648_000_000;

describe('Simulation vs Orekit 13.1.8 (reference generated in CI; see reference/SOURCE.md)', () => {
  it('compared 18 states (3 objects × 6 epochs) and 9 geodetic sites', () => {
    expect(c.sgp4Teme.n).toBe(18);
    expect(g.n).toBe(9);
  });

  it('SGP4 (satellite.js vs Orekit TLEPropagator): < 1 mm and < 1e-7 m/s — same algorithm, same constants', () => {
    // measured: 8.2e-5 m, 5.9e-9 m/s
    expect(c.sgp4Teme.maxPosM).toBeLessThan(1e-3);
    expect(c.sgp4Teme.maxVelMps).toBeLessThan(1e-7);
  });

  it('pure frame algorithm, ITRF ↔ GCRF, fed Orekit’s own EOP: < 0.1 m at GEO radius (≈ 0.5 mas)', () => {
    // measured: 2.6 cm (0.13 mas at 42 164 km), 1.9e-4 m/s. Orekit: IAU 2006/2000A CIO-based;
    // Simulation: IAU 2006/2000B equinox-based, no celestial-pole offsets.
    for (const s of [c.itrfToGcrf, c.gcrfToItrf]) {
      expect(s.maxPosM).toBeLessThan(0.1);
      expect(s.maxVelMps).toBeLessThan(1e-3);
      expect(s.maxPosM / R_GEO).toBeLessThan(0.5 * MAS);
    }
  });

  it('TEME ↔ ITRF/GCRF differ by a documented TEME-definition offset of ≈ 36 mas (< 60 mas)', () => {
    // Both codes rotate TEME to Earth-fixed by GMST82 (difference 0.0 mas, checked in README), but
    // Orekit's TEME pole derives from the IAU 1980 nutation theory and Simulation's from IAU 2006/2000B.
    // measured: 7.4 m at GEO (1.2 m at LEO) = 36 mas.
    for (const s of [c.temeToItrf, c.temeToGcrf]) {
      expect(s.maxPosM).toBeLessThan(12);
      expect(s.maxPosM / R_GEO).toBeLessThan(60 * MAS);
    }
    // …and it is a real, non-zero offset (a regression to "exactly equal" would mean the frames changed).
    expect(c.temeToGcrf.maxPosM).toBeGreaterThan(1);
  });

  it('TEME → Earth-fixed rotation about the pole: Orekit’s effective sidereal angle is within 25 mas of GMST82 (measured 18 mas)', () => {
    // The remainder of the ≈ 36 mas TEME offset is pole orientation, not the sidereal angle.
    expect(temeSiderealAngleDifferenceRad()).toBeLessThan(25 * MAS);
  });

  it('WGS 84 geodetic ↔ ECEF: forward < 1 µm, inverse exact to 1e-12 rad / 1 µm, from -400 m to GEO altitude', () => {
    expect(g.maxForwardM).toBeLessThan(1e-6);
    expect(g.ourInverse.latRad).toBeLessThan(1e-12);
    expect(g.ourInverse.lonRad).toBeLessThan(1e-12);
    expect(g.ourInverse.heightM).toBeLessThan(1e-6);
  });
});
