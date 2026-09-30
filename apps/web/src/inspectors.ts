import type { AircraftStateWire, OrbitalObjectState } from '@simulation/schemas';
import { api, type EnvironmentAt, type Wire } from './api';
import { h, setChildren } from './dom';
import { DEG, fmtDuration, fmtKm, fmtLatLon, fmtNum, fmtSci, fmtUtc, fmtVec } from './format';
import { kindBadge, kv, provenanceDetails, providerCard, resultSection } from './provenance-ui';

export type InspectorFrame = 'GCRF' | 'TEME' | 'ITRF';

/** Selected orbital object: authoritative server state, sampled a few times per second. */
export class ObjectInspector {
  readonly el = h('div', { class: 'inspector' });
  private id: string | undefined;
  private frame: InspectorFrame = 'GCRF';
  private busy = false;
  private lastKey = '';
  private last: Wire<OrbitalObjectState> | undefined;

  constructor(private readonly getSimIso: () => string) {
    this.render();
  }

  setObject(id: string | undefined): void {
    this.id = id;
    this.lastKey = '';
    this.last = undefined;
    this.render();
  }

  setFrame(f: InspectorFrame): void {
    this.frame = f;
    this.lastKey = '';
    this.render();
  }

  /** Called ~4×/s and on changes; fetches only when the simulation time changed. */
  async refresh(): Promise<void> {
    if (!this.id || this.busy) return;
    const iso = this.getSimIso();
    const key = `${this.id}|${this.frame}|${iso.slice(0, 19)}`;
    if (key === this.lastKey) return;
    this.busy = true;
    try {
      this.last = await api.objectState(this.id, iso, this.frame);
      this.lastKey = key;
      this.render();
    } catch (e) {
      this.last = undefined;
      setChildren(
        this.el,
        h(
          'div',
          { class: 'refusal unavailable' },
          `Request failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    } finally {
      this.busy = false;
    }
  }

  private render(): void {
    if (!this.id) {
      setChildren(
        this.el,
        h('div', { class: 'empty' }, 'Select an object on the globe or from the list.'),
      );
      return;
    }
    const frameSel = h(
      'select',
      {
        onchange: (e: Event) =>
          this.setFrame((e.target as HTMLSelectElement).value as InspectorFrame),
      },
      ...(['GCRF', 'TEME', 'ITRF'] as const).map((f) =>
        h('option', { value: f, ...(f === this.frame ? { selected: true } : {}) }, f),
      ),
    );
    if (!this.last) {
      setChildren(this.el, h('div', { class: 'dim' }, `Loading ${this.id}…`));
      return;
    }
    setChildren(
      this.el,
      h('div', { class: 'row-between' }, h('span', { class: 'dim' }, 'Vector frame'), frameSel),
      resultSection('Propagated state', this.last, (v) => objectRows(v)),
    );
  }
}

function objectRows(v: OrbitalObjectState) {
  const e = v.elements;
  return [
    h(
      'div',
      { class: 'obj-name' },
      v.name,
      h('span', { class: 'dim' }, ` ${v.id} · ${v.intlDesignator}`),
    ),
    h(
      'div',
      { class: 'tag-row' },
      kindBadge('PROPAGATED'),
      h('span', { class: 'dim' }, 'SGP4 from CelesTrak OMM — not a live measurement'),
    ),
    kv('Sample time', fmtUtc(v.timeUtc), 'The simulation time this state was computed for'),
    kv(
      `Position ${v.frame}`,
      fmtVec(
        v.positionM.map((x) => x / 1000),
        'km',
        3,
      ),
    ),
    kv(
      `Velocity ${v.frame}`,
      fmtVec(
        v.velocityMps.map((x) => x / 1000),
        'km/s',
        6,
      ),
    ),
    kv('Speed', fmtNum(v.speedMps / 1000, 4, 'km/s')),
    kv('Sub-point', fmtLatLon(v.geodetic.latDeg, v.geodetic.lonDeg)),
    kv('Height (ellipsoid)', fmtKm(v.geodetic.heightM)),
    h('div', { class: 'sub-title' }, 'Source elements'),
    kv('Source', `${e.source.provider} · ${e.source.dataset}`),
    kv('Source epoch', fmtUtc(e.epochUtc)),
    kv('Retrieved', e.source.retrievedAtUtc ? fmtUtc(e.source.retrievedAtUtc) : '—'),
    kv('Period', fmtNum(e.periodSeconds / 60, 3, 'min')),
    kv('Inclination', fmtNum(e.inclinationDeg, 4, '°')),
    kv('Eccentricity', fmtNum(e.eccentricity, 7)),
    kv('Mean motion', fmtNum(e.meanMotionRevPerDay, 8, 'rev/day')),
    kv('RAAN', fmtNum(e.raanDeg, 4, '°')),
    kv('Arg. perigee', fmtNum(e.argPerigeeDeg, 4, '°')),
    kv('Mean anomaly', fmtNum(e.meanAnomalyDeg, 4, '°')),
    kv('B*', fmtSci(e.bstar, 4, '1/ER')),
    kv('Theory', e.regime === 'near' ? 'SGP4 (near-Earth)' : 'SDP4 (deep-space)'),
  ];
}

/** Environment at a picked point on the globe. */
export class EnvironmentInspector {
  readonly el = h('div', { class: 'inspector' });
  private site: { latDeg: number; lonDeg: number; heightM: number } | undefined;
  private busy = false;
  private lastKey = '';
  private data: EnvironmentAt | undefined;
  private error: string | undefined;

  constructor(
    private readonly getSimIso: () => string,
    private readonly onSite: (latDeg: number, lonDeg: number, heightM: number) => void,
  ) {
    this.render();
  }

  setSite(latDeg: number, lonDeg: number): void {
    this.site = { latDeg, lonDeg, heightM: this.site?.heightM ?? 0 };
    this.lastKey = '';
    this.onSite(latDeg, lonDeg, this.site.heightM);
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.site || this.busy) return;
    const iso = this.getSimIso();
    const key = `${this.site.latDeg.toFixed(4)},${this.site.lonDeg.toFixed(4)},${this.site.heightM}|${iso.slice(0, 16)}`;
    if (key === this.lastKey) return;
    this.busy = true;
    try {
      this.data = await api.environmentAt(this.site, iso);
      this.error = undefined;
      this.lastKey = key;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private render(): void {
    if (!this.site) {
      setChildren(
        this.el,
        h('div', { class: 'empty' }, 'Click the globe to query the environment at a point.'),
      );
      return;
    }
    const s = this.site;
    const heightInput = h('input', {
      type: 'number',
      value: s.heightM,
      step: 1000,
      class: 'num',
      onchange: (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) {
          s.heightM = v;
          this.lastKey = '';
          this.onSite(s.latDeg, s.lonDeg, v);
          void this.refresh();
        }
      },
    });
    const head = [
      kv('Point', fmtLatLon(s.latDeg, s.lonDeg)),
      h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Height (m, ellipsoid)'), heightInput),
    ];
    if (this.error) {
      setChildren(this.el, ...head, h('div', { class: 'refusal unavailable' }, this.error));
      return;
    }
    const d = this.data;
    if (!d) {
      setChildren(this.el, ...head, h('div', { class: 'dim' }, 'Loading…'));
      return;
    }
    setChildren(
      this.el,
      ...head,
      kv('For simulation time', fmtUtc(d.timeUtc)),
      resultSection('Sun illumination', d.illumination, (v) => [
        kv('Condition', v.condition.replace('_', ' ')),
        kv(
          'Solar elevation',
          fmtNum(v.solarElevationRad * DEG, 3, '°'),
          'Geometric elevation of the Sun’s centre, no refraction',
        ),
      ]),
      resultSection('Sun', d.sunDirection, (v) => [
        kv('Sub-solar point', fmtLatLon(v.subSolarPoint.latDeg, v.subSolarPoint.lonDeg, 3)),
        kv('Distance', `${(v.distanceM / 1.495978707e11).toFixed(6)} au`),
        kv('Light-time', v.lightTime),
      ]),
      d.eclipse
        ? resultSection('Eclipse (Earth shadow)', d.eclipse, (v) => [
            kv('State', v.condition),
            kv('Sun visible', `${(v.illuminatedFraction * 100).toFixed(2)} %`),
          ])
        : null,
      resultSection('Gravity', d.gravity, (v) => [
        kv('|g| (with centrifugal)', fmtNum(v.gravityMagnitude, 6, 'm/s²')),
        kv('Gravitation ITRF', fmtVec(v.gravitationItrf, 'm/s²', 6)),
        kv('Field', v.field),
      ]),
      resultSection('Atmosphere (NRLMSISE-00)', d.atmosphere, (v) => [
        kv('Mass density', fmtSci(v.totalMassDensityKgM3, 4, 'kg/m³')),
        kv('Temperature', fmtNum(v.temperatureK, 1, 'K')),
        kv('Pressure (derived)', fmtSci(v.pressurePa, 4, 'Pa')),
        kv('Exospheric T', fmtNum(v.exosphericTemperatureK, 1, 'K')),
        kv('n(N₂)', fmtSci(v.numberDensityM3.N2, 3, 'm⁻³')),
        kv('n(O)', fmtSci(v.numberDensityM3.O, 3, 'm⁻³')),
        kv(
          'Inputs F10.7 / 81d / Ap',
          `${v.modelInputs.f107Sfu} / ${v.modelInputs.f107AvgSfu} sfu / ${v.modelInputs.apDaily}`,
        ),
        kv('Local solar time', fmtNum(v.modelInputs.localSolarTimeHours, 2, 'h')),
      ]),
      resultSection('Space weather', d.spaceWeather, (v) => [
        kv('Day', `${v.dayUtc} (${v.dataType})`),
        kv('F10.7 (obs)', fmtNum(v.f107ObsSfu, 1, 'sfu')),
        kv('F10.7 81-day mean', fmtNum(v.f107Avg81CenteredSfu, 1, 'sfu')),
        kv('Ap (daily)', fmtNum(v.apDaily, 0)),
        kv('Kp (3-hourly)', v.kp3Hourly.map((k) => (k === null ? '–' : k.toFixed(1))).join(' ')),
        v.nowcast?.kpEstimated1Min
          ? kv(
              'NOAA Kp now (est.)',
              `${v.nowcast.kpEstimated1Min.kp.toFixed(2)} @ ${v.nowcast.kpEstimated1Min.timeUtc}`,
            )
          : null,
      ]),
    );
  }
}

export function aircraftInspector(a: AircraftStateWire | undefined, notice: string): HTMLElement {
  if (!a) return h('div', { class: 'empty' }, 'Select an aircraft.');
  return h(
    'div',
    { class: 'inspector' },
    h(
      'div',
      { class: 'obj-name' },
      a.callsign ?? a.icao24,
      h('span', { class: 'dim' }, ` ${a.id}`),
    ),
    h(
      'div',
      { class: 'tag-row' },
      kindBadge('OBSERVED'),
      h('span', { class: 'dim' }, `${a.positionSource} report (OpenSky)`),
    ),
    kv('Position report', a.positionTimeUtc ? fmtUtc(a.positionTimeUtc) : '—'),
    kv('Last contact', a.lastContactUtc ? fmtUtc(a.lastContactUtc) : '—'),
    kv('Position', a.latDeg !== null && a.lonDeg !== null ? fmtLatLon(a.latDeg, a.lonDeg) : '—'),
    kv(
      'Baro altitude',
      a.baroAltitudeM !== null ? `${a.baroAltitudeM.toFixed(0)} m (pressure altitude)` : '—',
    ),
    kv('Geometric altitude', a.geoAltitudeM !== null ? `${a.geoAltitudeM.toFixed(0)} m` : '—'),
    kv(
      'Ground speed',
      a.groundSpeedMps !== null
        ? `${a.groundSpeedMps.toFixed(1)} m/s (${(a.groundSpeedMps * 1.943844).toFixed(0)} kt)`
        : '—',
    ),
    kv('Track', a.trackDeg !== null ? `${a.trackDeg.toFixed(1)}° (true, over ground)` : '—'),
    kv('Vertical rate', a.verticalRateMps !== null ? `${a.verticalRateMps.toFixed(1)} m/s` : '—'),
    kv('Origin country', a.originCountry),
    kv('On ground', a.onGround ? 'yes' : 'no'),
    h('div', { class: 'notice' }, notice),
  );
}

export function sourcesPanel(): { el: HTMLElement; refresh(): Promise<void> } {
  const el = h('div', { class: 'inspector' });
  const refresh = async (): Promise<void> => {
    try {
      const r = await api.providers();
      setChildren(
        el,
        h(
          'div',
          { class: 'dim' },
          'Every externally derived value in the viewer comes from one of these sources. “Age” is wall-clock time since the bytes were obtained.',
        ),
        ...r.providers.map(providerCard),
      );
    } catch (e) {
      setChildren(
        el,
        h('div', { class: 'refusal unavailable' }, e instanceof Error ? e.message : String(e)),
      );
    }
  };
  return { el, refresh };
}

export { fmtDuration, provenanceDetails };
