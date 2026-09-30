import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadVerificationCases, runCase, type CaseResult } from './vallado';

const ref = (n: string): string => fileURLToPath(new URL(`./reference/${n}`, import.meta.url));
const cases = loadVerificationCases(ref('SGP4-VER.TLE'), ref('tmatverDec2015.out'));
const improved = cases.map((c) => runCase(c, 'i'));
const afspc = cases.map((c) => runCase(c, 'a'));

// The Lyddane-choice case: SGP4's "AFSPC" mode retains a quadrant bug in atan2 that the improved mode
// fixes, so the two modes legitimately differ for this satellite. See README.md.
const LYDDANE_CASE = '23599';

const worst = (rs: CaseResult[], skip: string[] = []): CaseResult =>
  rs
    .filter((r) => !skip.includes(r.satnum))
    .reduce((a, b) => (b.maxPositionErrorM > a.maxPositionErrorM ? b : a));

describe('SGP4 vs Vallado verification suite (AIAA 2006-6753)', () => {
  it('loads every reference block and compares 636 state vectors', () => {
    expect(cases.length).toBe(33);
    expect(improved.reduce((a, r) => a + r.rows, 0)).toBeGreaterThan(600);
  });

  it('AFSPC mode (the mode the reference was generated in) agrees to < 0.1 m in position and < 1e-4 m/s in velocity', () => {
    for (const r of afspc) {
      expect(r.maxPositionErrorM, `sat ${r.satnum}`).toBeLessThan(0.1);
      expect(r.maxVelocityErrorMps, `sat ${r.satnum}`).toBeLessThan(1e-4);
    }
  });

  it('improved mode (our default) agrees to < 1e-4 m everywhere except the documented Lyddane case', () => {
    for (const r of improved.filter((x) => x.satnum !== LYDDANE_CASE)) {
      expect(r.maxPositionErrorM, `sat ${r.satnum}`).toBeLessThan(1e-4);
      expect(r.maxVelocityErrorMps, `sat ${r.satnum}`).toBeLessThan(1e-5);
    }
    const l = improved.find((x) => x.satnum === LYDDANE_CASE)!;
    expect(l.maxPositionErrorM).toBeGreaterThan(100); // the modes really do differ here…
    expect(l.maxPositionErrorM).toBeLessThan(2_000); // …by about a kilometre, not more
  });

  it('records the measured worst cases', () => {
    const wa = worst(afspc);
    const wi = worst(improved, [LYDDANE_CASE]);
    console.log(
      `AFSPC worst: sat ${wa.satnum} ${wa.maxPositionErrorM.toExponential(2)} m; ` +
        `improved worst (excl. ${LYDDANE_CASE}): sat ${wi.satnum} ${wi.maxPositionErrorM.toExponential(2)} m`,
    );
  });
});
