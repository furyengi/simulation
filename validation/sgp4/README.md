# Validation: SGP4/SDP4 vs Vallado's verification suite

**Question:** does Simulation's SGP4 (satellite.js 7.1.0 behind `Sgp4Propagator`) reproduce the
reference implementation's output?

| Item             | Value                                                                                                                                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reference        | Vallado, Crawford, Hujsak, Kelso, "Revisiting Spacetrack Report #3", AIAA 2006-6753: `SGP4-VER.TLE` (33 element sets: near-Earth, 12 h/24 h resonant, Molniya, GEO, lunar-solar, decayed) and `tmatverDec2015.out` (MATLAB reference output) — see [SOURCE.md](reference/SOURCE.md) |
| Input            | TLEs, WGS-72 gravity constants (SGP4's own)                                                                                                                                                                                                                                         |
| Output frame     | TEME                                                                                                                                                                                                                                                                                |
| Units            | Reference in km and km/s; converted to SI (m, m/s) by the wrapper; compared in m and m/s                                                                                                                                                                                            |
| Vectors compared | 636 position/velocity pairs at the reference's tsince values (minutes since epoch), 0 … 1 845 100 min                                                                                                                                                                               |
| Models           | Ours: `satellite.js` `sgp4()` called with `tsince` computed from a µs-exact epoch, in _improved_ (`i`) and _AFSPC_ (`a`) operation modes. Reference: Vallado MATLAB, Dec 2015                                                                                                       |

## Results (2026-09-30)

| Mode                      | Worst position difference             | Note                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AFSPC (`a`)               | 3.5 cm (sat 23333)                    | All 33 cases. The reference was generated in this mode. The mm–cm residuals come from `json2satrec` truncating the OMM epoch to 1 ms when initialising deep-space terms (the TLE→OMM path used to select this mode). |
| Improved (`i`), default   | 8.1 µm (sat 33335) for 32 of 33 cases | Reference values are printed to 1e-8 km (10 µm), so this is agreement to the reference's own precision.                                                                                                              |
| Improved (`i`), sat 23599 | ≈ 964 m                               | The suite's "Lyddane bug" case (Ariane 42P+3 R/B, discontinuity of an `atan` argument beyond 280.5 min). AFSPC mode reproduces the historic behaviour; improved mode fixes it, so the modes differ _by design_.      |

## Interpretation and decisions

- The engine defaults to the **improved** mode: the AFSPC quirks are defects retained for
  compatibility with the operational catalogue software. Provenance records the mode.
- The test asserts both modes: `< 0.1 m` in AFSPC for all cases; `< 0.1 mm` in improved mode
  except 23599, whose 100 m – 2 km difference is asserted so an accidental change is noticed.
- This validates the SGP4 _implementation_, not the _accuracy of TLE/OMM data_ against reality
  (that is ≈ 1 km at epoch and worse thereafter, and is not something a verification suite tests).
- Two blocks of the reference output need care: catalogue number 20413 appears twice with
  different time spans, so blocks are matched to TLEs in file order; and the file's final line is a
  fragment of another record glued onto the last block, which the loader rejects because tsince
  must increase within a block.

Cross-implementation comparison against Orekit is a separate case (`validation/orekit`).
