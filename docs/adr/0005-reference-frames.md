# ADR 0005 — Reference frames: GCRF, TEME, ITRF via IAU 2006/2000B

- Status: accepted
- Date: 2026-09-30

## Context

Orbital propagation (SGP4) works in TEME; Earth-fixed display and ground geometry need ITRF;
ephemerides are inertial (GCRF/EME2000). We need conversions that are explicit, tested and accurate
enough not to be the dominant error anywhere (SGP4 itself is ≥ 1 km).

## Options

1. Convert with `satellite.js` (GMST only; no polar motion, no UT1). Adequate for pictures; hides
   errors up to ~0.5 km.
2. Use Astronomy Engine's rotations. Its nutation is a 5-term truncation (tens of mas) and mixes
   obliquity models — measured 2.3 m error against Vallado's published test case.
3. Port the SOFA/ERFA algorithms (IAU 2006 precession, IAU 2000B nutation, ERA/GAST, polar motion).
4. CSPICE (WASM) with binary PCK kernels: authoritative, but heavy data distribution.

## Decision

Option 3, with IAU 2000B nutation (77 terms; generated from ERFA's table by
`packages/physics/scripts/generate-nut00b.mjs`) and EOP from IERS. Frames are `GCRF`, `TEME`, `ITRF`;
`Position<F>` types carry the frame. The TEME axis is pinned by GMST82 so the frame graph closes.
Velocities include the ω × r term for inertial ↔ ITRF.

## Validation

ERFA test vectors (model-identical functions to 1e-12…1e-16; 2000A-based functions within
the 2000A/2000B difference), full `c2t06a` matrix to 0.15 mas, and the Vallado et al. LEO test case
to 1.1 cm. See docs/reference-frames.md.

## Consequences

- We own ~150 lines of frame code plus a generated table, guarded by upstream test vectors.
- Upgrading to 2000A or applying celestial-pole offsets is a local change.
- Option 4 remains an upgrade path behind the same `FrameModel` interface.
