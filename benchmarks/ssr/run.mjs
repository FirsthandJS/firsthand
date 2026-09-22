/**
 * Server rendering, measured.
 *
 * The same table — the same rows, the same classes, the same handlers that a
 * server cannot write — rendered to markup by four frameworks in one Node
 * process, interleaved, with the same statistics the browser benchmark uses.
 *
 * The rules it keeps, which are PERFORMANCE_PLAN's rules applied to a server:
 *
 * 1. **The output is checked before anything is timed.** Each framework's
 *    markup is stripped of the comments and attributes it needs for its own
 *    hydration and then compared: same elements, same classes, same text. A
 *    framework that rendered less than the others cannot look faster.
 * 2. **Interleaved.** One repetition runs every framework before the second
 *    repetition runs any of them, so a process that gets slower over time
 *    makes every number worse rather than one of them.
 * 3. **Hydratable output.** Solid is compiled with `hydratable: true` and
 *    Firsthand always emits its region markers, because markup a browser
 *    cannot take over is not the thing this is about.
 * 4. **The loser is published.** Whatever comes out goes into
 *    `benchmarks/results/ssr.json` and into the README.
 *
 *   node benchmarks/ssr/run.mjs
 *   node benchmarks/ssr/run.mjs --rows 5000 --repeats 15
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cpus, platform, release } from 'node:os';
import * as esbuild from 'esbuild';
import { aggregate, summarise } from '../statistics.mjs';
import { productionDev, pureDevHooks } from '../build.mjs';
import { normaliseMarkup as normalise } from './normalise.mjs';
import { transform } from '../../packages/compiler/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const frameworksModules = resolve(root, 'benchmarks/frameworks/node_modules');

const options = parseArguments(process.argv.slice(2));
const ROWS = options.rows ?? 1000;
const REPEATS = options.repeats ?? 11;
const WARMUP = 3;
/** Renders per timed sample. One render of 1000 rows is too short to time. */
const BATCH = 10;

// ---------------------------------------------------------------------------
// Building the four implementations
// ---------------------------------------------------------------------------

/** The real compiler, in server mode. There is no benchmark-only runtime. */
const firsthandServer = {
  name: 'firsthand-ssr',
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, (args) => ({
      contents: transform(readFileSync(args.path, 'utf8'), {
        filename: args.path,
        typescript: true,
        packageName: 'firsthand-ssr-benchmark',
        ssr: true,
      }),
      loader: 'tsx',
    }));
  },
};

/** Solid's own compiler, which is not an optional extra for Solid. */
const solidServer = {
  name: 'solid-ssr',
  setup(build) {
    build.onLoad({ filter: /\.jsx$/ }, async (args) => {
      const babel = await import(
        pathToFileURL(resolve(frameworksModules, '@babel/core/lib/index.js')).href
      );
      const preset = await import(
        pathToFileURL(resolve(frameworksModules, 'babel-preset-solid/index.js')).href
      );
      const result = await babel.default.transformAsync(readFileSync(args.path, 'utf8'), {
        filename: args.path,
        babelrc: false,
        configFile: false,
        presets: [[preset.default ?? preset, { generate: 'ssr', hydratable: true }]],
      });
      return { contents: result.code, loader: 'js' };
    });
  },
};

const dist = resolve(here, 'dist');
mkdirSync(dist, { recursive: true });

await esbuild.build({
  entryPoints: [resolve(here, 'entries', 'firsthand.ts')],
  outfile: resolve(dist, 'firsthand.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  // The published build's `dev.js` -> `dev.prod.ts` swap: measuring a
  // development build against production rivals would be measuring the
  // diagnostics.
  pure: pureDevHooks,
  plugins: [productionDev, firsthandServer],
  alias: {
    '@firsthandjs/core': resolve(root, 'packages/core/src/index.ts'),
    '@firsthandjs/dom': resolve(root, 'packages/dom/src/index.ts'),
    '@firsthandjs/server': resolve(root, 'packages/server/src/index.ts'),
    '@firsthandjs/server/internal': resolve(root, 'packages/server/src/internal.ts'),
  },
});

await esbuild.build({
  entryPoints: [resolve(here, 'entries', 'solid.js')],
  outfile: resolve(dist, 'solid.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  // Solid resolves to a different build per condition, and the server one is
  // the point here.
  conditions: ['node', 'import'],
  nodePaths: [frameworksModules],
  plugins: [solidServer],
});

await esbuild.build({
  entryPoints: [resolve(here, 'entries', 'vue.js')],
  outfile: resolve(dist, 'vue.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  conditions: ['node', 'import'],
  nodePaths: [frameworksModules],
  define: { __VUE_OPTIONS_API__: 'false', __VUE_PROD_DEVTOOLS__: 'false' },
});

await esbuild.build({
  entryPoints: [resolve(here, 'entries', 'react.js')],
  outfile: resolve(dist, 'react.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  jsx: 'transform',
  // React's server build is CommonJS and reaches for Node's own modules, so
  // it is left for Node to load rather than bundled. It is measured as an
  // application would get it.
  packages: 'external',
  define: { 'process.env.NODE_ENV': '"production"' },
});

// ---------------------------------------------------------------------------
// Running them
// ---------------------------------------------------------------------------

const FRAMEWORKS = ['firsthand', 'solid', 'vue', 'react'];
const modules = {};
for (const name of FRAMEWORKS) {
  modules[name] = await import(pathToFileURL(resolve(dist, `${name}.mjs`)).href);
}

const rows = (await import(pathToFileURL(resolve(dist, 'firsthand.mjs')).href)).rows(ROWS);

const first = normalise(await modules.firsthand.render(rows, rows[3].id));
for (const name of FRAMEWORKS) {
  const produced = normalise(await modules[name].render(rows, rows[3].id));
  if (produced !== first) {
    console.error(`\n${name} did not render the same document as firsthand.\n`);
    console.error(`firsthand: ${first.slice(0, 400)}\n`);
    console.error(`${name}: ${produced.slice(0, 400)}\n`);
    process.exit(1);
  }
}
console.log(`Every framework renders the same ${ROWS}-row document.\n`);

const samples = Object.fromEntries(FRAMEWORKS.map((name) => [name, []]));
const bytes = {};

for (let repeat = 0; repeat < WARMUP + REPEATS; repeat++) {
  for (const name of FRAMEWORKS) {
    const render = modules[name].render;
    const started = process.hrtime.bigint();
    let last = '';
    for (let i = 0; i < BATCH; i++) {
      last = await render(rows, rows[3].id);
    }
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6 / BATCH;
    bytes[name] = last.length;
    if (repeat >= WARMUP) {
      samples[name].push(elapsed);
    }
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const stats = Object.fromEntries(FRAMEWORKS.map((name) => [name, summarise(samples[name])]));
const ratios = Object.fromEntries(
  FRAMEWORKS.filter((name) => name !== 'firsthand').map((name) => [
    name,
    aggregate([stats[name].median / stats.firsthand.median]),
  ]),
);

const result = {
  measuredAt: new Date().toISOString(),
  commit: gitCommit(),
  environment: {
    node: process.version,
    platform: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
  },
  parameters: { rows: ROWS, repeats: REPEATS, warmup: WARMUP, batch: BATCH },
  frameworks: Object.fromEntries(
    FRAMEWORKS.map((name) => [name, { ...stats[name], bytes: bytes[name] }]),
  ),
  ratios,
};

mkdirSync(resolve(root, 'benchmarks', 'results'), { recursive: true });
writeFileSync(
  resolve(root, 'benchmarks', 'results', 'ssr.json'),
  `${JSON.stringify(result, null, 2)}\n`,
);

const pad = (text, width) => String(text).padEnd(width);
console.log(`${pad('Framework', 12)}${pad('median', 12)}${pad('p95', 12)}${pad('bytes', 10)}ratio`);
for (const name of FRAMEWORKS) {
  const ratio =
    name === 'firsthand' ? '—' : `${(stats[name].median / stats.firsthand.median).toFixed(2)}×`;
  console.log(
    `${pad(name, 12)}${pad(`${stats[name].median.toFixed(3)} ms`, 12)}` +
      `${pad(`${stats[name].p95.toFixed(3)} ms`, 12)}${pad(bytes[name], 10)}${ratio}`,
  );
}

const winner = FRAMEWORKS.reduce((best, name) =>
  stats[name].median < stats[best].median ? name : best,
);
console.log(`\nFastest: ${winner}. Written to benchmarks/results/ssr.json.`);

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
