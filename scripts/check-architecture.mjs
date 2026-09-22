/**
 * The architecture rules a linter cannot see.
 *
 * ESLint checks one file at a time, so it can say "this import is restricted"
 * but not "these four modules form a cycle" or "this package's surface has
 * grown to thirty names". Those are properties of the graph, and this is where
 * the graph gets built. Everything here is from `docs/architecture/code-rules.md`;
 * nothing here is new policy.
 *
 *   node scripts/check-architecture.mjs
 *
 * Exits non-zero on the first category that fails, and prints every instance
 * rather than only the first — a refactor wants the whole list.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Who may import whom. A package may reach what is listed and nothing else;
 * `[]` means it stands alone. This is the table from code-rules §1 (D), and it
 * is the one place it exists as data rather than as prose.
 */
const layers = {
  core: [],
  compiler: [],
  dom: ['core'],
  server: ['core'],
  'jsx-runtime': ['core', 'dom'],
  deep: ['core'],
  devtools: ['core', 'dom'],
  i18n: ['core'],
  testing: ['core', 'dom'],
  router: ['core', 'dom'],
  data: ['core'],
  'data-axios': ['core', 'data'],
  'data-urql': ['core', 'data'],
  'data-apollo': ['core', 'data'],
  // `import type {} from '@firsthandjs/jsx-runtime'` pulls in the JSX namespace
  // augmentation, which is how a styled component types its own props. Types
  // only: nothing from that package survives into the bundle.
  styled: ['core', 'dom', 'jsx-runtime'],
  react: ['core', 'dom'],
};

/** Names a module may export before it is doing two jobs (code-rules §1, I). */
const MAX_EXPORTS = 12;

/** A barrel exists to re-export, so counting its names would measure nothing. */
const barrels = new Set(['index.ts', 'internal.ts', 'types.ts']);

const failures = [];
const fail = (category, message) => failures.push({ category, message });

// ---------------------------------------------------------------------------
// Collecting
// ---------------------------------------------------------------------------

/** Every `.ts`/`.tsx` under a directory, recursively. */
function* sources(directory) {
  if (!existsSync(directory)) {
    return;
  }
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      yield* sources(path);
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) {
      yield path;
    }
  }
}

/**
 * The specifiers a module imports from, including `export … from`.
 *
 * Dynamic imports are only collected for the cycle graph, not for the `../`
 * rule: a test may legitimately contain the *text* `import('../generated/types')`
 * as an assertion about compiler output, and a regex cannot tell that from the
 * real thing. ESLint parses rather than matches, and covers the real ones.
 */
function specifiersOf(file, { dynamic = true } = {}) {
  const code = readFileSync(file, 'utf8');
  const found = [];
  for (const match of code.matchAll(/^\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/gm)) {
    found.push(match[1]);
  }
  if (dynamic) {
    for (const match of code.matchAll(/(^|[^'"`])\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm)) {
      found.push(match[2]);
    }
  }
  return found;
}

/** The names a module exports, ignoring re-exports and types. */
function exportsOf(file) {
  const code = readFileSync(file, 'utf8');
  const names = new Set();
  for (const match of code.matchAll(
    /^export\s+(?:async\s+)?(?:function|class|const|let)\s+(\w+)/gm,
  )) {
    names.add(match[1]);
  }
  for (const match of code.matchAll(/^export\s*\{([^}]*)\}\s*(?!from)/gm)) {
    for (const part of match[1].split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop();
      if (name !== undefined && name !== '' && !part.includes('type ')) {
        names.add(name);
      }
    }
  }
  return names;
}

const packages = readdirSync(join(root, 'packages')).filter((name) =>
  existsSync(join(root, 'packages', name, 'package.json')),
);

// ---------------------------------------------------------------------------
// 1. Imports are absolute (code-rules §3)
// ---------------------------------------------------------------------------

for (const name of packages) {
  for (const file of sources(join(root, 'packages', name))) {
    if (file.includes(`${sep}dist${sep}`)) {
      continue;
    }
    for (const specifier of specifiersOf(file, { dynamic: false })) {
      if (specifier.startsWith('../')) {
        fail('imports', `${short(file)} imports '${specifier}' — use '@/…' (code-rules §3)`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Layering (code-rules §1, D)
// ---------------------------------------------------------------------------

for (const name of packages) {
  const allowed = layers[name];
  if (allowed === undefined) {
    fail('layering', `packages/${name} is not in the layer table in this file — add it`);
    continue;
  }
  for (const file of sources(join(root, 'packages', name, 'src'))) {
    for (const specifier of specifiersOf(file)) {
      const match = /^@firsthandjs\/([^/]+)/.exec(specifier);
      if (match === null || match[1] === name) {
        continue;
      }
      if (!allowed.includes(match[1])) {
        fail(
          'layering',
          `${short(file)} imports '${specifier}' — ${name} may import ${
            allowed.length === 0 ? 'nothing' : allowed.join(', ')
          }`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. No cycles, inside a package or between them
// ---------------------------------------------------------------------------

const graph = new Map();
for (const name of packages) {
  for (const file of sources(join(root, 'packages', name, 'src'))) {
    const edges = [];
    for (const specifier of specifiersOf(file)) {
      const target = localTarget(file, specifier);
      if (target !== null) {
        edges.push(target);
      }
    }
    graph.set(file, edges);
  }
}

/** The file a `./…` or `@/…` specifier names, or `null` for anything else. */
function localTarget(file, specifier) {
  let base;
  if (specifier.startsWith('./')) {
    base = join(dirname(file), specifier.slice(2));
  } else if (specifier.startsWith('@/')) {
    const parts = file.split(sep);
    base = join(
      parts.slice(0, parts.lastIndexOf('packages') + 2).join(sep),
      'src',
      specifier.slice(2),
    );
  } else {
    return null;
  }
  const stem = base.replace(/\.js$/, '');
  for (const candidate of [`${stem}.ts`, `${stem}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

const state = new Map();
for (const file of graph.keys()) {
  visit(file, []);
}

/**
 * Depth-first, remembering the path so a cycle can be printed as the cycle it
 * is rather than as "somewhere below here". `state` keeps a node from being
 * walked twice, which is what keeps this linear.
 */
function visit(file, path) {
  if (state.get(file) === 'done') {
    return;
  }
  if (state.get(file) === 'open') {
    const cycle = [...path.slice(path.indexOf(file)), file].map(short).join(' → ');
    fail('cycles', cycle);
    return;
  }
  state.set(file, 'open');
  for (const next of graph.get(file) ?? []) {
    visit(next, [...path, file]);
  }
  state.set(file, 'done');
}

// ---------------------------------------------------------------------------
// 4. Module surface (code-rules §1, I)
// ---------------------------------------------------------------------------

for (const name of packages) {
  for (const file of sources(join(root, 'packages', name, 'src'))) {
    if (barrels.has(file.split(sep).pop())) {
      continue;
    }
    const names = exportsOf(file);
    if (names.size > MAX_EXPORTS) {
      fail(
        'surface',
        `${short(file)} exports ${names.size} names (max ${MAX_EXPORTS}) — it has two jobs, or a name should be internal`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Every package can resolve `@/`
// ---------------------------------------------------------------------------

for (const name of packages) {
  const dir = join(root, 'packages', name);
  for (const config of ['tsconfig.json', 'tsconfig.test.json']) {
    const path = join(dir, config);
    if (!existsSync(path)) {
      fail('aliases', `packages/${name}/${config} is missing — '@/' would not resolve`);
      continue;
    }
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed.compilerOptions?.paths?.['@/*']?.[0] !== './src/*') {
      fail('aliases', `packages/${name}/${config} does not map '@/*' to './src/*'`);
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/** Every `eslint-disable`, so the count is visible rather than discovered. */
const disables = [];
for (const name of packages) {
  for (const file of sources(join(root, 'packages', name, 'src'))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (line.includes('eslint-disable')) {
        disables.push(`${short(file)}:${index + 1}`);
      }
    });
  }
}

function short(file) {
  return relative(root, file).split(sep).join('/');
}

const categories = ['imports', 'layering', 'cycles', 'surface', 'aliases'];
for (const category of categories) {
  const found = failures.filter((entry) => entry.category === category);
  if (found.length > 0) {
    console.error(`\n${category} (${found.length}):`);
    for (const entry of found) {
      console.error(`  ${entry.message}`);
    }
  }
}

console.log(
  `\nchecked ${graph.size} modules in ${packages.length} packages · ${disables.length} eslint-disable${
    disables.length === 1 ? '' : 's'
  }`,
);
for (const disable of disables) {
  console.log(`  ${disable}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} architecture violation(s) — docs/architecture/code-rules.md`);
  process.exit(1);
}
