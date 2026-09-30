# Performance

Rule for this project: **measure before optimising, and scale object counts only with evidence.**
Simulation calculation cadence is independent of render cadence: the server computes ephemeris
_windows_ (batches of samples); the browser interpolates between them at display rate.

## Method

`npm run bench` (`packages/environment/bench/propagation.bench.ts`) loads a real CelesTrak group
(default `active`, 16 612 objects at the time of writing), then for N = 100, 1 000, 10 000 and the
whole catalogue measures, with medians of 3–9 runs:

1. building propagators from OMM;
2. propagating every object at one instant (raw SGP4);
3. the server's window computation: 30 samples × 60 s, GCRF, including TEME→GCRF conversion, **step
   fixed** (no verification) so the cost is comparable;
4. the wire cost of that window: JSON size and `JSON.stringify` time;
5. `satellite.js`'s WebAssembly bulk propagator over the same objects/dates;
6. the per-frame arithmetic the **browser** does to animate N objects (Hermite interpolation +
   quaternion rotation), which is the part that must fit in a 16 ms frame.

Latest results (machine details in [performance-results.md](performance-results.md)):

| Objects | Build (ms) | Propagate all, 1 instant (ms) | Window 30 × GCRF (ms) | per object-sample (µs) | Window JSON | `JSON.stringify` (ms) | WASM bulk (ms) | Browser interp. per frame (ms) |
| ------: | ---------: | ----------------------------: | --------------------: | ---------------------: | ----------: | --------------------: | -------------: | -----------------------------: |
|     100 |          5 |                           2.0 |                    14 |                    4.6 |     0.45 MB |                     6 |             14 |                           0.10 |
|   1 000 |         24 |                           3.2 |                   122 |                    4.1 |      4.5 MB |                    60 |             67 |                           0.08 |
|  10 000 |        135 |                          12.8 |                   825 |                    2.8 |       45 MB |                   703 |            715 |                            2.2 |
|  16 612 |        308 |                          23.7 |                 1 355 |                    2.7 |       75 MB |                 1 390 |          1 229 |                            2.9 |

## What the numbers say

- **Computation is not the problem.** SGP4 costs ≈ 1.3 µs per object per instant; a window
  including frame conversion ≈ 3–5 µs per object-sample. The whole 16 612-object catalogue × 30
  samples is 1.4 s on one core. Workers or batching would help only beyond that.
- **Transport is.** Positions and velocities as JSON are ≈ 150 bytes per sample: 45 MB and 0.7 s
  of serialisation for 10 000 objects. JSON is comfortable to ~1 000 objects (4.5 MB, 60 ms) and
  clearly wrong beyond a few thousand.
- **The browser's interpolation arithmetic is cheap:** 2.2 ms per frame for 10 000 objects. The
  unmeasured cost is Cesium's own per-point update and draw; it must be measured in the target
  browser before raising the viewer limit.
- **`satellite.js`'s WASM bulk propagator gives no advantage here** (715 ms vs 825 ms for 10 000
  × 30, and it does not include frame conversion) and works in `Date` milliseconds (≈ 7 m of LEO
  motion per ms), which would cost the microsecond-exact time handling. Not adopted.
- Verified step selection (`chooseVerifiedStep`, used by default for ≤ 64 objects) costs about 6×
  the propagation of the window it verifies; it is off for large batches, which use the closed-form
  step (see [interpolation validation](../validation/interpolation/README.md) for when that
  under-delivers).

## Current limits and the path to scale

| Stage                             | Status                                                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 viewer / API              | `POST /api/orbital/ephemeris` accepts ≤ 2 000 ids. Comfortable at the development catalogue (22 stations) and up to ~1 000 objects.                                                                     |
| Next step (justified by the data) | Binary window transport (`Float64Array`/`Float32` with per-window origin, ≈ 3–6× smaller, no `JSON.stringify`), and requesting only objects that are selected, near the view, or decimated by distance. |
| Then                              | Server-side per-window caching keyed by (object, start, step, frame); a worker pool for windows above ~50 ms; level-of-detail steps for distant/slow objects.                                           |
| Not needed yet                    | Moving propagation into the browser (forbidden by [ADR 0002](adr/0002-server-authoritative.md) in any case), GPU propagation, WASM propagators.                                                         |

Re-run the benchmark after any change to the propagation or window code and update the table.
