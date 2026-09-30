/**
 * Runtime configuration from environment variables (see /.env.example). Secrets are read here and
 * only here, and are never logged or serialised.
 */
export interface EnvironmentConfig {
  /** Directory for cached provider responses. */
  readonly cacheDir: string;
  /** Forbid all outbound network requests; use cache and fixtures only. */
  readonly offline: boolean;
  readonly openSky: {
    readonly clientId: string | undefined;
    readonly clientSecret: string | undefined;
  };
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>): EnvironmentConfig {
  const blank = (v: string | undefined): string | undefined =>
    v === undefined || v.trim() === '' ? undefined : v.trim();
  return {
    cacheDir: blank(env.SIM_CACHE_DIR) ?? '.simulation-cache',
    offline: blank(env.SIM_OFFLINE) === '1' || blank(env.SIM_OFFLINE)?.toLowerCase() === 'true',
    openSky: {
      clientId: blank(env.OPENSKY_CLIENT_ID),
      clientSecret: blank(env.OPENSKY_CLIENT_SECRET),
    },
  };
}
