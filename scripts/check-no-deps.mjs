/**
 * Asserts that the browser runtime has no third-party production dependencies.
 *
 * That is the claim the README makes, so it is checked rather than promised.
 * `@firsthandjs/dom` may depend on `@firsthandjs/core` — one package of this project
 * depending on another is not a third-party dependency, and an application that
 * installs `@firsthandjs/dom` downloads exactly the two. The compiler is
 * build-time only and may depend on Babel.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimePackages = [
  'core',
  'dom',
  'jsx-runtime',
  'router',
  'query',
  'styled',
  'react',
  'testing',
];
let failed = false;

for (const name of runtimePackages) {
  const manifest = JSON.parse(
    readFileSync(resolve(root, 'packages', name, 'package.json'), 'utf8'),
  );
  const deps = Object.keys(manifest.dependencies ?? {});
  const foreign = deps.filter((dep) => !dep.startsWith('@firsthandjs/'));
  if (foreign.length > 0) {
    console.error(`@firsthandjs/${name} has production dependencies: ${foreign.join(', ')}`);
    failed = true;
  } else {
    const own = deps.length === 0 ? 'none' : deps.join(', ');
    console.log(`@firsthandjs/${name}: 0 third-party production dependencies (own: ${own})`);
  }
}

// ---------------------------------------------------------------------------
// React belongs to one package
// ---------------------------------------------------------------------------

/**
 * Nothing but `@firsthandjs/react` may mention React.
 *
 * "Usable without React" is a claim about every other package, and the way it
 * would quietly stop being true is a helpful import somewhere else. React is
 * a peer dependency of the bridge, so an application that never imports it
 * never installs it — but only if no other package reaches for it.
 */
const REACT = /(^|[^\w])(from\s+['"]react(-dom)?(\/[\w./-]+)?['"]|require\(['"]react)/;

function* sources(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      yield* sources(path);
    } else if (/\.tsx?$/.test(entry)) {
      yield path;
    }
  }
}

for (const name of runtimePackages) {
  if (name === 'react') {
    continue;
  }
  for (const file of sources(resolve(root, 'packages', name, 'src'))) {
    if (REACT.test(readFileSync(file, 'utf8'))) {
      console.error(`@firsthandjs/${name} imports React (${file}); only the bridge may`);
      failed = true;
    }
  }
}
if (!failed) {
  console.log('React is imported by @firsthandjs/react and by nothing else');
}

process.exitCode = failed ? 1 : 0;
