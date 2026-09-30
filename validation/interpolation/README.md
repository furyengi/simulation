# Validation: client-side interpolation of server ephemeris windows

**Question:** the viewer animates between server-supplied samples with cubic Hermite interpolation.
How large is the error that introduces, and does the server's step selection keep it within the
requested tolerance?

| Item                | Value                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scheme              | Cubic Hermite on position + velocity samples (`hermitePosition`; identical arithmetic in `apps/web/src/interp.ts`, asserted equal by a unit test)                                          |
| Truth               | Direct SGP4 propagation at the interpolated instant (same TLE), TEME, metres                                                                                                               |
| Orbits              | ISS (LEO), GOES 14 (GEO), GPS BIIR-5 (12 h MEO, e = 0.012), Vallado 11801 (e = 0.73) and 16925 (e = 0.56) — the last two are deliberately harsh: perigee ≈ 150 km, strong drag, fast decay |
| Span / probes       | 2 days from epoch; seven fractions inside every interval                                                                                                                                   |
| Tolerance requested | 25 m                                                                                                                                                                                       |

## Results (2026-09-30)

| Orbit         | Closed-form step | error      | Verified step | error  |
| ------------- | ---------------- | ---------- | ------------- | ------ |
| ISS           | 171.9 s          | 25.25 m    | 154.4 s       | 16.4 m |
| GOES 14       | 600 s (cap)      | 2.6 m      | 600 s         | 2.6 m  |
| GPS BIIR-5    | 600 s (cap)      | 4.5 m      | 600 s         | 4.5 m  |
| Vallado 11801 | 124.4 s          | **54.8 m** | 58.2 s        | 22.5 m |
| Vallado 16925 | 129.3 s          | **57.5 m** | 56.0 s        | 22.8 m |

## Findings

1. The closed-form step (`suggestedStepSeconds`, from the h⁴/384 · max|x⁗| bound with
   max|x⁗| ≈ r_p ω_p⁴ — checked numerically to hold within 13 % for Kepler motion at any
   eccentricity) is accurate for near-Keplerian orbits: ISS lands at 25.25 m for a 25 m request.
2. It **under-delivers by ~2.2×** for the heavy-drag, rapidly decaying eccentric orbits. Two
   reasons: drag changes the orbit during the window, and **SGP4's velocity is not exactly
   d(position)/dt** for such orbits, which adds an error term that peaks at ⅓ and ⅔ of an interval
   rather than at the midpoint.
3. Therefore the server does not trust the closed form alone: `chooseVerifiedStep` measures the
   error against direct propagation at five interior fractions and refines the step by the h⁴
   law until the measured error is within tolerance (default for ≤ 64 objects). Windows report
   `interpolationErrorMeasuredM` (or `null` when only the closed form was used).
4. Every test asserts the verified step meets the tolerance, and that a 4× coarser step does not
   (the bound is meaningful, not vacuous).

Not covered here: the error of the _frame rotation_ interpolation (quaternion slerp of Earth
orientation). For a constant-rate rotation slerp is exact; the viewer test suite asserts 1e-12.
