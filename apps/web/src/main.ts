import type { AircraftStateWire, OrbitalCatalogEntry } from '@simulation/schemas';
import * as Cesium from 'cesium';
import { api, connectClock, type ClockMessage } from './api';
import { ClientClock } from './clock';
import { h, setChildren } from './dom';
import { fmtRate, fmtUtcMs } from './format';
import {
  EnvironmentInspector,
  ObjectInspector,
  aircraftInspector,
  sourcesPanel,
} from './inspectors';
import { DEFAULT_LAYERS, GlobeView, type LayerState } from './scene';
import { TrackManager } from './tracks';
import './style.css';

const clock = new ClientClock();
const tracks = new TrackManager();
// eslint-disable-next-line prefer-const -- created after the UI elements whose handlers refer to it
let globe: GlobeView;
let connected = false;
let aircraftAvail: { available: boolean; reason?: string } = {
  available: false,
  reason: 'connecting…',
};
let catalog: OrbitalCatalogEntry[] = [];
let selectedId: string | undefined;
let selectedAircraft: AircraftStateWire | undefined;
let orbitCenterMs = 0;
let layers: LayerState = { ...DEFAULT_LAYERS };
let aircraftNotice = '';
let aircraftLayerNotice = '';

const simIso = (): string => new Date(clock.nowMs()).toISOString();

// ---- layout ---------------------------------------------------------------------------------

const app = document.getElementById('app')!;
const timeEl = h('div', { class: 'simtime' });
const modeEl = h('span', { class: 'mode' });
const engineEl = h('span', { class: 'engine bad' }, 'ENGINE: connecting');
const overlay = h('div', { class: 'overlay-note' });
const globeEl = h('div', { class: 'globe' }, overlay);
const errEl = h('span', { class: 'dim' });

async function command(cmd: Parameters<typeof api.clockCommand>[0]): Promise<void> {
  try {
    if (cmd.command === 'seek' || cmd.command === 'syncToWall' || cmd.command === 'setRate')
      tracks.invalidate();
    const m = await api.clockCommand(cmd);
    applyClock(m);
    errEl.textContent = '';
  } catch (e) {
    errEl.textContent = e instanceof Error ? e.message : String(e);
  }
}

// Time controls
const playBtn = h(
  'button',
  { title: 'Pause / resume (space)', onclick: () => void togglePlay() },
  '⏸',
);
const PRESETS = [1, 10, 60, 600, 3600, 86_400];
const rateButtons = PRESETS.map((r) =>
  h(
    'button',
    {
      'data-rate': r,
      title: `${r}× real time`,
      onclick: () => void command({ command: 'setRate', rate: r }),
    },
    `${r}×`,
  ),
);
const rateInput = h('input', {
  type: 'text',
  class: 'num',
  style: 'width:70px',
  placeholder: 'rate ×',
});
rateInput.addEventListener('change', () => {
  const v = Number(rateInput.value);
  if (v > 0) void command({ command: 'setRate', rate: v });
});
const jumpInput = h('input', { type: 'text', class: 'time', placeholder: 'YYYY-MM-DD HH:MM:SS' });
const goBtn = h('button', { onclick: () => void jump() }, 'Go');
jumpInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void jump();
});
const liveBtn = h(
  'button',
  {
    title: 'Jump to real UTC and run at 1×',
    onclick: () => void command({ command: 'syncToWall' }),
  },
  'Live',
);
const paceSel = h(
  'select',
  {
    title: 'Clock mode',
    onchange: (e: Event) =>
      void command({
        command: 'setPace',
        pace: (e.target as HTMLSelectElement).value as 'wall' | 'manual',
      }),
  },
  h('option', { value: 'wall' }, 'Wall-paced'),
  h('option', { value: 'manual' }, 'Stepped'),
);
const stepInput = h('input', {
  type: 'text',
  class: 'num',
  style: 'width:54px',
  value: '60',
  title: 'Step size (s)',
});
const stepBtn = h(
  'button',
  { onclick: () => void command({ command: 'step', seconds: Number(stepInput.value) || 1 }) },
  'Step',
);

async function togglePlay(): Promise<void> {
  if (!clock.ready) return;
  await command({ command: clock.snapshot.paused ? 'resume' : 'pause' });
}
async function jump(): Promise<void> {
  const raw = jumpInput.value.trim().replace(' ', 'T').replace(/Z$/, '');
  if (!raw) return;
  await command({ command: 'seek', timeUtc: `${raw.length === 16 ? `${raw}:00` : raw}Z` });
}
window.addEventListener('keydown', (e) => {
  if (
    e.code === 'Space' &&
    !(e.target instanceof HTMLInputElement) &&
    !(e.target instanceof HTMLSelectElement)
  ) {
    e.preventDefault();
    void togglePlay();
  }
});

const topbar = h(
  'div',
  { class: 'topbar' },
  h('span', { class: 'brand' }, 'SIMULATION'),
  timeEl,
  modeEl,
  h('div', { class: 'group' }, playBtn, ...rateButtons, rateInput),
  h('div', { class: 'group' }, jumpInput, goBtn, liveBtn),
  h('div', { class: 'group' }, paceSel, stepInput, stepBtn),
  h('span', { class: 'spacer' }),
  errEl,
  engineEl,
);

// Left: search + layers
const searchInput = h('input', {
  type: 'text',
  placeholder: 'Search objects: name, NORAD id, designator',
});
const listEl = h('div', { class: 'list' });
searchInput.addEventListener('input', renderList);
const layersEl = h('div', { class: 'layers' });
const left = h(
  'div',
  { class: 'panel left' },
  h('div', { class: 'section-title' }, 'Objects'),
  h('div', { class: 'search' }, searchInput),
  listEl,
  h('div', { class: 'section-title' }, 'Layers'),
  layersEl,
);

// Right: inspector tabs
const objInspector = new ObjectInspector(simIso);
const envInspector = new EnvironmentInspector(simIso, (lat, lon, height) =>
  globe.showSiteMarker(lat, lon, height),
);
const sources = sourcesPanel();
const aircraftEl = h('div');
const tabBody = h('div', { class: 'tabbody' });
type Tab = 'object' | 'environment' | 'aircraft' | 'sources';
let tab: Tab = 'object';
const tabButtons: Record<Tab, HTMLButtonElement> = {
  object: h('button', { onclick: () => setTab('object') }, 'Object'),
  environment: h('button', { onclick: () => setTab('environment') }, 'Environment'),
  aircraft: h('button', { onclick: () => setTab('aircraft') }, 'Aircraft'),
  sources: h('button', { onclick: () => setTab('sources') }, 'Sources'),
};
function setTab(t: Tab): void {
  tab = t;
  for (const [k, b] of Object.entries(tabButtons)) b.classList.toggle('on', k === t);
  const el =
    t === 'object'
      ? objInspector.el
      : t === 'environment'
        ? envInspector.el
        : t === 'aircraft'
          ? aircraftEl
          : sources.el;
  setChildren(tabBody, el);
  if (t === 'sources') void sources.refresh();
  if (t === 'environment') void envInspector.refresh();
}
const right = h(
  'div',
  { class: 'panel right' },
  h('div', { class: 'tabs' }, ...Object.values(tabButtons)),
  tabBody,
);

const bottom = h(
  'div',
  { class: 'bottom' },
  h('span', {}, 'Orbits: CelesTrak OMM + SGP4 (propagated, not live)'),
  h('span', {}, 'Earth orientation: IERS'),
  h('span', {}, 'Space weather: GFZ · NRC · NOAA SWPC'),
  h('span', {}, 'Aircraft: OpenSky Network (coverage incomplete)'),
  h('span', { class: 'spacer' }),
  h('span', {}, 'Ellipsoid: WGS 84 · no terrain · imagery: Natural Earth II · CesiumJS'),
);

app.append(h('div', { class: 'shell' }, topbar, left, globeEl, right, bottom));

// ---- layers ---------------------------------------------------------------------------------

const LAYER_DEFS: { key: keyof LayerState; label: string; note?: string }[] = [
  {
    key: 'illumination',
    label: 'Sun illumination',
    note: 'Lighting driven by the engine’s Sun direction',
  },
  { key: 'moon', label: 'Moon', note: 'Engine position; orientation/phase shading not modelled' },
  { key: 'sun', label: 'Sun marker' },
  { key: 'objects', label: 'Orbital objects' },
  { key: 'orbit', label: 'Orbit (selected)' },
  { key: 'groundTrack', label: 'Ground track (selected)' },
  { key: 'groundStations', label: 'Ground stations', note: 'Curated NASA DSN sites (approximate)' },
  { key: 'aircraft', label: 'Aircraft (live)' },
  {
    key: 'atmosphere',
    label: 'Atmosphere glow',
    note: 'Cosmetic; not a physical atmosphere render',
  },
  { key: 'stars', label: 'Star field', note: 'Cosmetic' },
];
function renderLayers(): void {
  setChildren(
    layersEl,
    ...LAYER_DEFS.flatMap((d) => {
      const isAircraft = d.key === 'aircraft';
      const disabled = isAircraft && !aircraftAvail.available;
      const cb = h('input', {
        type: 'checkbox',
        ...(layers[d.key] && !disabled ? { checked: true } : {}),
        ...(disabled ? { disabled: true } : {}),
        onchange: (e: Event) => {
          layers = { ...layers, [d.key]: (e.target as HTMLInputElement).checked };
          globe.setLayers(layers);
          if (isAircraft) void pollAircraft();
          renderLayers();
        },
      });
      return [
        h('label', { class: disabled ? 'disabled' : '' }, cb, d.label),
        disabled
          ? h(
              'div',
              { class: 'note' },
              `Disabled: ${aircraftAvail.reason ?? 'live data is not valid for this simulation time'}`,
            )
          : d.note
            ? h('div', { class: 'note' }, d.note)
            : null,
      ];
    }),
  );
}

// ---- object list / selection ----------------------------------------------------------------

function renderList(): void {
  const q = searchInput.value.trim().toLowerCase();
  const hits = catalog.filter(
    (o) =>
      !q ||
      o.name.toLowerCase().includes(q) ||
      String(o.noradCatId) === q ||
      o.intlDesignator.toLowerCase().includes(q),
  );
  setChildren(
    listEl,
    ...hits
      .slice(0, 400)
      .map((o) =>
        h(
          'div',
          { class: `item${o.id === selectedId ? ' sel' : ''}`, onclick: () => selectObject(o.id) },
          h('span', {}, o.name),
          h('span', { class: 'id' }, String(o.noradCatId)),
        ),
      ),
    hits.length === 0
      ? h('div', { class: 'empty', style: 'padding:8px 12px' }, 'No matching objects')
      : null,
  );
}

function selectObject(id: string | undefined): void {
  selectedId = id;
  selectedAircraft = undefined;
  globe.select(id);
  objInspector.setObject(id);
  renderList();
  if (id) {
    setTab('object');
    void loadOrbitLines(id);
  }
}

async function loadOrbitLines(id: string): Promise<void> {
  const entry = catalog.find((o) => o.id === id);
  if (!entry) return;
  const period = Math.min(entry.periodSeconds, 3 * 86_400);
  const t = clock.nowMs();
  orbitCenterMs = t;
  const start = new Date(t - period / 2).toISOString();
  try {
    const step = period / 240;
    const [eph, gt] = await Promise.all([
      api.ephemeris({
        ids: [id],
        start,
        durationSeconds: period,
        stepSeconds: step,
        frame: 'GCRF',
      }),
      api.groundTrack(id, start, period, Math.max(step, 10)),
    ]);
    if (selectedId !== id) return;
    if (eph.status === 'ok') globe.setOrbit(eph.value.windows[0]!.positionsM);
    if (gt.status === 'ok') globe.setGroundTrack(gt.value.points);
  } catch {
    /* the inspector shows request errors; lines are optional */
  }
}

// ---- clock -> UI ----------------------------------------------------------------------------

function applyClock(m: ClockMessage): void {
  clock.update(m.snapshot);
  aircraftAvail = m.aircraft;
  if (!m.aircraft.available && layers.aircraft) {
    layers = { ...layers, aircraft: false };
    globe?.setLayers(layers);
  }
  renderLayers();
  for (const b of rateButtons)
    b.classList.toggle('on', Number(b.getAttribute('data-rate')) === m.snapshot.rate);
  paceSel.value = m.snapshot.pace;
  const manual = m.snapshot.pace === 'manual';
  stepInput.style.display = manual ? '' : 'none';
  stepBtn.style.display = manual ? '' : 'none';
  playBtn.textContent = m.snapshot.paused || manual ? '▶' : '⏸';
  playBtn.disabled = manual;
  modeEl.className = 'mode';
  if (manual) modeEl.textContent = 'STEPPED (deterministic)';
  else if (m.snapshot.paused) {
    modeEl.textContent = 'PAUSED';
    modeEl.classList.add('paused');
  } else if (m.snapshot.rate === 1) {
    modeEl.textContent = 'REAL-TIME RATE 1×';
    modeEl.classList.add('live');
  } else {
    modeEl.textContent = `ACCELERATED ${fmtRate(m.snapshot.rate)}`;
    modeEl.classList.add('accel');
  }
}

// ---- aircraft -------------------------------------------------------------------------------

async function pollAircraft(): Promise<void> {
  if (!layers.aircraft || !aircraftAvail.available) {
    globe?.setAircraft([]);
    aircraftLayerNotice = '';
    return;
  }
  const rect = globe.viewer.camera.computeViewRectangle();
  let box: { latMin: number; latMax: number; lonMin: number; lonMax: number } | undefined;
  if (rect) {
    const d = (r: number) => (r * 180) / Math.PI;
    box = {
      latMin: d(rect.south),
      latMax: d(rect.north),
      lonMin: d(rect.west),
      lonMax: d(rect.east),
    };
    const area = (box.latMax - box.latMin) * ((box.lonMax - box.lonMin + 360) % 360 || 360);
    if (area > 1500) {
      aircraftLayerNotice =
        'Zoom in to load aircraft (each world-wide request costs several of the small anonymous API quota).';
      globe.setAircraft([]);
      renderAircraftTab(undefined);
      return;
    }
  } else {
    aircraftLayerNotice = 'Zoom in to load aircraft.';
    globe.setAircraft([]);
    return;
  }
  try {
    const r = await api.aircraft(box);
    if (r.status === 'ok') {
      aircraftLayerNotice = '';
      aircraftNotice = r.value.coverageNotice;
      globe.setAircraft(r.value.aircraft);
      renderAircraftTab(r.value.count);
    } else {
      aircraftLayerNotice = `Aircraft unavailable: ${r.reason}`;
      globe.setAircraft([]);
    }
  } catch (e) {
    aircraftLayerNotice = `Aircraft request failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}
function renderAircraftTab(count: number | undefined): void {
  setChildren(
    aircraftEl,
    count !== undefined
      ? h(
          'div',
          { class: 'dim', style: 'padding:6px 0' },
          `${count} aircraft in view (of those OpenSky receives).`,
        )
      : null,
    aircraftInspector(
      selectedAircraft,
      aircraftNotice || 'Coverage is limited to OpenSky receivers: incomplete and not worldwide.',
    ),
  );
}

// ---- boot -----------------------------------------------------------------------------------

globe = new GlobeView(globeEl, clock, tracks, {
  onSelectObject: (id) => selectObject(id),
  onSelectAircraft: (a) => {
    selectedAircraft = a;
    if (a) {
      renderAircraftTab(undefined);
      setTab('aircraft');
    }
  },
  onPickSite: (lat, lon) => {
    setTab('environment');
    envInspector.setSite(lat, lon);
  },
});
globe.setLayers(layers);
renderLayers();
setTab('object');

connectClock(
  (m) => {
    const first = !clock.ready;
    applyClock(m);
    if (first) void loadStatic();
  },
  (ok) => {
    connected = ok;
    engineEl.textContent = ok ? 'ENGINE: connected' : 'ENGINE: disconnected';
    engineEl.className = `engine ${ok ? 'ok' : 'bad'}`;
  },
);

async function loadStatic(): Promise<void> {
  const [objs, gs] = await Promise.all([api.objects('', 5000), api.groundStations()]);
  catalog = objs.objects;
  globe.setObjects(catalog.map((o) => ({ id: o.id, name: o.name })));
  tracks.setObjectIds(catalog.map((o) => o.id));
  if (gs.status === 'ok') globe.setGroundStations(gs.value);
  renderList();
}

// Frame loop: timestamp display (always the current simulation time) and throttled inspector refresh.
let lastInspect = 0;
function frame(now: number): void {
  if (clock.ready) {
    const ms = clock.nowMs();
    timeEl.textContent = fmtUtcMs(ms).replace(' UTC', '');
    if (!timeEl.querySelector('small')) timeEl.append(h('small', {}, 'UTC'));
    if (now - lastInspect > 250) {
      lastInspect = now;
      if (tab === 'object') void objInspector.refresh();
      if (tab === 'environment') void envInspector.refresh();
      // Re-centre the orbit/ground track when the simulation has moved a third of a period away.
      if (selectedId) {
        const entry = catalog.find((o) => o.id === selectedId);
        if (entry && Math.abs(ms - orbitCenterMs) > (entry.periodSeconds * 1000) / 3)
          void loadOrbitLines(selectedId);
      }
    }
    const notes: string[] = [];
    if (!connected)
      notes.push('Engine connection lost — display is extrapolating the last clock snapshot.');
    if (tracks.error) notes.push(`Data: ${tracks.error}`);
    else if (globe.dataGap && connected)
      notes.push('Waiting for engine data for this simulation time…');
    if (aircraftLayerNotice) notes.push(aircraftLayerNotice);
    overlay.textContent = notes.join(' ');
    overlay.classList.toggle('warn', !connected || !!tracks.error);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

setInterval(() => {
  if (tab === 'sources') void sources.refresh();
}, 15_000);
setInterval(() => void pollAircraft(), 60_000);

// Development aid: inspect the live objects from the browser console (not present in production builds).
if (import.meta.env.DEV)
  (window as unknown as { __sim: unknown }).__sim = { globe, tracks, clock, Cesium };
