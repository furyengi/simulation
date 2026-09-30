# Phase 1 status

A feature is marked **done** only when its tests pass (and, for user-visible items, it has been
exercised in the running app). Updated 2026-09-30.

| #   | Definition-of-done item                                 | Status   | Evidence                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Earth oriented for simulation time                      | **done** | IAU 2006/2000B frames validated to 5 mm (ERFA) / 1.1 cm (Vallado) / 2.6 cm at GEO (Orekit); server sends orientation quaternions; viewer rotates the world with them. Client-rendered ECEF positions match server ITRF states to ≈ 8 m (ISO-ms truncation of the test). |
| 2   | Sun illumination / day-night                            | **done** | Light direction = engine Sun direction; terminator checked against the local-time expectation; illumination/twilight classification and eclipse model tested (eclipse vs brute-force integration).                                                                      |
| 3   | Moon at calculated position                             | **done** | Astronomy Engine via `Ephemeris` interface; ≤ 23.5″ vs JPL Horizons DE431 over 1972–2099. Rendered at the engine position (no phase/orientation modelling — stated in the UI).                                                                                          |
| 4   | Pause and accelerate simulation time                    | **done** | Master clock (pause, resume, 1×, up to 10⁷×, seek, deterministic stepping); 20+ tests; UI controls verified in the app.                                                                                                                                                 |
| 5   | Load controlled set of real catalogued objects          | **done** | CelesTrak `stations` OMM (22 objects) by default; any CelesTrak group via `SIM_ORBITAL_GROUPS`; benchmarked with the full 16 612-object `active` catalogue.                                                                                                             |
| 6   | Watch them propagate                                    | **done** | SGP4 windows from the server, Hermite-interpolated in the viewer with a verified error bound (≤ 25 m tested); orbit and ground track for the selected object.                                                                                                           |
| 7   | Inspect selected object with provenance                 | **done** | Object inspector: position, velocity (GCRF/TEME/ITRF), source epoch, retrieval time, frame, model, data age, freshness, limitations, elements.                                                                                                                          |
| 8   | Query basic environmental state                         | **done** | `environment.{gravity,atmosphere,sun,eclipse,spaceWeather,earth,moon}` + REST + "Environment" inspector; explicit `unsupported`/`unavailable`.                                                                                                                          |
| 9   | Optional live aircraft                                  | **done** | OpenSky provider (anonymous/OAuth2, rate limits, 429 back-off); verified live (24 aircraft over Switzerland); disabled with a reason unless the clock is 1×, wall-paced and within 120 s of UTC.                                                                        |
| 10  | Inspect source and freshness of external data           | **done** | "Sources" tab and `/api/providers`: state, origin, retrieved time/age, next refresh, errors, attribution, licence; verified offline (fixtures) and online.                                                                                                              |
| 11  | Reproduce core calculations through automated tests     | **done** | `npm run check` (170 unit and contract tests) and `npm run validate` (20 validation tests), run in CI on Node 22 and 24.                                                                                                                                                |
| 12  | Compare against an established reference implementation | **done** | Orekit 13.1.8 (CI-generated reference, committed): SGP4 0.08 mm, frames 2.6 cm at GEO, geodetic 1e-8 m, TEME-definition offset 36 mas explained. Also Vallado suite, ERFA, JPL Horizons, original NRLMSISE-00 C.                                                        |

## Known limitations (honest list)

- **Not DE-grade ephemerides**: Moon up to 23.5″ (≈ 44 km) from JPL DE431; fine for display and
  illumination, not for lunar navigation. A DE440-backed provider is the planned upgrade (ADR 0006).
- **Gravity is the WGS 84 normal field** — no geoid undulation/anomalies (~1e-3 m/s²), no third-body
  terms.
- **Eclipse is geometric**, Earth-only, spherical (no oblateness, no atmosphere, no lunar shadow).
- **Atmosphere**: NRLMSISE-00 in daily-Ap mode; 0–1000 km; unavailable when F10.7/Ap are (e.g. the
  monthly-prediction era after the ~45-day forecast).
- **SGP4 accuracy** is ~1 km at epoch and degrades by km/day; every value is labelled `PROPAGATED`.
- **TEME↔GCRF** differs from Orekit's definition by ≈ 36 mas (7 m at GEO).
- **Transport**: JSON windows are comfortable to ~1 000 objects; the viewer/API cap is 2 000.
  Larger catalogues need binary transport ([performance](performance.md)).
- **Viewer**: no terrain (WGS 84 ellipsoid only), Moon drawn untextured without phase, star field and
  atmosphere glow are cosmetic, ground stations are a 3-site curated list, single global session.
- **Leap seconds**: `:60` is not representable (POSIX time); no leap second is assumed after the
  IERS list's expiry (2027-06-28).
- **Not implemented by design** (out of scope for Phase 1): vehicles, builders, accounts, multiplayer,
  game mechanics, AI, anomaly detection, collision avoidance.
