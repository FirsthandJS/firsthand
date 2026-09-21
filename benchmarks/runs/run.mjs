/**
 * Decides ADR-0026 by measurement.
 *
 * The same component, written twice: once with a site per expression, and once
 * as a render function that reads its source in a statement. Both are compiled
 * by the real compiler and mounted through the published protocol — there is
 * no benchmark-only runtime — and both are checked to have produced the same
 * number of nodes before anything is timed, so a variant that quietly renders
 * nothing cannot look fast.
 *
 * The shape is the one the decision turns on: twenty sites that all derive
 * from one source, which is what a detail view is.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus, platform, release } from 'node:os';
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import { transform } from '../../packages/compiler/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

const VARIANTS = ['Parts', 'Run'];
const COUNT = 1000;
const WARMUP = 3;
const REPEATS = 11;
const UPDATES = 20;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

const firsthandCompiler = {
  name: 'firsthand',
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, (args) => ({
      contents: transform(readFileSync(args.path, 'utf8'), {
        filename: args.path,
        typescript: true,
        packageName: 'firsthand-runs',
      }),
      loader: 'tsx',
    }));
  },
};

await esbuild.build({
  entryPoints: [resolve(here, 'harness.tsx')],
  outfile: resolve(here, 'dist', 'harness.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  alias: {
    '@firsthandjs/core': resolve(root, 'packages/core/src/index.ts'),
    '@firsthandjs/dom': resolve(root, 'packages/dom/src/index.ts'),
    '@firsthandjs/dom/internal': resolve(root, 'packages/dom/src/internal.ts'),
  },
  plugins: [firsthandCompiler],
});

const html =
  '<!doctype html><html><body><div id="app"></div>' +
  '<script type="module" src="./dist/harness.js"></script></body></html>';

// Two files, named here rather than taken from the request: a benchmark has
// no business turning a URL into a path on disk.
const bundle = resolve(here, 'dist', 'harness.js');

const server = createServer((request, response) => {
  const url = (request.url ?? '/').split('?')[0];
  if (url === '/' || url === '/index.html') {
    response.writeHead(200, { 'content-type': MIME['.html'] });
    response.end(html);
    return;
  }
  if (url === '/dist/harness.js') {
    readFile(bundle)
      .then((body) => {
        response.writeHead(200, { 'content-type': MIME['.js'] });
        response.end(body);
      })
      .catch(() => {
        response.writeHead(500);
        response.end('build missing');
      });
    return;
  }
  response.writeHead(404);
  response.end('not found');
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
const page = await browser.newPage();
const cdp = await page.context().newCDPSession(page);
page.on('pageerror', (error) => {
  console.error('page error:', String(error));
  process.exitCode = 1;
});
await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.waitForFunction(() => globalThis.runsHarness !== undefined);

const timings = Object.fromEntries(
  VARIANTS.map((variant) => [variant, { mount: [], update: [], heap: [] }]),
);
const nodes = {};

for (let repetition = 0; repetition < WARMUP + REPEATS; repetition++) {
  // The order rotates, so neither variant always inherits the other's heap.
  const order = repetition % 2 === 0 ? VARIANTS : [...VARIANTS].reverse();
  for (const variant of order) {
    await cdp.send('HeapProfiler.collectGarbage');
    const result = await page.evaluate(
      ({ variant: name, count, updates }) => {
        const mount = globalThis.runsHarness.mount(name, count);
        const update = globalThis.runsHarness.update(updates);
        return { ...mount, update, heap: globalThis.runsHarness.heap() };
      },
      { variant, count: COUNT, updates: UPDATES },
    );
    nodes[variant] = result.nodes;
    if (repetition >= WARMUP) {
      timings[variant].mount.push(result.elapsed);
      timings[variant].update.push(result.update);
      timings[variant].heap.push(result.heap);
    }
  }
}

await browser.close();
server.close();

const counts = new Set(Object.values(nodes));
if (counts.size !== 1) {
  console.error(`Variants rendered different numbers of nodes: ${JSON.stringify(nodes)}`);
  process.exit(1);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  } catch {
    return 'unknown';
  }
}

const rows = VARIANTS.map((variant) => ({
  variant,
  mountMs: Number(median(timings[variant].mount).toFixed(2)),
  updateMs: Number(median(timings[variant].update).toFixed(3)),
  heapMb: Number((median(timings[variant].heap) / 1048576).toFixed(1)),
}));

const report = {
  metadata: {
    timestamp: new Date().toISOString(),
    os: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    browser: 'chromium',
    nodeVersion: process.version,
    gitCommit: gitCommit(),
    components: COUNT,
    sitesPerComponent: 20,
    updatesPerMeasurement: UPDATES,
    warmupRepetitions: WARMUP,
    measuredRepetitions: REPEATS,
    nodesRendered: nodes.Parts,
  },
  rows,
};

mkdirSync(resolve(root, 'benchmarks', 'results'), { recursive: true });
writeFileSync(
  resolve(root, 'benchmarks', 'results', 'render-functions.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);

console.log(`\n${String(COUNT)} components of 20 sites, ${String(nodes.Parts)} nodes each way`);
console.log('variant   mount(ms)   update(ms)   heap(MB)');
for (const row of rows) {
  console.log(
    row.variant.padEnd(9),
    row.mountMs.toFixed(2).padStart(7),
    row.updateMs.toFixed(3).padStart(12),
    row.heapMb.toFixed(1).padStart(10),
  );
}
console.log('\nWritten to benchmarks/results/render-functions.json');
