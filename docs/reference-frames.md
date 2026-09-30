# Reference frames and coordinates

Latitude/longitude, ECEF, ECI and TEME are never mixed casually. Every position or velocity in the
engine is a `Position<F>` / `Velocity<F>` carrying its frame `F`, in SI units, and every conversion
goes through [`FrameModel`](../packages/physics/src/frames/transform.ts).

## Frames

| Id     | Meaning                                                                                          | Inertial? |
| ------ | ------------------------------------------------------------------------------------------------ | --------- |
| `GCRF` | Geocentric Celestial Reference Frame — ICRS axes, Earth-centred. Frame bias included.            | yes       |
| `TEME` | True Equator, Mean Equinox of date. **The native frame of SGP4, TLE and OMM output.**            | quasi     |
| `ITRF` | International Terrestrial Reference Frame realised through IERS EOP. What most people call ECEF. | no        |

Geodetic coordinates (WGS 84 latitude, longitude, ellipsoidal height) are a _coordinate system_ on
`ITRF`, not a frame; see [`wgs84.ts`](../packages/physics/src/earth/wgs84.ts). Latitude is geodetic,
height is above the ellipsoid (not the geoid).

## Transformation chain

Classical equinox-based form of the IAU 2006/2000 reduction, following SOFA/ERFA algorithms:

```
r_ITRF = W · R3(GAST) · NPB · r_GCRF
r_ITRF = W · R3(GMST82)   · r_TEME
r_TEME = R3(GAST − GMST82) · NPB · r_GCRF
```

- **NPB** — frame bias + IAU 2006 (P03) precession + IAU 2000B nutation with the IAU 2006
  adjustments, in Fukushima–Williams form (`eraPfw06`, `eraNut00b`, `eraFw2m`). Evaluated at TT.
- **GAST** — Greenwich apparent sidereal time = ERA(UT1) + (GMST−ERA)(TT) + equation of the equinoxes.
- **GMST82** — IAU 1982 mean sidereal time (Vallado eq. 3-47), the angle SGP4 assumes.
- **W** — polar motion `R1(−yp)·R2(−xp)·R3(s′)` (`eraPom00`).
- **EOP** (UT1−UTC, xp, yp, LOD) come from IERS via CelesTrak's `EOP-*.csv` and are linearly
  interpolated (UT1−TAI is interpolated, not UT1−UTC, so leap seconds do not smear).

Velocities crossing inertial ↔ ITRF include the transport term `ω × r`, with
`ω = 7.292115146706979e-5·(1 − LOD/86400)` rad/s along the pole.

### Why TEME is treated specially

TEME's x-axis is defined here through the sidereal angle SGP4 uses (GMST82), so that
`TEME→ITRF` and `TEME→GCRF→ITRF` are the _same_ rotation and the frame graph closes exactly.
Compared with a pure 2006 mean-equinox axis this offsets TEME by `EqE + (GMST06 − GMST82)`;
the second term grows ≈ 2.6 mas/yr after 2000 (≈ 60 mas in 2026 ≈ 2 m at LEO). SGP4 itself is
accurate to ≥ 1 km, so this is invisible in practice, but it is stated here so nobody has to
rediscover it.

## Accuracy and known simplifications

| Simplification                                                    | Effect                      |
| ----------------------------------------------------------------- | --------------------------- |
| IAU 2000B (77 terms) rather than 2000A (1365) nutation            | ≲ 1 mas (≈ 3 cm at surface) |
| Celestial-pole offsets dX, dY not applied                         | ≲ 1 mas                     |
| Truncated complementary terms in the equation of the equinoxes    | ≲ 0.03 mas                  |
| Sub-daily EOP variations (ocean tides, libration) not applied     | ≲ 0.1 ms in UT1 ≈ 5 cm      |
| TDB − TT ignored                                                  | < 2 ms in ephemeris time    |
| No EOP available (out of coverage) → zeros, flagged `UNAVAILABLE` | ≲ 0.4 km at the equator     |

**Measured** against authoritative references (see `packages/physics/test` and `/validation`):

- SOFA/ERFA `c2t06a` full GCRS→ITRS matrix: max element difference 7.3 × 10⁻¹⁰ rad (0.15 mas, ≈ 5 mm).
- Vallado, Kelso, Seago, Cefola (AAS/AIAA SFM 2006) LEO test case, IAU-2000B row:
  1.1 cm position difference.
- ERFA `nut00b`, `pfw06`, `obl06`, `gmst06`, `era00`, `pom00`: agreement to the test suite's own
  tolerances (1e-12 … 1e-16).
- **Orekit 13.1.8** (IAU 2006/2000A CIO chain, fed the same EOP): pure ITRF ↔ GCRF 2.6 cm (0.13 mas)
  at GEO radius. TEME ↔ Earth-fixed/GCRF differ by ≈ 36 mas (1.2 m at LEO, 7 m at GEO) because the two
  tools define the TEME pole differently (IAU 1976/1980 vs 2006/2000B theory); see
  [validation/orekit](../validation/orekit/README.md).

## Why not Astronomy Engine for frames?

Astronomy Engine is used for Sun/Moon ephemerides ([ADR 0006](adr/0006-ephemerides.md)). Its
nutation is a 5-term truncation of IAU 2000B (good to ~50 mas), which showed up as a 2.3 m
disagreement with the published Vallado reference during development; it also composes a nutation
built on a different mean obliquity with its P03 precession. Frames therefore use our own
SOFA-algorithm implementation, validated to centimetres.
