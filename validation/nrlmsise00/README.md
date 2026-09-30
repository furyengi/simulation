# Validation: NRLMSISE-00 (WebAssembly build) vs the original C reference

**Question:** does the `nrlmsise-00` WebAssembly package behind `Nrlmsise00`, together with
Simulation's argument handling (km ↔ m, degrees, day-of-year/UT from an `Instant`, local solar
time), reproduce the reference C implementation?

| Item             | Value                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Reference        | C translation of the official NRL Fortran code, pinned commit, built and run in CI ([SOURCE.md](reference/SOURCE.md))                           |
| Conditions       | 2 100: day 1–355, UT 0/29 000/64 800 s, altitude 0–1 000 km, latitude −75…80°, longitude −150…100°, F10.7 70–220 sfu, Ap 3–100                  |
| Outputs compared | He, O, N₂, O₂, Ar, H, N, anomalous O number densities (m⁻³); total mass density (kg m⁻³); exospheric and local temperature (K) — 23 100 numbers |
| Units            | SI on both sides (the C model's metre/kilogram switch on; wrapper converts km/degrees)                                                          |
| Not compared     | The 3-hourly ap array (not exposed by the WASM wrapper): daily-Ap mode only; this is stated in every atmosphere result's limitations            |

## Results (2026-09-30)

| Output                   | Worst relative difference                     |
| ------------------------ | --------------------------------------------- |
| Species number densities | 3 × 10⁻⁸ … 1.0 × 10⁻⁶ (worst: Ar at 1 000 km) |
| Total mass density       | 1.5 × 10⁻⁷                                    |
| Temperatures             | 3 × 10⁻⁸                                      |

The two builds implement the same model: disagreement at the 10⁻⁸…10⁻⁶ level (rather than the
10⁻¹⁶ of pure rounding) points to numerical-precision differences in the WebAssembly build, not
to different physics. It is five to seven orders of magnitude below the model's own ≈ 10–20 %
(1σ) scatter against real thermospheric density, so it is immaterial — but it is recorded here
rather than assumed away.

This validates the **implementation and our wrapper**. It says nothing about how well NRLMSISE-00
matches the real atmosphere; that uncertainty is published in the model's literature and is
carried in the `limitations` of every atmosphere result.

The first reference case of the model's own documentation (day 172, 29 000 s, 400 km, 60° N, 70° W,
LST 16 h, F10.7 150, Ap 4) is additionally asserted to 7 digits in
`packages/physics/test/atmosphere.test.ts`.
