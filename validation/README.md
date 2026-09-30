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

_Cases are added as each subsystem lands; see [docs/phase-1-status.md](../docs/phase-1-status.md)._

Unit-level reference checks that live next to the code (`packages/*/test`) — SOFA/ERFA vectors for
frames, Vallado's worked example — are cross-referenced from each case's write-up.

## Adding a case

1. Obtain a reference result from an authoritative implementation or publication.
2. Commit the raw reference under `validation/<case>/reference/` with `SOURCE.md`.
3. Write `validation/<case>/<case>.test.ts` and a `README.md` with the items listed above.
4. State every tolerance and its justification; explain any residual difference.
