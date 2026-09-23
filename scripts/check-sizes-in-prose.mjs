/**
 * Asserts that the size figures written into prose are the sizes the build
 * measures.
 *
 * `check:readme` governs the README and the reference pages, because those are
 * generated. The architecture notes and the ADRs are not: their numbers are
 * typed by hand, by somebody who measured once and moved on. That number has
 * drifted twice in two days — first stale in the direction that flattered us,
 * then corrected to a figure taken from a probe that weighed a bundle 69 bytes
 * larger than anything that ships.
 *
 * What this checks is deliberately narrow: the *claims*, not every number.
 * A byte figure beside a commit hash is history and is supposed to stay where
 * it is — a check that made the table agree with today would be asking for
 * history to be falsified. A sentence that says what the headroom **is** has
 * to be true today, and that is what a claim names. Adding one is a line, and
 * a claim nobody can express as a line is a claim prose should not be making
 * on its own.
 *
 * One claim is enough for the runtime's own size: the headroom is the budget
 * minus the measurement, and the budget is read from the build, so pinning the
 * headroom pins the figure. A second claim naming the same number would add no
 * coverage and one more thing to keep true.
 */
import { readFileSync, statSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const measurement = resolve(root, 'benchmarks/results/bundle-size.json');

const sizes = JSON.parse(readFileSync(measurement, 'utf8'));
const full = sizes.sizes.find((entry) => entry.module.startsWith('full runtime'));

/**
 * The ceiling, read from the build rather than repeated here.
 *
 * Repeating it would make this check agree with itself while disagreeing with
 * the thing it is about, which is the whole failure it exists to catch. If the
 * build ever spells it differently this says so, rather than dying on a
 * subscript — the anchor moving is the same class of drift as the number
 * moving.
 */
function budgetFromBuild() {
  const source = readFileSync(resolve(root, 'scripts/build.mjs'), 'utf8');
  const found = /const budget = ([\d.]+) \* 1024;/u.exec(source);
  if (found === null) {
    console.error(
      'Could not find the budget in scripts/build.mjs. It is read rather than ' +
        'repeated here on purpose, so this check cannot run until the line it ' +
        'reads is found again.',
    );
    process.exit(1);
  }
  return Number(found[1]) * 1024;
}

/**
 * The newest source file the runtime is built from.
 *
 * The measurement on disk is only worth reading if it is newer than what it
 * measured. Inside `npm run check` it always is, because `build` runs first —
 * but somebody debugging a failure runs this alone, and then it would happily
 * compare prose against whatever was measured hours ago. That is how
 * `check:tests` misled a session yesterday: it reads a report only one command
 * writes, and said the counts were current when they were 49 tests stale.
 */
function newestSource() {
  let newest = { path: '', at: 0 };
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith('.ts')) {
        const at = statSync(path).mtimeMs;
        if (at > newest.at) {
          newest = { path, at };
        }
      }
    }
  };
  for (const pkg of readdirSync(resolve(root, 'packages'), { withFileTypes: true })) {
    const source = resolve(root, 'packages', pkg.name, 'src');
    if (pkg.isDirectory()) {
      try {
        walk(source);
      } catch {
        // A package without a `src` is a package with nothing to measure.
      }
    }
  }
  return newest;
}

/** A figure as prose writes it: 7,667 rather than 7667. */
const grouped = (value) => value.toLocaleString('en-US');

const budget = budgetFromBuild();

const claims = [
  {
    file: 'docs/architecture/code-rules.md',
    what: 'the headroom under the runtime budget',
    pattern: /headroom is now \*\*([\d,]+) bytes\*\*/u,
    expected: () => grouped(budget - full.gzip),
  },
];

const source = newestSource();
if (source.at > statSync(measurement).mtimeMs) {
  console.error(
    `benchmarks/results/bundle-size.json is older than ${source.path.slice(root.length + 1)}, ` +
      'so it measures something that is no longer there. Run `npm run build` first.',
  );
  process.exit(1);
}

let wrong = 0;
for (const claim of claims) {
  const text = readFileSync(resolve(root, claim.file), 'utf8');
  const found = claim.pattern.exec(text);
  const expected = claim.expected();
  if (found === null) {
    console.error(`${claim.file} no longer states ${claim.what}. It should say ${expected}.`);
    wrong += 1;
    continue;
  }
  if (found[1] !== expected) {
    console.error(
      `${claim.file} says ${claim.what} is ${found[1]}; the build measures ${expected}. ` +
        'Nothing regenerates this file — correct it by hand, with `npm run build` rather than a probe.',
    );
    wrong += 1;
  }
}

if (wrong > 0) {
  process.exitCode = 1;
} else {
  // Which measurement, not merely that one agreed: a check that says only
  // "passed" is a check somebody has to go and verify.
  console.log(
    `${claims.length} size claim in prose agrees with benchmarks/results/bundle-size.json ` +
      `(full runtime ${grouped(full.gzip)} B gzip, budget ${grouped(budget)} B)`,
  );
}
