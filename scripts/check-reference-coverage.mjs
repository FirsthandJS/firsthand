/**
 * Asserts that everything a package exports is named in a reference page.
 *
 * `check:exports` proves the documented entry points exist. This is the other
 * direction: an export that no page mentions is a thing somebody can import,
 * cannot look up, and will therefore either use wrongly or not use at all. It
 * is also the failure mode nobody notices, because adding an export is a
 * diff you read and a page you forget.
 *
 * It found three when it was written: `serialize` and `createMemoryStorage`,
 * which are how a server's answers reach the browser, and devtools' `watch`.
 *
 * A re-export is checked against the page for the package it came from —
 * `@firsthandjs/dom` re-exports the whole of `@firsthandjs/core`, and copying
 * that reference into a second page would leave two to keep in step.
 *
 * "Named" is deliberately a low bar: this asks whether a reader can find the
 * word, not whether the prose is good. A stricter rule would be a rule people
 * satisfy with a table nobody reads.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Packages with a reference page, by the name their page is under. */
const packages = [
  'core',
  'dom',
  'server',
  'router',
  'data',
  'styled',
  'i18n',
  'deep',
  'devtools',
  'testing',
  'compiler',
  'react',
];

const page = (name) => resolve(root, 'docs/reference', `${name}.md`);

/** Every name an index exports, with the package it came from if not this one. */
function exportsOf(source) {
  const found = new Map();
  const named = /export\s*(?:type\s*)?\{([^}]*)\}(?:\s*from\s*'([^']+)')?/gu;
  for (const match of source.matchAll(named)) {
    const from = match[2] ?? '';
    const foreign = /^@firsthandjs\/([\w-]+)/u.exec(from)?.[1];
    for (const part of match[1].split(',')) {
      const name = part.trim().split(' as ').at(-1)?.replace('type ', '').trim();
      if (name !== undefined && name !== '' && /^[A-Za-z]/u.test(name)) {
        found.set(name, foreign);
      }
    }
  }
  const declared = /export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/gu;
  for (const match of source.matchAll(declared)) {
    found.set(match[1], undefined);
  }
  return found;
}

const text = new Map();
const read = (name) => {
  if (!text.has(name)) {
    const file = page(name);
    text.set(name, existsSync(file) ? readFileSync(file, 'utf8') : null);
  }
  return text.get(name);
};

let failed = false;
let checked = 0;

for (const name of packages) {
  const index = resolve(root, 'packages', name, 'src/index.ts');
  if (!existsSync(index) || read(name) === null) {
    console.error(`${name}: no index or no reference page`);
    failed = true;
    continue;
  }
  const missing = [];
  for (const [symbol, foreign] of exportsOf(readFileSync(index, 'utf8'))) {
    checked++;
    const where = read(foreign ?? name) ?? read(name);
    if (
      !new RegExp(`\\b${symbol.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\b`, 'u').test(where)
    ) {
      missing.push(symbol);
    }
  }
  if (missing.length > 0) {
    console.error(
      `docs/reference/${name}.md does not mention: ${missing.join(', ')} — ` +
        'document it, or say in the page that it is internal.',
    );
    failed = true;
  }
}

if (!failed) {
  console.log(
    `${checked} exports across ${packages.length} packages, each named in a reference page`,
  );
}
process.exitCode = failed ? 1 : 0;
