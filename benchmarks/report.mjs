/**
 * Renders a committed result file as a table.
 *
 * It prints every scenario, including the ones Firsthand loses, and it refuses to
 * state an aggregate advantage unless the bootstrap interval excludes 1.0.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file =
  process.argv.find((arg) => arg.endsWith('.json')) ?? resolve(here, 'results/latest.json');
const markdown = process.argv.includes('--markdown');
const result = JSON.parse(readFileSync(file, 'utf8'));

const ms = (value) => value.toFixed(2);
const verdict = (ratio) =>
  ratio > 1 ? `Firsthand ${ratio.toFixed(2)}×` : `React ${(1 / ratio).toFixed(2)}×`;

if (markdown) {
  const meta = result.metadata;
  console.log(`### Benchmark: Firsthand vs React ${meta.reactVersion}\n`);
  console.log(
    `${meta.cpu}, ${meta.cores} cores · ${meta.browser} · Node ${meta.nodeVersion} · ` +
      `${meta.measuredRepetitions} repetitions after ${meta.warmupRepetitions} warmups · ` +
      `commit \`${meta.gitCommit.slice(0, 8)}\`\n`,
  );
  console.log(
    '| Scenario | Firsthand median | React median | Firsthand p95 | React p95 | Faster |',
  );
  console.log('| --- | ---: | ---: | ---: | ---: | :--- |');
  for (const scenario of result.scenarios) {
    console.log(
      `| ${scenario.id} | ${ms(scenario.firsthand.median)} ms | ${ms(scenario.react.median)} ms | ` +
        `${ms(scenario.firsthand.p95)} ms | ${ms(scenario.react.p95)} ms | ${verdict(scenario.ratio)} |`,
    );
  }
  const { geometricMeanRatio, ci95 } = result.aggregate;
  console.log(
    `\nGeometric mean of the per-scenario ratios: **${geometricMeanRatio.toFixed(3)}** ` +
      `(95 % CI ${ci95[0].toFixed(3)}–${ci95[1].toFixed(3)}).`,
  );
  console.log(
    ci95[0] > 1
      ? '\nThe interval excludes 1.0, so the aggregate advantage is statistically supported.'
      : '\nThe interval includes 1.0, so **no aggregate advantage may be claimed** from this run.',
  );
} else {
  console.log(result);
}
