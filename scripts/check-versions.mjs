/**
 * Asserts that every package carries the same version, and that each
 * `@firsthandjs/*` dependency asks for exactly that version.
 *
 * The packages are published together and the compiler's output depends on the
 * runtime's protocol, so a mismatch is a release that cannot work.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packages = [
  'core',
  'dom',
  'jsx-runtime',
  'router',
  'query',
  'styled',
  'react',
  'testing',
  'compiler',
];

const manifests = packages.map((name) => ({
  name,
  manifest: JSON.parse(readFileSync(resolve(root, 'packages', name, 'package.json'), 'utf8')),
}));

const version = manifests[0].manifest.version;
let failed = false;

for (const { name, manifest } of manifests) {
  if (manifest.version !== version) {
    console.error(
      `@firsthandjs/${name} is ${manifest.version}, but @firsthandjs/core is ${version}`,
    );
    failed = true;
  }
  for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
    if (dependency.startsWith('@firsthandjs/') && range !== version) {
      console.error(`@firsthandjs/${name} depends on ${dependency}@${range}, not ${version}`);
      failed = true;
    }
  }
  for (const required of ['license', 'repository', 'description']) {
    if (manifest[required] === undefined) {
      console.error(`@firsthandjs/${name} has no "${required}"`);
      failed = true;
    }
  }
  if (!(manifest.files ?? []).includes('LICENSE')) {
    console.error(`@firsthandjs/${name} does not publish its LICENSE`);
    failed = true;
  }
}

if (!failed) {
  console.log(`all ${String(packages.length)} packages at ${version}, cross-references included`);
}
process.exitCode = failed ? 1 : 0;
