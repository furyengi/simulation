# ADR 0001 — TypeScript monorepo with a pure physics core

- Status: accepted
- Date: 2026-09-30

## Context

The project needs a browser front end, a simulation backend, scientific services, shared schemas, tests
and documentation. Options: (a) Python backend (Astropy, SGP4, pymsis, Skyfield) + TypeScript
front end; (b) Java (Orekit) backend; (c) TypeScript everywhere with maintained scientific
libraries.

## Decision

TypeScript on Node.js (≥ 22.12, developed on 24) throughout, in an npm-workspaces monorepo:
`schemas`, `physics`, `environment`, `server`, `web`, `validation`. Internal packages export their
TypeScript source directly (no build step between packages); Vite, Vitest and `tsx` consume it.

Scientific dependencies are chosen for maintenance and licence:

| Need          | Choice                                                    | Note                                                         |
| ------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| SGP4/SDP4     | `satellite.js` (MIT)                                      | Port of Vallado's reference code; validated in `/validation` |
| Sun/Moon      | `astronomy-engine` (MIT)                                  | ADR 0006                                                     |
| Frames / EOP  | Own implementation of the IAU 2006/2000 (SOFA) algorithms | ADR 0005; validated against ERFA test vectors                |
| Atmosphere    | NRLMSISE-00 via `nrlmsise-00` (Apache-2.0 WASM build)     | ADR 0008                                                     |
| Visualisation | CesiumJS (Apache-2.0)                                     | ADR 0010                                                     |

Cross-implementation validation against Orekit (Java) and GMAT is run as _reference generation_ in
CI, with results committed as data (ADR 0011) — the runtime does not need a JVM.

## Consequences

- One language and toolchain; shared types end-to-end; the same pure clock function runs in server
  and browser.
- No Python/Java on developer machines is required to build or run the project.
- Some scientific components (frames) are implemented locally instead of imported from a mature
  library, because no maintained JS/TS implementation of IAU 2006 exists; the cost is mitigated by
  following SOFA algorithms exactly and testing against SOFA's own vectors.
- If a Python/Java service becomes preferable for a component later, the provider/engine
  interfaces allow replacing it without touching consumers.
