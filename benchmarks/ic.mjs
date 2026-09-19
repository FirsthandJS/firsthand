/**
 * R2: does `.value` go megamorphic when a site reads many kinds of cell?
 *
 * The risk register has carried this as open since before the code existed.
 * The design's answer is that signals, computeds and effect nodes all use one
 * object shape, so a `.value` read stays monomorphic however many kinds of
 * cell pass through it — but "one shape" was an intention, and nothing had
 * measured what the engine actually does.
 *
 * This measures it three ways, in one process, interleaved:
 *
 *  1. **one shape** — a site that only ever sees signals.
 *  2. **mixed cells** — the same site reading signals, computeds and cells
 *     that an effect subscribes to. If the design is right, this matches (1).
 *  3. **many shapes** — the same site reading eight unrelated object shapes
 *     with a `value` getter. This is the control: if the harness cannot
 *     detect a megamorphic site here, it cannot detect one anywhere, and the
 *     result in (2) would mean nothing.
 *
 * It reports nanoseconds per read. The claim is only that (2) is close to (1)
 * while (3) is clearly worse; absolute numbers are machine-specific and are
 * written into the result file with the machine.
 *
 * One caveat, because the control is not a pure measurement of shape: the
 * foreign objects in (3) also reach a different getter per shape, so their
 * cost includes call-site polymorphism in the getter as well. That makes (3)
 * an upper bound on the penalty rather than an exact price for megamorphism —
 * which is fine for what it is used for, namely showing that the harness can
 * see a bad site at all.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cpus, platform, release } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const { signal, computed, effect, createRoot } = await import(
  pathToFileURL(resolve(root, 'packages', 'core', 'dist', 'index.js')).href
);

const READS = 2_000_000;
const REPEATS = 15;
const WARMUP = 3;

/**
 * Three identical read sites, written out three times.
 *
 * One shared function would make all three kinds the *same* call site, and
 * that site would see everything — which is the thing being measured. Each
 * kind therefore gets a site of its own, and the bodies are identical so that
 * nothing but what they read differs.
 */
function readOneShape(cells) {
  let total = 0;
  for (let at = 0; at < cells.length; at++) {
    total += cells[at].value;
  }
  return total;
}

function readMixedCells(cells) {
  let total = 0;
  for (let at = 0; at < cells.length; at++) {
    total += cells[at].value;
  }
  return total;
}

function readManyShapes(cells) {
  let total = 0;
  for (let at = 0; at < cells.length; at++) {
    total += cells[at].value;
  }
  return total;
}

const SITES = {
  'one shape': readOneShape,
  'mixed cells': readMixedCells,
  'many shapes': readManyShapes,
};

/** Eight unrelated shapes, each with its own `value` getter. */
function foreignShapes() {
  const shapes = [];
  for (let at = 0; at < 8; at++) {
    const holder = { [`field${String(at)}`]: at, extra: at * 2 };
    Object.defineProperty(holder, 'value', { get: () => holder[`field${String(at)}`] });
    shapes.push(holder);
  }
  return shapes;
}

function build(kind) {
  if (kind === 'one shape') {
    return Array.from({ length: 8 }, (_, at) => signal(at));
  }
  if (kind === 'mixed cells') {
    const sources = Array.from({ length: 4 }, (_, at) => signal(at));
    const derived = sources.map((source) => computed(() => source.value + 1));
    // Cells an effect is subscribed to take a different path through the graph
    // — flags set, subscribers linked — without being a different shape.
    for (const source of sources) {
      effect(() => void source.value);
    }
    return [...sources, ...derived];
  }
  return foreignShapes();
}

function measure(kind, cells) {
  const site = SITES[kind];
  const rounds = Math.ceil(READS / cells.length);
  const started = process.hrtime.bigint();
  let sink = 0;
  for (let round = 0; round < rounds; round++) {
    sink += site(cells);
  }
  const elapsed = Number(process.hrtime.bigint() - started);
  if (sink === Number.MAX_SAFE_INTEGER) {
    throw new Error('unreachable, and here so the loop cannot be optimised away');
  }
  return elapsed / (rounds * cells.length);
}

const KINDS = ['one shape', 'mixed cells', 'many shapes'];
const samples = Object.fromEntries(KINDS.map((kind) => [kind, []]));

let stop = () => {};
createRoot((dispose) => {
  stop = dispose;

  for (let repetition = 0; repetition < REPEATS + WARMUP; repetition++) {
    for (const kind of KINDS) {
      const cells = build(kind);
      // Warm the site with its own kind before timing it.
      SITES[kind](cells);
      const perRead = measure(kind, cells);
      if (repetition >= WARMUP) {
        samples[kind].push(perRead);
      }
    }
  }
});
stop();

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const results = Object.fromEntries(
  KINDS.map((kind) => [
    kind,
    {
      medianNs: median(samples[kind]),
      minNs: Math.min(...samples[kind]),
      maxNs: Math.max(...samples[kind]),
      samples: samples[kind].length,
    },
  ]),
);

const base = results['one shape'].medianNs;
const report = {
  measuredAt: new Date().toISOString(),
  environment: {
    node: process.version,
    v8: process.versions.v8,
    cpu: cpus()[0]?.model ?? 'unknown',
    platform: `${platform()} ${release()}`,
  },
  readsPerSample: READS,
  results,
  ratios: Object.fromEntries(KINDS.map((kind) => [kind, results[kind].medianNs / base])),
};

mkdirSync(resolve(root, 'benchmarks', 'results'), { recursive: true });
writeFileSync(
  resolve(root, 'benchmarks', 'results', 'ic.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);

console.log(`\n`.trimStart() + 'Cost of one `.value` read:');
for (const kind of KINDS) {
  const { medianNs } = results[kind];
  console.log(
    `  ${kind.padEnd(12)} ${medianNs.toFixed(2).padStart(6)} ns  ` +
      `${(medianNs / base).toFixed(2)}× the one-shape case`,
  );
}
console.log('\nWritten to benchmarks/results/ic.json');
