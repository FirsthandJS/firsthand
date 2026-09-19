/**
 * Compares a benchmark run against the committed baseline.
 *
 * Shared CI hardware is noisy, so this does not fail a build on a slow
 * afternoon. What it does is make a regression *visible*: it prints a table of
 * every scenario whose ratio against React moved by more than the threshold,
 * in either direction, and marks the rows whose samples were too widely spread
 * for the comparison to mean anything.
 *
 *   node benchmarks/compare.mjs <candidate.json> [--baseline <file>] [--threshold 0.1]
 *
 * With `--fail`, a regression beyond the threshold sets a non-zero exit code —
 * for a machine where the numbers are known to be stable.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const candidatePath = args.find((arg) => arg.endsWith('.json') && !arg.startsWith('--'));
const baselinePath = resolve(here, flag('baseline', 'results/latest.json'));
const threshold = Number(flag('threshold', '0.1'));
const shouldFail = args.includes('--fail');

if (candidatePath === undefined) {
  console.error('Usage: node benchmarks/compare.mjs <candidate.json> [--baseline <file>]');
  process.exit(1);
}
if (!existsSync(baselinePath)) {
  console.log('No baseline to compare against; nothing to report.');
  process.exit(0);
}

const candidate = JSON.parse(readFileSync(resolve(process.cwd(), candidatePath), 'utf8'));
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));

const unstable = (scenario) =>
  scenario.firsthand.mad > scenario.firsthand.median * 0.1 ||
  scenario.react.mad > scenario.react.median * 0.1;

const before = new Map(baseline.scenarios.map((scenario) => [scenario.id, scenario]));
const moved = [];
const missing = [];

for (const scenario of candidate.scenarios) {
  const previous = before.get(scenario.id);
  if (previous === undefined) {
    missing.push(scenario.id);
    continue;
  }
  // The ratio against React, not the raw time: it is the part that survives a
  // machine being generally slower or faster than the one before it.
  const change = scenario.ratio / previous.ratio - 1;
  if (Math.abs(change) >= threshold) {
    moved.push({
      id: scenario.id,
      before: previous.ratio,
      after: scenario.ratio,
      change,
      shaky: unstable(scenario) || unstable(previous),
    });
  }
}

const aggregateChange =
  candidate.aggregate.geometricMeanRatio / baseline.aggregate.geometricMeanRatio - 1;

const percent = (value) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)} %`;

console.log(`### Benchmark comparison against \`${baseline.metadata.gitCommit.slice(0, 8)}\`\n`);
console.log(
  `Aggregate: ${baseline.aggregate.geometricMeanRatio.toFixed(3)}× → ` +
    `${candidate.aggregate.geometricMeanRatio.toFixed(3)}× (${percent(aggregateChange)})\n`,
);

if (moved.length === 0) {
  console.log(`No scenario moved by more than ${(threshold * 100).toFixed(0)} %.`);
} else {
  console.log('| Scenario | Before | After | Change |');
  console.log('| --- | ---: | ---: | ---: |');
  for (const entry of moved.sort((a, b) => a.change - b.change)) {
    console.log(
      `| \`${entry.id}\`${entry.shaky ? ' ~' : ''} | ${entry.before.toFixed(2)}× | ` +
        `${entry.after.toFixed(2)}× | ${percent(entry.change)} |`,
    );
  }
  if (moved.some((entry) => entry.shaky)) {
    console.log(
      '\nRows marked `~` had widely spread samples on one side or the other; ' +
        'their movement may be noise.',
    );
  }
}

if (missing.length > 0) {
  console.log(`\nScenarios absent from the baseline: ${missing.join(', ')}.`);
}

const regressions = moved.filter((entry) => entry.change <= -threshold && !entry.shaky);
if (shouldFail && regressions.length > 0) {
  console.error(`\n${regressions.length} scenario(s) regressed beyond the threshold.`);
  process.exitCode = 1;
}
