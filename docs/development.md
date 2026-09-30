# Development

## Requirements

Node.js ≥ 22.12 (developed on 24) and npm ≥ 10. No Python, Java or C toolchain is needed to build,
run or test. (Java/C are used only by the manually triggered CI workflows that generate validation
reference data.)

## Commands

```bash
npm ci                 # install
npm run check          # format:check + lint + typecheck + unit tests
npm run validate       # validation cases against committed reference data
npm run bench          # performance benchmark (fetches one CelesTrak group; see docs/performance.md)
npm run dev            # API server (http://127.0.0.1:8787) + Vite dev server (http://127.0.0.1:5173)
npm run build          # production build of the web app (apps/web/dist); the server serves it at /
```

Run the viewer: `npm run dev`, then open http://127.0.0.1:5173. The Vite dev server proxies `/api`
and `/ws` to the API server.

## Configuration

Environment variables (see [.env.example](../.env.example)); the server also reads a `.env` file from
the working directory or the repository root. Nothing is required.

| Variable                                      | Meaning                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `SIM_OFFLINE=1`                               | No outbound requests; use cache and committed fixtures                   |
| `SIM_CACHE_DIR`                               | Cache for provider responses (default `.simulation-cache`, git-ignored)  |
| `SIM_ORBITAL_GROUPS`                          | CelesTrak groups to load, comma-separated (default `stations`)           |
| `SIM_SERVER_HOST` / `SIM_SERVER_PORT`         | API bind address (default `127.0.0.1:8787`)                              |
| `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` | Optional OpenSky OAuth2 client; anonymous access works with a tiny quota |
| `VITE_CESIUM_ION_TOKEN`                       | Not used; reserved                                                       |

**Never commit credentials.** `.env` is git-ignored; CI needs no secrets.

## Layout and boundaries

See [architecture.md](architecture.md). Two boundaries are enforced by lint: the physics core may not
read the wall clock or use `Math.random`; the web app may import only `@simulation/physics/time` and
`@simulation/schemas` (never the engine or physics core).

## Testing conventions

- `packages/*/test` — unit tests with authoritative vectors where available.
- `apps/server/test` — API contract tests using `fastify.inject` against the shared wire schemas.
- `validation/*` — reference comparisons; each has a README with the required write-up.
- Providers are tested with fake fetchers and temporary cache directories; no test needs the network.
- Testing the viewer in a browser: the desktop browser pane throttles `requestAnimationFrame` unless a
  screenshot is being taken; drive frames with `viewer.scene.render()` from the console (the dev build
  exposes `window.__sim`).

## Regenerating reference data

Orekit: `gh workflow run orekit-reference.yml`, download the artifact, replace
`validation/orekit/reference/orekit-reference.csv`. NRLMSISE-00: `gh workflow run nrlmsise-reference.yml`
likewise. Fixtures: `node packages/environment/scripts/refresh-fixtures.mjs` (be gentle with CelesTrak:
one request per group per 2 hours).
