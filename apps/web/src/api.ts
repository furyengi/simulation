import type {
  AircraftLayer,
  AtmosphereSample,
  BodiesWindow,
  ClockCommand,
  ClockSnapshot,
  EclipseSample,
  EphemerisWindow,
  GravitySample,
  GroundStation,
  Illumination,
  OrbitalCatalogEntry,
  OrbitalObjectState,
  Provenance,
  ProviderStatus,
  SpaceWeatherState,
  SunDirection,
} from '@simulation/schemas';

/** Wire form of `EnvResult<T>`: the engine answers ok / unsupported / unavailable, never a guess. */
export type Wire<T> =
  | { status: 'ok'; value: T; provenance: Provenance[] }
  | { status: 'unsupported'; code: string; reason: string }
  | { status: 'unavailable'; code: string; reason: string; provenance?: Provenance[] };

export interface ClockMessage {
  type: 'clock';
  snapshot: ClockSnapshot;
  aircraft: { available: boolean; reason?: string };
}

export interface EnvironmentAt {
  timeUtc: string;
  site: { latDeg: number; lonDeg: number; heightM: number };
  positionItrfM: [number, number, number];
  sunDirection: Wire<SunDirection>;
  illumination: Wire<Illumination>;
  eclipse?: Wire<EclipseSample>;
  gravity: Wire<GravitySample>;
  atmosphere: Wire<AtmosphereSample>;
  spaceWeather: Wire<SpaceWeatherState>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json()) as T & {
    error?: string;
    message?: string;
    issues?: { message: string }[];
  };
  if (!res.ok) {
    const detail = body.message ?? body.issues?.map((i) => i.message).join('; ') ?? res.statusText;
    throw new Error(`${res.status} ${detail}`);
  }
  return body;
}

const post = <T>(path: string, payload: unknown): Promise<T> =>
  request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

const qs = (o: Record<string, string | number | undefined>): string =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');

export const api = {
  clock: () => request<ClockMessage>('/api/clock'),
  clockCommand: (cmd: ClockCommand) => post<ClockMessage>('/api/clock', cmd),
  providers: () => request<{ providers: ProviderStatus[] }>('/api/providers'),
  environmentAt: (site: { latDeg: number; lonDeg: number; heightM: number }, timeUtc: string) =>
    post<EnvironmentAt>('/api/environment/at', { site, time: timeUtc }),
  bodiesWindow: (startUtc: string, count: number, stepSeconds: number) =>
    request<Wire<BodiesWindow>>(
      `/api/environment/bodies-window?${qs({ start: startUtc, count, stepSeconds })}`,
    ),
  objects: (q: string, limit = 200) =>
    request<{ objects: OrbitalCatalogEntry[]; total: number }>(
      `/api/orbital/objects?${qs({ q, limit })}`,
    ),
  objectState: (id: string, timeUtc: string, frame: string) =>
    request<Wire<OrbitalObjectState>>(
      `/api/orbital/objects/${encodeURIComponent(id)}/state?${qs({ time: timeUtc, frame })}`,
    ),
  groundTrack: (id: string, startUtc: string, spanSeconds: number, stepSeconds: number) =>
    request<
      Wire<{
        id: string;
        points: { timeUtc: string; latDeg: number; lonDeg: number; heightM: number }[];
      }>
    >(
      `/api/orbital/objects/${encodeURIComponent(id)}/ground-track?${qs({ start: startUtc, spanSeconds, stepSeconds })}`,
    ),
  ephemeris: (req: {
    ids: string[];
    start: string;
    count?: number;
    durationSeconds?: number;
    frame: string;
    stepSeconds?: number;
    toleranceMeters?: number;
  }) =>
    post<Wire<{ windows: EphemerisWindow[]; stepSeconds: number }>>('/api/orbital/ephemeris', req),
  groundStations: () => request<Wire<GroundStation[]>>('/api/ground-stations'),
  aircraft: (box?: { latMin: number; latMax: number; lonMin: number; lonMax: number }) =>
    request<Wire<AircraftLayer>>(`/api/aircraft?${box ? qs(box) : ''}`),
};

/** Subscribe to clock snapshots pushed by the server. Reconnects with back-off. */
export function connectClock(
  onMessage: (m: ClockMessage) => void,
  onState: (connected: boolean) => void,
): () => void {
  let ws: WebSocket | undefined;
  let closed = false;
  let delay = 500;
  const open = (): void => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      delay = 500;
      onState(true);
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as ClockMessage;
      if (m.type === 'clock') onMessage(m);
    };
    ws.onclose = () => {
      onState(false);
      if (!closed) setTimeout(open, (delay = Math.min(delay * 2, 8000)));
    };
  };
  open();
  return () => {
    closed = true;
    ws?.close();
  };
}
