# Validation: Simulation vs Orekit

Orekit (CS GROUP, Apache-2.0) is the established open-source flight-dynamics library we compare
against. The JVM is needed only to **generate** reference data: a manually triggered GitHub Actions
workflow (`.github/workflows/orekit-reference.yml`) runs the harness in this directory
(`src/main/java/sim/OrekitReference.java`, Orekit 13.1.8, Java 21) and the output is committed to
[`reference/`](reference/SOURCE.md). The everyday test run compares against it offline.

| Item            | Value                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Objects         | ISS (LEO, 51.6°), GOES 14 (GEO, i = 1.95°), GPS BIIR-5 (12 h MEO, e = 0.012) — real CelesTrak TLEs, 2026-09-30 ([inputs](inputs/tles.txt))                         |
| Epochs          | 0, 1, 6, 12, 24, 48 h from each element epoch (18 states)                                                                                                          |
| Orekit side     | `TLEPropagator` (SGP4/SDP4) → TEME; `FramesFactory` TEME, ITRF (IERS 2010, simple EOP — no sub-daily tides), GCRF                                                  |
| Simulation side | `Sgp4Propagator` (satellite.js 7.1.0, µs-exact epoch); `FrameModel` (IAU 2006/2000B, equinox-based)                                                                |
| EOP             | Orekit's own UT1−UTC, xp, yp, LOD at each instant are written into the reference and fed to Simulation, so frame differences are algorithmic, not data differences |
| Units           | SI throughout (m, m/s, rad, s)                                                                                                                                     |
| Geodetic        | 9 WGS 84 sites from −400 m to GEO altitude and ±90° latitude                                                                                                       |

## Results (2026-09-30, measured)

| Comparison                                    | Max difference                                  | Tolerance        | Reading                                                                                                         |
| --------------------------------------------- | ----------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| SGP4 TEME position / velocity                 | 0.08 mm / 6 × 10⁻⁹ m/s                          | 1 mm / 10⁻⁷ m/s  | Two independent ports of the same theory (Vallado) agree to rounding.                                           |
| **Pure frame algorithm** ITRF → GCRF and back | 2.6 cm (0.13 mas) at GEO radius; 1.9 × 10⁻⁴ m/s | 10 cm / 10⁻³ m/s | IAU 2006/2000B equinox chain vs Orekit's IAU 2006/2000A CIO chain. Consistent with the ERFA and Vallado checks. |
| TEME → ITRF / GCRF                            | 7.4 m at GEO (1.2 m at LEO) = **≈ 36 mas**      | 12 m (< 60 mas)  | A difference in the _definition of TEME_, explained below.                                                      |
| Geodetic → ECEF (WGS 84)                      | 1.2 × 10⁻⁸ m                                    | 1 µm             | Limited by the reference's printed precision.                                                                   |
| ECEF → geodetic (vs the exact input)          | 4 × 10⁻¹⁶ rad, 7 × 10⁻⁹ m                       | 10⁻¹² rad, 1 µm  | Orekit's own inverse: 10⁻¹⁶ rad, 10⁻⁹ m.                                                                        |

### The 36 mas TEME difference

TEME is not a precisely defined physical frame: it is "the frame SGP4 outputs", and software
differs in how it is tied to the Earth. Decomposing the difference (reproducible in
`temeSiderealAngleDifferenceRad`): the rotation about the pole that takes TEME to Earth-fixed
differs by up to **18 mas** between the two tools (Simulation pins TEME to GMST82; Orekit's TEME is
defined through the IAU 1980 equation of the equinoxes), and the remainder of the ≈ 36 mas is the
orientation of the pole itself — Orekit's TEME derives from the IAU 1976/1980 precession–nutation
theory, Simulation's from IAU 2006/2000B, like its ITRF and GCRF. Tens of mas between those theories
is expected. (The split into sidereal-angle and pole parts is an inference from these two
measurements, not a separate measurement of the pole.)

The consequence: converting an SGP4 state to GCRF/ITRF differs between the two tools by ≈ 1 m at
LEO and ≈ 7 m at GEO. SGP4 itself is accurate to ≥ 1 km, so this is far below the noise, but it is
stated here so nobody has to rediscover it. See [ADR 0005](../../docs/adr/0005-reference-frames.md).

## Not compared

Sun/Moon ephemerides (validated against JPL Horizons instead — [../ephemeris](../ephemeris/README.md)),
gravity (validated against Somigliana's formula; Orekit's EGM-based field includes anomalies the
normal field deliberately omits), eclipse geometry (validated against numerical integration), and
NRLMSISE-00 (validated against the original C implementation — [../nrlmsise00](../nrlmsise00/README.md)).
GMAT was not used; Orekit covers the quantities Phase 1 computes.

## Regenerating

1. Edit `inputs/tles.txt` or the harness if needed.
2. `gh workflow run orekit-reference.yml`, then `gh run download <id> -n orekit-reference`.
3. Replace `reference/orekit-reference.csv` (and update the run id in `reference/SOURCE.md`).
