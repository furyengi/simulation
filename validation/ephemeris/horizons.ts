import { readFileSync } from 'node:fs';
import {
  AstronomyEngineEphemeris,
  FrameModel,
  Instant,
  apply,
  degToRad,
  geodetic,
  geodeticToEcef,
  norm,
  transpose,
  vec,
  type BodyId,
} from '@simulation/physics';

/**
 * Comparison of Simulation's Sun/Moon ephemeris with JPL Horizons (DE431mx) topocentric ICRF
 * astrometric RA/Dec tables.
 *
 * Reference: raw Horizons output committed verbatim in ./reference (see SOURCE.md). Each row is the
 * astrometric (light-time-corrected, no aberration, no refraction) ICRF right ascension and
 * declination of the body as seen from the header's user-defined site.
 *
 * We reproduce exactly that quantity: body GCRF position (retarded by light time) minus the site's
 * GCRF position (site ITRF → GCRF through FrameModel), converted to RA/Dec.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface HorizonsRow {
  readonly time: Instant;
  readonly raDeg: number;
  readonly decDeg: number;
}

export interface HorizonsTable {
  readonly site: { lonDeg: number; latDeg: number; altKm: number };
  readonly rows: readonly HorizonsRow[];
}

export function parseHorizonsTable(text: string): HorizonsTable {
  const geo = /Center geodetic\s*:\s*([-\d.]+),([-\d.]+),([-\d.]+)/.exec(text);
  if (!geo) throw new Error('Horizons table: missing "Center geodetic" line');
  const soe = text.indexOf('$$SOE');
  const eoe = text.indexOf('$$EOE');
  if (soe < 0 || eoe < 0) throw new Error('Horizons table: missing $$SOE/$$EOE markers');
  const rows: HorizonsRow[] = [];
  for (const line of text.slice(soe, eoe).split('\n')) {
    const m =
      /^\s*(\d{4})-([A-Za-z]{3})-(\d{2}) (\d{2}):(\d{2})\s+(?:[A-Za-z*]+\s+)?(-?\d+\.\d+)\s+(-?\d+\.\d+)/.exec(
        line,
      );
    if (!m) continue;
    const month = MONTHS.indexOf(m[2]!) + 1;
    const iso = `${m[1]}-${String(month).padStart(2, '0')}-${m[3]}T${m[4]}:${m[5]}:00Z`;
    rows.push({ time: Instant.parse(iso), raDeg: Number(m[6]), decDeg: Number(m[7]) });
  }
  return {
    site: { lonDeg: Number(geo[1]), latDeg: Number(geo[2]), altKm: Number(geo[3]) },
    rows,
  };
}

export interface EphemerisComparison {
  readonly body: BodyId;
  readonly count: number;
  readonly maxArcsec: number;
  readonly meanArcsec: number;
  readonly rmsArcsec: number;
  readonly worst: { iso: string; arcsec: number };
}

const eph = new AstronomyEngineEphemeris();
const frames = new FrameModel(); // no EOP: UT1 ≡ UTC, zero polar motion (effect ≲ 0.25″ on the Moon's parallax)

export function compareWithHorizons(
  body: BodyId,
  file: string,
  fromIso: string,
  toIso: string,
  stride = 1,
): EphemerisComparison {
  const table = parseHorizonsTable(readFileSync(file, 'utf8'));
  const from = Instant.parse(fromIso);
  const to = Instant.parse(toIso);
  const site = geodeticToEcef(
    geodetic(degToRad(table.site.latDeg), degToRad(table.site.lonDeg), table.site.altKm * 1000),
  );

  const errors: number[] = [];
  let worst = { iso: '', arcsec: -1 };
  table.rows.forEach((row, i) => {
    if (i % stride !== 0 || row.time.compare(from) < 0 || row.time.compare(to) > 0) return;
    const r = eph.state(body, row.time, 'astrometric');
    if (r.status !== 'ok') throw new Error(r.reason);
    const o = frames.orientation(row.time);
    const siteGcrf = apply(transpose(o.itrfFromGcrf), site);
    const d = vec(r.state.position).map((v, k) => v - siteGcrf[k]!) as [number, number, number];
    const ra = Math.atan2(d[1], d[0]);
    const dec = Math.asin(d[2] / norm(d));
    const ra0 = degToRad(row.raDeg);
    const dec0 = degToRad(row.decDeg);
    // Angular separation (haversine form; stable for tiny angles).
    const s =
      2 *
      Math.asin(
        Math.sqrt(
          Math.sin((dec - dec0) / 2) ** 2 +
            Math.cos(dec) * Math.cos(dec0) * Math.sin((ra - ra0) / 2) ** 2,
        ),
      );
    const arcsec = (s * 180 * 3600) / Math.PI;
    errors.push(arcsec);
    if (arcsec > worst.arcsec) worst = { iso: row.time.toIso(), arcsec };
  });
  const n = errors.length;
  const sum = errors.reduce((a, b) => a + b, 0);
  return {
    body,
    count: n,
    maxArcsec: Math.max(...errors),
    meanArcsec: sum / n,
    rmsArcsec: Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / n),
    worst,
  };
}
