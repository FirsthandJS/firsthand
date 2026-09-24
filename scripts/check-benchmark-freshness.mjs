/**
 * Asserts that the published benchmark numbers describe the published code.
 *
 * `check:readme` proves the README transcribes `benchmarks/results/` correctly.
 * It cannot prove the results are about this version, and for a while they were
 * not: the README's headline — how much faster than React, Solid and Vue —
 * carried numbers measured on 0.9.0 while the packages were at 0.11.1, with two
 * releases of runtime changes in between. Transcribed faithfully, and a claim
 * about code nobody was shipping any more.
 *
 * So the rule is the version. A benchmark run records the version it measured;
 * if that is not the version in the workspace, the numbers are about something
 * else and the build says so. Re-record with `npm run bench` (which writes
 * `latest.json`) and then `npm run bench:readme`.
 *
 * Not a mtime rule, deliberately: a benchmark is a measurement of a machine as
 * much as of a tree, and a rule that demanded a re-run for every touched source
 * file would be a rule people turn off. A version is the unit the claim is made
 * in — the README says "the runtime is this fast", and a release is when that
 * sentence changes.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const read = (file) => JSON.parse(readFileSync(resolve(root, file), 'utf8'));

const version = read('packages/core/package.json').version;
const results = read('benchmarks/results/latest.json');
const measured = results.metadata?.firsthandVersion;
const commit = results.metadata?.gitCommit;
const when = results.metadata?.timestamp;

if (measured === undefined) {
  console.error(
    'benchmarks/results/latest.json records no firsthandVersion, so nothing can be said ' +
      'about what it measured. Re-record it with `npm run bench`.',
  );
  process.exitCode = 1;
} else if (measured !== version) {
  console.error(
    `benchmarks/results/latest.json measured ${measured}; the workspace is at ${version}. ` +
      'The README publishes these numbers as a claim about the current runtime, so they have ' +
      `to be measured on it: run \`npm run bench\` and then \`npm run bench:readme\`. ` +
      `(The stale run was ${String(commit).slice(0, 8)}, ${String(when)}.)`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `benchmark results measured on ${measured}, which is this workspace ` +
      `(${String(commit).slice(0, 8)}, ${String(when)})`,
  );
}
