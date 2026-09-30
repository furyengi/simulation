// Downloads the small committed fixtures used by tests and by offline mode, and records where and
// when each came from in data/fixtures/manifest.json.
//
//   node packages/environment/scripts/refresh-fixtures.mjs
//
// Be a good citizen: CelesTrak refreshes GP data every 2 hours and blocks clients that poll faster;
// run this rarely. OpenSky is queried anonymously for one small bounding box (1 credit).

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../data/fixtures/', import.meta.url));
mkdirSync(dir, { recursive: true });

const UA = 'simulation-environment/0.1 (+https://github.com/furyengi/simulation) fixture-refresh';

/** @type {Array<{file:string,url:string,note?:string,transform?:(t:string)=>string}>} */
const RESOURCES = [
  {
    file: 'celestrak-gp-stations.json',
    url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json',
  },
  {
    file: 'celestrak-gp-stations.tle',
    url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle',
  },
  {
    file: 'celestrak-sw-last5years.csv',
    url: 'https://celestrak.org/SpaceData/SW-Last5Years.csv',
    note: 'Trimmed to rows dated 2025-01-01 and later (header kept); columns unchanged.',
    transform: (t) => keepRowsFrom(t, '2025-01-01'),
  },
  {
    file: 'celestrak-eop-last5years.csv',
    url: 'https://celestrak.org/SpaceData/EOP-Last5Years.csv',
    note: 'Trimmed to rows dated 2025-01-01 and later (header kept); columns unchanged.',
    transform: (t) => keepRowsFrom(t, '2025-01-01'),
  },
  { file: 'noaa-f107_cm_flux.json', url: 'https://services.swpc.noaa.gov/json/f107_cm_flux.json' },
  {
    file: 'noaa-planetary-k-index.json',
    url: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
  },
  {
    file: 'noaa-planetary_k_index_1m.json',
    url: 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json',
  },
  {
    file: 'opensky-states-alps.json',
    url: 'https://opensky-network.org/api/states/all?lamin=45.8&lomin=5.9&lamax=47.8&lomax=10.5',
    note: 'Anonymous request for a small Alpine bounding box (1 credit).',
  },
];

function keepRowsFrom(text, isoDate) {
  const lines = text.split(/\r?\n/);
  return (
    [lines[0], ...lines.slice(1).filter((l) => l && l.slice(0, 10) >= isoDate)].join('\n') + '\n'
  );
}

const manifest = [];
for (const r of RESOURCES) {
  try {
    const res = await fetch(r.url, { headers: { 'user-agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.text();
    const retrievedAtUtc = new Date().toISOString();
    const body = r.transform ? r.transform(raw) : raw;
    writeFileSync(`${dir}${r.file}`, body);
    manifest.push({
      file: r.file,
      url: r.url,
      retrievedAtUtc,
      bytes: Buffer.byteLength(body),
      sha256: createHash('sha256').update(body).digest('hex'),
      ...(r.note ? { note: r.note } : {}),
    });
    console.log(`ok   ${r.file} (${body.length} chars)`);
  } catch (e) {
    console.error(`FAIL ${r.file}: ${e.message}`);
  }
}
writeFileSync(`${dir}manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
