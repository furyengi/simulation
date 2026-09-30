# Reference data: NRLMSISE-00, original C translation

- `nrlmsise00-reference.csv` — output of `validation/nrlmsise00/driver.c` linked with the C sources
  `nrlmsise-00.c`, `nrlmsise-00.h`, `nrlmsise-00_data.c` from https://github.com/magnific0/nrlmsise-00
  at commit `a5f81be6c8802e9014f94457b41d3484673e0bfb` (Dominik Brodowski's C translation of the
  official NRL Fortran code, release 20151122), compiled by `gcc -O0 -ffp-contract=off` on GitHub
  Actions ubuntu-latest, workflow `.github/workflows/nrlmsise-reference.yml` (run 36760428883,
  2026-09-30).
- `sources.sha256` — checksums of the three C files used.
- 2 100 conditions: 5 days of year × 3 UT × 7 altitudes (0–1000 km) × 5 latitudes × 4 longitudes ×
  4 solar/geomagnetic scenarios (thinned deterministically). SI output, daily-Ap mode, switches 1–23 on.
- The NRLMSISE-00 model itself: Picone, Hedin, Drob, Aikin, J. Geophys. Res. 107(A12), 2002,
  doi:10.1029/2002JA009430.
