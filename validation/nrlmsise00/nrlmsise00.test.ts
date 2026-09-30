import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { Instant, Nrlmsise00, degToRad, geodetic } from '@simulation/physics';

/**
 * Simulation's NRLMSISE-00 (WebAssembly build of the C translation, behind `Nrlmsise00`) vs the
 * original C translation compiled from a pinned commit by CI (see reference/SOURCE.md and
 * driver.c). Same grid of day of year, UT, altitude 0–1000 km, latitude, longitude, local solar time,
 * F10.7, 81-day F10.7 and Ap (daily-Ap mode, SI output).
 */

interface Row {
  doy: number;
  sec: number;
  altKm: number;
  latDeg: number;
  lonDeg: number;
  lst: number;
  f107A: number;
  f107: number;
  ap: number;
  He: number;
  O: number;
  N2: number;
  O2: number;
  Ar: number;
  rho: number;
  H: number;
  N: number;
  anomO: number;
  texo: number;
  t: number;
}

const rows: Row[] = readFileSync(
  fileURLToPath(new URL('./reference/nrlmsise00-reference.csv', import.meta.url)),
  'utf8',
)
  .split(/\r?\n/)
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const f = l.split(',').map(Number);
    return {
      doy: f[0]!,
      sec: f[1]!,
      altKm: f[2]!,
      latDeg: f[3]!,
      lonDeg: f[4]!,
      lst: f[5]!,
      f107A: f[6]!,
      f107: f[7]!,
      ap: f[8]!,
      He: f[9]!,
      O: f[10]!,
      N2: f[11]!,
      O2: f[12]!,
      Ar: f[13]!,
      rho: f[14]!,
      H: f[15]!,
      N: f[16]!,
      anomO: f[17]!,
      texo: f[18]!,
      t: f[19]!,
    };
  });

let msis: Nrlmsise00;
beforeAll(async () => {
  msis = await Nrlmsise00.create();
});

const rel = (a: number, b: number): number =>
  a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

describe('NRLMSISE-00: WebAssembly build vs the original C reference', () => {
  it('reference covers the whole grid', () => {
    expect(rows.length).toBeGreaterThan(2000);
    expect(new Set(rows.map((r) => r.altKm)).size).toBe(7);
    expect(new Set(rows.map((r) => r.doy)).size).toBe(5);
  });

  it('agrees on every output for every row (worst relative difference reported)', () => {
    const worstBy = new Map<string, { d: number; where: string }>();
    const check = (name: string, got: number, want: number, r: Row): void => {
      const d = rel(got, want);
      if (d > (worstBy.get(name)?.d ?? -1)) {
        worstBy.set(name, {
          d,
          where: `doy ${r.doy} sec ${r.sec} alt ${r.altKm} lat ${r.latDeg} lon ${r.lonDeg}`,
        });
      }
    };
    for (const r of rows) {
      // Year is irrelevant to the model; 2001 is not a leap year so doy → date is unambiguous.
      const t = Instant.fromUnixMillis(Date.UTC(2001, 0, r.doy) + r.sec * 1000);
      const res = msis.sample(
        geodetic(degToRad(r.latDeg), degToRad(r.lonDeg), r.altKm * 1000),
        t,
        { f107Sfu: r.f107, f107AvgSfu: r.f107A, apDaily: r.ap },
        { localSolarTimeHours: r.lst },
      );
      if (res.status !== 'ok') throw new Error(`row doy ${r.doy} alt ${r.altKm}: ${res.reason}`);
      const s = res.sample;
      expect(s.modelArguments.dayOfYear).toBe(r.doy);
      expect(s.modelArguments.secondsOfDayUt).toBeCloseTo(r.sec, 6);
      check('He', s.numberDensityM3.He, r.He, r);
      check('O', s.numberDensityM3.O, r.O, r);
      check('N2', s.numberDensityM3.N2, r.N2, r);
      check('O2', s.numberDensityM3.O2, r.O2, r);
      check('Ar', s.numberDensityM3.Ar, r.Ar, r);
      check('rho', s.totalMassDensityKgM3, r.rho, r);
      check('H', s.numberDensityM3.H, r.H, r);
      check('N', s.numberDensityM3.N, r.N, r);
      check('anomalousO', s.numberDensityM3.anomalousO, r.anomO, r);
      check('Texo', s.exosphericTemperatureK, r.texo, r);
      check('T', s.temperatureK, r.t, r);
    }
    console.log(
      [...worstBy]
        .map(([k, v]) => `${k.padEnd(11)} ${v.d.toExponential(2)}  (${v.where})`)
        .join('\n'),
    );
    expect(worstBy.size).toBe(11);
    // Measured worst relative differences: species ≤ 1.0e-6 (at 1000 km, where densities are tiny
    // and the model's exponentials amplify rounding), total mass density 1.5e-7, temperatures 3e-8.
    // Tolerances are ~3× those. The pattern (1e-8…1e-6, not 1e-16) indicates the WebAssembly build
    // differs from the reference in numerical precision (e.g. coefficient storage), not in logic; it
    // is 5–7 orders of magnitude below the model's own 10–20 % scatter.
    for (const k of ['He', 'O', 'N2', 'O2', 'Ar', 'H', 'N', 'anomalousO']) {
      expect(worstBy.get(k)!.d, k).toBeLessThan(3e-6);
    }
    expect(worstBy.get('rho')!.d).toBeLessThan(5e-7);
    expect(worstBy.get('Texo')!.d).toBeLessThan(1e-7);
    expect(worstBy.get('T')!.d).toBeLessThan(1e-7);
  });
});
