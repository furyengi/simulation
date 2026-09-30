import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Instant, SimulationClock } from '@simulation/physics';
import { Environment } from '@simulation/environment';
import {
  AtmosphereSampleSchema,
  ClockSnapshotSchema,
  EarthOrientationSchema,
  EphemerisWindowSchema,
  GravitySampleSchema,
  MoonStateSchema,
  OrbitalCatalogEntrySchema,
  OrbitalObjectStateSchema,
  ProviderStatusSchema,
  SpaceWeatherStateSchema,
  SunDirectionSchema,
  WireResultSchema,
} from '@simulation/schemas';
import { type z } from 'zod';
import { buildApp } from '../src/app';

const WALL = Instant.parse('2026-09-30T17:00:00Z');
let app: FastifyInstance;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sim-srv-'));
  const env = await Environment.create({
    config: {
      cacheDir: dir,
      offline: true,
      openSky: { clientId: undefined, clientSecret: undefined },
    },
    clock: new SimulationClock({
      start: Instant.parse('2026-09-27T12:00:00Z'),
      pace: 'manual',
      wall: () => WALL.unixMicros / 1000,
    }),
    wallNow: () => WALL,
  });
  app = await buildApp(env, { heartbeatMs: 0, providerRefreshMs: 0 });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

const get = async (url: string) => {
  const r = await app.inject({ method: 'GET', url });
  return { status: r.statusCode, body: r.json() as unknown };
};
const post = async (url: string, payload: unknown) => {
  const r = await app.inject({ method: 'POST', url, payload: payload as object });
  return { status: r.statusCode, body: r.json() as unknown };
};

describe('clock API', () => {
  it('serves a schema-valid snapshot plus aircraft-layer availability', async () => {
    const { status, body } = await get('/api/clock');
    expect(status).toBe(200);
    const b = body as { type: string; snapshot: unknown; aircraft: { available: boolean } };
    expect(b.type).toBe('clock');
    expect(ClockSnapshotSchema.safeParse(b.snapshot).success).toBe(true);
    expect(b.aircraft.available).toBe(false);
  });

  it('applies commands and broadcasts the new snapshot to WebSocket clients', async () => {
    // Attach the listener before the socket opens: the server greets immediately.
    const inbox: { type: string; snapshot: { anchorSimUtc: string } }[] = [];
    const ws = await app.injectWS(
      '/ws',
      {},
      {
        onInit: (sock) => {
          sock.on('message', (m: Buffer) => inbox.push(JSON.parse(m.toString())));
        },
      },
    );
    const waitFor = async (n: number): Promise<void> => {
      for (let i = 0; i < 100 && inbox.length < n; i++) await new Promise((r) => setTimeout(r, 20));
      expect(inbox.length).toBeGreaterThanOrEqual(n);
    };
    await waitFor(1);
    expect(inbox[0]!.type).toBe('clock');
    const r = await post('/api/clock', { command: 'seek', timeUtc: '2026-10-05T00:00:00Z' });
    expect(r.status).toBe(200);
    await waitFor(2);
    expect(inbox[1]!.snapshot.anchorSimUtc).toBe('2026-10-05T00:00:00.000Z');
    ws.terminate();
  });

  it('steps a manual clock deterministically', async () => {
    await post('/api/clock', { command: 'seek', timeUtc: '2026-09-27T12:00:00Z' });
    const a = (await post('/api/clock', { command: 'step', seconds: 0.5 })).body as {
      snapshot: { anchorSimUtc: string };
    };
    const b = (await post('/api/clock', { command: 'step', seconds: 0.5 })).body as {
      snapshot: { anchorSimUtc: string };
    };
    expect(a.snapshot.anchorSimUtc).toBe('2026-09-27T12:00:00.500Z');
    expect(b.snapshot.anchorSimUtc).toBe('2026-09-27T12:00:01.000Z');
  });

  it('rejects unsupported times, bad commands and non-positive rates with 400', async () => {
    expect(
      (await post('/api/clock', { command: 'seek', timeUtc: '1960-01-01T00:00:00Z' })).status,
    ).toBe(400);
    expect((await post('/api/clock', { command: 'seek', timeUtc: 'yesterday' })).status).toBe(400);
    expect((await post('/api/clock', { command: 'setRate', rate: 0 })).status).toBe(400);
    expect((await post('/api/clock', { command: 'warp' })).status).toBe(400);
  });
});

describe('environment API', () => {
  const T = '2026-09-27T12:00:00Z';
  const Ok = <S extends z.ZodType>(s: S) => WireResultSchema(s);

  it('earth orientation and Moon responses match their wire schemas', async () => {
    const eo = await get(`/api/environment/earth-orientation?time=${T}`);
    expect(Ok(EarthOrientationSchema).safeParse(eo.body).success).toBe(true);
    const moon = await get(`/api/environment/moon?time=${T}&frame=ITRF`);
    expect(Ok(MoonStateSchema).safeParse(moon.body).success).toBe(true);
    expect((moon.body as { value: { frame: string } }).value.frame).toBe('ITRF');
  });

  it('sun direction, gravity and atmosphere validate and carry provenance', async () => {
    const pos = { frame: 'ITRF', x: 6_778_137, y: 0, z: 0 };
    const sun = await post('/api/environment/sun-direction', { position: pos, time: T });
    expect(Ok(SunDirectionSchema).safeParse(sun.body).success).toBe(true);
    const g = await post('/api/environment/gravity', { position: pos, time: T });
    expect(Ok(GravitySampleSchema).safeParse(g.body).success).toBe(true);
    const a = await post('/api/environment/atmosphere', { position: pos, time: T });
    expect(Ok(AtmosphereSampleSchema).safeParse(a.body).success).toBe(true);
    expect((a.body as { provenance: unknown[] }).provenance.length).toBeGreaterThanOrEqual(2);
  });

  it('refusals are 200 responses with explicit status, not errors', async () => {
    const r = await post('/api/environment/atmosphere', {
      position: { frame: 'ITRF', x: 7_600_000, y: 0, z: 0 }, // ~1.2 Mm altitude
      time: T,
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'unsupported', code: 'ABOVE_MODEL_RANGE' });
  });

  it('space weather endpoint returns OBSERVED daily indices', async () => {
    const r = await get(`/api/environment/space-weather?time=${T}`);
    expect(Ok(SpaceWeatherStateSchema).safeParse(r.body).success).toBe(true);
  });

  it('validates inputs: bad frame, malformed time, NaN position → 400 with issues', async () => {
    expect(
      (await post('/api/environment/gravity', { position: { frame: 'ECI', x: 1, y: 1, z: 1 } }))
        .status,
    ).toBe(400);
    expect((await get('/api/environment/earth-orientation?time=nope')).status).toBe(400);
    expect(
      (await post('/api/environment/gravity', { position: { frame: 'ITRF', x: 'a', y: 1, z: 1 } }))
        .status,
    ).toBe(400);
  });

  it('/environment/at bundles independent results (one refusal does not hide the rest)', async () => {
    const r = await post('/api/environment/at', {
      site: { latDeg: 10, lonDeg: 20, heightM: 1_500_000 },
      time: T,
    });
    const b = r.body as Record<string, { status: string }>;
    expect(b.atmosphere!.status).toBe('unsupported');
    expect(b.gravity!.status).toBe('ok');
    expect(b.sunDirection!.status).toBe('ok');
    expect(b.eclipse!.status).toBe('ok');
    expect(b.spaceWeather!.status).toBe('ok');
  });

  it('provider statuses are listed with source and freshness', async () => {
    const r = await get('/api/providers');
    const list = (r.body as { providers: unknown[] }).providers;
    expect(list.length).toBe(5);
    for (const p of list) expect(ProviderStatusSchema.safeParse(p).success).toBe(true);
  });
});

describe('orbital API', () => {
  it('searches the catalogue and reports a propagated ISS state with provenance', async () => {
    const list = await get('/api/orbital/objects?q=ISS');
    const objs = (list.body as { objects: unknown[] }).objects;
    expect(objs.length).toBeGreaterThan(0);
    for (const o of objs) expect(OrbitalCatalogEntrySchema.safeParse(o).success).toBe(true);
    const st = await get(
      '/api/orbital/objects/norad:25544/state?time=2026-09-30T04:00:00Z&frame=GCRF',
    );
    expect(WireResultSchema(OrbitalObjectStateSchema).safeParse(st.body).success).toBe(true);
    expect((st.body as { provenance: { stateKind: string }[] }).provenance[0]!.stateKind).toBe(
      'PROPAGATED',
    );
  });

  it('serves ephemeris windows for client interpolation', async () => {
    const r = await post('/api/orbital/ephemeris', {
      ids: ['norad:25544'],
      start: '2026-09-30T04:00:00Z',
      count: 50,
      frame: 'GCRF',
      toleranceMeters: 5,
    });
    const v = r.body as { status: string; value: { windows: unknown[]; stepSeconds: number } };
    expect(v.status).toBe('ok');
    expect(EphemerisWindowSchema.safeParse(v.value.windows[0]).success).toBe(true);
  });

  it('unknown object ids are explicit, not 500s', async () => {
    const r = await get('/api/orbital/objects/norad:99999999/state');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'unavailable', code: 'UNKNOWN_OBJECT' });
  });
});

describe('aircraft API', () => {
  it('is disabled while the clock is not live, with the reason', async () => {
    const r = await get('/api/aircraft?latMin=45&latMax=48&lonMin=5&lonMax=10');
    expect(r.body).toMatchObject({
      status: 'unavailable',
      code: 'LIVE_DATA_INVALID_FOR_SIMULATION_TIME',
    });
  });
});
