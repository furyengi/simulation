/**
 * Progressive performance benchmark: 100 → 1 000 → 10 000 → whole catalogue.
 *
 *   npx tsx packages/environment/bench/propagation.bench.ts [group=active] [--write-docs]
 *
 * Measures, separately, (1) building propagators, (2) propagating every object at one instant,
 * (3) the server's ephemeris-window computation with frame conversion, (4) the wire cost of a
 * window (JSON size and serialisation time), (5) satellite.js's WebAssembly bulk propagator for
 * comparison, and (6) the per-frame arithmetic the BROWSER performs to animate N objects between
 * server samples. Nothing is optimised before it is measured; conclusions are in docs/performance.md.
 *
 * Element sets come from CelesTrak (one request per group, cached under .simulation-cache and
 * honouring the 2-hour rule). Nothing is written to the repository except, with --write-docs,
 * docs/performance.md.
 */
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import {
  BulkPropagator,
  EciBaseCalculator,
  createSingleThreadRuntime,
  json2satrec,
} from 'satellite.js';
import { FrameModel, Instant, Sgp4Propagator } from '@simulation/physics';
import type { OrbitalElementSet } from '@simulation/schemas';
import { CelestrakGpProvider } from '../src/providers/celestrak-gp';
import { ResourceCache } from '../src/providers/cache';
import { OrbitalService } from '../src/engine/orbital';

const group = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'active';
const writeDocs = process.argv.includes('--write-docs');

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
function time<T>(fn: () => T, runs = 5): { ms: number; result: T } {
  let result!: T;
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const a = performance.now();
    result = fn();
    t.push(performance.now() - a);
  }
  return { ms: median(t), result };
}

async function loadSets(): Promise<OrbitalElementSet[]> {
  const cache = new ResourceCache({ dir: '.simulation-cache', offline: false });
  const p = new CelestrakGpProvider({ cache, groups: [group] });
  await p.refresh();
  const st = p.status();
  console.log(
    `Loaded ${p.size} element sets from CelesTrak group "${group}" (${st.state}, retrieved ${st.retrievedAtUtc}).`,
  );
  return p.all();
}

interface Row {
  n: number;
  init: number;
  single: number;
  windowMs: number;
  windowPerSampleUs: number;
  jsonKB: number;
  jsonMs: number;
  wasmMs: number | undefined;
  clientFrameMs: number;
}

async function main(): Promise<void> {
  const all = await loadSets();
  const sizes = [100, 1000, 10000, all.length].filter(
    (n, i, a) => n <= all.length && a.indexOf(n) === i,
  );
  const frames = new FrameModel();
  const start = Instant.parse('2026-09-30T12:00:00Z');
  const SAMPLES = 30;
  const STEP = 60;
  const rows: Row[] = [];
  const wasm = await createSingleThreadRuntime();

  for (const n of sizes) {
    const sets = all.slice(0, n);

    const init = time(() => {
      const svc = new OrbitalService(frames);
      svc.load(sets);
      return svc;
    }, 3);
    const svc = init.result;
    const props = sets.map((s) => Sgp4Propagator.fromOmm(s.omm));
    const single = time(() => {
      let ok = 0;
      for (const p of props) if (p.propagate(start).status === 'ok') ok++;
      return ok;
    });

    const ids = svc.list().map((e) => e.id);
    const win = time(
      () => svc.ephemerisBatch({ ids, start, count: SAMPLES, stepSeconds: STEP, frame: 'GCRF' }),
      3,
    );
    if (win.result.status !== 'ok') throw new Error('window failed');
    const json = time(() => JSON.stringify(win.result), 3);
    const bytes = (json.result as string).length;

    let wasmMs: number | undefined;
    try {
      const satrecs = sets.map((s) => json2satrec(s.omm as Parameters<typeof json2satrec>[0]));
      const dates = Array.from(
        { length: SAMPLES },
        (_, i) => new Date(start.toDate().getTime() + i * STEP * 1000),
      );
      const w = time(() => {
        using bp = new BulkPropagator({
          runtime: wasm,
          calculators: [new EciBaseCalculator()],
          satRecsCount: satrecs.length,
          datesCount: dates.length,
        });
        bp.setSatRecs(satrecs);
        bp.setDates(dates);
        bp.run();
        return true;
      }, 3);
      wasmMs = w.ms;
    } catch (e) {
      console.warn(
        `WASM bulk propagator unavailable: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // Browser-side per-frame work: Hermite-interpolate N positions and rotate them by a quaternion.
    const w0 = win.result.value.windows;
    const tMid = 0.5 * (SAMPLES - 1) * STEP * 1000;
    const out = new Float64Array(3);
    const q = [0.001, -0.001, 0.72, 0.69];
    const client = time(() => {
      let acc = 0;
      for (const w of w0) {
        const x = tMid / (w.stepSeconds * 1000);
        const i = Math.min(Math.floor(x), w.count - 2);
        const u = x - i;
        const a = 3 * i;
        const b = a + 3;
        const h = w.stepSeconds;
        const u2 = u * u;
        const u3 = u2 * u;
        const h00 = 2 * u3 - 3 * u2 + 1;
        const h10 = u3 - 2 * u2 + u;
        const h01 = -2 * u3 + 3 * u2;
        const h11 = u3 - u2;
        for (let k = 0; k < 3; k++) {
          out[k] =
            h00 * w.positionsM[a + k]! +
            h10 * h * w.velocitiesMps[a + k]! +
            h01 * w.positionsM[b + k]! +
            h11 * h * w.velocitiesMps[b + k]!;
        }
        const tx = 2 * (q[1]! * out[2]! - q[2]! * out[1]!);
        const ty = 2 * (q[2]! * out[0]! - q[0]! * out[2]!);
        const tz = 2 * (q[0]! * out[1]! - q[1]! * out[0]!);
        acc += out[0]! + q[3]! * tx + (q[1]! * tz - q[2]! * ty) + ty + tz;
      }
      return acc;
    }, 9);

    rows.push({
      n: sets.length,
      init: init.ms,
      single: single.ms,
      windowMs: win.ms,
      windowPerSampleUs: (win.ms * 1000) / (n * SAMPLES),
      jsonKB: bytes / 1024,
      jsonMs: json.ms,
      wasmMs,
      clientFrameMs: client.ms,
    });
    console.log(JSON.stringify(rows[rows.length - 1]));
  }

  const f = (x: number, d = 1): string => x.toFixed(d);
  const table = [
    '| Objects | Build propagators (ms) | Propagate all, 1 instant (ms) | Window: 30 samples × GCRF (ms) | per object-sample (µs) | Window JSON (KB) | JSON.stringify (ms) | WASM bulk, 30 dates (ms) | Browser interp. + rotate, one frame (ms) |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map(
      (r) =>
        `| ${r.n} | ${f(r.init, 0)} | ${f(r.single)} | ${f(r.windowMs, 0)} | ${f(r.windowPerSampleUs, 2)} | ${f(r.jsonKB, 0)} | ${f(r.jsonMs, 0)} | ${r.wasmMs === undefined ? 'n/a' : f(r.wasmMs, 0)} | ${f(r.clientFrameMs, 2)} |`,
    ),
  ].join('\n');
  console.log(`\n${table}\n`);

  if (writeDocs) {
    const cpu = os.cpus()[0]?.model ?? 'unknown CPU';
    writeFileSync(
      new URL('../../../docs/performance-results.md', import.meta.url),
      `<!-- Generated by packages/environment/bench/propagation.bench.ts on ${new Date().toISOString()} -->\n` +
        `Machine: ${cpu} × ${os.cpus().length}, ${(os.totalmem() / 2 ** 30).toFixed(0)} GB RAM, Node ${process.version}, ${os.platform()} ${os.arch()}.\n` +
        `Element sets: CelesTrak group \`${group}\`. Medians of 3–9 runs.\n\n${table}\n`,
    );
  }
}

await main();
