import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import type { AircraftStateWire, GroundStation } from '@simulation/schemas';
import type { ClientClock } from './clock';
import { rotateByQuaternion } from './interp';
import type { TrackManager } from './tracks';

/**
 * The CesiumJS view. It draws what the server says and nothing else:
 *  - Earth orientation, Sun and Moon positions come from server windows (TrackManager);
 *  - lighting is driven by the engine's Sun direction (Cesium's built-in Sun/Moon ephemeris is off);
 *  - objects are server-propagated states, interpolated between server samples.
 * Cesium's own clock is set to the simulation time purely so its decorative star field is
 * oriented sensibly; nothing physical depends on it.
 */

export interface LayerState {
  atmosphere: boolean;
  illumination: boolean;
  moon: boolean;
  sun: boolean;
  objects: boolean;
  orbit: boolean;
  groundTrack: boolean;
  aircraft: boolean;
  groundStations: boolean;
  stars: boolean;
}

export const DEFAULT_LAYERS: LayerState = {
  atmosphere: true,
  illumination: true,
  moon: true,
  sun: true,
  objects: true,
  orbit: true,
  groundTrack: true,
  aircraft: false,
  groundStations: true,
  stars: true,
};

export interface SceneCallbacks {
  onSelectObject(id: string | undefined): void;
  onSelectAircraft(a: AircraftStateWire | undefined): void;
  onPickSite(latDeg: number, lonDeg: number): void;
}

const COLORS = {
  object: Cesium.Color.fromCssColorString('#7fd1ff'),
  objectSelected: Cesium.Color.fromCssColorString('#ffd479'),
  aircraft: Cesium.Color.fromCssColorString('#9be29b'),
  station: Cesium.Color.fromCssColorString('#ff9a6b'),
  orbit: Cesium.Color.fromCssColorString('#ffd479').withAlpha(0.85),
  track: Cesium.Color.fromCssColorString('#7fd1ff').withAlpha(0.7),
  site: Cesium.Color.fromCssColorString('#ffffff'),
};

export class GlobeView {
  readonly viewer: Cesium.Viewer;
  layers: LayerState = { ...DEFAULT_LAYERS };

  private readonly points: Cesium.PointPrimitiveCollection;
  private readonly labels: Cesium.LabelCollection;
  private readonly pointById = new Map<string, Cesium.PointPrimitive>();
  private readonly aircraftPoints: Cesium.PointPrimitiveCollection;
  private readonly stationPoints: Cesium.PointPrimitiveCollection;
  private readonly stationLabels: Cesium.LabelCollection;
  private readonly sunMarker: Cesium.PointPrimitiveCollection;
  private readonly sunPoint: Cesium.PointPrimitive;
  private readonly moonEntity: Cesium.Entity;
  private readonly siteMarker: Cesium.PointPrimitive;
  private readonly siteCollection: Cesium.PointPrimitiveCollection;
  private orbitLine: Cesium.PolylineCollection | undefined;
  private trackLine: Cesium.PolylineCollection | undefined;
  private selectedId: string | undefined;
  private names = new Map<string, string>();
  private objectLabel: Cesium.Label | undefined;

  // scratch
  private readonly q = [0, 0, 0, 1];
  private readonly v3 = [0, 0, 0];
  private readonly c3 = new Cesium.Cartesian3();
  private readonly lightDir = new Cesium.Cartesian3(1, 0, 0);
  private readonly quat = new Cesium.Quaternion();
  private readonly m3 = new Cesium.Matrix3();
  private readonly m4 = new Cesium.Matrix4();
  private readonly moonPos = new Cesium.Cartesian3();
  private moonVisible = false;
  dataGap = false;
  private initialViewSet = false;

  constructor(
    container: HTMLElement,
    private readonly clock: ClientClock,
    private readonly tracks: TrackManager,
    private readonly cb: SceneCallbacks,
  ) {
    // The default credit is the Cesium ion logo; this app uses no ion services (bundled imagery, no
    // terrain), so credit the open-source library honestly instead.
    Cesium.CreditDisplay.cesiumCredit = new Cesium.Credit(
      '<a href="https://cesium.com/platform/cesiumjs/" target="_blank" rel="noopener">CesiumJS</a>',
      true,
    );
    this.viewer = new Cesium.Viewer(container, {
      baseLayer: false,
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: false,
      requestRenderMode: false,
      contextOptions: { webgl: { alpha: false } },
    });
    const scene = this.viewer.scene;
    scene.backgroundColor = Cesium.Color.fromCssColorString('#05070a');
    scene.highDynamicRange = false;
    scene.globe.baseColor = Cesium.Color.fromCssColorString('#0a0e14');
    scene.globe.enableLighting = true;
    scene.globe.showGroundAtmosphere = true;
    // Cesium's own Sun/Moon ephemerides are NOT the engine's: hide them and draw the engine's.
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
    scene.light = new Cesium.DirectionalLight({
      direction: new Cesium.Cartesian3(1, 0, 0),
    });
    scene.fog.enabled = false;

    void Cesium.TileMapServiceImageryProvider.fromUrl(
      Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII'),
    ).then((p) => {
      this.viewer.imageryLayers.addImageryProvider(p);
    });

    this.points = scene.primitives.add(new Cesium.PointPrimitiveCollection());
    this.labels = scene.primitives.add(new Cesium.LabelCollection());
    this.aircraftPoints = scene.primitives.add(new Cesium.PointPrimitiveCollection());
    this.stationPoints = scene.primitives.add(new Cesium.PointPrimitiveCollection());
    this.stationLabels = scene.primitives.add(new Cesium.LabelCollection());
    this.sunMarker = scene.primitives.add(new Cesium.PointPrimitiveCollection());
    this.siteCollection = scene.primitives.add(new Cesium.PointPrimitiveCollection());
    this.sunPoint = this.sunMarker.add({
      position: new Cesium.Cartesian3(1e10, 0, 0),
      pixelSize: 12,
      color: Cesium.Color.fromCssColorString('#fff2b0'),
      outlineColor: Cesium.Color.fromCssColorString('#ffb347'),
      outlineWidth: 2,
      show: false,
    });
    this.siteMarker = this.siteCollection.add({
      position: Cesium.Cartesian3.ZERO,
      pixelSize: 9,
      color: Cesium.Color.TRANSPARENT,
      outlineColor: COLORS.site,
      outlineWidth: 2,
      show: false,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });

    this.moonEntity = this.viewer.entities.add({
      name: 'Moon',
      position: new Cesium.CallbackPositionProperty(() => this.moonPos, false),
      ellipsoid: {
        radii: new Cesium.Cartesian3(1_737_400, 1_737_400, 1_737_400),
        material: Cesium.Color.fromCssColorString('#b9bcc2'),
      },
      show: false,
    });

    this.viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(10, 20, 2.4e7) });
    scene.preRender.addEventListener(() => this.update());

    const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction(
      (e: { position: Cesium.Cartesian2 }) => this.onClick(e.position),
      Cesium.ScreenSpaceEventType.LEFT_CLICK,
    );
  }

  // ---- interaction ------------------------------------------------------------------------

  private onClick(pos: Cesium.Cartesian2): void {
    const picked = this.viewer.scene.pick(pos) as { primitive?: { id?: unknown } } | undefined;
    const id = picked?.primitive?.id;
    if (typeof id === 'string' && id.startsWith('norad:')) {
      this.cb.onSelectObject(id);
      return;
    }
    if (typeof id === 'object' && id !== null && 'icao24' in id) {
      this.cb.onSelectAircraft(id as AircraftStateWire);
      return;
    }
    const ray = this.viewer.camera.getPickRay(pos);
    const hit = ray ? this.viewer.scene.globe.pick(ray, this.viewer.scene) : undefined;
    if (hit) {
      const c = Cesium.Cartographic.fromCartesian(hit);
      this.cb.onPickSite(Cesium.Math.toDegrees(c.latitude), Cesium.Math.toDegrees(c.longitude));
      this.cb.onSelectAircraft(undefined);
    }
  }

  showSiteMarker(latDeg: number, lonDeg: number, heightM: number): void {
    this.siteMarker.position = Cesium.Cartesian3.fromDegrees(lonDeg, latDeg, heightM);
    this.siteMarker.show = true;
  }

  flyToObject(): void {
    if (!this.selectedId) return;
    const p = this.pointById.get(this.selectedId);
    if (!p) return;
    const c = Cesium.Cartographic.fromCartesian(p.position);
    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(
        c.longitude,
        c.latitude,
        Math.max(c.height * 4, 4e6),
      ),
      duration: 1.2,
    });
  }

  // ---- layers -----------------------------------------------------------------------------

  setLayers(l: LayerState): void {
    this.layers = l;
    const s = this.viewer.scene;
    s.globe.showGroundAtmosphere = l.atmosphere;
    if (s.skyAtmosphere) s.skyAtmosphere.show = l.atmosphere;
    s.globe.enableLighting = l.illumination;
    if (s.skyBox) s.skyBox.show = l.stars;
    this.points.show = l.objects;
    this.labels.show = l.objects;
    this.sunPoint.show = l.sun;
    this.moonEntity.show = l.moon && this.moonVisible;
    this.aircraftPoints.show = l.aircraft;
    this.stationPoints.show = l.groundStations;
    this.stationLabels.show = l.groundStations;
    if (this.orbitLine) this.orbitLine.show = l.orbit;
    if (this.trackLine) this.trackLine.show = l.groundTrack;
  }

  // ---- data setters -----------------------------------------------------------------------

  setObjects(list: { id: string; name: string }[]): void {
    const keep = new Set(list.map((o) => o.id));
    for (const [id, p] of this.pointById) {
      if (!keep.has(id)) {
        this.points.remove(p);
        this.pointById.delete(id);
      }
    }
    for (const o of list) {
      this.names.set(o.id, o.name);
      if (!this.pointById.has(o.id)) {
        this.pointById.set(
          o.id,
          this.points.add({
            id: o.id,
            position: Cesium.Cartesian3.ZERO,
            pixelSize: 6,
            color: COLORS.object,
            outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
            outlineWidth: 1,
            show: false,
          }),
        );
      }
    }
  }

  setGroundStations(stations: GroundStation[]): void {
    this.stationPoints.removeAll();
    this.stationLabels.removeAll();
    for (const s of stations) {
      const pos = Cesium.Cartesian3.fromDegrees(s.lonDeg, s.latDeg, s.heightM + 1000);
      this.stationPoints.add({ id: s.id, position: pos, pixelSize: 7, color: COLORS.station });
      this.stationLabels.add({
        position: pos,
        text: s.name,
        font: '11px ui-monospace, monospace',
        fillColor: COLORS.station,
        pixelOffset: new Cesium.Cartesian2(8, -8),
        scale: 1,
        showBackground: false,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2.5e7),
      });
    }
  }

  setAircraft(list: AircraftStateWire[]): void {
    this.aircraftPoints.removeAll();
    for (const a of list) {
      if (a.latDeg === null || a.lonDeg === null) continue;
      const h = a.geoAltitudeM ?? a.baroAltitudeM ?? 0;
      this.aircraftPoints.add({
        id: a,
        position: Cesium.Cartesian3.fromDegrees(a.lonDeg, a.latDeg, h),
        pixelSize: 4,
        color: a.onGround ? Cesium.Color.GRAY : COLORS.aircraft,
      });
    }
  }

  select(id: string | undefined): void {
    if (this.selectedId) {
      const p = this.pointById.get(this.selectedId);
      if (p) {
        p.color = COLORS.object;
        p.pixelSize = 6;
      }
    }
    this.selectedId = id;
    if (this.objectLabel) {
      this.labels.remove(this.objectLabel);
      this.objectLabel = undefined;
    }
    if (id) {
      const p = this.pointById.get(id);
      if (p) {
        p.color = COLORS.objectSelected;
        p.pixelSize = 10;
      }
      this.objectLabel = this.labels.add({
        position: this.pointById.get(id)?.position ?? Cesium.Cartesian3.ZERO,
        text: this.names.get(id) ?? id,
        font: '12px ui-monospace, monospace',
        fillColor: COLORS.objectSelected,
        pixelOffset: new Cesium.Cartesian2(12, -10),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#0b0d10').withAlpha(0.8),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
    } else {
      this.removeLines();
    }
  }

  private removeLines(): void {
    if (this.orbitLine) this.viewer.scene.primitives.remove(this.orbitLine);
    if (this.trackLine) this.viewer.scene.primitives.remove(this.trackLine);
    this.orbitLine = undefined;
    this.trackLine = undefined;
  }

  /** Orbit polyline in GCRF (inertial) points; drawn rotated by the engine's Earth orientation. */
  setOrbit(gcrfPositionsM: number[]): void {
    if (this.orbitLine) this.viewer.scene.primitives.remove(this.orbitLine);
    const positions: Cesium.Cartesian3[] = [];
    for (let i = 0; i + 2 < gcrfPositionsM.length; i += 3) {
      positions.push(
        new Cesium.Cartesian3(gcrfPositionsM[i], gcrfPositionsM[i + 1], gcrfPositionsM[i + 2]),
      );
    }
    this.orbitLine = new Cesium.PolylineCollection();
    this.orbitLine.add({
      positions,
      width: 1.5,
      material: Cesium.Material.fromType('Color', { color: COLORS.orbit }),
    });
    this.orbitLine.show = this.layers.orbit;
    this.viewer.scene.primitives.add(this.orbitLine);
  }

  setGroundTrack(points: { latDeg: number; lonDeg: number; heightM: number }[]): void {
    if (this.trackLine) this.viewer.scene.primitives.remove(this.trackLine);
    // Split at the antimeridian so the line does not cross the whole map.
    const segments: Cesium.Cartesian3[][] = [[]];
    let prev: number | undefined;
    for (const p of points) {
      if (prev !== undefined && Math.abs(p.lonDeg - prev) > 180) segments.push([]);
      segments[segments.length - 1]!.push(Cesium.Cartesian3.fromDegrees(p.lonDeg, p.latDeg, 3000));
      prev = p.lonDeg;
    }
    this.trackLine = new Cesium.PolylineCollection();
    for (const positions of segments) {
      if (positions.length > 1) {
        this.trackLine.add({
          positions,
          width: 1.5,
          material: Cesium.Material.fromType('Color', { color: COLORS.track }),
        });
      }
    }
    this.trackLine.show = this.layers.groundTrack;
    this.viewer.scene.primitives.add(this.trackLine);
  }

  // ---- per-frame update -------------------------------------------------------------------

  private update(): void {
    if (!this.clock.ready) return;
    const t = this.clock.nowMs();
    this.tracks.tick(this.clock);
    // Cesium's clock only orients its decorative star field.
    this.viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(t));

    const q = this.tracks.earthQuaternion(t, this.q);
    const covered = !!q;
    this.dataGap = !covered;

    // Sun: lighting + marker, from the engine's ITRF position.
    const sun = covered ? this.tracks.sunItrf(t, this.v3) : undefined;
    if (sun) {
      const n = Math.hypot(sun[0]!, sun[1]!, sun[2]!);
      const ux = sun[0]! / n;
      const uy = sun[1]! / n;
      const uz = sun[2]! / n;
      // DirectionalLight.direction is the direction light TRAVELS: from the Sun towards the Earth.
      Cesium.Cartesian3.fromElements(-ux, -uy, -uz, this.lightDir);
      // Assign a fresh vector: Cesium compares by value and would never see an in-place mutation.
      (this.viewer.scene.light as Cesium.DirectionalLight).direction = Cesium.Cartesian3.clone(
        this.lightDir,
      );
      if (!this.initialViewSet) {
        // Start on the day side so the terminator is in view: look at the Earth from ~60° off the Sun direction.
        this.initialViewSet = true;
        const ex = -uy;
        const ey = ux;
        const en = Math.hypot(ex, ey) || 1;
        const px = ux + (0.9 * ex) / en;
        const py = uy + (0.9 * ey) / en;
        const pz = uz + 0.35;
        const pn = Math.hypot(px, py, pz);
        const cam = new Cesium.Cartesian3((px / pn) * 2.4e7, (py / pn) * 2.4e7, (pz / pn) * 2.4e7);
        this.viewer.camera.setView({
          destination: cam,
          orientation: {
            direction: Cesium.Cartesian3.normalize(
              Cesium.Cartesian3.negate(cam, new Cesium.Cartesian3()),
              new Cesium.Cartesian3(),
            ),
            up: Cesium.Cartesian3.UNIT_Z,
          },
        });
      }
      this.sunPoint.position = Cesium.Cartesian3.fromElements(
        ux * 2.5e9,
        uy * 2.5e9,
        uz * 2.5e9,
        this.c3,
      );
    }
    // Moon: engine ITRF position.
    const moon = covered ? this.tracks.moonItrf(t, this.v3) : undefined;
    this.moonVisible = !!moon;
    if (moon) Cesium.Cartesian3.fromElements(moon[0]!, moon[1]!, moon[2]!, this.moonPos);
    this.moonEntity.show = this.layers.moon && this.moonVisible;

    if (!q) {
      for (const p of this.pointById.values()) p.show = false;
      return;
    }

    // Objects: GCRF Hermite-interpolated, rotated into the Earth-fixed world by the engine's quaternion.
    const r = [0, 0, 0];
    for (const [id, p] of this.pointById) {
      const g = this.tracks.objectGcrf(id, t, this.v3);
      if (!g) {
        p.show = false;
        continue;
      }
      rotateByQuaternion(q, g[0]!, g[1]!, g[2]!, r);
      p.position = Cesium.Cartesian3.fromElements(r[0]!, r[1]!, r[2]!, this.c3);
      p.show = true;
      if (id === this.selectedId && this.objectLabel) this.objectLabel.position = p.position;
    }

    // Inertial lines: rotate GCRF → fixed by the same quaternion.
    if (this.orbitLine) {
      this.quat.x = q[0]!;
      this.quat.y = q[1]!;
      this.quat.z = q[2]!;
      this.quat.w = q[3]!;
      Cesium.Matrix3.fromQuaternion(this.quat, this.m3);
      Cesium.Matrix4.fromRotationTranslation(this.m3, Cesium.Cartesian3.ZERO, this.m4);
      this.orbitLine.modelMatrix = this.m4;
    }
  }

  /** Current world position of an object (for zoom/camera), if visible. */
  objectWorldPosition(id: string): Cesium.Cartesian3 | undefined {
    return this.pointById.get(id)?.position;
  }

  destroy(): void {
    this.viewer.destroy();
  }
}
