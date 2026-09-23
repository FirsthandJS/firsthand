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
 * it is; a sentence that says what the headroom **is** has to be true today.
 * Each claim below names the file, the sentence, and where the true value
 * comes from — adding one is a line, and a claim nobody can express as a line
 * is a claim prose should not be making on its own.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const sizes = JSON.parse(
  readFileSync(resolve(root, 'benchmarks/results/bundle-size.json'), 'utf8'),
);
const full = sizes.sizes.find((entry) => entry.module.startsWith('full runtime'));

/**
 * The ceiling, read from the build rather than repeated here.
 *
 * Repeating it would make this check agree with itself while disagreeing with
 * the thing it is about, which is the whole failure it exists to catch.
 */
const budget =
  Number(
    /const budget = ([\d.]+) \* 1024;/u.exec(
      readFileSync(resolve(root, 'scripts/build.mjs'), 'utf8'),
    )[1],
  ) * 1024;

/** A figure as prose writes it: 7,667 rather than 7667. */
const grouped = (value) => value.toLocaleString('en-US');

const claims = [
  {
    file: 'docs/architecture/code-rules.md',
    what: 'the headroom under the runtime budget',
    pattern: /headroom is now \*\*([\d,]+) bytes\*\*/u,
    expected: () => grouped(budget - full.gzip),
  },
  {
    file: 'docs/architecture/code-rules.md',
    what: 'the full runtime as the budget measures it',
    pattern: /\|\s*`[0-9a-f]{7}`, after the fix \(#59\)\s*\|[^|]*\|\s*([\d,]+) B\s*\|/u,
    expected: () => grouped(full.gzip),
  },
];

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
  console.log(`${claims.length} size claims in prose agree with the build`);
}
