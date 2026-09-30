# Reference data: JPL Horizons Sun and Moon tables

- Files: `Horizons_Sun.txt`, `Horizons_Moon.txt` — raw JPL Horizons (ssd.jpl.nasa.gov/horizons) output, unmodified.
- Obtained from: https://github.com/cosinekitty/astronomy (MIT licence), `generate/horizons/Sun.txt` and `Moon.txt`,
  commit `865d3da7d8112bbc7911238052c6af4aaf877181`. Retrieved 2026-09-30.
  (JPL's own servers were not reachable from the development network; the files are JPL's output as
  committed by the Astronomy Engine author for its own tests. The Horizons header inside each file
  records the generation date, 2019-04-12, and the ephemeris: DE431mx.)
- Quantity: topocentric **astrometric** ICRF (J2000) right ascension and declination, degrees,
  from the user-defined site in the header (East longitude 279.0°, geodetic latitude 29.0°,
  altitude 0.01 km), every 10 days from 1900-01-01 to 2100-01-01 UT. Astrometric = corrected for
  light-time only (no aberration, no refraction).
- JPL Horizons output is a US Government work product of NASA/JPL/Caltech; cite "JPL Horizons System".
