import { describe, expect, it } from 'vitest';
import { compareGeodetic, compareStates } from './orekit';

const c = compareStates();
const g = compareGeodetic();

describe('Simulation vs Orekit 13.1.8', () => {
  it('prints the measured differences', () => {
    const f = (s: { n: number; maxPosM: number; maxVelMps: number }) =>
      `n=${s.n} max position ${s.maxPosM.toExponential(3)} m, max velocity ${s.maxVelMps.toExponential(3)} m/s`;
    console.log(
      [
        `SGP4 TEME (satellite.js vs Orekit TLEPropagator): ${f(c.sgp4Teme)}`,
        `TEME→ITRF (our frames): ${f(c.temeToItrf)}`,
        `TEME→GCRF (our frames): ${f(c.temeToGcrf)}`,
        `ITRF→GCRF (pure frame algorithm): ${f(c.itrfToGcrf)}`,
        `GCRF→ITRF (pure frame algorithm): ${f(c.gcrfToItrf)}`,
        `per case: ${JSON.stringify(c.perCase)}`,
        `geodetic: ${JSON.stringify(g)}`,
      ].join('\n'),
    );
    expect(c.sgp4Teme.n).toBe(18);
    expect(g.n).toBeGreaterThan(5);
  });
});
