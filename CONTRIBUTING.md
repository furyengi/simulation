# Contributing to Simulation

Thanks for helping. Simulation is an accuracy-first project, so the bar for changes is
_justifiable_, not merely _working_.

## Ground rules

1. **The environment is authoritative.** Do not add visual-only physics. If the viewer needs a
   number, the engine computes it and the viewer displays it.
2. **No naked numbers in the scientific core.** Follow the [units policy](docs/units-policy.md):
   SI internally, branded types or unit-suffixed names in signatures, conversions only through
   `packages/physics/src/units.ts`.
3. **Explicit frames and time.** A position or velocity is always tagged with its frame; time is
   always an `Instant` from the master clock. Never call `Date.now()` in `packages/physics`
   (lint enforces this).
4. **Provenance is mandatory** for anything an external provider or a model produced. Use the shared
   schemas in `packages/schemas`. Never present propagated or modelled data as observed.
5. **Unsupported means unsupported.** Return `unsupported`/`unavailable` from
   `@simulation/schemas`; never fabricate a value to satisfy an interface.
6. **Cite sources.** A new constant, model or algorithm needs a reference in a comment or ADR
   (paper, standard, library docs) and a check of its licence.
7. **Test against an authority where one exists.** If a reference result is obtainable (SOFA/ERFA,
   Vallado, JPL Horizons, Orekit, GMAT, a model's own test case), a test must use it. State the
   tolerance and why.
8. **Scope discipline.** Phase 1 is the environment. Vehicle builders, game mechanics, accounts,
   multiplayer and the like are out of scope — see the README.

## Workflow

```bash
npm ci
npm run check        # format:check + lint + typecheck + tests
npm run validate     # validation cases (slower)
```

- Branch from `main`; keep commits small and logical, in the imperative mood
  (`Add SGP4 wrapper with OMM parsing`).
- Every PR: tests for new behaviour, updated docs, and no widened tolerance without an explanation
  in the PR description.
- Significant design choices get an ADR in `docs/adr/` (copy the latest one as a template).
- Formatting is Prettier; linting is ESLint with `typescript-eslint`. Both run in CI.

## Adding an external data provider

1. Read its documentation and terms (licence, attribution, rate limits, authentication).
2. Implement the provider interface in `packages/environment`; preserve `provider`,
   observation/model time, retrieval time, units and freshness on every value.
3. Cache appropriately and respect rate limits; the engine must keep working when the provider is
   unavailable.
4. Add a small committed fixture (with its retrieval date and source URL) so tests run offline.
5. Document it in `docs/data-sources.md`.

## Secrets

Never commit API keys, tokens or credentials. Use `.env` (git-ignored) locally; `.env.example` lists
the variable names only. CI does not need secrets.

## Reporting problems

Open an issue with the simulation time, inputs, expected result and its source. For suspected
scientific errors, a reference value from an authoritative source is the most useful thing you can
attach.
