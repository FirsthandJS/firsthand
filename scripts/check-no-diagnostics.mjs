/**
 * Asserts that the production bundles carry no development diagnostics.
 *
 * ADR-0019 and ADR-0020 promise devtools and strict-reactivity warnings that
 * production does not pay for. The mechanism is a resolver alias in
 * `scripts/build.mjs` that swaps `dev.js` for `dev.prod.ts`, and it is a
 * *suffix rewrite on the import specifier*:
 *
 *     args.path.replace(/dev\.js$/, 'dev.prod.ts')
 *
 * So the promise holds only as long as every module that imports diagnostics
 * does so through a specifier ending in `dev.js`, and only as long as
 * `dev.ts` and `dev.prod.ts` stay in the same directory — the rewrite keeps
 * esbuild's `resolveDir` and changes the basename.
 *
 * Nothing else in the repo checks that. Tests run against the development
 * build, so a split that renames the module, moves it, or reaches it as
 * `@/diagnostics/hooks.js` would ship the real diagnostics and no suite would
 * notice: the only symptom is a bundle that is quietly bigger than the budget
 * claims. That is what this file is for, and it is why it runs after `build`.
 *
 *   npm run build && npm run check:no-diagnostics
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Text that only exists in `dev.ts`. Each one is a whole message rather than a
 * word, so that a minifier renaming identifiers cannot hide it and an ordinary
 * string in real code cannot be mistaken for it.
 */
const diagnostics = [
  'A signal or prop was read in a component setup without anything subscribing',
  'A signal or computed was rendered directly',
  'An object was rendered as text',
  'The markup is kept as the server sent it',
  'hands a child a new function on every run',
];

/** The packages whose production bundle must be free of them. */
const audited = ['core', 'dom', 'jsx-runtime'];

let failed = false;

for (const name of audited) {
  const dist = join(root, 'packages', name, 'dist');
  if (!existsSync(dist)) {
    console.error(`packages/${name}/dist is missing — run \`npm run build\` first`);
    failed = true;
    continue;
  }
  for (const entry of readdirSync(dist)) {
    // The development build is *meant* to carry them: `index.dev.js` and the
    // chunks it splits into, which `scripts/build.mjs` names `dev-chunk-*`.
    if (!entry.endsWith('.js') || entry.endsWith('.dev.js') || entry.startsWith('dev-chunk-')) {
      continue;
    }
    const code = readFileSync(join(dist, entry), 'utf8');
    for (const message of diagnostics) {
      if (code.includes(message)) {
        console.error(
          `packages/${name}/dist/${entry} contains a development diagnostic: "${message}"\n` +
            '  The `dev.js` → `dev.prod.ts` alias in scripts/build.mjs did not fire.\n' +
            '  It matches the *end* of the import specifier, so the module must be\n' +
            '  imported as something ending in `dev.js`, and `dev.prod.ts` must sit\n' +
            '  next to it. See ADR-0020.',
        );
        failed = true;
      }
    }
  }
}

if (failed) {
  process.exit(1);
}

console.log(`no development diagnostics in ${audited.join(', ')}`);
