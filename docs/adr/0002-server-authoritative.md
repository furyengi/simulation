# ADR 0002 — Server-authoritative simulation; browser is a renderer

- Status: accepted
- Date: 2026-09-30

## Context

A globe viewer in the browser can easily become the place where physics happens ("just propagate in
JS at 60 fps"). That makes the visualisation the source of truth and makes every other consumer
(future vehicle simulation, tests, other clients) disagree with what the user sees.

## Decision

All environment state is computed by the engine on the server (`packages/physics` +
`packages/environment`). The browser:

- receives clock snapshots and displays a pure extrapolation of them;
- requests **ephemeris windows** (timestamped position + velocity samples in a stated frame) and
  interpolates between server-supplied samples for smooth animation;
- never imports `@simulation/physics`, and has no code path that produces a physical quantity the
  server did not send.

Simulation calculation cadence is independent of render cadence: the server computes windows on
demand and caches them; the client renders at display rate.

## Consequences

- Any client sees the same environment; future vehicles will call the same API.
- Latency: a window is requested ahead of need. At high time acceleration windows cover more
  simulation time with proportionally larger steps (bounded by an interpolation-error budget that is
  tested).
- Phase 1 has a single global simulation session (one clock). Multi-session support is deferred.
