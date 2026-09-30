# ADR 0008 — Atmosphere: NRLMSISE-00 via WebAssembly

- Status: accepted
- Date: 2026-09-30

## Context

`environment.atmosphere.sample(position, time)` must return density, temperature and pressure with
model metadata and input epoch, for later drag and atmospheric-flight use. Candidates: NRLMSISE-00
(classic, in every orbit-analysis tool), NRLMSIS 2.x (current, Fortran), JB2008 (needs different
indices), US Standard Atmosphere 1976 (static, no solar/geomagnetic dependence).

## Decision

NRLMSISE-00 through the `nrlmsise-00` npm package (Apache-2.0 WebAssembly build of Brodowski's C
translation of the official Fortran). It runs in-process, offline, deterministically, and needs
only F10.7 (previous day), 81-day F10.7 and daily Ap — all of which the space-weather service
provides with provenance (ADR 0009).

- Range: 0–1000 km geodetic altitude. Outside it the answer is `unsupported` (no extrapolation).
- Inputs are never invented: if F10.7/Ap are unavailable for a date (e.g. the long-range
  monthly-prediction era has no Ap forecast) the answer is `unavailable` with the reason.
- Pressure is **derived** (ideal gas from summed species densities) and labelled as such; it is not a
  model output.
- Known limitations are in every result: empirical model (typical 10–20 % 1σ density scatter, more
  in storms), daily-Ap only (the wrapper does not expose the 3-hourly ap array), climatology (no
  weather) below ~60 km.

## Validation

2 100 conditions (23 100 numbers) against the original C code built in CI: worst relative difference
1.0 × 10⁻⁶ (species at 1000 km), 1.5 × 10⁻⁷ density, 3 × 10⁻⁸ temperature. The model's first
documented test case is asserted to 7 digits. See `/validation/nrlmsise00`.

## Consequences / upgrade path

NRLMSIS 2.1 or JB2008 can be added behind the same `atmosphere` interface. Validation against real
density data (e.g. accelerometer-derived) is out of scope for Phase 1 and would be a separate study.
