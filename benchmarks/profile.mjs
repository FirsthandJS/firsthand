/**
 * Profiling: where the time and the allocations actually go.
 *
 * Two questions the timing benchmark cannot answer:
 *
 *  1. **What allocates?** The design claims the steady-state update path
 *     allocates nothing for a text or attribute change, and that a re-running
 *     effect with stable dependencies reuses its edges instead of rebuilding
 *     them. This measures bytes allocated per operation with Chromium's
 *     sampling heap profiler, so the claim is either true or it is not.
 *
 *  2. **Where is the self time?** The CPU profiler attributes time to
 *     functions, so an optimisation can be aimed at the function that is
 *     actually costing something rather than the one that looks expensive.
 *
 * It profiles Firsthand only. This is not a comparison — it is the input to the
 * next optimisation, and mixing it with the React numbers would invite reading
 * it as one.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus, platform, release } from 'node:os';
import { chromium } from 'playwright';
import { buildBenchmark } from './build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/** Each scenario runs `repeat` times inside one profiling window. */
const SCENARIOS = [
  { id: 'mount-1k', setup: [], op: ['create', 1000], repeat: 20 },
  {
    id: 'update-every-10th-1k',
    setup: [['create', 1000]],
    op: ['updateEveryTenth', 0],
    repeat: 50,
  },
  { id: 'update-single-row-1k', setup: [['create', 1000]], op: ['updateOne', 500], repeat: 200 },
  { id: 'select-row-1k', setup: [['create', 1000]], op: ['select', 500], repeat: 200 },
  { id: 'swap-rows-1k', setup: [['create', 1000]], op: ['swap', 0], repeat: 100 },
  // The two the benchmark loses to Solid, so the profiler can say why.
  { id: 'clear-10k', setup: [['create', 10000]], op: ['clear', 0], repeat: 10 },
  {
    id: 'update-single-row-10k',
    setup: [['create', 10000]],
    op: ['updateOne', 5000],
    repeat: 100,
  },
  {
    id: 'rapid-signal-writes',
    mode: 'counter',
    setup: [],
    op: ['rapidUnbatched', 10000],
    repeat: 20,
  },
];

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

async function serve(directory) {
  const server = createServer((request, response) => {
    const url = request.url === '/' ? '/index.html' : (request.url ?? '/');
    const path = url.split('?')[0];
    readFile(join(directory, path))
      .then((body) => {
        response.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'text/plain' });
        response.end(body);
      })
      .catch(() => {
        response.writeHead(404);
        response.end('not found');
      });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { server, port: server.address().port };
}

/** Total bytes in a sampling-heap-profile tree. */
function totalBytes(node) {
  let bytes = 0;
  for (const sample of node.selfSize === undefined ? [] : [node]) {
    bytes += sample.selfSize;
  }
  for (const child of node.children ?? []) {
    bytes += totalBytes(child);
  }
  return bytes;
}

/** Self bytes per function, deepest frame only, so callers are not double-counted. */
function bytesByFunction(node, into = new Map()) {
  const frame = node.callFrame ?? {};
  const name = frame.functionName === '' ? '(anonymous)' : (frame.functionName ?? '(root)');
  if (node.selfSize > 0) {
    into.set(name, (into.get(name) ?? 0) + node.selfSize);
  }
  for (const child of node.children ?? []) {
    bytesByFunction(child, into);
  }
  return into;
}

/** Self time per function from a CPU profile, in milliseconds. */
function selfTimeByFunction(profile) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map();
  const total = new Map();
  for (const node of profile.nodes) {
    total.set(node.id, node.hitCount ?? 0);
  }
  const duration = (profile.endTime - profile.startTime) / 1000;
  const hits = profile.nodes.reduce((sum, node) => sum + (node.hitCount ?? 0), 0);
  const perHit = hits === 0 ? 0 : duration / hits;
  for (const [id, count] of total) {
    const node = byId.get(id);
    const frame = node.callFrame;
    const name = frame.functionName === '' ? '(anonymous)' : frame.functionName;
    self.set(name, (self.get(name) ?? 0) + count * perHit);
  }
  return self;
}

function top(map, count) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([name, value]) => ({ name, value }));
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  } catch {
    return 'unknown';
  }
}

// Unminified, so the hotspots have names. The shape of the code is the same;
// only the identifiers differ from the timed build.
await buildBenchmark({ minify: false });
const { server, port } = await serve(resolve(here, 'app'));
const browser = await chromium.launch();
const page = await browser.newPage();
const client = await page.context().newCDPSession(page);
await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.waitForFunction(() => globalThis.harness !== undefined);

const scenarios = [];

for (const scenario of SCENARIOS) {
  const parameters = {
    setup: scenario.setup,
    op: scenario.op,
    repeat: scenario.repeat,
    mode: scenario.mode ?? 'table',
  };

  // Warm up so that the profile measures steady state, not first-run
  // compilation and lazy template parsing.
  await page.evaluate(({ setup, op, mode }) => {
    globalThis.harness.mount('firsthand', 1, mode, 0);
    for (const [operation, argument] of setup) {
      globalThis.harness.run(operation, argument);
    }
    for (let i = 0; i < 3; i++) {
      globalThis.harness.run(op[0], op[1]);
    }
    globalThis.harness.unmount();
  }, parameters);

  // Setup is mounted *before* the window opens. Leaving it inside would
  // attribute the cost of building a thousand rows to the operation under
  // test, which is how a profile ends up pointing at the wrong function.
  const mount = ({ setup, mode }) => {
    globalThis.harness.mount('firsthand', 1, mode, 0);
    for (const [operation, argument] of setup) {
      globalThis.harness.run(operation, argument);
    }
  };
  const repeatOp = ({ op, repeat }) => {
    for (let i = 0; i < repeat; i++) {
      globalThis.harness.run(op[0], op[1]);
    }
  };

  // --- allocations ---------------------------------------------------------
  await page.evaluate(mount, parameters);
  await client.send('HeapProfiler.enable');
  await client.send('HeapProfiler.collectGarbage');
  await client.send('HeapProfiler.startSampling', { samplingInterval: 256 });
  await page.evaluate(repeatOp, parameters);
  const { profile: heap } = await client.send('HeapProfiler.stopSampling');
  await client.send('HeapProfiler.disable');
  await page.evaluate(() => globalThis.harness.unmount());

  // --- self time -----------------------------------------------------------
  await page.evaluate(mount, parameters);
  await client.send('Profiler.enable');
  await client.send('Profiler.setSamplingInterval', { interval: 100 });
  await client.send('Profiler.start');
  await page.evaluate(repeatOp, parameters);
  const { profile: cpu } = await client.send('Profiler.stop');
  await client.send('Profiler.disable');
  await page.evaluate(() => globalThis.harness.unmount());

  const bytes = totalBytes(heap.head);
  scenarios.push({
    id: scenario.id,
    repetitions: scenario.repeat,
    bytesTotal: bytes,
    bytesPerOperation: Math.round(bytes / scenario.repeat),
    allocationHotspots: top(bytesByFunction(heap.head), 8),
    selfTimeHotspots: top(selfTimeByFunction(cpu), 10),
  });
  console.log(
    `  ${scenario.id.padEnd(24)} ${(bytes / scenario.repeat / 1024).toFixed(1).padStart(9)} kB/op`,
  );
}

await browser.close();
server.close();

const result = {
  metadata: {
    timestamp: new Date().toISOString(),
    os: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    browser: 'chromium',
    nodeVersion: process.version,
    gitCommit: gitCommit(),
    buildMode: 'production',
    note: 'Firsthand only. Sampling profilers: figures are estimates, not exact counts.',
  },
  scenarios,
};

mkdirSync(resolve(root, 'benchmarks', 'results'), { recursive: true });
const file = resolve(root, 'benchmarks', 'results', 'profile.json');
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(`\nProfile written to ${file}`);

for (const scenario of scenarios) {
  console.log(
    `\n${scenario.id}: ${(scenario.bytesPerOperation / 1024).toFixed(2)} kB allocated per operation`,
  );
  console.log('  allocations:');
  for (const entry of scenario.allocationHotspots.slice(0, 5)) {
    console.log(`    ${entry.name.padEnd(28)} ${(entry.value / 1024).toFixed(1)} kB`);
  }
  console.log('  self time:');
  for (const entry of scenario.selfTimeHotspots.slice(0, 5)) {
    console.log(`    ${entry.name.padEnd(28)} ${entry.value.toFixed(1)} ms`);
  }
}
