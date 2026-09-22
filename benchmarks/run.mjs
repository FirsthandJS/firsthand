/**
 * The benchmark runner.
 *
 * It enforces the rules in PERFORMANCE_PLAN.md in code rather than in prose:
 *
 *  1. Every implementation runs in the **same browser session**, interleaved
 *     per repetition, so drift in CPU frequency or GC state hits all of them
 *     equally.
 *  2. A **DOM-equality phase runs first**. If the implementations do not render
 *     the same thing for the same data, the run aborts before any timing
 *     happens.
 *  3. Production builds, one seeded dataset, warmup repetitions discarded.
 *  4. Every scenario is recorded, including the ones Firsthand loses.
 *  5. The raw result file carries the full environment, so a number can never
 *     be quoted without the machine it came from.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus, totalmem, platform, release } from 'node:os';
import { chromium } from 'playwright';
import { buildBenchmark } from './build.mjs';
import { aggregate, summarise } from './statistics.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/**
 * `BENCH_SCALE=heavy` swaps in the 100 000-row scenarios.
 *
 * They are a separate run rather than extra rows in the default suite: a single
 * repetition costs seconds, so folding them in would either make the everyday
 * run unusable or force a lower repetition count on every scenario. The heavy
 * results are written to their own file and are not mixed into the default
 * aggregate — averaging measurements taken with different sample sizes would
 * quietly weaken the confidence interval.
 */
const HEAVY = process.env.BENCH_SCALE === 'heavy';

/**
 * `BENCH_LAYOUT=off` measures the framework's own work, without the forced
 * layout that follows it.
 *
 * The published numbers include that layout deliberately — see the README —
 * but every framework pays the same browser for the same DOM, so the totals
 * understate how far apart the frameworks themselves are. Running both ways
 * is how you find out whether a scenario is worth optimising at all.
 */
const LAYOUT = process.env.BENCH_LAYOUT !== 'off';

/** `BENCH_ONLY=id,id` narrows the run to the scenarios worth looking at. */
const ONLY = (process.env.BENCH_ONLY ?? '')
  .split(',')
  .map((one) => one.trim())
  .filter((one) => one !== '');
const WARMUP = Number(process.env.BENCH_WARMUP ?? (HEAVY ? 1 : 5));
const REPEATS = Number(process.env.BENCH_REPEATS ?? (HEAVY ? 7 : 25));
const SEED = 0x51a2d;
const NL = String.fromCharCode(10);

/** Firsthand first, then everything it is measured against. */
const FRAMEWORKS = ['firsthand', 'react', 'solid', 'vue'];
const RIVALS = FRAMEWORKS.slice(1);

/**
 * The one difference in rendered markup that is accepted, and why.
 *
 * Vue writes `class=""` where the others leave the attribute off, because a
 * class binding that evaluates to nothing is normalised to an empty string
 * before it is patched. The two are the same element with the same classes and
 * the same layout; insisting on the byte would mean writing the benchmark's
 * markup around one framework's attribute handling.
 *
 * Nothing else is normalised. A comment node, a text node, an attribute value
 * or an element out of place still fails the run.
 */
function comparable(html) {
  return html.replaceAll(' class=""', '');
}

/**
 * One scenario: a setup sequence that is not timed, then the operation that is.
 * Both implementations receive an identical sequence.
 */
/**
 * Mass data. Deliberately short.
 *
 * Every scenario that needs a 100 000-row *setup* before the timed operation
 * costs two full mounts per repetition per framework, and holding two such
 * trees pushes the browser into swapping on an ordinary machine — which
 * measures the machine, not the framework. Mount and clear are the two
 * operations that say something at this scale without that distortion.
 */
const HEAVY_SCENARIOS = [
  { id: 'mount-100k', setup: [], op: ['create', 100000] },
  { id: 'clear-100k', setup: [['create', 100000]], op: ['clear', 0] },
  { id: 'update-every-10th-100k', setup: [['create', 100000]], op: ['updateEveryTenth', 0] },
];

const DEFAULT_SCENARIOS = [
  { id: 'mount-1k', setup: [], op: ['create', 1000] },
  { id: 'mount-10k', setup: [], op: ['create', 10000] },
  { id: 'replace-1k', setup: [['create', 1000]], op: ['create', 1000] },
  { id: 'replace-10k', setup: [['create', 10000]], op: ['create', 10000] },
  { id: 'update-every-10th-1k', setup: [['create', 1000]], op: ['updateEveryTenth', 0] },
  { id: 'update-every-10th-10k', setup: [['create', 10000]], op: ['updateEveryTenth', 0] },
  { id: 'select-row', setup: [['create', 1000]], op: ['select', 500] },
  { id: 'append-1k-to-1k', setup: [['create', 1000]], op: ['append', 1000] },
  { id: 'append-1k-to-10k', setup: [['create', 10000]], op: ['append', 1000] },
  { id: 'remove-row', setup: [['create', 1000]], op: ['remove', 500] },
  { id: 'swap-rows-1k', setup: [['create', 1000]], op: ['swap', 0] },
  { id: 'swap-rows-10k', setup: [['create', 10000]], op: ['swap', 0] },
  { id: 'reverse-1k', setup: [['create', 1000]], op: ['reverse', 0] },
  { id: 'reverse-10k', setup: [['create', 10000]], op: ['reverse', 0] },
  { id: 'clear-1k', setup: [['create', 1000]], op: ['clear', 0] },
  { id: 'clear-10k', setup: [['create', 10000]], op: ['clear', 0] },
  { id: 'prepend-1k-to-10k', setup: [['create', 10000]], op: ['prepend', 1000] },
  { id: 'update-single-row-10k', setup: [['create', 10000]], op: ['updateOne', 5000] },
  {
    id: 'conditional-branch-switch-1k',
    setup: [['create', 1000]],
    op: ['toggleBranch', 0],
  },
  { id: 'deep-tree-mount', mode: 'deep', setup: [], op: ['deepUpdate', 0] },
  { id: 'context-change-1', mode: 'context', modeArgument: 1, setup: [], op: ['contextChange', 0] },
  {
    id: 'context-change-100',
    mode: 'context',
    modeArgument: 100,
    setup: [],
    op: ['contextChange', 0],
  },
  {
    id: 'context-change-10k',
    mode: 'context',
    modeArgument: 10000,
    setup: [],
    op: ['contextChange', 0],
  },
  {
    id: 'rapid-updates-1k-unbatched',
    mode: 'counter',
    setup: [],
    op: ['rapidUnbatched', 1000],
  },
  { id: 'rapid-updates-1k-batched', mode: 'counter', setup: [], op: ['rapidBatched', 1000] },
  { id: 'portal-update', mode: 'portal', setup: [], op: ['portalUpdate', 0] },
  { id: 'input-event-latency', mode: 'input', setup: [], op: ['type', 1] },
];

const SCENARIOS = (HEAVY ? HEAVY_SCENARIOS : DEFAULT_SCENARIOS).filter(
  (scenario) => ONLY.length === 0 || ONLY.includes(scenario.id),
);

/**
 * The sequences the equality phase walks, asserting the DOM after every step.
 *
 * One per application mode, so that the deep tree, the context fan-out and the
 * counter are held to the same standard as the table: if the two
 * implementations ever render different markup, no timing happens.
 */
const EQUALITY_SUITES = [
  {
    mode: 'table',
    modeArgument: 0,
    steps: [
      ['create', 1000],
      ['prepend', 10],
      ['updateOne', 5],
      ['toggleBranch', 0],
      ['toggleBranch', 0],
      ['updateEveryTenth', 0],
      ['select', 3],
      ['swap', 0],
      ['reverse', 0],
      ['remove', 10],
      ['append', 100],
      ['clear', 0],
      ['create', 50],
    ],
  },
  { mode: 'deep', modeArgument: 0, steps: [['deepUpdate', 0]] },
  {
    mode: 'context',
    modeArgument: 50,
    steps: [
      ['contextChange', 0],
      ['contextChange', 0],
    ],
  },
  {
    mode: 'counter',
    modeArgument: 0,
    steps: [
      ['rapidUnbatched', 5],
      ['rapidBatched', 5],
    ],
  },
  {
    mode: 'portal',
    modeArgument: 0,
    steps: [
      ['portalUpdate', 0],
      ['portalUpdate', 0],
    ],
  },
  {
    mode: 'input',
    modeArgument: 0,
    steps: [
      ['type', 1],
      ['type', 2],
    ],
  },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
};

/**
 * Serves the page **cross-origin isolated**, which is what buys the resolution.
 *
 * `performance.now()` is clamped to 100 µs in Chromium unless the page is
 * isolated, and a scenario that takes a tenth of a millisecond is then reported
 * as exactly that — one tick, for every framework, with no way to tell them
 * apart. With `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`
 * set, the clamp drops to 5 µs and the sub-millisecond rows become real
 * measurements rather than a row of identical numbers.
 *
 * Nothing about what is measured changes; only how finely the clock reads.
 * `crossOriginIsolated` is asserted in the page and recorded in the result
 * file, so a run that silently lost the isolation cannot be mistaken for one
 * that had it.
 */
async function serve(directory) {
  const server = createServer((request, response) => {
    const path = request.url === '/' ? '/index.html' : (request.url ?? '/');
    readFile(join(directory, path.split('?')[0]))
      .then((body) => {
        response.writeHead(200, {
          'content-type': MIME[extname(path)] ?? 'text/plain',
          'cross-origin-opener-policy': 'same-origin',
          'cross-origin-embedder-policy': 'require-corp',
          'cross-origin-resource-policy': 'same-origin',
        });
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

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  } catch {
    return 'unknown';
  }
}

/** The version of a framework installed in `benchmarks/frameworks`. */
function frameworkVersionOf(name) {
  try {
    return JSON.parse(
      readFileSync(resolve(here, 'frameworks', 'node_modules', name, 'package.json'), 'utf8'),
    ).version;
  } catch {
    return 'unknown';
  }
}

function versionOf(name) {
  try {
    return JSON.parse(
      execFileSync(process.execPath, [
        '-e',
        `process.stdout.write(JSON.stringify(require('${name}/package.json').version))`,
      ]).toString(),
    );
  } catch {
    return 'unknown';
  }
}

/**
 * Retained heap after mount, after repeated updates, and after disposal.
 *
 * Each reading is taken after a forced collection, so it is retained memory
 * rather than whatever happened to be uncollected. The third reading is the
 * one that matters: it says whether tearing a thousand rows down gives the
 * memory back.
 */
/** The same list, starting one place further along each time. */
function rotate(names, by) {
  const at = by % names.length;
  return [...names.slice(at), ...names.slice(0, at)];
}

async function measureMemory(page, url) {
  const client = await page.context().newCDPSession(page);
  await client.send('HeapProfiler.enable');
  const readings = {};

  for (const name of FRAMEWORKS) {
    // A fresh page per framework, so none inherits another's garbage.
    await page.goto(url);
    await page.waitForFunction(() => globalThis.harness !== undefined);
    const heap = async () => {
      await client.send('HeapProfiler.collectGarbage');
      const { usedSize } = await client.send('Runtime.getHeapUsage');
      return usedSize;
    };

    const baseline = await heap();
    await page.evaluate(async (impl) => {
      await globalThis.harness.mount(impl, 1, 'table', 0);
      await globalThis.harness.run('create', 1000);
    }, name);
    const afterMount = await heap();

    await page.evaluate(async () => {
      for (let i = 0; i < 100; i++) {
        await globalThis.harness.run('updateEveryTenth', 0);
      }
    });
    const afterUpdates = await heap();

    await page.evaluate(() => globalThis.harness.unmount());
    const afterDisposal = await heap();

    readings[name] = {
      baselineBytes: baseline,
      afterMountBytes: afterMount - baseline,
      afterUpdatesBytes: afterUpdates - baseline,
      afterDisposalBytes: afterDisposal - baseline,
    };
  }

  await client.send('HeapProfiler.disable');
  return readings;
}

/**
 * Cold start: a fresh page, then the first mount of a thousand rows.
 *
 * Nothing is warmed up, so this includes parsing, first-execution compilation
 * and the lazy template parse — the costs a user pays once and a warmed-up
 * benchmark never shows.
 */
async function measureStartup(browser, url) {
  const readings = {};
  for (const name of FRAMEWORKS) {
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(url);
      await page.waitForFunction(() => globalThis.harness !== undefined);
      samples.push(
        await page.evaluate(async (impl) => {
          const start = performance.now();
          await globalThis.harness.mount(impl, 1, 'table', 0);
          await globalThis.harness.run('create', 1000);
          return performance.now() - start;
        }, name),
      );
      await context.close();
    }
    readings[name] = summarise(samples);
  }
  return readings;
}

async function main() {
  await buildBenchmark();
  const { server, port } = await serve(resolve(here, 'app'));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const url = `http://127.0.0.1:${port}/index.html`;
  await page.goto(url);
  await page.waitForFunction(() => globalThis.harness !== undefined);

  await page.evaluate((on) => globalThis.harness.setLayout(on), LAYOUT);
  const isolated = await page.evaluate(() => globalThis.crossOriginIsolated);
  if (!isolated) {
    await browser.close();
    server.close();
    console.error(
      'The page is not cross-origin isolated, so `performance.now()` is clamped to ' +
        '100 µs and the sub-millisecond scenarios cannot be told apart. Refusing to ' +
        'publish numbers at that resolution.',
    );
    process.exitCode = 1;
    return;
  }
  console.log(`Timer resolution: cross-origin isolated (5 µs).`);

  // --- Phase 1: identical output, before anything is timed -------------------
  for (const suite of EQUALITY_SUITES) {
    const snapshots = {};
    for (const name of FRAMEWORKS) {
      snapshots[name] = await page.evaluate(
        async ({ impl, sequence, seed, mode, modeArgument }) => {
          await globalThis.harness.mount(impl, seed, mode, modeArgument);
          const results = [];
          for (const [operation, argument] of sequence) {
            await globalThis.harness.run(operation, argument);
            results.push(globalThis.harness.snapshot());
          }
          globalThis.harness.unmount();
          return results;
        },
        {
          impl: name,
          sequence: suite.steps,
          seed: SEED,
          mode: suite.mode,
          modeArgument: suite.modeArgument,
        },
      );
    }
    for (let step = 0; step < suite.steps.length; step++) {
      for (const name of RIVALS) {
        if (comparable(snapshots[name][step]) !== comparable(snapshots.firsthand[step])) {
          await browser.close();
          server.close();
          console.error(
            `DOM equality failed in the "${suite.mode}" suite at step ${step} ` +
              `(${suite.steps[step].join(' ')}) — Firsthand and ${name} do not render the same thing:`,
          );
          console.error(`  firsthand: ${snapshots.firsthand[step].slice(0, 300)}`);
          console.error(`  ${name}: ${snapshots[name][step].slice(0, 300)}`);
          process.exitCode = 1;
          return;
        }
      }
    }
    console.log(
      `DOM equality (${suite.mode}): ${suite.steps.length} steps identical across ` +
        `${FRAMEWORKS.join(', ')}.`,
    );
  }

  // --- Phase 2: interleaved measurement -------------------------------------
  const timings = {};
  for (const scenario of SCENARIOS) {
    timings[scenario.id] = Object.fromEntries(FRAMEWORKS.map((name) => [name, []]));
  }

  for (let repetition = 0; repetition < WARMUP + REPEATS; repetition++) {
    for (const scenario of SCENARIOS) {
      /*
       * Rotated, so that going first is not a framework's permanent lot.
       *
       * A measurement ends by forcing layout, and how much that costs depends
       * on what the page was left in by whoever ran before. With a fixed
       * order the same framework always follows the previous scenario's
       * teardown, every scenario, every repetition — which is a systematic
       * cost handed to whichever name happens to be first in the list. It is
       * invisible where the framework's own work dominates and decisive where
       * it does not: on `portal-update` the four are identical with layout
       * off and three times apart with it on.
       */
      const order = rotate(FRAMEWORKS, repetition);
      for (const name of order) {
        const duration = await page.evaluate(
          async ({ impl, setup, op, seed, mode, modeArgument }) => {
            await globalThis.harness.mount(impl, seed, mode, modeArgument);
            for (const [operation, argument] of setup) {
              await globalThis.harness.run(operation, argument);
            }
            const elapsed = await globalThis.harness.measure(op[0], op[1]);
            globalThis.harness.unmount();
            return elapsed;
          },
          {
            impl: name,
            setup: scenario.setup,
            op: scenario.op,
            seed: SEED,
            mode: scenario.mode ?? 'table',
            modeArgument: scenario.modeArgument ?? 0,
          },
        );
        if (repetition >= WARMUP) {
          timings[scenario.id][name].push(duration);
        }
      }
    }
    if ((repetition + 1) % 5 === 0) {
      console.log(`  ${repetition + 1}/${WARMUP + REPEATS} repetitions`);
    }
  }

  // --- Phase 3: memory and startup ------------------------------------------
  // Skipped for the heavy run: these measure the same thing at 1 000 rows, and
  // repeating them would add minutes for no new information.
  const memory = HEAVY ? null : await measureMemory(page, url);
  const startup = HEAVY ? null : await measureStartup(browser, url);

  const userAgent = await page.evaluate(() => navigator.userAgent);
  await browser.close();
  server.close();

  const scenarios = SCENARIOS.map((scenario) => {
    const summaries = Object.fromEntries(
      FRAMEWORKS.map((name) => [name, summarise(timings[scenario.id][name])]),
    );
    // Above 1 means Firsthand is faster by that factor. Below 1 means it is
    // not, and that is published exactly the same way.
    const ratios = Object.fromEntries(
      RIVALS.map((name) => [name, summaries[name].median / summaries.firsthand.median]),
    );
    return {
      id: scenario.id,
      ...summaries,
      ratios,
      /** Kept so that older result files and `compare.mjs` still line up. */
      ratio: ratios.react,
    };
  });

  const result = {
    metadata: {
      timestamp: new Date().toISOString(),
      os: `${platform()} ${release()}`,
      cpu: cpus()[0]?.model ?? 'unknown',
      cores: cpus().length,
      ramBytes: totalmem(),
      browser: 'chromium',
      browserVersion: userAgent,
      nodeVersion: process.version,
      playwrightVersion: versionOf('playwright'),
      reactVersion: versionOf('react'),
      reactDomVersion: versionOf('react-dom'),
      solidVersion: frameworkVersionOf('solid-js'),
      vueVersion: frameworkVersionOf('vue'),
      firsthandVersion: JSON.parse(
        await readFile(resolve(root, 'packages/dom/package.json'), 'utf8'),
      ).version,
      gitCommit: gitCommit(),
      buildMode: 'production',
      scale: HEAVY ? 'heavy (100 000 rows)' : 'default (1 000 and 10 000 rows)',
      warmupRepetitions: WARMUP,
      measuredRepetitions: REPEATS,
      domEqualityVerified: true,
      crossOriginIsolated: true,
      forcedLayoutIncluded: LAYOUT,
    },
    frameworks: FRAMEWORKS,
    scenarios,
    aggregates: Object.fromEntries(
      RIVALS.map((name) => [name, aggregate(scenarios.map((scenario) => scenario.ratios[name]))]),
    ),
    /** Kept so that older result files and `compare.mjs` still line up. */
    aggregate: aggregate(scenarios.map((scenario) => scenario.ratios.react)),
    // Kept apart from the timing aggregate: these are sizes and cold-start
    // times, not the per-operation durations the geometric mean is over.
    memory,
    startup,
  };

  mkdirSync(resolve(here, 'results'), { recursive: true });
  // The heavy run gets its own files: it measures different scenarios with a
  // different sample size, and folding it into the default results would make
  // the aggregate mean something else.
  const prefix = `${HEAVY ? 'benchmark-heavy' : 'benchmark'}${LAYOUT ? '' : '-nolayout'}`;
  const day = result.metadata.timestamp.slice(0, 10);
  const file = resolve(here, 'results', `${prefix}-${day}.json`);
  const serialised = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(file, serialised);
  if (ONLY.length === 0) {
    writeFileSync(
      resolve(
        here,
        'results',
        `${HEAVY ? 'latest-heavy' : 'latest'}${LAYOUT ? '' : '-nolayout'}.json`,
      ),
      serialised,
    );
  }

  console.log(`\nRaw results written to ${file}\n`);
  console.log(
    `  ${'scenario'.padEnd(22)}${FRAMEWORKS.map((name) => `${name} (ms)`.padStart(14)).join('')}`,
  );
  for (const scenario of scenarios) {
    console.log(
      `  ${scenario.id.padEnd(22)}` +
        FRAMEWORKS.map((name) => scenario[name].median.toFixed(2).padStart(14)).join(''),
    );
  }
  for (const name of RIVALS) {
    const { geometricMeanRatio, ci95 } = result.aggregates[name];
    const verdict =
      ci95[0] > 1
        ? 'the interval excludes 1.0'
        : ci95[1] < 1
          ? 'the interval is below 1.0'
          : 'the interval includes 1.0, so no aggregate claim may be published';
    console.log(
      `${NL}Geometric mean of ${name}/firsthand medians: ${geometricMeanRatio.toFixed(3)} ` +
        `(95% CI ${ci95[0].toFixed(3)}–${ci95[1].toFixed(3)}) — ${verdict}`,
    );
  }
  if (result.memory !== null) {
    const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    console.log(`${NL}  retained heap (after a forced collection, relative to an empty page):`);
    for (const name of FRAMEWORKS) {
      const entry = result.memory[name];
      console.log(
        `    ${name.padEnd(8)} mount ${mb(entry.afterMountBytes).padStart(9)}   ` +
          `after 100 updates ${mb(entry.afterUpdatesBytes).padStart(9)}   ` +
          `after disposal ${mb(entry.afterDisposalBytes).padStart(9)}`,
      );
    }
    console.log(`${NL}  cold start (fresh page, first mount of 1 000 rows):`);
    for (const name of FRAMEWORKS) {
      console.log(`    ${name.padEnd(8)} ${result.startup[name].median.toFixed(1)} ms median`);
    }
  }
}

await main();
