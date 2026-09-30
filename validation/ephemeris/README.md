# Validation: Sun and Moon ephemerides vs JPL Horizons

**Question:** how far is Simulation's Sun/Moon direction from the JPL DE431 ephemeris?

| Item                     | Value                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Simulation model         | Astronomy Engine 2.1.19 (VSOP87 Sun; truncated lunar series) via `AstronomyEngineEphemeris`; light-time-retarded (`astrometric`) positions |
| Reference                | JPL Horizons, DE431mx; topocentric ICRF astrometric RA/Dec ([SOURCE.md](reference/SOURCE.md))                                              |
| Epochs                   | 4 675 dates, every 10 days, 1972-01-01 … 2099-12-31 (the engine's supported range)                                                         |
| Frame                    | GCRF (ICRF axes). Site position: WGS 84 geodetic → ITRF → GCRF through `FrameModel`                                                        |
| Units                    | Angles in degrees on the reference side; compared as angular separation in arcseconds                                                      |
| Frame/EOP simplification | No EOP applied (UT1 ≡ UTC, no polar motion): moves the site by ≤ 0.4 km, i.e. ≤ 0.25″ of lunar parallax and ≪ 0.01″ for the Sun            |
| Known unmodelled         | ICRS ↔ J2000-mean-equator frame bias (≈ 17 mas), which Astronomy Engine does not use                                                       |

## Results (2026-09-30)

| Body | Max   | Mean  | RMS   | Worst epoch |
| ---- | ----- | ----- | ----- | ----------- |
| Sun  | 2.77″ | 0.77″ | 0.86″ | 2098-02-01  |
| Moon | 23.5″ | 13.2″ | 14.6″ | 2017-03-28  |

Both are inside Astronomy Engine's documented ~1′ (60″) accuracy, which is the claim the test
verifies. The Moon's error is dominated by a near-constant offset of ~13″ (0.2′); the 23.5″ maximum
is ≈ 44 km at the Moon's distance. That is negligible for
visualisation and for illumination geometry (the Moon subtends ~1800″), but it is **not** DE-grade:
do not use this ephemeris for occultation timing or lunar navigation. The provider interface
(ADR 0006) exists so a DE440-backed implementation can replace it.

## Tolerances

- `< 60″` — the published accuracy claim of the library (verified, not fitted).
- `Sun max < 3.5″`, `mean < 1.2″`; `Moon max < 30″`, `mean < 16″` — regression guards set just above
  the measured values so any change that worsens the ephemeris is caught.

Run: `npm run validate` (or `npx vitest run --project validation validation/ephemeris`).
