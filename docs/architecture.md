# Architecture

## Principles

1. **Physics is separate from visualisation.** The browser is a renderer, never the authoritative
   simulation engine. `packages/physics` and `packages/environment` have no dependency on any
   rendering code.
2. **The environment is authoritative.** Vehicles (a later phase) will call the environment API; they
   will not carry private physics.
3. **Providers and models are replaceable.** External data sources and physics implementations sit
   behind interfaces. Swapping CelesTrak for Space-Track, `astronomy-engine` for JPL DE440, or
   NRLMSISE-00 for NRLMSIS 2.x must not change any consumer.
4. **Everything carries provenance.** One shared schema; no per-feature re-implementations.
5. **Honest results.** `ok | unsupported | unavailable`, never a fabricated value.

## Data flow

```
 Scientific / data sources
   CelesTrak (OMM) · CelesTrak/GFZ/NOAA (space weather) · IERS (EOP) · OpenSky · IAU/SOFA algorithms
        │
        ▼
 Providers                                    packages/environment/src/providers
   fetch · validate (zod) · cache (disk + memory) · rate-limit · stamp provenance
        │
        ▼
 Environment engine                           packages/environment/src/engine
   ┌─────────────────────────────────────────────────────────────────────────────┐
   │ MasterClock ──► every subsystem receives an Instant, never reads a clock    │
   │ FrameModel · Earth (WGS84, orientation) · Ephemeris (Sun/Moon) · Gravity    │
   │ Eclipse · Atmosphere (NRLMSISE-00) · SpaceWeather · Orbital (SGP4) · Aircraft│
   └─────────────────────────────────────────────────────────────────────────────┘
        │  physics (pure, no I/O):  packages/physics
        ▼
 Canonical simulation state                   packages/schemas
   typed values + Provenance; EnvResult = ok | unsupported | unavailable
        │
        ▼
 API / realtime transport                     apps/server
   REST (queries, ephemeris windows) · WebSocket (clock snapshots, layer status)
        │
        ▼
 Web visualisation                            apps/web
   CesiumJS; displays engine state; interpolates engine-supplied samples for smooth motion
```

## Packages

| Package                   | Responsibility                                                                                                                                                              | May depend on          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `@simulation/schemas`     | Types + zod schemas: state kinds, provenance, results, clock, API contracts                                                                                                 | zod                    |
| `@simulation/physics`     | Pure computation: time scales, clock math, units, frames, Earth, ephemerides, SGP4 wrapper, atmosphere wrapper, gravity, eclipse. **No I/O, no wall-clock, deterministic.** | schemas, sci libraries |
| `@simulation/environment` | Engine and providers: composes physics with data; implements the query API                                                                                                  | physics, schemas       |
| `@simulation/server`      | HTTP/WebSocket API, master-clock authority, cache directory, config                                                                                                         | environment, schemas   |
| `@simulation/web`         | CesiumJS viewer + engineering UI                                                                                                                                            | schemas only (types)   |
| `@simulation/validation`  | Reference-result comparison suites                                                                                                                                          | everything             |

The web app depends on `@simulation/schemas` (types and the pure clock-evaluation helper), **not** on
`@simulation/physics`. It has no way to compute environment state; it can only display what the
server sends.

## Master clock and time flow

The server owns the `SimulationClock`. Clients receive `ClockSnapshot` messages and display
`evaluateClock(snapshot, wallMs)` (the same pure function the server uses) so the UI advances
smoothly without polling. Snapshots carry a `revision`; a client always adopts the highest revision.
Time-dependent queries take an explicit `time` and default to the server clock's current time.

## Smooth motion without a browser physics engine

Rendering at 60 Hz must not mean computing physics at 60 Hz, nor in the browser. The server computes
**ephemeris windows**: batches of timestamped states (position and velocity, in a stated frame)
covering a span of simulation time at a step chosen from the object's dynamics. The client
interpolates _between server-supplied samples_ (Hermite, using the supplied velocities) and requests
the next window before the current one is exhausted. Interpolation error is characterised and tested
(see `validation/`), and the UI labels interpolated positions as such. Accelerated time simply widens
the span the window covers.

## Query API (`environment.*`)

```ts
environment.clock.now(): Instant
environment.frames.convert(state, toFrame, time)
environment.earth.orientation(time)
environment.sun.direction(position, time)   // and .position(time)
environment.moon.position(time)
environment.eclipse.state(position, time)
environment.gravity.at(position, time)
environment.atmosphere.sample(position, time)
environment.spaceWeather.at(time)
environment.orbital.state(objectId, time)
environment.aircraft.snapshot()             // separate from simulated objects; live-mode only
```

Each returns `EnvResult<T>` with `Provenance[]`. Anything not supported by a model — e.g. NRLMSISE-00
above its validity ceiling, an unimplemented body — returns `unsupported` with a reason.

## Failure and freshness

Providers cache on disk with provider-appropriate TTLs (e.g. CelesTrak GP: never more than once per
2 hours, per its usage policy). If a refresh fails, the last good data is served and its
provenance says how old it is. With no data at all, dependent queries return `unavailable`. The
engine is usable offline against committed fixtures (`SIM_OFFLINE=1`).

## Decisions

Each significant decision is recorded in [docs/adr/](adr/). Start with
[ADR 0001](adr/0001-typescript-monorepo.md).
