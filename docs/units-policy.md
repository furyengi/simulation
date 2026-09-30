# Units policy

Ambiguous numbers are how spacecraft get lost. Simulation's rule: **a number with a physical
meaning always has a unit you can see.**

## Rules

1. **SI inside the scientific core.** `packages/physics` computes in metres, seconds, kilograms,
   radians, kelvin and pascals. Angles are radians. There are no exceptions inside the core.
2. **Other units live at boundaries only** — parsing external data (km, degrees, arcseconds, hours,
   au, revolutions/day) and serialising for humans or the wire. Every conversion goes through
   [`units.ts`](../packages/physics/src/units.ts) and is tested.
3. **Public signatures carry units** — via branded types (`Meters`, `Seconds`, `Radians`,
   `MetersPerSecond`, …) or, for object fields, unit-suffixed names (`heightM`, `latRad`,
   `rotationRateRadS`). A bare `number` in a public physics signature is a defect unless it is
   dimensionless, and then its name says so.
4. **Frames are part of the type.** `Position<'ITRF'>` cannot be passed where `Position<'GCRF'>`
   is required. See [reference-frames.md](reference-frames.md).
5. **The wire format is explicit.** Anything that leaves the engine either uses a unit-suffixed
   field name or a `{ value, unit }` [`Quantity`](../packages/schemas/src/quantity.ts) from a closed
   list of unit symbols. Units in API responses are never implied by documentation alone.
6. **Constants cite their source and unit** (`WGS84.a`, `TT_MINUS_TAI_S`, `EARTH_ROTATION_RATE`).
7. **External data keeps its native units until parsed once**, at the provider boundary, into SI —
   and the provenance records the native unit and dataset.

## What branding does and does not do

Branded types are erased at runtime and arithmetic on them yields plain `number`, so they guard
_interfaces_, not every intermediate expression. Inside a function, re-brand results
explicitly (`meters(x)`); across a function boundary, the compiler checks. Reviewers are expected to
catch un-suffixed names in new code.

## Conventions

| Quantity         | Internal unit | Notes                                                                |
| ---------------- | ------------- | -------------------------------------------------------------------- |
| Length, position | m             | `km` only when parsing SGP4 output (satellite.js) or CelesTrak       |
| Velocity         | m/s           |                                                                      |
| Angle            | rad           | `deg`/`arcsec` at boundaries (`degToRad`, `arcsecToRad`)             |
| Time interval    | s             | `Seconds`                                                            |
| Time instant     | `Instant`     | integer µs since the Unix epoch, UTC; never a bare number            |
| Density          | kg/m³         | NRLMSISE-00 native g/cm³ converted at the wrapper                    |
| Number density   | m⁻³           | NRLMSISE-00 native cm⁻³ converted at the wrapper                     |
| Temperature      | K             |                                                                      |
| Pressure         | Pa            |                                                                      |
| Solar radio flux | sfu           | 1 sfu = 10⁻²² W m⁻² Hz⁻¹ (F10.7); kept in sfu as it is a model input |
