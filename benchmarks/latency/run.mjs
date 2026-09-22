/**
 * Where the two sub-millisecond scenarios actually spend their time.
 *
 * `portal-update` and `input-event-latency` are the two rows Firsthand is
 * furthest behind on, and in a geometric mean every scenario weighs the same
 * — so a 0.135 ms miss there costs the aggregate more than a 2.5 ms miss on a
 * ten-thousand-row update. This is the isolation step before any optimising:
 * five variants, each timed with the layout flush and without it.
 *
 * Firsthand only. It is not a comparison — it is the input to the next
 * decision, and mixing in another framework's numbers would invite reading it
 * as one.
 *
 *   node benchmarks/latency/run.mjs
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
import { summarise } from '../statistics.mjs';
import { productionDev, pureDevHooks } from '../build.mjs';
import { transform } from '../../packages/compiler/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

const REPEATS = Number(process.env.LATENCY_REPEATS ?? 21);
const WARMUP = 5;
/** Operations per timed sample: one input event is well under the clock. */
const BATCH = 50;

const VARIANTS = [
  { id: 'plain', label: 'text update, in place' },
  { id: 'ported', label: 'text update, through a portal' },
  { id: 'delegated', label: 'input event to text, delegated' },
  { id: 'direct', label: 'input event to text, direct listener' },
  { id: 'empty', label: 'input event, handler does nothing' },
];

const firsthandCompiler = {
  name: 'firsthand',
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, (args) => ({
      contents: transform(readFileSync(args.path, 'utf8'), {
        filename: args.path,
        typescript: true,
        packageName: 'firsthand-latency-benchmark',
      }),
      loader: 'tsx',
    }));
  },
};

mkdirSync(resolve(here, 'dist'), { recursive: true });
await esbuild.build({
  entryPoints: [resolve(here, 'harness.tsx')],
  outfile: resolve(here, 'dist', 'harness.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  // The published build's `dev.js` -> `dev.prod.ts` swap. Measuring the
  // development build was worth a factor of three the last time it happened.
  pure: pureDevHooks,
  plugins: [productionDev, firsthandCompiler],
  alias: {
    '@firsthandjs/core': resolve(root, 'packages/core/src/index.ts'),
    '@firsthandjs/dom': resolve(root, 'packages/dom/src/index.ts'),
    '@firsthandjs/dom/internal': resolve(root, 'packages/dom/src/internal.ts'),
  },
});

const html =
  '<!doctype html><html><body><div id="scratch"></div><div id="portal-target"></div>' +
  '<script type="module" src="./dist/harness.js"></script></body></html>';

/** Cross-origin isolation, for a clock that reads in 5 µs rather than 100. */
const ISOLATION = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
};

// Two files, named here rather than taken from the request: a benchmark has no
// business turning a URL into a path on disk.
const bundle = resolve(here, 'dist', 'harness.js');
const server = createServer((request, response) => {
  const url = (request.url ?? '/').split('?')[0];
  if (url === '/' || url === '/index.html') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...ISOLATION });
    response.end(html);
    return;
  }
  if (url === '/dist/harness.js') {
    readFile(bundle)
      .then((body) => {
        response.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
          ...ISOLATION,
        });
        response.end(body);
      })
      .catch(() => {
        response.writeHead(500).end('build missing');
      });
    return;
  }
  response.writeHead(404).end('not found');
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (error) => {
  console.error('page error:', String(error));
  process.exitCode = 1;
});
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
await page.waitForFunction(() => globalThis.latency !== undefined);

if (!(await page.evaluate(() => globalThis.crossOriginIsolated))) {
  console.error('Not cross-origin isolated: the clock would be clamped. Refusing to publish.');
  process.exit(1);
}

// Each variant has to render something, and its operation has to change it.
for (const variant of VARIANTS) {
  const proof = await page.evaluate((id) => {
    const harness = globalThis.latency;
    harness.setup();
    const nodes = harness.mount(id);
    const before = harness.shown(id);
    harness.measure(id, 1, true);
    return { nodes, before, after: harness.shown(id) };
  }, variant.id);
  if (proof.nodes === 0 || (variant.id !== 'empty' && proof.before === proof.after)) {
    console.error(`\n${variant.id} did not change what it renders.`);
    console.error(proof);
    process.exit(1);
  }
}
console.log('Every variant renders, and every operation changes what it renders.\n');

const samples = Object.fromEntries(
  VARIANTS.map((one) => [one.id, { framework: [], withLayout: [], first: [] }]),
);
for (let repeat = 0; repeat < WARMUP + REPEATS; repeat++) {
  for (const variant of VARIANTS) {
    const reading = await page.evaluate(
      ({ id, batch }) => {
        const harness = globalThis.latency;
        harness.setup();
        harness.mount(id);
        return {
          framework: harness.measure(id, batch, false),
          withLayout: harness.measure(id, batch, true),
          first: harness.measureFirst(id, true),
        };
      },
      { id: variant.id, batch: BATCH },
    );
    if (repeat >= WARMUP) {
      samples[variant.id].framework.push(reading.framework);
      samples[variant.id].withLayout.push(reading.withLayout);
      samples[variant.id].first.push(reading.first);
    }
  }
}

await browser.close();
server.close();

const result = {
  measuredAt: new Date().toISOString(),
  commit: gitCommit(),
  environment: {
    platform: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
  },
  parameters: { repeats: REPEATS, warmup: WARMUP, batch: BATCH },
  variants: Object.fromEntries(
    VARIANTS.map((one) => [
      one.id,
      {
        label: one.label,
        framework: summarise(samples[one.id].framework),
        withLayout: summarise(samples[one.id].withLayout),
        first: summarise(samples[one.id].first),
      },
    ]),
  ),
};
writeFileSync(
  resolve(root, 'benchmarks', 'results', 'latency.json'),
  `${JSON.stringify(result, null, 2)}\n`,
);

const pad = (text, width) => String(text).padEnd(width);
const us = (value) => `${(value * 1000).toFixed(1)} µs`;
console.log(
  `${pad('variant', 38)}${pad('framework', 13)}${pad('with layout', 13)}first after mount`,
);
for (const one of VARIANTS) {
  const v = result.variants[one.id];
  console.log(
    `${pad(one.label, 38)}${pad(us(v.framework.median), 13)}` +
      `${pad(us(v.withLayout.median), 13)}${us(v.first.median)}`,
  );
}
console.log('\nWritten to benchmarks/results/latency.json.');

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  } catch {
    return 'unknown';
  }
}
