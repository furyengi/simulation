# ADR 0010 — Visualisation (CesiumJS) and the aircraft layer

- Status: accepted
- Date: 2026-09-30

## Context

The viewer needs a credible globe without becoming the physics engine. Options: CesiumJS (mature,
WGS 84 ellipsoid, Apache-2.0), three.js + custom globe (novelty, no geodesy), deck.gl/MapLibre
globe (map-centric). The brief says not to write a custom globe for novelty.

## Decision

**CesiumJS 1.145** with vanilla TypeScript UI, rendering server state only:

- Bundled **Natural Earth II** imagery and **no terrain** (no ion token, no external tile requests);
  the surface is the WGS 84 ellipsoid, matching the engine. The default "Cesium ion" credit is replaced by
  a plain CesiumJS credit because no ion service is used.
- Cesium's own Sun and Moon ephemerides are disabled. Lighting is a `DirectionalLight` set each frame to
  the **engine's** Sun direction (ITRF), so the terminator is the engine's. The Moon and a Sun
  direction marker are drawn at engine positions. Cesium's clock is set to simulation time only so
  its decorative star field is oriented sensibly; the star field and "atmosphere glow" are labelled
  cosmetic in the UI.
- Earth orientation, Sun, Moon: server **bodies windows** (quaternions + ITRF positions), slerp/lerp.
  Objects: server **ephemeris windows** in GCRF (Hermite), rotated into the fixed world with the
  engine's quaternion. Orbit lines are drawn in GCRF and rotated by the same quaternion. The
  browser imports only the pure clock helper from the physics package (lint-enforced).
- The timestamp is always displayed; the clock mode (real-time, accelerated, paused, stepped) is shown.

**Aircraft layer (OpenSky).** Aircraft are separate entities (`icao24:…`) from simulated objects,
shown only when live data is semantically valid: the clock is wall-paced, running at exactly 1×, and
within 120 s of real UTC. Otherwise the layer is disabled with the reason. The UI and every payload state that coverage is
limited to OpenSky receivers and is not worldwide; anonymous quotas are tiny, so the viewer refuses to
request world-sized areas.

## Consequences

- Smooth animation at any time rate without browser-side physics; windows scale with the rate.
- Ground stations are a small curated NASA DSN list with explicit "approximate, transcribed" provenance.
- Not done in Phase 1: terrain, geoid-referenced heights, lunar orientation/phase texture, inertial
  camera mode.
