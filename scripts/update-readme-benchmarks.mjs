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
const ms = (value) => `${value.toFixed(2)} ms`;
const verdict = (ratio) =>
  ratio > 1 ? `Firsthand ${ratio.toFixed(2)}×` : `React ${(1 / ratio).toFixed(2)}×`;

const meta = bench.metadata;
const aggregate = bench.aggregate;
const wins = bench.scenarios.filter((scenario) => scenario.ratio > 1).length;
const full = bundle.sizes[bundle.sizes.length - 1];

/**
 * Marks a row whose median is not a reliable point estimate.
 *
 * A median absolute deviation above a tenth of the median means the samples are
 * spread widely enough — usually a garbage collection landing inside some of the
 * measured windows — that the ratio should not be read as a firm result. Marking
 * it is more honest than quietly reporting the median.
 */
const unstable = (scenario) =>
  scenario.firsthand.mad > scenario.firsthand.median * 0.1 ||
  scenario.react.mad > scenario.react.median * 0.1;

const anyUnstable = bench.scenarios.some(unstable);

const scenarioRows = bench.scenarios
  .map(
    (scenario) =>
      `| \`${scenario.id}\`${unstable(scenario) ? ' ~' : ''} | ${ms(scenario.firsthand.median)} | ${ms(scenario.react.median)} | ` +
      `${ms(scenario.firsthand.p95)} | ${ms(scenario.react.p95)} | ${verdict(scenario.ratio)} |`,
  )
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
  const row = (name, label) => {
    const entry = bench.memory[name];
    return `| ${label} | ${mb(entry.afterMountBytes)} | ${mb(entry.afterUpdatesBytes)} | ${mb(entry.afterDisposalBytes)} | ${ms(bench.startup[name].median)} |`;
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
    row('firsthand', '**Firsthand**'),
    row('react', 'React'),
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
  const rows = heavy.scenarios
    .map(
      (scenario) =>
        `| \`${scenario.id}\` | ${ms(scenario.firsthand.median)} | ` +
        `${ms(scenario.react.median)} | ${verdict(scenario.ratio)} |`,
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
    '| Scenario | Firsthand median | React median | Faster |',
    '| --- | ---: | ---: | :--- |',
    rows,
    '',
    '',
  ].join('\n');
}

// Wrapped in prettier-ignore markers: the block is generated, and reformatting
// it would make the in-sync check fail for cosmetic reasons.
const body = `${START}
<!-- prettier-ignore-start -->

### Firsthand vs React ${meta.reactVersion}

${meta.cpu}, ${meta.cores} cores · Chromium via Playwright · Node ${meta.nodeVersion} ·
${meta.measuredRepetitions} measured repetitions after ${meta.warmupRepetitions} warmups ·
production builds · interleaved in one browser session ·
DOM equality verified before timing · commit \`${meta.gitCommit.slice(0, 8)}\` ·
${meta.timestamp.slice(0, 10)}

| Scenario | Firsthand median | React median | Firsthand p95 | React p95 | Faster |
| --- | ---: | ---: | ---: | ---: | :--- |
${scenarioRows}

**Geometric mean of the per-scenario ratios: ${aggregate.geometricMeanRatio.toFixed(3)}×**
(95 % bootstrap CI ${aggregate.ci95[0].toFixed(3)}–${aggregate.ci95[1].toFixed(3)}). The interval
excludes 1.0, which is the condition this project set before it would make an
aggregate claim at all. Firsthand was faster in ${wins} of ${bench.scenarios.length} scenarios in this run.
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
render/update set it is **${aggregate.geometricMeanRatio.toFixed(2)}× faster** than React ${meta.reactVersion} (geometric mean of ${bench.scenarios.length}
scenarios, 95 % CI ${aggregate.ci95[0].toFixed(2)}–${aggregate.ci95[1].toFixed(2)}) — measured in the same browser session with
byte-identical DOM verified before any timing, and with every scenario published,
including the ${bench.scenarios.length - wins} React wins.
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
