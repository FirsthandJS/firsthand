/**
 * Regenerates the README's test counts from the suites themselves.
 *
 * The same rule the benchmark numbers already follow: a figure appears in the
 * README because something measured it, not because someone typed it. The test
 * count was the one claim that escaped that — it said 561 long after the suite
 * had grown past 600, which is exactly the kind of quiet drift that makes a
 * reader stop trusting the other numbers on the page.
 *
 * The Vitest count comes from the JSON report `npm run coverage` writes, so it
 * costs nothing extra: the suite has just run. The Playwright count comes from
 * `playwright test --list`, which enumerates without launching a browser.
 *
 * `--check` fails if the README has drifted, and `npm run check` runs it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const START = '<!-- tests:start -->';
const END = '<!-- tests:end -->';

const reportPath = resolve(root, 'reports/tests.json');
if (!existsSync(reportPath)) {
  console.error(
    'reports/tests.json is missing, so there is no measured test count to use.\n' +
      'Run `npm run coverage` first: it writes the report as a side effect of the run.',
  );
  process.exit(1);
}
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const unit = report.numTotalTests;
if (typeof unit !== 'number') {
  console.error('reports/tests.json has no numTotalTests. Was it written by a different reporter?');
  process.exit(1);
}

/**
 * Asks Playwright what it would run, across every configured project.
 *
 * `--list` resolves the config and prints one line per test plus a total; it
 * starts no browser and no web server, so this stays a fast check rather than
 * a second browser run.
 */
const listed = execFileSync(
  process.execPath,
  [resolve(root, 'node_modules/@playwright/test/cli.js'), 'test', '--list'],
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
);
const totals = /Total:\s+(\d+)\s+tests?\s+in\s+(\d+)\s+files?/.exec(listed);
if (totals === null) {
  console.error('Could not read a total out of `playwright test --list`.');
  process.exit(1);
}
const browser = Number(totals[1]);

/**
 * The examples, counted rather than remembered.
 *
 * Each one is a directory with its own entry point; the files beside them —
 * the shared stylesheet, the index, the workspace's own config — are not
 * examples and are skipped by looking for that entry point.
 */
const examples = readdirSync(resolve(root, 'examples'), { withFileTypes: true }).filter(
  (entry) => entry.isDirectory() && existsSync(resolve(root, 'examples', entry.name, 'main.tsx')),
).length;

/** Prose spells small numbers, so the generated sentence does too. */
const WORDS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];
const word = (value) => WORDS[value] ?? String(value);

// The prettier-ignore pair is what the benchmark block uses, and for the same
// reason: without it Prettier reflows the generated sentence, the next `--check`
// reports drift, and regenerating puts it back — forever.
const body = `${START}
<!-- prettier-ignore-start -->
This repository is the demonstration: ${unit} tests under Vitest and ${browser}
under Playwright across Chromium, Firefox and WebKit, covering the framework,
the router, the query cache and all ${word(examples)} examples.
<!-- prettier-ignore-end -->
${END}`;

const path = resolve(root, 'README.md');
const readme = readFileSync(path, 'utf8');
const start = readme.indexOf(START);
const end = readme.indexOf(END);
if (start === -1 || end === -1) {
  console.error(`README.md is missing the ${START} / ${END} markers.`);
  process.exit(1);
}
const updated = readme.slice(0, start) + body + readme.slice(end + END.length);

if (check) {
  if (updated !== readme) {
    console.error('README.md test counts have drifted. Run `npm run tests:readme`.');
    process.exit(1);
  }
  console.log(`README test counts are current: ${unit} unit, ${browser} browser.`);
} else {
  writeFileSync(path, updated);
  console.log(`README test counts regenerated: ${unit} unit, ${browser} browser.`);
}
