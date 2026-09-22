/**
 * Does `deepSignal` already do what a fine-grained store does?
 *
 * The benchmark's table keeps its rows in a `signal<Row[]>`, so changing one
 * label means a new array of ten thousand — the list re-keys every row to move
 * one text node. Solid's implementation keeps its rows in a store, where the
 * same change is a write to one nested signal and the list is never re-run.
 *
 * That is the shape of `update-single-row-10k`, the one scenario Firsthand
 * still loses. Before answering it with a new list API, this asks whether the
 * answer is already in the box: `@firsthandjs/deep` makes every property a
 * signal, which is the same bet Solid's store makes.
 *
 * Same rows, same markup, same change, one browser session, interleaved. The
 * rendered text is checked before anything is timed, so a variant that quietly
 * updated nothing cannot look fast.
 *
 *   node benchmarks/deep/run.mjs
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
import { transform } from '../../packages/compiler/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

const ROWS = Number(process.env.DEEP_ROWS ?? 10000);
const REPEATS = Number(process.env.DEEP_REPEATS ?? 15);
const WARMUP = 3;
const VARIANTS = ['Plain', 'Deep'];

const firsthandCompiler = {
  name: 'firsthand',
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, (args) => ({
      contents: transform(readFileSync(args.path, 'utf8'), {
        filename: args.path,
        typescript: true,
        packageName: 'firsthand-deep-benchmark',
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
  alias: {
    '@firsthandjs/core': resolve(root, 'packages/core/src/index.ts'),
    '@firsthandjs/dom': resolve(root, 'packages/dom/src/index.ts'),
    '@firsthandjs/dom/internal': resolve(root, 'packages/dom/src/internal.ts'),
    '@firsthandjs/deep': resolve(root, 'packages/deep/src/index.ts'),
  },
  plugins: [firsthandCompiler],
});

const html =
  '<!doctype html><html><body><div id="app"></div>' +
  '<script type="module" src="./dist/harness.js"></script></body></html>';

// Two files, named here rather than taken from the request: a benchmark has no
// business turning a URL into a path on disk.
const bundle = resolve(here, 'dist', 'harness.js');

/**
 * Cross-origin isolation, for a clock that reads in 5 µs steps.
 *
 * Without it Chromium clamps `performance.now()` to 100 µs, and the whole
 * point of this benchmark is a number that turned out to be smaller than that.
 */
const ISOLATION = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
};
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
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', ...ISOLATION });
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
await page.waitForFunction(() => globalThis.deepHarness !== undefined);

if (!(await page.evaluate(() => globalThis.crossOriginIsolated))) {
  console.error('Not cross-origin isolated: the clock would be clamped. Refusing to publish.');
  process.exit(1);
}

// Both have to render the same rows, and both have to actually change one.
const rendered = {};
for (const variant of VARIANTS) {
  rendered[variant] = await page.evaluate(
    ({ which, rows }) => {
      const harness = globalThis.deepHarness;
      const mounted = harness.mount(which, rows);
      harness.update(which, 5000, 1);
      return { nodes: mounted.nodes, row: harness.text(5000) };
    },
    { which: variant, rows: ROWS },
  );
}
if (rendered.Plain.nodes !== rendered.Deep.nodes || rendered.Plain.row !== rendered.Deep.row) {
  console.error('The two variants do not render the same thing.');
  console.error(rendered);
  process.exit(1);
}
console.log(
  `Both variants render ${String(rendered.Plain.nodes)} cells, and both changed row 5000.\n`,
);

const samples = Object.fromEntries(
  VARIANTS.map((one) => [one, { mount: [], update: [], framework: [] }]),
);
for (let repeat = 0; repeat < WARMUP + REPEATS; repeat++) {
  for (const variant of VARIANTS) {
    const reading = await page.evaluate(
      ({ which, rows }) => {
        const harness = globalThis.deepHarness;
        const mounted = harness.mount(which, rows);
        return {
          mount: mounted.elapsed,
          update: harness.update(which, 5000, 5, true),
          framework: harness.update(which, 5000, 5, false),
        };
      },
      { which: variant, rows: ROWS },
    );
    if (repeat >= WARMUP) {
      samples[variant].mount.push(reading.mount);
      samples[variant].update.push(reading.update);
      samples[variant].framework.push(reading.framework);
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
  parameters: { rows: ROWS, repeats: REPEATS, warmup: WARMUP },
  variants: Object.fromEntries(
    VARIANTS.map((one) => [
      one,
      {
        mount: summarise(samples[one].mount),
        update: summarise(samples[one].update),
        framework: summarise(samples[one].framework),
      },
    ]),
  ),
};
writeFileSync(
  resolve(root, 'benchmarks', 'results', 'deep-vs-array.json'),
  `${JSON.stringify(result, null, 2)}\n`,
);

const pad = (text, width) => String(text).padEnd(width);
console.log(`${ROWS} rows, one label changed`);
console.log(`${pad('variant', 10)}${pad('mount', 14)}${pad('update', 14)}without layout`);
for (const one of VARIANTS) {
  const v = result.variants[one];
  console.log(
    `${pad(one, 10)}${pad(`${v.mount.median.toFixed(2)} ms`, 14)}` +
      `${pad(`${v.update.median.toFixed(3)} ms`, 14)}${v.framework.median.toFixed(3)} ms`,
  );
}
console.log('\nWritten to benchmarks/results/deep-vs-array.json.');

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  } catch {
    return 'unknown';
  }
}
