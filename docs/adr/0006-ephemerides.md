# ADR 0006 — Sun and Moon ephemerides

- Status: accepted (provider interface); implementation re-evaluated against measurements
- Date: 2026-09-30

## Context

We need Earth–Sun–Moon geometry at any supported simulation time. Authoritative ephemerides are the
JPL DE series (DE440/DE441). Distributing and evaluating them in JS/WASM is possible (SPICE
kernels, ~30–100 MB) but heavy for Phase 1.

## Decision

Define an `Ephemeris` interface (geocentric GCRF position/velocity of a named body at an `Instant`)
and implement it first with **Astronomy Engine** (MIT): VSOP87 for the Sun/planets and a truncated
lunar series, documented by its author as accurate to about one arcminute against JPL DE. The
interface takes a `BodyId` union so additional solar-system bodies can be added without changing
consumers.

Astronomy Engine is used **only** for ephemerides. Frames, sidereal time and Earth orientation do
not use it (ADR 0005). It depends on TT alone, which we supply exactly.

The implementation is validated in `/validation` against JPL Horizons vectors committed with their
query parameters and retrieval date. Measured errors are recorded there; if they are unacceptable
for a use case, a DE440-backed implementation replaces the provider without touching consumers.

## Consequences

- Sun/Moon geometry is `MODELLED` (analytical theory), with model name/version in provenance.
- No new data distribution requirement in Phase 1.
- The light-time convention used for the Sun direction is stated in provenance.
