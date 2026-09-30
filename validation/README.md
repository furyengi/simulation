# Validation

Validation is a first-class feature. Each case here compares Simulation against an authoritative
reference and records, in one place:

- **Initial conditions** and the simulation time(s) used;
- **Reference frames** and **units**;
- **Models** on both sides (ours and the reference's), with versions;
- **Expected results** and where they came from (paper, library test suite, tool, retrieval date);
- **Tolerances** with the reason for each;
- **Differences** found, with an explanation — not just a pass/fail.

Cases run under `npm run validate` (Vitest project `validation`) and in CI. Reference data is
committed verbatim under each case's `reference/` directory (never reformatted) with a `SOURCE.md`
giving its origin and retrieval date, so results are reproducible offline.

## Cases

| Case                                     | Question                                            | Reference                                  | Headline result                                                           |
| ---------------------------------------- | --------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| [ephemeris](ephemeris/README.md)         | Sun/Moon direction vs DE431                         | JPL Horizons (1972–2099)                   | Sun ≤ 2.8″, Moon ≤ 23.5″                                                  |
| [sgp4](sgp4/README.md)                   | SGP4 implementation                                 | Vallado verification suite (636 vectors)   | 8 µm; 964 m only for the documented Lyddane case                          |
| [interpolation](interpolation/README.md) | Error of client-side Hermite interpolation          | direct SGP4                                | closed-form step under-delivers for decaying orbits; verified step ≤ 25 m |
| [orekit](orekit/README.md)               | SGP4, frames, geodetic vs a flight-dynamics library | Orekit 13.1.8 (CI-generated)               | 0.08 mm; 2.6 cm at GEO; TEME definition 36 mas                            |
| [nrlmsise00](nrlmsise00/README.md)       | WASM build + wrapper vs the original                | C reference built in CI (2 100 conditions) | ≤ 1.0 × 10⁻⁶ relative                                                     |

Unit-level reference checks that live next to the code (`packages/*/test`) — ERFA/SOFA vectors and
the Vallado/Kelso/Seago/Cefola LEO case for frames, Somigliana's formula for gravity, a brute-force
numerical integration for the eclipse fraction — are cross-referenced from the relevant docs
([reference frames](../docs/reference-frames.md)).

## Adding a case

1. Obtain a reference result from an authoritative implementation or publication.
2. Commit the raw reference under `validation/<case>/reference/` with `SOURCE.md`.
3. Write `validation/<case>/<case>.test.ts` and a `README.md` with the items listed above.
4. State every tolerance and its justification; explain any residual difference.
