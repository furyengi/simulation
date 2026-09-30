# ADR 0004 — Time model: `Instant`, derived scales, one master clock

- Status: accepted
- Date: 2026-09-30

## Context

Subsystems quietly using different notions of time (JS `Date`, epoch-ms, Julian date, GPS week) is
a classic source of sub-second and one-second errors that only show up as "the satellite is 40 km
off".

## Decision

- Simulation time is a single `Instant`: integer microseconds since the Unix epoch, UTC on the
  POSIX scale. TAI, TT and UT1 are derived by explicit functions using the IERS leap-second table
  and EOP. Nothing else carries time across a boundary.
- One `SimulationClock` per engine. Its state is a serialisable snapshot; `evaluateClock(snapshot, wall)`
  is the single definition of the wall→simulation mapping, shared by server and browser.
- `pace: 'manual'` clocks ignore wall time, giving deterministic runs; `DeterministicRun` computes
  sample _n_ as `start + n·dt`.
- Lint forbids `Date.now()`, `new Date()` (no-arg) and `Math.random` in `packages/physics` outside
  the time module.
- Supported range 1972-01-01 … 2100-01-01.

## Alternatives considered

- Two-part Julian dates as the canonical time: precise, but unreadable, easy to mis-scale, and
  invites mixing UTC/TT JDs. Kept as a derived, scale-tagged form (`JulianDate`).
- BigInt nanoseconds: unnecessary; 1 µs is 7 mm of LEO motion, and a safe-integer double is exact.
- `astrotime` / Temporal: young or unavailable; the needed conversions are small and tested here.

## Consequences

- Leap-second instants (`:60`) are unrepresentable (POSIX behaviour); documented in docs/time.md.
- The last leap second predates the project; after the list's expiry (2027-06-28) none are assumed.
