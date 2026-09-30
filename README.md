# Simulation

**Simulation** is an open-source Earth and space simulation _environment_: an authoritative,
scientifically defensible model of the time, geometry, and physical conditions in which vehicles
will eventually operate — satellites, aircraft, balloons, lunar vehicles and others.

It is built environment-first. Vehicles obey the environment; the environment never bends to make a
picture look good.

> **Status: Phase 1 (environment) — in development.** Nothing in this repository lets you design or
> fly a vehicle yet, by intent. See [Phase 1](#phase-1) and [Out of scope](#out-of-scope-in-phase-1).

## Contents

- [What Simulation is](#what-simulation-is)
- [Phase 1](#phase-1)
- [Long-term vision](#long-term-vision)
- [Scientific-data philosophy](#scientific-data-philosophy)
- [Architecture](#architecture)
- [Development setup](#development-setup)
- [Validation philosophy](#validation-philosophy)
- [Repository layout](#repository-layout)
- [Documentation](#documentation)
- [Licence](#licence)

## What Simulation is

A server-side **environment engine** plus a **web visualisation**. The engine owns one master
simulation clock, a rigorous set of reference frames and Earth-orientation models, ephemerides for
the Sun and Moon, real catalogued orbital objects propagated with SGP4, an atmosphere model, a
space-weather service, and an optional live-aircraft layer. It answers questions like:

```ts
environment.gravity.at(position, time);
environment.atmosphere.sample(position, time);
environment.sun.direction(position, time);
environment.eclipse.state(position, time);
environment.spaceWeather.at(time);
```

Every answer says what kind of thing it is (observed, propagated, modelled or simulated), where it
came from, how old the underlying data is, and which model produced it. If a query is outside what
the engine can honestly answer, it says **unsupported** — it does not guess.

The browser is a renderer. It is never the source of truth for any physical quantity.

## Phase 1

Phase 1 delivers the environment and nothing else. It is complete when you can open Simulation and:

1. see Earth oriented for the current _simulation_ time;
2. see correct Sun illumination and the day/night terminator;
3. see the Moon at a calculated position;
4. pause and accelerate simulation time;
5. load a controlled set of real catalogued orbital objects;
6. watch them propagate;
7. select an object and inspect its position, velocity, source epoch, reference frame, model and provenance;
8. query basic environmental state;
9. optionally display live aircraft in real-time mode;
10. inspect the source and freshness of every externally derived value;
11. reproduce the core calculations through automated tests;
12. compare important orbital calculations against an established reference implementation.

The live status of each item is tracked in [docs/phase-1-status.md](docs/phase-1-status.md).

### Out of scope in Phase 1

Spacecraft/aircraft/rocket/lander builders, propulsion design, component marketplace, mission
economy, game mechanics, AI assistant, anomaly detection, collision avoidance, user accounts,
multiplayer, achievements, and any fictional physics. These are deliberately absent.

## Long-term vision

Once the environment is trustworthy, vehicles are added on top of it: user-designed spacecraft,
satellites, aircraft, balloons and lunar vehicles that are integrated through the _same_ gravity,
atmosphere, illumination and time services that Phase 1 validates. A vehicle can never see a
different Earth from the one you inspect in the viewport. The bar for every later phase is the
same as for this one: provenance, reproducibility and validation before spectacle.

## Scientific-data philosophy

- **The environment is authoritative.** Future vehicles obey it. Nothing is faked for visual effect.
- **Prefer established science over novel code.** SGP4 comes from a maintained implementation;
  atmosphere from NRLMSISE-00; astronomical geometry and Earth-orientation algorithms follow the
  IAU/SOFA standard; orbital elements come from CelesTrak; space weather from GFZ/NOAA-derived
  datasets; aircraft from OpenSky.
- **Four kinds of state, never confused.** Every value is exactly one of:

  | Kind         | Meaning                                                                  |
  | ------------ | ------------------------------------------------------------------------ |
  | `OBSERVED`   | Measured/reported by an instrument or provider at a real time            |
  | `PROPAGATED` | An observed initial condition advanced by a published theory (e.g. SGP4) |
  | `MODELLED`   | Evaluated from an environment model (gravity, atmosphere, ephemeris)     |
  | `SIMULATED`  | Produced by Simulation's own dynamics (unused in Phase 1)                |

  A TLE/OMM is **not** a live spacecraft position. A modelled density is **not** a measurement.

- **Provenance everywhere.** One shared [provenance schema](packages/schemas/src/provenance.ts) —
  source, epoch, retrieval time, model, frame, data age, freshness, limitations — is attached to
  every environmental answer.
- **Honest failure.** Unsupported and unavailable are first-class results, not exceptions and not
  placeholders. The system stays usable when an external provider is down.
- **Explicit units, frames and time.** See [units policy](docs/units-policy.md),
  [reference frames](docs/reference-frames.md) and [time](docs/time.md).

## Architecture

```
 Scientific / data sources                 (CelesTrak · GFZ/NOAA · IERS · OpenSky · IAU/SOFA algorithms)
          │
          ▼
 Providers   (replaceable; cache, rate-limit, provenance)      packages/environment
          │
          ▼
 Environment engine   master clock · frames · Earth · Sun/Moon ·
                      SGP4 · atmosphere · gravity · eclipse    packages/environment + packages/physics
          │
          ▼
 Canonical simulation state  (typed, provenance-carrying)      packages/schemas
          │
          ▼
 API / realtime transport    (REST + WebSocket)                apps/server
          │
          ▼
 Web visualisation           (CesiumJS; display-only)          apps/web
```

Key rules: physics never imports rendering; the browser never computes authoritative state; every
provider and physics implementation sits behind an interface so it can be replaced. Full detail and
the reasoning behind each decision are in [docs/architecture.md](docs/architecture.md) and the
[architecture decision records](docs/adr/).

## Development setup

Requirements: **Node.js ≥ 22.12** (developed on 24) and npm ≥ 10. No other runtime is required.

```bash
git clone https://github.com/furyengi/simulation.git
cd simulation
npm ci
cp .env.example .env      # optional; nothing is required to run
npm run check             # format, lint, typecheck, unit tests
npm run validate          # validation cases against reference results
npm run dev               # server + web (see docs/development.md)
```

Configuration is via environment variables (see [.env.example](.env.example)). **Never commit
credentials**; `.env` is git-ignored and CI needs no secrets. The engine runs fully offline against
committed fixtures with `SIM_OFFLINE=1`.

Contribution rules are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Validation philosophy

A plausible-looking picture is not evidence. Validation is a first-class feature:

- Every scientific function that has an authoritative reference result is tested against it —
  IAU SOFA/ERFA test vectors, published worked examples, Vallado's SGP4 verification set, JPL
  Horizons ephemerides, the NRLMSISE-00 reference case.
- Cross-implementation comparison against Orekit (and GMAT where practical) lives in
  [`/validation`](validation/) with the initial conditions, frames, units, models, expected
  results and tolerances written down, and the differences explained rather than hidden.
- Tolerances are stated with a reason. A test that only passes because its tolerance was widened
  until it did is a defect.
- Performance is measured before it is optimised; object counts scale 100 → 1 000 → 10 000 only
  with benchmark evidence.

See [validation/README.md](validation/README.md).

## Repository layout

```
apps/server         Fastify server: clock authority, providers, REST + WebSocket
apps/web            CesiumJS viewer and engineering UI (display only)
packages/schemas    Shared types + zod schemas: provenance, results, clock, API contracts
packages/physics    Pure scientific core: time, units, frames, Earth, ephemerides, SGP4, atmosphere
packages/environment  Engine and providers: composes physics with external data
validation          Reproducible validation cases and reference data
docs                Architecture, policies, ADRs, data-source notes
```

## Documentation

- [Architecture](docs/architecture.md) · [ADRs](docs/adr/)
- [Units policy](docs/units-policy.md) · [Time](docs/time.md) · [Reference frames](docs/reference-frames.md)
- [Provenance](docs/provenance.md) · [Data sources](docs/data-sources.md)
- [Phase 1 status](docs/phase-1-status.md)

## Licence

Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). Third-party data and libraries
carry their own terms; see [docs/data-sources.md](docs/data-sources.md).
