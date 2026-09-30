# ADR 0009 — External data: providers, caching, offline behaviour

- Status: accepted
- Date: 2026-09-30

## Context

Orbital elements, space weather, Earth-orientation parameters and aircraft come from third parties
with different licences, rate limits and failure modes. The system must stay usable when any of them
is down, must never hide how old a value is, and must not abuse the services.

## Decision

Every provider sits behind the same pattern:

1. **One `ResourceCache`** (disk-backed, atomic writes) performs all fetches. A cached copy younger
   than the provider's `minRefreshSeconds` is served without a network call — **persisted across
   restarts**, so restarting the server cannot bypass a rate limit (CelesTrak: once per 2 h).
2. On refresh failure (or `SIM_OFFLINE=1`) the last good copy is served and flagged `stale`/`offline`.
3. With no cache, a **committed, dated fixture** is used and flagged `fixture`.
4. Only with none of these is a dependent query `unavailable`.
5. Provenance always uses the **retrieval time of the bytes actually served**, never "now", and a
   signed data age relative to _simulation_ time. `ProviderStatus` (state, origin, retrieved, age,
   next refresh time, last error, attribution, licence) is exposed at `/api/providers` and in the UI
   "Sources" tab.
6. Responses are validated (zod / format checks) before caching; malformed records are skipped and
   counted, never repaired.

| Provider          | Data                                 | Notes                                                                                                    |
| ----------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| CelesTrak GP      | OMM element sets                     | ≤ 1 request / 2 h / group                                                                                |
| CelesTrak SW CSV  | F10.7, Kp, Ap (GFZ, NRC, NOAA, NASA) | rows flagged OBS/INT/PRD/PRM; forecasts are `PREDICTED`, never `OBSERVED`; full history loaded on demand |
| NOAA SWPC         | near-real-time Kp, F10.7             | "nowcast" only; not model drivers                                                                        |
| CelesTrak EOP CSV | UT1−UTC, xp, yp, LOD, ΔAT (IERS)     | out of coverage → zeros and `UNAVAILABLE`                                                                |
| OpenSky           | aircraft state vectors               | anonymous or OAuth2; self rate-limit; 429 back-off; see ADR 0010 for validity rules                      |

Secrets (OpenSky client credentials) are read from environment variables only; nothing is logged or
committed. Fixtures live in `packages/environment/data/fixtures` with `manifest.json` (URL,
retrieval time, size, SHA-256) and are produced by `scripts/refresh-fixtures.mjs`.

## Consequences

- The app works with no network at all (`SIM_OFFLINE=1`), with honest — and visibly old — data.
- Adding a provider means implementing `refresh()`/`lookup()`/`status()`, supplying a fixture and a
  test with a fake fetcher; no consumer changes.
