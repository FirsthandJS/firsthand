/**
 * Hydration, measured.
 *
 * The other half of server rendering: a browser is handed markup and has to
 * take it over. What is timed is exactly that — from the call to the framework
 * to the moment the page is live — over markup each framework produced for
 * itself, because hydration is about adopting *your own* output.
 *
 * The rules, which are the browser benchmark's rules:
 *
 * 1. **One session, interleaved.** Every framework hydrates once before any of
 *    them hydrates twice.
 * 2. **The tree is checked before anything is timed.** After hydrating, the
 *    live DOM of each framework is compared against the others with the
 *    hydration bookkeeping removed. A framework that adopted less cannot look
 *    faster.
 * 3. **Fresh markup every time.** Hydration mutates the tree it adopts, so
 *    each repetition starts from the string again, and the clock starts after
 *    the parse.
 * 4. **Cross-origin isolated**, so the clock has microsecond resolution rather
 *    than Chromium's clamped 100 µs.
 *
 * React is not here. `hydrateRoot` schedules its work rather than doing it,
 * so a number taken the same way would be the time to *start* hydrating and
 * not the time to hydrate — which is not the number this table is about.
 *
 *   node benchmarks/ssr/hydrate.mjs
 *   node benchmarks/ssr/hydrate.mjs --rows 5000
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cpus, platform, release } from 'node:os';
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import { aggregate, summarise } from '../statistics.mjs';
import { productionDev, pureDevHooks } from '../build.mjs';
import { normaliseTree as normalise } from './normalise.mjs';
import { transform } from '../../packages/compiler/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const frameworksModules = resolve(root, 'benchmarks/frameworks/node_modules');
const dist = resolve(here, 'dist');

const options = parseArguments(process.argv.slice(2));
const ROWS = options.rows ?? 1000;
const REPEATS = options.repeats ?? 11;
const WARMUP = 3;

const FRAMEWORKS = ['firsthand', 'solid', 'vue'];

// ---------------------------------------------------------------------------
// The markup each framework will be asked to take over
// ---------------------------------------------------------------------------

const server = {};
for (const name of FRAMEWORKS) {
  server[name] = await import(pathToFileURL(resolve(dist, `${name}.mjs`)).href);
}
const rows = server.firsthand.rows(ROWS);
const selected = rows[3].id;
const markup = {};
for (const name of FRAMEWORKS) {
  markup[name] = await server[name].render(rows, selected);
}

// ---------------------------------------------------------------------------
// The browser bundles
// ---------------------------------------------------------------------------

/** The real compiler, in the mode an application with a server uses. */
const firsthandClient = {
  name: 'firsthand-hydratable',
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, (args) => ({
      contents: transform(readFileSync(args.path, 'utf8'), {
        filename: args.path,
        typescript: true,
        packageName: 'firsthand-ssr-benchmark',
        hydratable: true,
      }),
      loader: 'tsx',
    }));
  },
};

const solidClient = {
  name: 'solid-hydratable',
  setup(build) {
    build.onLoad({ filter: /\.jsx$/ }, async (args) => {
      const babel = await import(
        pathToFileURL(resolve(frameworksModules, '@babel/core/lib/index.js')).href
      );
      const preset = await import(
        pathToFileURL(resolve(frameworksModules, 'babel-preset-solid/index.js')).href
      );
      const output = await babel.default.transformAsync(readFileSync(args.path, 'utf8'), {
        filename: args.path,
        babelrc: false,
        configFile: false,
        presets: [[preset.default ?? preset, { generate: 'dom', hydratable: true }]],
      });
      return { contents: output.code, loader: 'js' };
    });
  },
};

const shared = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: process.env.BENCH_DEBUG === undefined,
  legalComments: 'none',
  // The published build's `dev.js` -> `dev.prod.ts` swap, and the same list of
  // hooks marked pure. Without it this would measure a development build of
  // Firsthand against a production build of everything else.
  pure: pureDevHooks,
  define: { 'process.env.NODE_ENV': '"production"' },
};

await esbuild.build({
  ...shared,
  entryPoints: [resolve(here, 'entries', 'hydrate-firsthand.ts')],
  outfile: resolve(dist, 'client-firsthand.js'),
  plugins: [productionDev, firsthandClient],
  alias: {
    '@firsthandjs/core': resolve(root, 'packages/core/src/index.ts'),
    '@firsthandjs/dom/hydrate': resolve(root, 'packages/dom/src/hydrate.ts'),
    '@firsthandjs/dom/internal': resolve(root, 'packages/dom/src/internal.ts'),
    '@firsthandjs/dom': resolve(root, 'packages/dom/src/index.ts'),
  },
});

await esbuild.build({
  ...shared,
  entryPoints: [resolve(here, 'entries', 'hydrate-solid.jsx')],
  outfile: resolve(dist, 'client-solid.js'),
  nodePaths: [frameworksModules],
  plugins: [solidClient],
});

await esbuild.build({
  ...shared,
  entryPoints: [resolve(here, 'entries', 'hydrate-vue.js')],
  outfile: resolve(dist, 'client-vue.js'),
  nodePaths: [frameworksModules],
  define: {
    ...shared.define,
    __VUE_OPTIONS_API__: 'false',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
});

writeFileSync(
  resolve(dist, 'markup.js'),
  `export const rows = ${JSON.stringify(rows)};\n` +
    `export const selected = ${JSON.stringify(selected)};\n` +
    `export const markup = ${JSON.stringify(markup)};\n`,
);

// Solid's `hydrate` reads a registry a script on the page sets up. A Solid
// application emits it from `generateHydrationScript()`; so does this.
const page = `<!doctype html><html><head><meta charset="utf-8"><title>hydration</title>
${server.solid.hydrationScript()}</head>
<body><div id="app"></div>
<script type="module">
import { rows, selected, markup } from './markup.js';
import * as firsthand from './client-firsthand.js';
import * as solid from './client-solid.js';
import * as vue from './client-vue.js';
const frameworks = { firsthand, solid, vue };
const app = document.getElementById('app');
let stop = null;
window.__run = (name) => {
  if (stop !== null) { stop(); stop = null; }
  app.innerHTML = markup[name];
  // The clock starts after the parse: what is being timed is taking the tree
  // over, not building it.
  const started = performance.now();
  stop = frameworks[name].start(app, rows, selected) ?? null;
  const elapsed = performance.now() - started;
  return { elapsed, html: app.innerHTML };
};
window.__ready = true;
</script></body></html>`;
mkdirSync(dist, { recursive: true });
writeFileSync(resolve(dist, 'hydrate.html'), page);

// ---------------------------------------------------------------------------
// Running it
// ---------------------------------------------------------------------------

/**
 * The five files this page is made of, read once and served by name.
 *
 * A request never reaches the file system: the URL is a key into a map. The
 * set is known before the server starts, so there is no reason to join a path
 * with anything that came over a socket.
 */
const files = new Map(
  [
    ['/hydrate.html', 'text/html; charset=utf-8'],
    ['/markup.js', 'text/javascript; charset=utf-8'],
    ['/client-firsthand.js', 'text/javascript; charset=utf-8'],
    ['/client-solid.js', 'text/javascript; charset=utf-8'],
    ['/client-vue.js', 'text/javascript; charset=utf-8'],
  ].map(([name, type]) => [name, { type, body: readFileSync(resolve(dist, name.slice(1))) }]),
);

const httpServer = createServer((request, response) => {
  const url = (request.url ?? '/').split('?')[0];
  const file = files.get(url === '/' ? '/hydrate.html' : url);
  if (file === undefined) {
    response.writeHead(404).end('not found');
    return;
  }
  response.writeHead(200, {
    'content-type': file.type,
    // Cross-origin isolation, for a clock with microsecond resolution.
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
  });
  response.end(file.body);
});
await new Promise((done) => httpServer.listen(0, '127.0.0.1', done));
const port = httpServer.address().port;

const browser = await chromium.launch({ args: ['--js-flags=--expose-gc'] });
const context = await browser.newContext();
const tab = await context.newPage();
await tab.goto(`http://127.0.0.1:${port}/hydrate.html`);
await tab.waitForFunction(() => window.__ready === true);

const isolated = await tab.evaluate(() => globalThis.crossOriginIsolated);
if (!isolated) {
  console.error('Not cross-origin isolated: the clock would be clamped. Refusing to publish.');
  process.exit(1);
}

const trees = {};
for (const name of FRAMEWORKS) {
  trees[name] = normalise((await tab.evaluate((one) => window.__run(one), name)).html);
}
for (const name of FRAMEWORKS) {
  if (trees[name] !== trees.firsthand) {
    console.error(`\n${name} hydrated to a different tree than firsthand.`);
    console.error(`firsthand: ${trees.firsthand.slice(0, 300)}`);
    console.error(`${name}: ${trees[name].slice(0, 300)}`);
    process.exit(1);
  }
}
console.log(`Every framework hydrates the same ${ROWS}-row tree.\n`);

const samples = Object.fromEntries(FRAMEWORKS.map((name) => [name, []]));
for (let repeat = 0; repeat < WARMUP + REPEATS; repeat++) {
  for (const name of FRAMEWORKS) {
    const { elapsed } = await tab.evaluate((one) => window.__run(one), name);
    if (repeat >= WARMUP) {
      samples[name].push(elapsed);
    }
  }
}

await browser.close();
httpServer.close();

const stats = Object.fromEntries(FRAMEWORKS.map((name) => [name, summarise(samples[name])]));
const result = {
  measuredAt: new Date().toISOString(),
  commit: gitCommit(),
  environment: {
    platform: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
  },
  parameters: { rows: ROWS, repeats: REPEATS, warmup: WARMUP },
  frameworks: Object.fromEntries(
    FRAMEWORKS.map((name) => [name, { ...stats[name], bytes: markup[name].length }]),
  ),
  ratios: Object.fromEntries(
    FRAMEWORKS.filter((name) => name !== 'firsthand').map((name) => [
      name,
      aggregate([stats[name].median / stats.firsthand.median]),
    ]),
  ),
};
writeFileSync(
  resolve(root, 'benchmarks', 'results', 'hydration.json'),
  `${JSON.stringify(result, null, 2)}\n`,
);

const pad = (text, width) => String(text).padEnd(width);
console.log(`${pad('Framework', 12)}${pad('median', 12)}${pad('p95', 12)}ratio`);
for (const name of FRAMEWORKS) {
  const ratio =
    name === 'firsthand' ? '—' : `${(stats[name].median / stats.firsthand.median).toFixed(2)}×`;
  console.log(
    `${pad(name, 12)}${pad(`${stats[name].median.toFixed(3)} ms`, 12)}` +
      `${pad(`${stats[name].p95.toFixed(3)} ms`, 12)}${ratio}`,
  );
}
const winner = FRAMEWORKS.reduce((best, name) =>
  stats[name].median < stats[best].median ? name : best,
);
console.log(`\nFastest: ${winner}. Written to benchmarks/results/hydration.json.`);

function parseArguments(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    if (key !== undefined) {
      parsed[key] = Number(argv[i + 1]);
    }
  }
  return parsed;
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  } catch {
    return 'unknown';
  }
}
