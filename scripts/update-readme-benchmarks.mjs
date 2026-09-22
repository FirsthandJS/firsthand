/**
 * Regenerates the README's performance numbers from the committed raw results.
 *
 * No performance figure in the README is written by hand. That is the
 * mechanical version of the rule in PERFORMANCE_PLAN.md: a number appears in
 * the README only because it appears in `benchmarks/results/`, and it appears
 * there only because the runner put it there.
 *
 * Run it after `npm run bench`. `--check` fails if the README has drifted, and
 * CI runs that check.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const bench = JSON.parse(readFileSync(resolve(root, 'benchmarks/results/latest.json'), 'utf8'));
const bundle = JSON.parse(
  readFileSync(resolve(root, 'benchmarks/results/bundle-size.json'), 'utf8'),
);
/** The 100 000-row run is optional: it is a separate, much slower invocation. */
const heavyPath = resolve(root, 'benchmarks/results/latest-heavy.json');
const heavy = existsSync(heavyPath) ? JSON.parse(readFileSync(heavyPath, 'utf8')) : null;

const START = '<!-- benchmark:start -->';
const END = '<!-- benchmark:end -->';
const HEAD_START = '<!-- headline:start -->';
const HEAD_END = '<!-- headline:end -->';

const kb = (bytes) => `${(bytes / 1024).toFixed(2)} kB`;
// Three decimals below a millisecond: the clock reads in 5 µs steps, and
// rounding that away is what made these rows look identical.
const ms = (value) => `${value.toFixed(value < 1 ? 3 : 2)} ms`;

const meta = bench.metadata;
/** Older result files predate the three-rival comparison. */
const frameworks = bench.frameworks ?? ['firsthand', 'react'];
const rivals = frameworks.slice(1);
const aggregates = bench.aggregates ?? { react: bench.aggregate };
const label = (key) => (key === 'firsthand' ? 'Firsthand' : key[0].toUpperCase() + key.slice(1));
const named = (key) => `${label(key)} ${meta[`${key}Version`] ?? ''}`.trim();
const full = bundle.sizes[bundle.sizes.length - 1];

/**
 * Which framework won a scenario, and by how much over the next one.
 *
 * Ordered by median, and where two medians are identical to the microsecond by
 * mean and then by p95 — the page is cross-origin isolated, so the clock reads
 * in 5 µs steps and a true tie across all three is vanishingly unlikely. There
 * is always a winner, and it is the one the samples say.
 */
const order = (scenario) => (a, b) =>
  scenario[a].median - scenario[b].median ||
  scenario[a].mean - scenario[b].mean ||
  scenario[a].p95 - scenario[b].p95;

const fastest = (scenario, among = frameworks) => {
  const [best, runnerUp] = [...among].sort(order(scenario));
  const margin = scenario[runnerUp].median / scenario[best].median;
  // Three decimals for a narrow win: `1.00×` reads as a tie and is not one.
  return `${label(best)} ${margin.toFixed(margin < 1.01 ? 3 : 2)}×`;
};

/**
 * The headline sentence, which may only say what the intervals support.
 *
 * A rival whose interval includes 1.0 is reported as level rather than being
 * rounded into a win — that rule is the reason this section can be trusted at
 * all, and it costs something here.
 */
const list = (parts) =>
  parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;

const claims = () => {
  const faster = [];
  const slower = [];
  const level = [];
  for (const one of rivals) {
    const { geometricMeanRatio, ci95 } = aggregates[one];
    if (ci95[0] > 1) {
      faster.push(`**${geometricMeanRatio.toFixed(2)}×** faster than ${named(one)}`);
    } else if (ci95[1] < 1) {
      slower.push(`**${(1 / geometricMeanRatio).toFixed(2)}×** slower than ${named(one)}`);
    } else {
      level.push(named(one));
    }
  }
  const phrases = [...faster, ...slower];
  if (level.length > 0) {
    phrases.push(`level with ${list(level)}`);
  }
  return list(phrases);
};

const wins = bench.scenarios.filter((scenario) =>
  frameworks.every((one) => scenario.firsthand.median <= scenario[one].median),
).length;

/**
 * Marks a row whose median is not a reliable point estimate.
 *
 * A median absolute deviation above a tenth of the median means the samples are
 * spread widely enough — usually a garbage collection landing inside some of the
 * measured windows — that the ratio should not be read as a firm result. Marking
 * it is more honest than quietly reporting the median.
 */
const unstable = (scenario) =>
  frameworks.some((one) => scenario[one].mad > scenario[one].median * 0.1);

const anyUnstable = bench.scenarios.some(unstable);

const scenarioRows = bench.scenarios
  .map(
    (scenario) =>
      `| \`${scenario.id}\`${unstable(scenario) ? ' ~' : ''} | ` +
      `${frameworks.map((one) => ms(scenario[one].median)).join(' | ')} | ${fastest(scenario)} |`,
  )
  .join('\n');

const aggregateRows = rivals
  .map((one) => {
    const { geometricMeanRatio, ci95 } = aggregates[one];
    const verdict =
      ci95[0] > 1
        ? 'yes — the interval excludes 1.0'
        : ci95[1] < 1
          ? 'yes, against Firsthand'
          : '**no** — the interval includes 1.0';
    return (
      `| ${named(one)} | **${geometricMeanRatio.toFixed(3)}×** | ` +
      `${ci95[0].toFixed(3)}–${ci95[1].toFixed(3)} | ${verdict} |`
    );
  })
  .join('\n');

const row = (entry) =>
  `| ${entry.module.startsWith('@') ? `\`${entry.module}\`` : entry.module} | ` +
  `${kb(entry.minified)} | **${kb(entry.gzip)}** | ${kb(entry.brotli)} |`;

const sizeRows = bundle.sizes.map(row).join('\n');
/** Packages an application pays for only if it imports them. */
const optionalRows = (bundle.optional ?? []).map(row).join('\n');

function memorySection() {
  if (bench.memory === undefined || bench.memory === null) {
    return '';
  }
  const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  const row = (name, text) => {
    const entry = bench.memory[name];
    return `| ${text} | ${mb(entry.afterMountBytes)} | ${mb(entry.afterUpdatesBytes)} | ${mb(entry.afterDisposalBytes)} | ${ms(bench.startup[name].median)} |`;
  };
  return [
    '### Memory and cold start',
    '',
    'Retained heap relative to an empty page, each reading taken after a forced',
    'collection, so it is memory that is actually held rather than memory that',
    'has not been collected yet. Cold start is a fresh page and the first mount',
    'of 1 000 rows, so it includes parsing and first-execution compilation.',
    '',
    '| | after mounting 1 000 rows | after 100 update cycles | after disposal | cold start |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...frameworks.map((one) => row(one, one === 'firsthand' ? '**Firsthand**' : label(one))),
    '',
    'The third column is the one to read: it is what the page still holds once',
    'the tree has been torn down.',
    '',
    '',
  ].join(String.fromCharCode(10));
}

function heavySection() {
  if (heavy === null) {
    return '';
  }
  const heavyFrameworks = heavy.frameworks ?? ['firsthand', 'react'];
  const rows = heavy.scenarios
    .map(
      (scenario) =>
        `| \`${scenario.id}\` | ` +
        `${heavyFrameworks.map((one) => ms(scenario[one].median)).join(' | ')} | ` +
        `${fastest(scenario, heavyFrameworks)} |`,
    )
    .join('\n');
  return [
    '### Mass data: 100 000 rows',
    '',
    'A separate, slower run (`BENCH_SCALE=heavy npm run bench`), with',
    `${heavy.metadata.measuredRepetitions} repetitions after ${heavy.metadata.warmupRepetitions} warmups. Kept out of the aggregate`,
    'above rather than folded into it: averaging measurements taken with',
    'different sample sizes would quietly weaken the confidence interval.',
    '',
    `| Scenario | ${heavyFrameworks.map(label).join(' | ')} | Fastest |`,
    `| --- | ${heavyFrameworks.map(() => '---:').join(' | ')} | :--- |`,
    rows,
    '',
    '',
  ].join('\n');
}

// Wrapped in prettier-ignore markers: the block is generated, and reformatting
// it would make the in-sync check fail for cosmetic reasons.
const body = `${START}
<!-- prettier-ignore-start -->

### Firsthand vs ${rivals.map(named).join(', ')}

${meta.cpu}, ${meta.cores} cores · Chromium via Playwright · Node ${meta.nodeVersion} ·
${meta.measuredRepetitions} measured repetitions after ${meta.warmupRepetitions} warmups ·
production builds · interleaved in one browser session ·
DOM equality verified before timing · commit \`${meta.gitCommit.slice(0, 8)}\` ·
${meta.timestamp.slice(0, 10)}

Each implementation is written the way its own documentation writes it: React
with memoised components and \`flushSync\`, Solid with a store and \`<For>\`,
compiled by \`babel-preset-solid\`, Vue with \`shallowRef\` and templates so that
its compiler emits the patch flags a real application gets. Medians, in
milliseconds; every scenario is here, including the ones Firsthand loses.

| Scenario | ${frameworks.map(label).join(' | ')} | Fastest |
| --- | ${frameworks.map(() => '---:').join(' | ')} | :--- |
${scenarioRows}

| Against | Geometric mean of the per-scenario ratios | 95 % bootstrap CI | Claimable |
| --- | ---: | :---: | :--- |
${aggregateRows}

**Fastest** names the winner of the row and its margin over the next one. The
page is served cross-origin isolated, so \`performance.now()\` reads in 5 µs
steps rather than Chromium's default 100 µs — without that the sub-millisecond
rows would all report the same number and there would be nothing to compare.

A ratio above 1.0 in the table below means Firsthand is faster by that factor.
Where the interval includes 1.0 the two are level as far as this suite can
tell, and this project publishes that rather than rounding it into a claim.
Firsthand was the fastest of the ${frameworks.length}, or tied with whoever was, in ${wins} of ${bench.scenarios.length}
scenarios in this run.
${
  anyUnstable
    ? [
        '',
        'Rows marked `~` had a median absolute deviation above 10 % of the median on',
        'at least one side — usually a garbage collection landing inside some of the',
        'measured windows. Their medians are not reliable point estimates, and the',
        'ratio should not be read as a firm result.',
        '',
      ].join(String.fromCharCode(10))
    : ''
}

${memorySection()}${heavySection()}### Bundle size

| Module | minified | gzip | brotli |
| --- | ---: | ---: | ---: |
${sizeRows}

${
  optionalRows === ''
    ? ''
    : `
Optional packages, downloaded only by an application that imports them:

| Module | minified | gzip | brotli |
| --- | ---: | ---: | ---: |
${optionalRows}
`
}
No third-party production dependencies, asserted in CI: \`@firsthandjs/dom\` pulls
in \`@firsthandjs/core\` and nothing else, and the optional packages depend on
those two and nothing else. At build time there is exactly one third-party
toolchain: the compiler uses Babel to parse TSX. The full-runtime row is
measured with *everything* imported; an application that uses no portals, no
keyed lists and no element hosts links less than that.

<!-- prettier-ignore-end -->
${END}`;

/** The one-line summary at the top, so no number is ever typed twice. */
// The framework's own numbers come first, and the comparison is stated as a
// measurement rather than as a verdict on anyone else's design.
const headline = `${HEAD_START}
<!-- prettier-ignore-start -->
The whole runtime is **${kb(full.gzip)} gzip** with no production dependencies. On the
render/update set it is ${claims()}
(geometric means of ${bench.scenarios.length} scenarios, 95 % bootstrap intervals) — measured in the same browser session,
with the same data and the same rendered DOM verified before any timing, and
with every scenario published, including the ${bench.scenarios.length - wins} that Firsthand does not win.
<!-- prettier-ignore-end -->
${HEAD_END}`;

const path = resolve(root, 'README.md');
const readme = readFileSync(path, 'utf8');

function splice(text, startMarker, endMarker, replacement) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if (start === -1 || end === -1) {
    console.error(`README.md is missing the ${startMarker} / ${endMarker} markers.`);
    process.exit(1);
  }
  return text.slice(0, start) + replacement + text.slice(end + endMarker.length);
}

const updated = splice(splice(readme, START, END, body), HEAD_START, HEAD_END, headline);

if (check) {
  if (updated !== readme) {
    console.error('README.md is out of sync with benchmarks/results/. Run `npm run bench:readme`.');
    process.exit(1);
  }
  console.log('README performance numbers are in sync with the committed results.');
} else {
  writeFileSync(path, updated);
  console.log('README performance numbers regenerated from benchmarks/results/.');
}
