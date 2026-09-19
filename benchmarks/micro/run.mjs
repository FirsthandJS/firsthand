/**
 * Runs the two micro-benchmarks that ADR-0003 and ADR-0012 are waiting for.
 *
 * Neither is a comparison against another framework. Each answers a question
 * about a default Firsthand chose: whether hosting every component in a custom
 * element would really have been too expensive, and whether delegated events
 * are worth their dispatch-time lookup.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus, platform, release } from 'node:os';
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import { transform } from '../../packages/compiler/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

const WARMUP = 3;
const REPEATS = 12;
const COUNT = 2000;
const DEPTHS = [1, 5, 20];

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

const firsthandCompiler = {
  name: 'firsthand',
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, (args) => ({
      contents: transform(readFileSync(args.path, 'utf8'), {
        filename: args.path,
        typescript: true,
        packageName: 'firsthand-micro',
      }),
      loader: 'tsx',
    }));
  },
};

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

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  } catch {
    return 'unknown';
  }
}

await esbuild.build({
  entryPoints: [resolve(here, 'harness.tsx')],
  outfile: resolve(here, 'dist', 'harness.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  plugins: [firsthandCompiler],
});

const { server, port } = await serve(here);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.waitForFunction(() => globalThis.micro !== undefined);

// --- ADR-0003: what an element host actually costs ---------------------------

const VARIANTS = ['hostless', 'hosted', 'shadowed'];
const hostMount = Object.fromEntries(VARIANTS.map((name) => [name, []]));
const hostUpdate = Object.fromEntries(VARIANTS.map((name) => [name, []]));
let nodeCounts = {};

for (let repetition = 0; repetition < WARMUP + REPEATS; repetition++) {
  // Order rotates, so the first variant does not inherit the previous one's state.
  const order = VARIANTS.map((_, i) => VARIANTS[(i + repetition) % VARIANTS.length]);
  for (const variant of order) {
    const result = await page.evaluate(
      ({ variant: name, count }) => {
        const mount = globalThis.micro.measureMount(name, count);
        const update = globalThis.micro.measureUpdate();
        globalThis.micro.unmount();
        return { ...mount, update };
      },
      { variant, count: COUNT },
    );
    if (repetition >= WARMUP) {
      hostMount[variant].push(result.elapsed);
      hostUpdate[variant].push(result.update);
      nodeCounts[variant] = result.nodes;
    }
  }
}

// --- ADR-0012: delegation versus direct listeners ----------------------------

const events = [];
for (const depth of DEPTHS) {
  const setup = { delegated: [], direct: [] };
  const dispatch = { delegated: [], direct: [] };
  for (let repetition = 0; repetition < WARMUP + REPEATS; repetition++) {
    for (const delegated of repetition % 2 === 0 ? [true, false] : [false, true]) {
      const key = delegated ? 'delegated' : 'direct';
      const setupTime = await page.evaluate(
        ({ delegated: flag, count, depth: levels }) => {
          const elapsed = globalThis.micro.measureListenerSetup(flag, count, levels);
          globalThis.micro.unmount();
          return elapsed;
        },
        { delegated, count: COUNT, depth },
      );
      const dispatchResult = await page.evaluate(
        ({ delegated: flag, count, depth: levels }) => {
          const result = globalThis.micro.measureDispatch(flag, count, levels);
          globalThis.micro.unmount();
          return result;
        },
        { delegated, count: COUNT, depth },
      );
      if (dispatchResult.hits !== COUNT) {
        console.error(`Dispatch lost events at depth ${depth}: ${dispatchResult.hits}/${COUNT}`);
        process.exitCode = 1;
      }
      if (repetition >= WARMUP) {
        setup[key].push(setupTime);
        dispatch[key].push(dispatchResult.elapsed);
      }
    }
  }
  events.push({
    depth,
    rows: COUNT,
    setup: { delegated: median(setup.delegated), direct: median(setup.direct) },
    dispatch: { delegated: median(dispatch.delegated), direct: median(dispatch.direct) },
  });
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
    components: COUNT,
    warmupRepetitions: WARMUP,
    measuredRepetitions: REPEATS,
  },
  elementHost: VARIANTS.map((variant) => ({
    variant,
    mountMedian: median(hostMount[variant]),
    updateMedian: median(hostUpdate[variant]),
    domNodes: nodeCounts[variant],
  })),
  events,
};

mkdirSync(resolve(root, 'benchmarks', 'results'), { recursive: true });
const file = resolve(root, 'benchmarks', 'results', 'micro.json');
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(`\nRaw results written to ${file}\n`);

console.log(`  element host, ${COUNT} components (ADR-0003):`);
for (const entry of result.elementHost) {
  console.log(
    `    ${entry.variant.padEnd(10)} mount ${entry.mountMedian.toFixed(2).padStart(8)} ms   ` +
      `update ${entry.updateMedian.toFixed(2).padStart(7)} ms   ${entry.domNodes} DOM nodes`,
  );
}

console.log(`\n  events, ${COUNT} rows (ADR-0012):`);
for (const entry of events) {
  console.log(
    `    depth ${String(entry.depth).padStart(2)}   setup  delegated ${entry.setup.delegated.toFixed(2).padStart(7)} ms` +
      `   direct ${entry.setup.direct.toFixed(2).padStart(7)} ms`,
  );
  console.log(
    `              dispatch  delegated ${entry.dispatch.delegated.toFixed(2).padStart(7)} ms` +
      `   direct ${entry.dispatch.direct.toFixed(2).padStart(7)} ms`,
  );
}
