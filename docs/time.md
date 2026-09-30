# Time

## One notion of time

Every environment quantity is a function of a single **simulation time**, owned by the master
clock ([`SimulationClock`](../packages/physics/src/time/clock.ts)). Subsystems never read
`Date.now()`; they receive an `Instant`. A lint rule forbids wall-clock reads in
`packages/physics` outside the time module.

The web client displays a _local extrapolation_ of the server's clock snapshot
(`evaluateClock(snapshot, wallMs)` — the same function the server uses), and the UI always shows the
current simulation timestamp. The server stays authoritative and publishes a new snapshot on every
state change.

## Representation: `Instant`

An `Instant` is an integer number of **microseconds since 1970-01-01T00:00:00Z on the POSIX
scale** (each day is exactly 86 400 s). Microsecond integers are exact in a double until ~2255.

- Leap-second instants (`23:59:60`) are not representable and are rejected on parse. Simulation
  time therefore skips over the inserted second exactly as POSIX does. The last leap second was
  2016-12-31; none are scheduled. This limitation affects only a one-second window per leap event.
- Other scales are _derived_ from an `Instant`, never stored:

| Scale | Definition                            | Used for                             |
| ----- | ------------------------------------- | ------------------------------------ |
| UTC   | the `Instant`                         | civil time, provider epochs, display |
| TAI   | UTC + ΔAT (integer leap-second count) | continuous time                      |
| TT    | TAI + 32.184 s                        | precession/nutation, ephemerides     |
| UT1   | UTC + (UT1−UTC) from IERS EOP         | Earth rotation angle                 |

TDB−TT (< 2 ms, periodic) is not distinguished; every TT consumer is insensitive to it.

ΔAT comes from the IERS/IANA `leap-seconds.list` (committed at
`packages/physics/data/leap-seconds.list`; a test asserts the in-code table equals it). Beyond the
list's expiry (2027-06-28) no further leap seconds are assumed — a documented assumption to revisit
if one is announced.

## Supported range

`1972-01-01T00:00:00Z` – `2100-01-01T00:00:00Z`. Before 1972 UTC used non-integer "rubber seconds";
after 2100 Earth-orientation and ephemeris accuracy is unspecified. Seeking outside the range is
rejected; a running clock clamps at the end and reports `atLimit()`.

Data coverage inside the range varies, and each subsystem reports it honestly:

- EOP (UT1−UTC, polar motion): observed to ≈ yesterday, IERS-predicted ≈ 180 days ahead. Outside
  the table the engine uses zeros and marks the result `UNAVAILABLE`; the worst case is a ≈ 0.4 km
  rotation error at the equator (|UT1−UTC| < 0.9 s).
- Space weather: observed history, NOAA/GFZ forecasts, then long-range monthly predictions.
- OMM/TLE-derived positions: accuracy decays with distance from the element epoch (see provenance
  `dataAgeSeconds`).

## Clock capabilities

- **UTC time** display and seeking to any supported instant.
- **Pause / resume**, with re-anchoring so changing rate or pausing never causes a jump.
- **1× real time** and **accelerated** (`rate` sim-seconds per wall-second, up to 10⁷).
- **Deterministic stepping**: `pace: 'manual'` ignores wall time entirely; time changes only via
  `step(seconds)` / `seek`. [`DeterministicRun`](../packages/physics/src/time/clock.ts) computes the
  _n_-th sample time as `start + n·dt` rather than by accumulation, so sample times are
  bit-identical across runs and machines.
- **Reproducible runs**: a run is fully described by its start `Instant`, step, and the dataset
  versions recorded in provenance; see [validation](../validation/README.md).
- **Sync to wall**: jump to the host's UTC and run at 1× (live mode). Live-data layers (aircraft)
  are enabled only while the clock is within a small tolerance of wall time, running at 1×.
