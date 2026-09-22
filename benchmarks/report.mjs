/**
 * Renders a committed result file as a table.
 *
 * It prints every scenario, including the ones Firsthand loses, and it refuses
 * to state an aggregate advantage unless the bootstrap interval excludes 1.0.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file =
  process.argv.find((arg) => arg.endsWith('.json')) ?? resolve(here, 'results/latest.json');
const markdown = process.argv.includes('--markdown');
const result = JSON.parse(readFileSync(file, 'utf8'));

/** Older result files predate the three-rival comparison. */
const frameworks = result.frameworks ?? ['firsthand', 'react'];
const rivals = frameworks.slice(1);
const aggregates = result.aggregates ?? { react: result.aggregate };

const ms = (value) => value.toFixed(2);
const name = (key) => (key === 'firsthand' ? 'Firsthand' : key[0].toUpperCase() + key.slice(1));

/** Which framework won a scenario, and by how much. */
const fastest = (scenario) => {
  const best = frameworks.reduce((a, b) => (scenario[a].median <= scenario[b].median ? a : b));
  const rest = frameworks.filter((one) => one !== best);
  const runnerUp = rest.reduce((a, b) => (scenario[a].median <= scenario[b].median ? a : b));
  const margin = scenario[runnerUp].median / scenario[best].median;
  // A margin that rounds to nothing is a tie, not a win.
  return margin < 1.005 ? 'level' : `${name(best)} ${margin.toFixed(2)}×`;
};

if (markdown) {
  const meta = result.metadata;
  const versions = rivals.map((one) => `${name(one)} ${meta[`${one}Version`] ?? '?'}`).join(', ');
  console.log(`### Benchmark: Firsthand vs ${versions}\n`);
  console.log(
    `${meta.cpu}, ${meta.cores} cores · ${meta.browser} · Node ${meta.nodeVersion} · ` +
      `${meta.measuredRepetitions} repetitions after ${meta.warmupRepetitions} warmups · ` +
      `commit \`${meta.gitCommit.slice(0, 8)}\`\n`,
  );
  console.log(
    `| Scenario | ${frameworks.map((one) => `${name(one)} median`).join(' | ')} | Fastest |`,
  );
  console.log(`| --- | ${frameworks.map(() => '---:').join(' | ')} | :--- |`);
  for (const scenario of result.scenarios) {
    console.log(
      `| ${scenario.id} | ${frameworks.map((one) => `${ms(scenario[one].median)} ms`).join(' | ')} ` +
        `| ${fastest(scenario)} |`,
    );
  }
  console.log('\n| Against | Geometric mean of the per-scenario ratios | 95 % CI | Claimable |');
  console.log('| --- | ---: | :---: | :--- |');
  for (const one of rivals) {
    const { geometricMeanRatio, ci95 } = aggregates[one];
    const claimable =
      ci95[0] > 1
        ? 'yes — the interval excludes 1.0'
        : ci95[1] < 1
          ? 'yes, against Firsthand — the interval is below 1.0'
          : '**no** — the interval includes 1.0';
    console.log(
      `| ${name(one)} | **${geometricMeanRatio.toFixed(3)}** | ` +
        `${ci95[0].toFixed(3)}–${ci95[1].toFixed(3)} | ${claimable} |`,
    );
  }
  console.log(
    '\nA ratio above 1.0 means Firsthand is faster by that factor. Where the interval ' +
      'includes 1.0 the two are level as far as this suite can tell, and nothing may be ' +
      'claimed either way.',
  );
} else {
  console.log(result);
}
