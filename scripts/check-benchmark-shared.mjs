/**
 * Asserts that the two benchmarks measure the same implementation.
 *
 * The repository's own benchmark and the js-framework-benchmark entry both have
 * to go through `benchmarks/app/table.tsx`. If one of them ever grows its own
 * copy of the row component, the independent numbers stop being independent
 * evidence about the same code — so this fails the build instead.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const consumers = [
  'benchmarks/app/firsthand.tsx',
  'benchmarks/js-framework-benchmark/src/main.tsx',
];

let failed = false;
for (const file of consumers) {
  const source = readFileSync(resolve(root, file), 'utf8');
  const importsShared = /from '[^']*table\.js'/.test(source);
  const definesRow = /<tr[\s>]/.test(source);
  if (!importsShared) {
    console.error(`${file} does not import the shared table implementation`);
    failed = true;
  } else if (definesRow) {
    console.error(`${file} defines its own rows instead of using the shared ones`);
    failed = true;
  } else {
    console.log(`${file}: uses the shared table implementation`);
  }
}

process.exitCode = failed ? 1 : 0;
