# Provenance

Every environment entity and important measurement can answer: _where did this number come from?_
The single schema is [`ProvenanceSchema`](../packages/schemas/src/provenance.ts).

## State kinds

| Kind         | Use for                                                                                                  | Never use for                   |
| ------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `OBSERVED`   | A value a provider reports as measured at a real time (e.g. a Kp index, an ADS-B report)                 | Anything computed by Simulation |
| `PROPAGATED` | An observed initial condition advanced by a published theory (SGP4 on an OMM)                            | Live spacecraft positions       |
| `MODELLED`   | Model evaluations: ephemeris theory, NRLMSISE-00, gravity field, eclipse geometry, EOP-based orientation | Measurements                    |
| `SIMULATED`  | Simulation's own dynamics for simulated entities (later phases)                                          | —                               |

## Fields

| Field               | Meaning                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `subject`           | Entity or quantity, e.g. `norad:25544`, `body:sun`                                           |
| `stateKind`         | See above                                                                                    |
| `source`            | `provider`, `dataset`, `url`, `license`, `attribution` — where the underlying data came from |
| `sourceEpochUtc`    | Epoch of the source data (OMM epoch, observation time, model input date)                     |
| `retrievedAtUtc`    | Wall-clock time Simulation obtained it; absent for bundled data                              |
| `simulationTimeUtc` | The simulation time the value is for                                                         |
| `model`             | `name`, `version`, `reference` of the algorithm that produced the value                      |
| `frame`             | Reference frame of a vector quantity                                                         |
| `dataAgeSeconds`    | **Signed** simulation time − source epoch; positive = extrapolating forward                  |
| `freshness`         | `FRESH`, `AGING`, `STALE`, `PREDICTED` (the provider itself flags a forecast), `UNKNOWN`     |
| `limitations`       | Plain-language caveats that change how the number should be used                             |

`dataAgeSeconds` (simulation-relative) and `retrievedAtUtc` (wall-relative) are deliberately
separate: replaying 2019 with a freshly downloaded 2026 OMM is a 7-year extrapolation that is not
"fresh" no matter when it was downloaded.

## Example: propagated ISS position

```
Object:              norad:25544 (ISS (ZARYA))
State type:          PROPAGATED
Orbital source:      celestrak  (GP/stations, OMM JSON)
Source epoch:        2026-09-30T08:12:41.000Z
Retrieved:           2026-09-30T15:02:11.000Z
Simulation time:     2026-09-30T18:00:00.000Z
Propagation model:   SGP4 (satellite.js 7.x)
Frame:               TEME → shown in GCRF/ITRF after conversion (IAU 2006/2000B, IERS EOP)
Data age:            +9 h 47 m 19 s (extrapolating forward from epoch)
Freshness:           FRESH
Limitations:         SGP4/OMM accuracy is ~1 km at epoch and degrades ~1–3 km/day; not a live measurement
```

## Rules

- Providers create provenance where data enters; the engine adds model and frame; nothing downstream
  edits the source fields.
- Derived values that combine several sources (e.g. an atmosphere sample using space-weather
  inputs) list **all** contributing provenance entries.
- If provenance cannot be determined, the value is not returned (`unavailable`).
