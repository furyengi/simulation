# ADR 0011 — Validation strategy

- Status: accepted
- Date: 2026-09-30

## Context

A plausible picture is not evidence. We need validation that is reproducible offline, honest about
differences, and does not require a JVM or C toolchain on every developer machine.

## Decision

1. **Unit-level references next to the code**: ERFA/SOFA test vectors, Vallado's published examples,
   Somigliana's gravity formula, brute-force numerical integration of the eclipse fraction.
2. **`/validation` cases** for cross-implementation and independent-data comparisons, each with
   initial conditions, frames, units, models, expected results, tolerances and explained differences
   in its README, and raw reference data committed byte-for-byte (`-text` in `.gitattributes`) with a `SOURCE.md`.
3. **Reference generation in CI, comparison offline.** Orekit (Java) and the original NRLMSISE-00
   (C) are built and run by manually triggered GitHub Actions workflows; the output is committed
   and the normal `npm run validate` compares against it. Regeneration is a documented two-step
   process.
4. **Tolerances are stated with reasons**: either the published accuracy claim being verified, or the
   measured value plus a small margin as a regression guard — and the README says which.
5. **Findings are reported, not hidden.** During this phase validation found a wrong assumption
   about SGP4 velocity consistency (leading to verified interpolation steps), a 2.3 m error from the
   truncated nutation in Astronomy Engine, first tried for frames (leading to our own IAU 2006/2000B chain), and a
   mis-stated sidereal-angle agreement (corrected from 0 to 18 mas by a test).

| Case          | Reference                                            | Headline result                                            |
| ------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| Frames        | ERFA test suite; Vallado/Kelso/Seago/Cefola LEO case | 0.15 mas (5 mm); 1.1 cm                                    |
| Sun/Moon      | JPL Horizons DE431mx (1972–2099)                     | Sun ≤ 2.8″; Moon ≤ 23.5″                                   |
| SGP4          | Vallado verification suite                           | 8 µm (improved), 3.5 cm (AFSPC)                            |
| Interpolation | direct SGP4                                          | verified step ≤ 25 m for all tested orbits                 |
| Orekit        | Orekit 13.1.8                                        | SGP4 0.08 mm; frames 2.6 cm at GEO; TEME definition 36 mas |
| NRLMSISE-00   | original C code                                      | ≤ 1.0 × 10⁻⁶ relative                                      |

GMAT was not used; Orekit covers what Phase 1 computes.

## Consequences

Reference data is auditable in git; upgrades (new Orekit, DE440, NRLMSIS 2.1) are regenerate-and-diff.
