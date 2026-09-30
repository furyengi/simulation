import { fileURLToPath } from 'node:url';
import { Environment, loadConfig } from '@simulation/environment';
import { buildApp } from './app';

// Load .env from the working directory if present (never committed; see .env.example).
// (npm workspaces run with cwd = apps/server, so also look in the repository root.)
for (const path of ['.env', fileURLToPath(new URL('../../../.env', import.meta.url))]) {
  try {
    process.loadEnvFile(path);
    break;
  } catch {
    /* not there: try the next location, or rely on the process environment */
  }
}

const config = loadConfig(process.env);
const host = process.env.SIM_SERVER_HOST ?? '127.0.0.1';
const port = Number(process.env.SIM_SERVER_PORT ?? 8787);
const groups = (process.env.SIM_ORBITAL_GROUPS ?? 'stations')
  .split(',')
  .map((g) => g.trim())
  .filter(Boolean);

const env = await Environment.create({ config, orbitalGroups: groups });
const app = await buildApp(env, {
  logger: true,
  staticDir: fileURLToPath(new URL('../../web/dist', import.meta.url)),
});

await app.listen({ host, port });
app.log.info(
  `Simulation server ready. Offline=${config.offline}. Simulation time ${env.clock.now().toIso()}. ` +
    `Orbital objects loaded: ${env.orbital.list().length} (${groups.join(', ')}).`,
);

const shutdown = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
