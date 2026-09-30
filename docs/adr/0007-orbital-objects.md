# ADR 0007 — Orbital objects: CelesTrak OMM + SGP4 (`satellite.js`)

- Status: accepted
- Date: 2026-09-30

## Context

Phase 1 must load real catalogued objects and propagate them without pretending the result is a live
position. Options for elements: CelesTrak GP (public, OMM/TLE/CSV), Space-Track (account, stricter
terms). Options for SGP4: `satellite.js` (maintained port of Vallado's code), `ootk` (AGPL),
a WASM/C build, or our own implementation.

## Decision

- **Source:** CelesTrak GP as **OMM JSON** (the CCSDS standard; microsecond epochs; `REF_FRAME=TEME`,
  `TIME_SYSTEM=UTC`, `MEAN_ELEMENT_THEORY=SGP4` are checked, anything else is refused). TLE input is
  supported for validation. CelesTrak's usage policy (one download per 2-hour update; 403s and IP
  blocks otherwise) is enforced by the resource cache across restarts.
- **Propagator:** `satellite.js` 7.x (MIT). We call its low-level `sgp4(satrec, tsince)` with `tsince`
  computed from microsecond `Instant`s, because its OMM parser truncates the epoch to milliseconds
  (≈ 7 m of LEO motion). Improved operation mode is the default; AFSPC mode is available and is what
  Vallado's published reference output was generated in.
- **Output:** `PROPAGATED` state in TEME, converted to GCRF/ITRF by the engine's frame model.
  Provenance carries source, source epoch, retrieval time, model, frame, signed data age, and a
  freshness class (|age| ≤ 3 d FRESH, ≤ 14 d AGING, else STALE — a display convention, not an error bound).
- **Not done:** per-object accuracy estimates (no covariance in public OMM), manoeuvre modelling,
  SGP4-XP (not in `satellite.js`).

## Validation

Vallado's 33-case verification suite (636 vectors): 8 µm in improved mode except the documented
Lyddane case; Orekit 13.1.8: 0.08 mm. See `/validation/sgp4`, `/validation/orekit`.

## Consequences

- Positions are good to ~1 km at epoch and degrade by kilometres per day; the UI and API say so on every
  value. Replacing the element source (Space-Track) or propagator (SGP4-XP, numerical) means
  implementing the same provider/propagator interfaces.
- `satellite.js`'s WebAssembly bulk propagator was benchmarked and not adopted
  ([performance](../performance.md)).
