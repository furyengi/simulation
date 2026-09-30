import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import {
  Instant,
  degToRad,
  geodetic,
  geodeticToEcef,
  position,
  type Position,
} from '@simulation/physics';
import { type Environment } from '@simulation/environment';
import {
  ClockCommandSchema,
  FrameIdSchema,
  IsoUtcSchema,
  type ClockSnapshot,
} from '@simulation/schemas';
import { z } from 'zod';

/**
 * HTTP + WebSocket API around the environment engine.
 *
 * The server is authoritative: it owns the master clock and computes every physical quantity.
 * Clients receive clock snapshots (over WebSocket and REST) and render an extrapolation of them.
 */

export interface AppOptions {
  /** Directory of the built web app to serve at `/`, if it exists. */
  readonly staticDir?: string;
  /** Additional CORS origins (the Vite dev server is always allowed on localhost). */
  readonly corsOrigins?: readonly string[];
  readonly logger?: boolean;
  /** Interval of the clock heartbeat broadcast, ms. Set 0 to disable (tests). */
  readonly heartbeatMs?: number;
  /** Interval of the background provider refresh, ms. Set 0 to disable. Providers self rate-limit. */
  readonly providerRefreshMs?: number;
}

const TimeParam = IsoUtcSchema.optional();
const PositionSchema = z.object({
  frame: FrameIdSchema,
  x: z.number(),
  y: z.number(),
  z: z.number(),
});
/** Geodetic site: degrees and metres, WGS 84. */
const SiteSchema = z.object({
  latDeg: z.number().min(-90).max(90),
  lonDeg: z.number().min(-360).max(360),
  heightM: z.number().min(-1000).max(1e9).default(0),
});

const toPosition = (p: z.infer<typeof PositionSchema>): Position =>
  position(p.frame, [p.x, p.y, p.z]);
const inst = (s: string | undefined): Instant | undefined => (s ? Instant.parse(s) : undefined);

export async function buildApp(env: Environment, opts: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  await app.register(cors, {
    origin: [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/, ...(opts.corsOrigins ?? [])],
  });
  await app.register(websocket);

  // ---- error mapping: invalid input is a 400 with the reason, never a stack trace -----------
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'INVALID_REQUEST',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (err instanceof RangeError) {
      return reply.status(400).send({ error: 'INVALID_REQUEST', message: err.message });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'INTERNAL', message: 'Internal error' });
  });

  // ---- clock -------------------------------------------------------------------------------
  const sockets = new Set<{ send(data: string): void; readyState: number }>();
  const broadcast = (msg: unknown): void => {
    const text = JSON.stringify(msg);
    for (const s of sockets) if (s.readyState === 1) s.send(text);
  };
  const clockMessage = () => ({
    type: 'clock' as const,
    snapshot: env.clock.snapshot(),
    aircraft: env.aircraftAvailability(),
  });

  app.get('/api/health', async () => ({ status: 'ok', timeUtc: env.clock.now().toIso() }));

  app.get('/api/clock', async () => clockMessage());

  app.post('/api/clock', async (req) => {
    const cmd = ClockCommandSchema.parse(req.body);
    if (cmd.command === 'seek') await env.prepare(Instant.parse(cmd.timeUtc));
    env.clock.apply(cmd);
    const msg = clockMessage();
    broadcast(msg);
    return msg;
  });

  app.get('/ws', { websocket: true }, (socket) => {
    sockets.add(socket);
    socket.send(JSON.stringify(clockMessage()));
    socket.on('close', () => sockets.delete(socket));
    socket.on('message', (raw: Buffer) => {
      // Clients may request the current snapshot (e.g. after tab suspension).
      if (raw.toString() === 'clock') socket.send(JSON.stringify(clockMessage()));
    });
  });

  const timers: NodeJS.Timeout[] = [];
  const heartbeat = opts.heartbeatMs ?? 15_000;
  if (heartbeat > 0) {
    timers.push(
      setInterval(() => {
        if (env.clock.atLimit()) env.clock.pause();
        broadcast(clockMessage());
      }, heartbeat).unref(),
    );
  }
  const refreshMs = opts.providerRefreshMs ?? 10 * 60_000;
  if (refreshMs > 0) {
    timers.push(
      setInterval(() => void env.refreshProviders().catch(() => undefined), refreshMs).unref(),
    );
  }
  app.addHook('onClose', async () => {
    for (const t of timers) clearInterval(t);
    for (const s of sockets) (s as unknown as { close(): void }).close();
  });

  // ---- provider status ---------------------------------------------------------------------
  app.get('/api/providers', async () => ({ providers: env.providerStatuses() }));

  // ---- environment queries -----------------------------------------------------------------
  const timeQuery = z.object({ time: TimeParam });

  app.get('/api/environment/earth-orientation', async (req) => {
    const q = timeQuery.parse(req.query);
    return env.earth.orientation(inst(q.time));
  });

  app.get('/api/environment/moon', async (req) => {
    const q = timeQuery.extend({ frame: FrameIdSchema.default('GCRF') }).parse(req.query);
    return env.moon.state(inst(q.time), q.frame);
  });

  app.get('/api/environment/space-weather', async (req) => {
    const q = timeQuery.parse(req.query);
    const t = inst(q.time) ?? env.clock.now();
    await env.prepare(t);
    return env.spaceWeather.at(t);
  });

  const withPosition = z.object({ position: PositionSchema, time: TimeParam });
  app.post('/api/environment/sun-direction', async (req) => {
    const b = withPosition.parse(req.body);
    return env.sun.direction(toPosition(b.position), inst(b.time));
  });
  app.post('/api/environment/eclipse', async (req) => {
    const b = withPosition.parse(req.body);
    return env.eclipse.state(toPosition(b.position), inst(b.time));
  });
  app.post('/api/environment/gravity', async (req) => {
    const b = withPosition.parse(req.body);
    return env.gravity.at(toPosition(b.position), inst(b.time));
  });
  app.post('/api/environment/atmosphere', async (req) => {
    const b = withPosition.parse(req.body);
    const t = inst(b.time) ?? env.clock.now();
    await env.prepare(t);
    return env.atmosphere.sample(toPosition(b.position), t);
  });
  app.post('/api/environment/illumination', async (req) => {
    const b = z.object({ site: SiteSchema, time: TimeParam }).parse(req.body);
    return env.sun.illumination(b.site, inst(b.time));
  });

  /**
   * Everything the environment inspector shows for one point, in one round trip: each entry is an
   * independent `EnvResult`, so a refusal in one (e.g. atmosphere above 1000 km) does not hide the rest.
   */
  app.post('/api/environment/at', async (req) => {
    const b = z.object({ site: SiteSchema, time: TimeParam }).parse(req.body);
    const t = inst(b.time) ?? env.clock.now();
    await env.prepare(t);
    const ecef = geodeticToEcef(
      geodetic(degToRad(b.site.latDeg), degToRad(b.site.lonDeg), b.site.heightM),
    );
    const p = position('ITRF', ecef);
    return {
      timeUtc: t.toIso(),
      site: b.site,
      positionItrfM: ecef,
      sunDirection: env.sun.direction(p, t),
      illumination: env.sun.illumination(b.site, t),
      eclipse: b.site.heightM > 0 ? env.eclipse.state(p, t) : undefined,
      gravity: env.gravity.at(p, t),
      atmosphere: env.atmosphere.sample(p, t),
      spaceWeather: env.spaceWeather.at(t),
    };
  });

  app.get('/api/environment/bodies-window', async (req) => {
    const b = z
      .object({
        start: TimeParam,
        count: z.coerce.number().int().min(2).max(20_000).default(120),
        stepSeconds: z.coerce.number().positive().default(60),
      })
      .parse(req.query);
    return env.windows.bodies({
      start: inst(b.start) ?? env.clock.now(),
      count: b.count,
      stepSeconds: b.stepSeconds,
    });
  });

  app.get('/api/ground-stations', async () => env.groundStations.list());

  // ---- orbital objects ---------------------------------------------------------------------
  app.get('/api/orbital/objects', async (req) => {
    const q = z
      .object({
        q: z.string().default(''),
        limit: z.coerce.number().int().min(1).max(5000).default(100),
      })
      .parse(req.query);
    return { objects: env.orbital.search(q.q, q.limit), total: env.orbital.list().length };
  });

  app.get<{ Params: { id: string } }>('/api/orbital/objects/:id/state', async (req) => {
    const q = timeQuery.extend({ frame: FrameIdSchema.default('GCRF') }).parse(req.query);
    return env.orbital.state(req.params.id, inst(q.time), q.frame);
  });

  app.get<{ Params: { id: string } }>('/api/orbital/objects/:id/ground-track', async (req) => {
    const q = z
      .object({
        start: TimeParam,
        spanSeconds: z.coerce
          .number()
          .positive()
          .max(7 * 86_400)
          .default(5400),
        stepSeconds: z.coerce.number().positive().default(30),
      })
      .parse(req.query);
    return env.orbital.groundTrack(
      req.params.id,
      inst(q.start) ?? env.clock.now(),
      q.spanSeconds,
      q.stepSeconds,
    );
  });

  app.post('/api/orbital/ephemeris', async (req) => {
    const b = z
      .object({
        ids: z.array(z.string()).min(1).max(2000),
        start: TimeParam,
        count: z.number().int().min(2).max(20_000).optional(),
        durationSeconds: z
          .number()
          .positive()
          .max(10 * 86_400)
          .optional(),
        frame: FrameIdSchema.default('GCRF'),
        stepSeconds: z.number().positive().optional(),
        toleranceMeters: z.number().positive().optional(),
      })
      .parse(req.body);
    return env.orbital.ephemerisBatch({
      ids: b.ids,
      start: inst(b.start) ?? env.clock.now(),
      ...(b.count !== undefined ? { count: b.count } : {}),
      ...(b.durationSeconds !== undefined ? { durationSeconds: b.durationSeconds } : {}),
      frame: b.frame,
      ...(b.stepSeconds !== undefined ? { stepSeconds: b.stepSeconds } : {}),
      ...(b.toleranceMeters !== undefined ? { toleranceM: b.toleranceMeters } : {}),
    });
  });

  // ---- aircraft ----------------------------------------------------------------------------
  app.get('/api/aircraft', async (req) => {
    const q = z
      .object({
        latMin: z.coerce.number().min(-90).max(90).optional(),
        latMax: z.coerce.number().min(-90).max(90).optional(),
        lonMin: z.coerce.number().min(-180).max(180).optional(),
        lonMax: z.coerce.number().min(-180).max(180).optional(),
      })
      .parse(req.query);
    const box =
      q.latMin !== undefined &&
      q.latMax !== undefined &&
      q.lonMin !== undefined &&
      q.lonMax !== undefined
        ? { latMinDeg: q.latMin, latMaxDeg: q.latMax, lonMinDeg: q.lonMin, lonMaxDeg: q.lonMax }
        : null;
    await env.aircraft.refresh(box);
    return env.aircraft.snapshot();
  });

  // ---- static web app (production) ---------------------------------------------------------
  if (opts.staticDir && existsSync(opts.staticDir)) {
    await app.register(fastifyStatic, { root: opts.staticDir });
  }

  return app;
}

export type { ClockSnapshot };
