/**
 * Minimal HTTP abstraction so providers never call `fetch` directly. Tests inject a fake; the
 * default implementation adds a timeout and an honest User-Agent (several providers, including
 * CelesTrak and OpenSky, ask API clients to identify themselves).
 */

export interface HttpResponse {
  readonly status: number;
  readonly text: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface HttpRequestOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly method?: 'GET' | 'POST';
  readonly body?: string;
  readonly timeoutMs?: number;
}

export type Fetcher = (url: string, options?: HttpRequestOptions) => Promise<HttpResponse>;

export const USER_AGENT = 'simulation-environment/0.1 (+https://github.com/furyengi/simulation)';

export const defaultFetcher: Fetcher = async (url, options = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
    const res = await fetch(url, {
      method: options.method ?? 'GET',
      ...(options.body !== undefined ? { body: options.body } : {}),
      headers: { 'user-agent': USER_AGENT, ...options.headers },
      signal: controller.signal,
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    return { status: res.status, text: await res.text(), headers };
  } finally {
    clearTimeout(timer);
  }
};

/** An error that means "the provider could not supply data right now". Never a bug. */
export class ProviderUnavailableError extends Error {
  constructor(
    readonly providerId: string,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(`${providerId}: ${message}`);
    this.name = 'ProviderUnavailableError';
  }
}
