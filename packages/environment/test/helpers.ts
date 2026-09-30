import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Instant } from '@simulation/physics';
import { ResourceCache } from '../src/providers/cache';
import type { Fetcher } from '../src/providers/http';

export const fixturePath = (name: string): string =>
  fileURLToPath(new URL(`../data/fixtures/${name}`, import.meta.url));

export const readFixture = (name: string): string => readFileSync(fixturePath(name), 'utf8');

interface ManifestEntry {
  file: string;
  retrievedAtUtc: string;
}
const manifest = JSON.parse(readFixture('manifest.json')) as ManifestEntry[];

/** Retrieval time of a committed fixture, from data/fixtures/manifest.json. */
export const fixtureRetrievedAt = (name: string): string => {
  const e = manifest.find((m) => m.file === name);
  if (!e) throw new Error(`fixture ${name} not in manifest`);
  return e.retrievedAtUtc;
};

export const fixtureManifestTimes = (): Record<string, string> =>
  Object.fromEntries(manifest.map((m) => [m.file, m.retrievedAtUtc]));

/** A controllable wall clock. */
export class FakeClock {
  constructor(private t: Instant) {}
  now = (): Instant => this.t;
  advance(seconds: number): void {
    this.t = this.t.plusSeconds(seconds);
  }
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'sim-test-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface RecordingFetcher extends Fetcher {
  calls: string[];
  respond: (url: string) => { status: number; text: string } | Error;
}

export function makeFetcher(
  respond: (url: string) => { status: number; text: string } | Error,
): RecordingFetcher {
  const f = (async (url: string) => {
    f.calls.push(url);
    const r = f.respond(url);
    if (r instanceof Error) throw r;
    return { status: r.status, text: r.text, headers: {} };
  }) as RecordingFetcher;
  f.calls = [];
  f.respond = respond;
  return f;
}

export const newCache = (
  dir: string,
  opts: { offline?: boolean; fetcher?: Fetcher; clock: FakeClock },
): ResourceCache =>
  new ResourceCache({
    dir,
    offline: opts.offline ?? false,
    ...(opts.fetcher ? { fetcher: opts.fetcher } : {}),
    now: opts.clock.now,
  });
