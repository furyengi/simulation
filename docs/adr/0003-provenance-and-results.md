# ADR 0003 — Shared provenance schema and explicit results

- Status: accepted
- Date: 2026-09-30

## Context

Users must be able to tell where a number came from, and propagated or modelled values must never be
mistaken for direct observations. Ad-hoc per-feature metadata would drift.

## Decision

`packages/schemas` defines, once:

- `StateKind`: `OBSERVED | PROPAGATED | MODELLED | SIMULATED`;
- `Provenance`: subject, state kind, source (provider, dataset, URL, licence, attribution),
  source epoch, retrieval time, simulation time, model (name, version, reference), frame, signed
  data age, freshness, limitations;
- `EnvResult<T>`: `ok(value, provenance[]) | unsupported(code, reason) | unavailable(code, reason)`;
- `Quantity`: `{ value, unit }` with a closed unit list.

Every environment query returns an `EnvResult`. Providers construct `Provenance` at the point data
enters the system and it travels with the value. The UI inspector renders provenance generically.

## Consequences

- "Unsupported" and "unavailable" are first-class and distinguishable: one is structural, the other
  depends on data availability and may change.
- Data age is signed (simulation time − source epoch) so extrapolation direction is explicit, and
  retrieval age (wall time) is kept separate from it.
- There is no place to put an unlabelled number; adding one requires changing the schema.
