/**
 * Decides ADR-0010 by measurement.
 *
 * Runs the three keyed-reconciliation candidates over the same operations, on
 * the same DOM, in the same browser session, and records both the wall time and
 * the number of DOM mutations each performs. Correctness is asserted on every
 * single measurement: a candidate that produces the wrong order is reported as
 * failed rather than as fast.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus, platform, release } from 'node:os';
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

const CANDIDATES = ['shipped', 'prefixSuffix', 'naive'];
const SIZES = [1000, 10000];
const WARMUP = 3;
const REPEATS = 15;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

async function build() {
  await esbuild.build({
    entryPoints: [resolve(here, 'harness.js')],
    outfile: resolve(here, 'dist', 'harness.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
  });
}

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

await build();
const { server, port } = await serve(here);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.waitForFunction(() => globalThis.reconcilerHarness !== undefined);

const operations = await page.evaluate(() => globalThis.reconcilerHarness.operations);

const timings = {};
const failures = [];
for (const size of SIZES) {
  for (const operation of operations) {
    for (const candidate of CANDIDATES) {
      timings[`${candidate}|${operation}|${size}`] = [];
    }
  }
}

for (let repetition = 0; repetition < WARMUP + REPEATS; repetition++) {
  // The candidate order rotates every repetition. With a fixed order the first
  // candidate measured would systematically inherit the state the previous one
  // left behind, and the comparison would partly measure that.
  const order = CANDIDATES.map((_, index) => CANDIDATES[(index + repetition) % CANDIDATES.length]);
  for (const size of SIZES) {
    for (const operation of operations) {
      for (const candidate of order) {
        const result = await page.evaluate(
          ({ candidate: name, operation: op, size: n }) =>
            globalThis.reconcilerHarness.measure(name, op, n),
          { candidate, operation, size },
        );
        if (!result.correct) {
          failures.push({ candidate, operation, size });
        }
        if (repetition >= WARMUP) {
          timings[`${candidate}|${operation}|${size}`].push(result.elapsed);
        }
      }
    }
  }
  if ((repetition + 1) % 5 === 0) {
    console.log(`  ${repetition + 1}/${WARMUP + REPEATS} repetitions`);
  }
}

const mutations = {};
for (const size of SIZES) {
  for (const operation of operations) {
    for (const candidate of CANDIDATES) {
      mutations[`${candidate}|${operation}|${size}`] = await page.evaluate(
        ({ candidate: name, operation: op, size: n }) =>
          globalThis.reconcilerHarness.countMutations(name, op, n),
        { candidate, operation, size },
      );
    }
  }
}

await browser.close();
server.close();

if (failures.length > 0) {
  console.error('A candidate produced the wrong order:');
  console.error(JSON.stringify(failures[0], null, 2));
  process.exitCode = 1;
}

const rows = [];
for (const size of SIZES) {
  for (const operation of operations) {
    const row = { operation, size, candidates: {} };
    for (const candidate of CANDIDATES) {
      const key = `${candidate}|${operation}|${size}`;
      row.candidates[candidate] = {
        median: median(timings[key]),
        samples: timings[key].length,
        ...mutations[key],
      };
    }
    rows.push(row);
  }
}

const totals = {};
for (const candidate of CANDIDATES) {
  totals[candidate] = {
    // Geometric mean of "this candidate's time / the fastest time here", so a
    // single huge operation cannot dominate the verdict.
    relative: Math.exp(
      rows.reduce((sum, row) => {
        const best = Math.min(...CANDIDATES.map((name) => row.candidates[name].median));
        return (
          sum + Math.log(Math.max(row.candidates[candidate].median, 1e-4) / Math.max(best, 1e-4))
        );
      }, 0) / rows.length,
    ),
    mutations: rows.reduce(
      (sum, row) => sum + row.candidates[candidate].inserts + row.candidates[candidate].removals,
      0,
    ),
  };
}

const result = {
  metadata: {
    timestamp: new Date().toISOString(),
    os: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    browser: 'chromium',
    nodeVersion: process.version,
    gitCommit: gitCommit(),
    warmupRepetitions: WARMUP,
    measuredRepetitions: REPEATS,
    correctnessVerified: failures.length === 0,
  },
  rows,
  totals,
};

mkdirSync(resolve(root, 'benchmarks', 'results'), { recursive: true });
const file = resolve(root, 'benchmarks', 'results', 'reconcilers.json');
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);

console.log(`\nRaw results written to ${file}\n`);
const pad = (text, width) => String(text).padStart(width);
console.log(
  `  ${'operation'.padEnd(14)}${pad('size', 7)}` +
    CANDIDATES.map((name) => pad(name, 14) + pad('moves', 8)).join(''),
);
for (const row of rows) {
  console.log(
    `  ${row.operation.padEnd(14)}${pad(row.size, 7)}` +
      CANDIDATES.map((name) => {
        const entry = row.candidates[name];
        return pad(`${entry.median.toFixed(2)} ms`, 14) + pad(entry.inserts + entry.removals, 8);
      }).join(''),
  );
}
console.log('\n  relative cost (1.00 = fastest overall), total DOM mutations:');
for (const candidate of CANDIDATES) {
  console.log(
    `    ${candidate.padEnd(14)} ${totals[candidate].relative.toFixed(3)}x   ` +
      `${totals[candidate].mutations} mutations`,
  );
}
