import { describe, expect, it } from 'vitest';
import {
  WGS84,
  WGS84_B,
  ZONAL_J,
  degToRad,
  earthShadowState,
  ecefToGeodetic,
  geodetic,
  geodeticToEcef,
  norm,
  normalGravity,
  solarConditionFromElevation,
  solarElevation,
  somiglianaSurfaceGravity,
  subSolarPoint,
  type Vec3,
} from '../src';

const deg = (d: number): number => degToRad(d);

describe('WGS84 geodetic <-> ECEF', () => {
  it('matches known points', () => {
    const eq = geodeticToEcef(geodetic(0, 0, 0));
    expect(eq[0]).toBeCloseTo(6_378_137, 6);
    expect(eq[1]).toBeCloseTo(0, 6);
    const np = geodeticToEcef(geodetic(Math.PI / 2, 0, 0));
    expect(np[2]).toBeCloseTo(6_356_752.314245, 5); // NGA.STND.0036 semi-minor axis b
    expect(WGS84_B).toBeCloseTo(6_356_752.314245, 5);
  });

  it('round-trips at all latitudes and heights from -1 km to lunar distance', () => {
    for (const lat of [-90, -89.9, -60, -30, 0, 0.001, 45, 89.999, 90]) {
      for (const lon of [-179.9, -90, 0, 33.3, 180]) {
        for (const h of [-1_000, 0, 1_000, 400_000, 35_786_000, 384_400_000]) {
          const g = geodetic(deg(lat), deg(lon), h);
          const [x, y, z] = geodeticToEcef(g);
          const back = ecefToGeodetic(x, y, z);
          expect(Math.abs(back.latRad - g.latRad)).toBeLessThan(1e-11);
          expect(Math.abs(back.heightM - h)).toBeLessThan(1e-3);
          if (Math.abs(lat) < 89.9) {
            const dLon = Math.abs(
              Math.atan2(Math.sin(back.lonRad - g.lonRad), Math.cos(back.lonRad - g.lonRad)),
            );
            expect(dLon).toBeLessThan(1e-11);
          }
        }
      }
    }
  });

  it('rejects the Earth centre', () => {
    expect(() => ecefToGeodetic(0, 0, 0)).toThrow();
  });
});

describe('WGS84 normal gravity', () => {
  it('derives the published WGS 84 ellipsoid zonal coefficients from the defining parameters', () => {
    // NGA.STND.0036 (2014): normalised C2,0 = -0.484166774985e-3 => J2 = 1.08262982131e-3;
    // J2n = -sqrt(4n+1) * C2n,0 for the higher terms.
    expect(ZONAL_J[2]).toBeCloseTo(1.08262982131e-3, 12);
    expect(ZONAL_J[4]).toBeCloseTo(-3 * 0.790303733511e-6, 10);
    expect(ZONAL_J[6]).toBeCloseTo(-Math.sqrt(13) * -0.168724961151e-8, 12);
    expect(ZONAL_J[8]).toBeCloseTo(-Math.sqrt(17) * 0.346098411e-11, 14);
  });

  it('agrees with Somigliana surface gravity on the ellipsoid at all latitudes (< 1e-7 m/s² = 0.01 mGal)', () => {
    for (let lat = -90; lat <= 90; lat += 7.5) {
      const p = geodeticToEcef(geodetic(deg(lat), deg(20), 0));
      const g = normalGravity(p);
      expect(Math.abs(g.gravityMagnitude - somiglianaSurfaceGravity(deg(lat)))).toBeLessThan(1e-7);
    }
  });

  it('reproduces the defining equatorial and polar gravity', () => {
    expect(normalGravity([WGS84.a, 0, 0]).gravityMagnitude).toBeCloseTo(9.7803253359, 7);
    expect(normalGravity([0, 0, WGS84_B]).gravityMagnitude).toBeCloseTo(9.8321849378, 7);
  });

  it('gravity is normal to the ellipsoid (equipotential surface)', () => {
    for (const lat of [10, 35, 60, 80]) {
      const g = geodetic(deg(lat), deg(-70), 0);
      const p = geodeticToEcef(g);
      const v = normalGravity(p).gravity;
      const up: Vec3 = [
        Math.cos(g.latRad) * Math.cos(g.lonRad),
        Math.cos(g.latRad) * Math.sin(g.lonRad),
        Math.sin(g.latRad),
      ];
      const cx = norm([
        v[1] * up[2] - v[2] * up[1],
        v[2] * up[0] - v[0] * up[2],
        v[0] * up[1] - v[1] * up[0],
      ]);
      // atan2 form: acos() loses ~1e-8 rad of resolution near zero.
      expect(Math.atan2(cx, -(v[0] * up[0] + v[1] * up[1] + v[2] * up[2]))).toBeLessThan(2e-9);
    }
  });

  it('decays toward the point-mass value with altitude', () => {
    const r = 42_164_000;
    const g = normalGravity([r, 0, 0]);
    const point = WGS84.gm / (r * r);
    // At GEO the J2 correction is ~4e-5 of the monopole; far away it must vanish.
    expect(Math.abs(norm(g.gravitation) - point) / point).toBeLessThan(1e-4);
    expect(Math.abs(norm(g.gravitation) - point) / point).toBeGreaterThan(1e-6);
    const far = normalGravity([1e11, 0, 0]);
    expect(Math.abs(norm(far.gravitation) - WGS84.gm / 1e22) / (WGS84.gm / 1e22)).toBeLessThan(
      1e-9,
    );
  });

  it('rejects points inside the reference ellipsoid', () => {
    expect(() => normalGravity([1_000_000, 0, 0])).toThrow(/inside/);
  });
});

describe('Sun geometry on the surface', () => {
  it('sub-solar point follows the direction; elevation is 90° there and 0° 90° away', () => {
    const sun: Vec3 = [
      1.4e11 * Math.cos(deg(23.4)) * Math.cos(deg(40)),
      1.4e11 * Math.cos(deg(23.4)) * Math.sin(deg(40)),
      1.4e11 * Math.sin(deg(23.4)),
    ];
    const ss = subSolarPoint(sun);
    expect(ss.latRad).toBeCloseTo(deg(23.4), 12);
    expect(ss.lonRad).toBeCloseTo(deg(40), 12);
    const zenith = solarElevation(geodetic(ss.latRad, ss.lonRad, 0), sun);
    expect(zenith).toBeCloseTo(Math.PI / 2, 5);
    // 90° of arc from the sub-solar point along the meridian: the Sun is on the horizon.
    const far = solarElevation(geodetic(ss.latRad - Math.PI / 2, ss.lonRad, 0), sun);
    expect(Math.abs(far)).toBeLessThan(deg(0.25)); // ellipsoid normal differs from radial by ≤ 0.19°
  });

  it('classifies twilight by the standard thresholds', () => {
    expect(solarConditionFromElevation(deg(10))).toBe('DAY');
    expect(solarConditionFromElevation(deg(-0.5))).toBe('DAY');
    expect(solarConditionFromElevation(deg(-1))).toBe('CIVIL_TWILIGHT');
    expect(solarConditionFromElevation(deg(-8))).toBe('NAUTICAL_TWILIGHT');
    expect(solarConditionFromElevation(deg(-15))).toBe('ASTRONOMICAL_TWILIGHT');
    expect(solarConditionFromElevation(deg(-30))).toBe('NIGHT');
  });
});

describe('Earth shadow (conical model, Montenbruck & Gill 3.4.2)', () => {
  const AU = 1.495978707e11;
  const R_SUN = 6.957e8;
  const sun: Vec3 = [AU, 0, 0];

  it('sunlit on the day side, umbra directly behind the Earth', () => {
    expect(earthShadowState([7_000_000, 0, 0], sun, R_SUN).condition).toBe('SUNLIT');
    const behind = earthShadowState([-7_000_000, 0, 0], sun, R_SUN);
    expect(behind.condition).toBe('UMBRA');
    expect(behind.illuminatedFraction).toBe(0);
  });

  it('terminator crossing at LEO: penumbra is a thin band, fractions are monotone in angle', () => {
    const r = 6_778_137;
    let last = 2;
    const conditions = new Set<string>();
    for (let a = 90; a <= 130; a += 0.01) {
      const p: Vec3 = [r * Math.cos(deg(a)), r * Math.sin(deg(a)), 0];
      const s = earthShadowState(p, sun, R_SUN);
      conditions.add(s.condition);
      expect(s.illuminatedFraction).toBeLessThanOrEqual(last + 1e-12);
      last = s.illuminatedFraction;
    }
    expect(conditions).toEqual(new Set(['SUNLIT', 'PENUMBRA', 'UMBRA']));
  });

  it('matches a brute-force numerical integration of the visible solar disc', () => {
    // Independent method: sample the solar disc on a fine grid, ray-test each sample direction
    // against the Earth sphere (exact spherical geometry, no small-angle approximation).
    const r = 6_778_137;
    const RE = WGS84.a;
    for (const a of [96.5, 97.2, 97.8, 98.1, 98.4]) {
      const p: Vec3 = [r * Math.cos(deg(a)), r * Math.sin(deg(a)), 0];
      const toSun: Vec3 = [sun[0] - p[0], sun[1] - p[1], sun[2] - p[2]];
      const d = norm(toSun);
      const u: Vec3 = [toSun[0] / d, toSun[1] / d, toSun[2] / d];
      const alpha = Math.asin(R_SUN / d);
      // orthonormal basis ⟂ u
      const e1: Vec3 = [-u[1], u[0], 0];
      const n1 = norm(e1);
      const b1: Vec3 = [e1[0] / n1, e1[1] / n1, 0];
      const b2: Vec3 = [
        u[1] * b1[2] - u[2] * b1[1],
        u[2] * b1[0] - u[0] * b1[2],
        u[0] * b1[1] - u[1] * b1[0],
      ];
      let total = 0;
      let visible = 0;
      const N = 400;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const x = ((i + 0.5) / N) * 2 - 1;
          const y = ((j + 0.5) / N) * 2 - 1;
          if (x * x + y * y > 1) continue;
          total++;
          const t = Math.tan(alpha);
          const dir: Vec3 = [
            u[0] + t * (x * b1[0] + y * b2[0]),
            u[1] + t * (x * b1[1] + y * b2[1]),
            u[2] + t * (x * b1[2] + y * b2[2]),
          ];
          const dn = norm(dir);
          const w: Vec3 = [dir[0] / dn, dir[1] / dn, dir[2] / dn];
          // does the ray p + s·w hit the sphere radius RE in front of the point?
          const bq = p[0] * w[0] + p[1] * w[1] + p[2] * w[2];
          const c = p[0] * p[0] + p[1] * p[1] + p[2] * p[2] - RE * RE;
          const disc = bq * bq - c;
          const hit = disc > 0 && -bq - Math.sqrt(disc) > 0;
          if (!hit) visible++;
        }
      }
      const numeric = visible / total;
      const analytic = earthShadowState(p, sun, R_SUN).illuminatedFraction;
      expect(Math.abs(numeric - analytic)).toBeLessThan(0.01);
    }
  });

  it('reports antumbra beyond the umbral cone tip and rejects points inside the Earth', () => {
    const far = earthShadowState([-1.6e9, 0, 0], sun, R_SUN);
    expect(far.condition).toBe('ANTUMBRA');
    // Earth appears smaller than the Sun: a ring remains; visible area fraction = 1 − (b/a)².
    const ratio = far.earthAngularRadiusRad / far.sunAngularRadiusRad;
    expect(far.illuminatedFraction).toBeCloseTo(1 - ratio * ratio, 12);
    expect(() => earthShadowState([1_000_000, 0, 0], sun, R_SUN)).toThrow();
  });
});
