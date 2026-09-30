import { beforeAll, describe, expect, it } from 'vitest';
import {
  Instant,
  Nrlmsise00,
  dayOfYearAndSeconds,
  degToRad,
  geodetic,
  type Nrlmsise00Inputs,
} from '../src';

let msis: Nrlmsise00;
beforeAll(async () => {
  msis = await Nrlmsise00.create();
});

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);
const T = Instant.parse('2001-06-21T08:03:20Z'); // day 172, 29 000 s
const MODERATE: Nrlmsise00Inputs = { f107Sfu: 150, f107AvgSfu: 150, apDaily: 4 };
const at = (latDeg: number, lonDeg: number, altKm: number) =>
  geodetic(degToRad(latDeg), degToRad(lonDeg), altKm * 1000);

function ok(r: ReturnType<Nrlmsise00['sample']>) {
  if (r.status !== 'ok') throw new Error(`expected ok, got ${r.code}: ${r.reason}`);
  return r.sample;
}

describe('NRLMSISE-00 reference case', () => {
  it('reproduces the reference program output for its first test case (to 7 digits)', () => {
    // Inputs of the first case of the reference C program nrlmsise-00_test.c (Brodowski):
    // day 172, 29000 s, 400 km, 60°N, 70°W, LST 16 h, F10.7A = F10.7 = 150, Ap = 4.
    // Expected (SI; the C program prints cm⁻³ and g/cm³): the well-known published values
    //   He 6.665177e5  O 1.138806e8  N2 1.998211e7  O2 4.022764e5  Ar 3.557465e3 cm⁻³
    //   ρ 4.074714e-15 g/cm³   H 3.475312e4  N 4.095913e6  anomalous O 2.667273e4 cm⁻³
    //   Texo 1250.540 K   T(400 km) 1241.416 K
    const s = ok(msis.sample(at(60, -70, 400), T, MODERATE, { localSolarTimeHours: 16 }));
    expect(rel(s.numberDensityM3.He, 6.665177e11)).toBeLessThan(1e-6);
    expect(rel(s.numberDensityM3.O, 1.138806e14)).toBeLessThan(1e-6);
    expect(rel(s.numberDensityM3.N2, 1.998211e13)).toBeLessThan(1e-6);
    expect(rel(s.numberDensityM3.O2, 4.022764e11)).toBeLessThan(1e-6);
    expect(rel(s.numberDensityM3.Ar, 3.557465e9)).toBeLessThan(1e-6);
    expect(rel(s.totalMassDensityKgM3, 4.074714e-12)).toBeLessThan(1e-6);
    expect(rel(s.numberDensityM3.H, 3.475312e10)).toBeLessThan(1e-6);
    expect(rel(s.numberDensityM3.N, 4.095913e12)).toBeLessThan(1e-6);
    expect(rel(s.numberDensityM3.anomalousO, 2.667273e10)).toBeLessThan(1e-6);
    expect(rel(s.exosphericTemperatureK, 1250.54)).toBeLessThan(1e-6);
    expect(rel(s.temperatureK, 1241.416)).toBeLessThan(1e-6);
  });

  it('records the exact model arguments it used', () => {
    const s = ok(msis.sample(at(60, -70, 400), T, MODERATE, { localSolarTimeHours: 16 }));
    expect(s.modelArguments).toMatchObject({
      dayOfYear: 172,
      secondsOfDayUt: 29_000,
      altitudeKm: 400,
      geodeticLatDeg: expect.closeTo(60, 10),
      localSolarTimeHours: 16,
      f107Sfu: 150,
      f107AvgSfu: 150,
      apDaily: 4,
    });
  });
});

describe('NRLMSISE-00 physical consistency', () => {
  it('density falls monotonically with altitude from 100 to 1000 km', () => {
    let last = Infinity;
    for (let h = 100; h <= 1000; h += 50) {
      const rho = ok(msis.sample(at(30, 10, h), T, MODERATE)).totalMassDensityKgM3;
      expect(rho).toBeLessThan(last);
      last = rho;
    }
  });

  it('gives sea-level density ≈ 1.2 kg/m³ and T ≈ 288 K (standard-atmosphere sanity)', () => {
    const s = ok(msis.sample(at(45, 0, 0), Instant.parse('2001-03-20T12:00:00Z'), MODERATE));
    expect(s.totalMassDensityKgM3).toBeGreaterThan(1.1);
    expect(s.totalMassDensityKgM3).toBeLessThan(1.4);
    expect(s.temperatureK).toBeGreaterThan(270);
    expect(s.temperatureK).toBeLessThan(295);
    expect(s.pressurePa).toBeGreaterThan(0.95e5);
    expect(s.pressurePa).toBeLessThan(1.05e5);
  });

  it('ISS altitude (400 km) density is of order 1e-12 kg/m³ and rises strongly with solar activity', () => {
    const quiet = ok(msis.sample(at(20, 40, 400), T, { f107Sfu: 70, f107AvgSfu: 70, apDaily: 4 }));
    const active = ok(
      msis.sample(at(20, 40, 400), T, { f107Sfu: 200, f107AvgSfu: 200, apDaily: 4 }),
    );
    expect(quiet.totalMassDensityKgM3).toBeGreaterThan(1e-13);
    expect(active.totalMassDensityKgM3).toBeLessThan(1e-10);
    expect(active.totalMassDensityKgM3 / quiet.totalMassDensityKgM3).toBeGreaterThan(5);
    expect(active.exosphericTemperatureK).toBeGreaterThan(quiet.exosphericTemperatureK);
  });

  it('geomagnetic activity raises thermospheric density', () => {
    const calm = ok(msis.sample(at(60, 0, 400), T, { f107Sfu: 150, f107AvgSfu: 150, apDaily: 3 }));
    const storm = ok(
      msis.sample(at(60, 0, 400), T, { f107Sfu: 150, f107AvgSfu: 150, apDaily: 100 }),
    );
    expect(storm.totalMassDensityKgM3).toBeGreaterThan(calm.totalMassDensityKgM3 * 1.3);
  });

  it('shows a day/night contrast at 400 km', () => {
    // Same UT, longitudes 0° (local noon) vs 180° (local midnight).
    const t = Instant.parse('2001-06-21T12:00:00Z');
    const noon = ok(msis.sample(at(0, 0, 400), t, MODERATE)).totalMassDensityKgM3;
    const midnight = ok(msis.sample(at(0, 180, 400), t, MODERATE)).totalMassDensityKgM3;
    expect(noon / midnight).toBeGreaterThan(1.5);
  });

  it('derives pressure from the ideal-gas law consistently', () => {
    const s = ok(msis.sample(at(10, 20, 200), T, MODERATE));
    const n = s.numberDensityM3;
    const total = n.He + n.O + n.N2 + n.O2 + n.Ar + n.H + n.N;
    expect(rel(s.pressurePa, 1.380649e-23 * s.temperatureK * total)).toBeLessThan(1e-12);
  });
});

describe('NRLMSISE-00 refuses rather than invents', () => {
  it('is unsupported above 1000 km and below 0 km, with explicit reasons', () => {
    const above = msis.sample(at(0, 0, 1_000.001), T, MODERATE);
    expect(above).toMatchObject({ status: 'unsupported', code: 'ABOVE_MODEL_RANGE' });
    const below = msis.sample(at(0, 0, -0.5), T, MODERATE);
    expect(below).toMatchObject({ status: 'unsupported', code: 'BELOW_MODEL_RANGE' });
    expect(msis.sample(at(0, 0, 35_786), T, MODERATE).status).toBe('unsupported');
  });

  it('rejects non-physical space-weather inputs', () => {
    const r = msis.sample(at(0, 0, 300), T, { f107Sfu: NaN, f107AvgSfu: 100, apDaily: 5 });
    expect(r).toMatchObject({ status: 'unsupported', code: 'INVALID_SPACE_WEATHER' });
    expect(msis.sample(at(0, 0, 300), T, { f107Sfu: -1, f107AvgSfu: 100, apDaily: 5 }).status).toBe(
      'unsupported',
    );
  });
});

describe('dayOfYearAndSeconds', () => {
  it('handles year boundaries and leap years', () => {
    expect(dayOfYearAndSeconds(Instant.parse('2026-01-01T00:00:00Z'))).toEqual({ doy: 1, sec: 0 });
    expect(dayOfYearAndSeconds(Instant.parse('2026-12-31T23:59:59Z'))).toEqual({
      doy: 365,
      sec: 86_399,
    });
    expect(dayOfYearAndSeconds(Instant.parse('2024-12-31T12:00:00Z'))).toEqual({
      doy: 366,
      sec: 43_200,
    });
    expect(dayOfYearAndSeconds(Instant.parse('2001-06-21T08:03:20Z'))).toEqual({
      doy: 172,
      sec: 29_000,
    });
  });
});
