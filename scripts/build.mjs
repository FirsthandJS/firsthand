/**
 * Builds every package and reports the size of the browser runtime.
 *
 * Types come from `tsc -b` (declarations only). JavaScript is bundled per
 * package with esbuild, with cross-package imports left external so that
 * `@firsthandjs/core` is not duplicated inside `@firsthandjs/dom`.
 *
 * The dev-diagnostics module is aliased to its production stub here. That is
 * the whole mechanism: no `if (DEV)` guards in the source, so there are no
 * branches that tests can never take, and no diagnostics in the shipped bundle.
 */
import { execFileSync } from 'node:child_process';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Replaces `dev.js` with `dev.prod.js` so diagnostics are dropped. */
const productionDev = {
  name: 'firsthand-production-dev',
  setup(build) {
    build.onResolve({ filter: /(^|\/)dev\.js$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.replace(/dev\.js$/, 'dev.prod.ts')),
    }));
  },
};

/**
 * The development-only hooks, which production replaces with empty functions.
 *
 * Replacing them is not quite enough: esbuild keeps a call to an empty
 * function, because it cannot know the function is free of side effects. This
 * list says that it is, so the calls are removed rather than merely emptied —
 * which is the difference between "the diagnostics are disabled" and "the
 * diagnostics are not in the file" (ADR-0019, ADR-0020).
 *
 * `reportUncaught` is deliberately absent: it does real work in production.
 */
const pureDevHooks = [
  'devWarn',
  'devWarnOnce',
  'devWarnRenderedObject',
  'devCheckSetupRead',
  'devEnterSetup',
  'devExitSetup',
  'devEnterSnapshot',
  'devExitSnapshot',
  'devLabel',
  'devCause',
  'devRoot',
  'devRunning',
  'devPart',
];

const targets = [
  { pkg: 'core', entries: { index: 'src/index.ts' }, platform: 'browser', runtime: true },
  {
    pkg: 'dom',
    entries: { index: 'src/index.ts', internal: 'src/internal.ts' },
    platform: 'browser',
    runtime: true,
  },
  { pkg: 'jsx-runtime', entries: { index: 'src/index.ts' }, platform: 'browser', runtime: true },
  // Optional packages: an application that does not route does not download
  // them, so they are measured separately from the core runtime budget.
  {
    pkg: 'deep',
    entries: { index: 'src/index.ts' },
    platform: 'browser',
    runtime: false,
    optional: true,
  },
  {
    pkg: 'devtools',
    entries: { index: 'src/index.ts' },
    platform: 'browser',
    runtime: false,
    optional: true,
    // The panel is reached through a dynamic import so that a session which
    // never opens it never downloads it. That only holds if the bundler is
    // allowed to split, which it does not do for a single entry by default.
    split: true,
  },
  {
    pkg: 'i18n',
    entries: { index: 'src/index.ts' },
    platform: 'browser',
    runtime: false,
    optional: true,
  },
  {
    pkg: 'router',
    entries: { index: 'src/index.ts' },
    platform: 'browser',
    runtime: false,
    optional: true,
  },
  {
    pkg: 'data',
    entries: { index: 'src/index.ts' },
    platform: 'browser',
    runtime: false,
    optional: true,
  },
  // One per client, each a thin binding over an instance the application
  // built. They carry no dependency on the client they bind (ADR-0022).
  {
    pkg: 'data-axios',
    entries: { index: 'src/index.ts' },
    platform: 'browser',
    runtime: false,
    optional: true,
  },
  {
    pkg: 'data-urql',
    entries: { index: 'src/index.ts' },
    platform: 'browser',
    runtime: false,
    optional: true,
  },
  {
    pkg: 'data-apollo',
    entries: { index: 'src/index.ts' },
    platform: 'browser',
    runtime: false,
    optional: true,
  },
  {
    pkg: 'styled',
    entries: { index: 'src/index.ts' },
    platform: 'browser',
    runtime: false,
    optional: true,
  },
  // React and react-dom are peers: an application that uses the bridge already
  // has them, and one that does not must not pay for them.
  {
    pkg: 'react',
    entries: { index: 'src/index.ts', auto: 'src/auto.ts' },
    platform: 'browser',
    runtime: false,
    optional: true,
    external: ['react', 'react-dom', 'react-dom/client'],
  },
  // The `.graphql` loader and the codegen plugin are build-time, like the
  // compiler's plugin.
  {
    pkg: 'data',
    entries: { vite: 'src/vite.ts', codegen: 'src/codegen.ts' },
    platform: 'node',
    runtime: false,
  },
  // Test helpers are a dev dependency, so their size is not part of the
  // browser-runtime budget.
  { pkg: 'testing', entries: { index: 'src/index.ts' }, platform: 'browser', runtime: false },
  {
    pkg: 'compiler',
    entries: { index: 'src/index.ts', vite: 'src/vite.ts' },
    platform: 'node',
    runtime: false,
  },
];

for (const target of targets) {
  rmSync(resolve(root, 'packages', target.pkg, 'dist'), { recursive: true, force: true });
}

execFileSync(
  process.execPath,
  [resolve(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-b', '--force'],
  {
    cwd: root,
    stdio: 'inherit',
  },
);

const sizes = [];
/** Opt-in packages: measured, but outside the runtime budget an app always pays. */
const optional = [];

/** esbuild reports output paths relative to the working directory. */
function relativeDist(from, base) {
  const relative = base
    .slice(from.length + 1)
    .split(sep)
    .join('/');
  return `${relative}/dist`;
}

/** An output file together with every chunk it imports, transitively. */
function withChunks(metafile, entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || metafile.outputs[file] === undefined) {
      continue;
    }
    seen.add(file);
    for (const imported of metafile.outputs[file].imports) {
      if (imported.kind !== 'require-call' && metafile.outputs[imported.path] !== undefined) {
        queue.push(imported.path);
      }
    }
  }
  return [...seen];
}

for (const target of targets) {
  const base = resolve(root, 'packages', target.pkg);
  const entries = Object.entries(target.entries);
  const result = await esbuild.build({
    metafile: true,
    entryPoints: entries.map(([name, entry]) => ({ in: resolve(base, entry), out: name })),
    outdir: resolve(base, 'dist'),
    bundle: true,
    format: 'esm',
    // Code splitting matters for correctness, not only for size: `@firsthandjs/dom`
    // and `@firsthandjs/dom/internal` share module state — the delegated-listener
    // registry, the configured element prefix — and building them as two
    // independent bundles would give an application two copies of it.
    splitting: entries.length > 1 || target.split === true,
    chunkNames: 'chunk-[hash]',
    platform: target.platform,
    target: target.platform === 'node' ? 'node20' : 'es2022',
    minify: target.runtime || target.optional === true,
    legalComments: 'none',
    pure: target.runtime || target.optional === true ? pureDevHooks : [],
    external: ['@firsthandjs/*', '@babel/*', 'node:*', ...(target.external ?? [])],
    plugins: target.runtime || target.optional === true ? [productionDev] : [],
  });
  // A second build for the packages that carry diagnostics: same code, with
  // `dev.ts` left in place. The production build strips them, which is the
  // point — and it also means an application installing from npm could never
  // reach devtools or a development warning. The `development` export
  // condition picks this one up, and Vite sets that condition while serving.
  if (existsSync(resolve(base, 'src', 'dev.ts'))) {
    await esbuild.build({
      entryPoints: entries.map(([name, entry]) => ({
        in: resolve(base, entry),
        out: `${name}.dev`,
      })),
      outdir: resolve(base, 'dist'),
      bundle: true,
      format: 'esm',
      splitting: entries.length > 1,
      chunkNames: 'dev-chunk-[hash]',
      platform: target.platform,
      target: target.platform === 'node' ? 'node20' : 'es2022',
      // Unminified on purpose: this build exists to produce readable warnings,
      // and devtools name a signal after the stack frame that created it.
      minify: false,
      legalComments: 'none',
      external: ['@firsthandjs/*', '@babel/*', 'node:*', ...(target.external ?? [])],
    });
  }

  if (!target.runtime && target.optional !== true) {
    continue;
  }
  for (const [name] of entries) {
    // An entry's real cost is the entry file plus every shared chunk it pulls
    // in. Reporting the entry alone would understate it by exactly the amount
    // code splitting moved out of sight.
    const files = withChunks(result.metafile, `${relativeDist(root, base)}/${name}.js`);
    const code = Buffer.concat(files.map((file) => readFileSync(resolve(root, file))));
    (target.runtime ? sizes : optional).push({
      module: `@firsthandjs/${target.pkg}${name === 'index' ? '' : `/${name}`}`,
      minified: code.byteLength,
      gzip: gzipSync(code, { level: 9 }).byteLength,
      brotli: brotliCompressSync(code).byteLength,
    });
  }
}

/**
 * Measures the query cache as an application using the `.gql` loader gets it.
 *
 * The loader parses documents at build time, so `parseGraphQL` is unreachable
 * and tree-shaken out. That is a published number, so it is measured here
 * rather than by hand.
 */
const loaderEntry = resolve(root, 'scripts', '.data-loader-entry.js');
mkdirSync(dirname(loaderEntry), { recursive: true });
writeFileSync(
  loaderEntry,
  [
    'export {',
    '  createData, DataContext, useData, useInvalidate,',
    '  useResource, useAction, fromObservable, fromPromise,',
    '  tag, tagMatches, anyTagMatches, resolveTags,',
    '  createCacheClient, createFetchClient, FirsthandHttpError,',
    "} from '../packages/data/src/index.js';",
  ].join('\n'),
);
const loaderBuild = await esbuild.build({
  entryPoints: [loaderEntry],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  pure: pureDevHooks,
  external: ['@firsthandjs/*'],
  plugins: [productionDev],
});
rmSync(loaderEntry, { force: true });
const loaderCode = Buffer.from(loaderBuild.outputFiles[0].contents);
// Reported next to the package it is a variant of, rather than at the end.
optional.splice(optional.findIndex((entry) => entry.module === '@firsthandjs/data') + 1, 0, {
  module: '@firsthandjs/data (.gql loader path, parser tree-shaken)',
  minified: loaderCode.byteLength,
  gzip: gzipSync(loaderCode, { level: 9 }).byteLength,
  brotli: brotliCompressSync(loaderCode).byteLength,
});

/** Measures what an application that uses everything actually downloads. */
const appEntry = resolve(root, 'scripts', '.size-entry.js');
mkdirSync(dirname(appEntry), { recursive: true });
writeFileSync(
  appEntry,
  [
    "export * from '../packages/dom/src/index.js';",
    "export * from '../packages/dom/src/internal.js';",
  ].join('\n'),
);
const whole = await esbuild.build({
  entryPoints: [appEntry],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  pure: pureDevHooks,
  plugins: [productionDev],
});
rmSync(appEntry, { force: true });
const wholeCode = Buffer.from(whole.outputFiles[0].contents);
sizes.push({
  module: 'full runtime (core + dom, everything imported)',
  minified: wholeCode.byteLength,
  gzip: gzipSync(wholeCode, { level: 9 }).byteLength,
  brotli: brotliCompressSync(wholeCode).byteLength,
});

mkdirSync(resolve(root, 'benchmarks', 'results'), { recursive: true });
const sizeFile = resolve(root, 'benchmarks', 'results', 'bundle-size.json');
// The timestamp only moves when a size does. Rewriting it on every build would
// dirty the working tree with a diff that says nothing, and a file that changes
// for no reason stops being read.
const previous = existsSync(sizeFile) ? JSON.parse(readFileSync(sizeFile, 'utf8')) : null;
const unchanged =
  previous !== null &&
  JSON.stringify(previous.sizes) === JSON.stringify(sizes) &&
  JSON.stringify(previous.optional ?? []) === JSON.stringify(optional);
const report = {
  measuredAt: unchanged ? previous.measuredAt : new Date().toISOString(),
  sizes,
  optional,
};
writeFileSync(
  sizeFile,
  `${JSON.stringify(report, null, 2)}
`,
);

const kb = (bytes) => `${(bytes / 1024).toFixed(2)} kB`;
console.log('\nBrowser runtime size (production build):');
for (const entry of sizes) {
  console.log(
    `  ${entry.module.padEnd(46)} ${kb(entry.minified).padStart(10)} min  ` +
      `${kb(entry.gzip).padStart(10)} gzip  ${kb(entry.brotli).padStart(10)} br`,
  );
}

if (optional.length > 0) {
  console.log('\nOptional packages (only downloaded if imported):');
  for (const entry of optional) {
    console.log(
      `  ${entry.module.padEnd(46)} ${kb(entry.minified).padStart(10)} min  ` +
        `${kb(entry.gzip).padStart(10)} gzip  ${kb(entry.brotli).padStart(10)} br`,
    );
  }
}

const budget = 6 * 1024;
const full = sizes[sizes.length - 1];
if (full.gzip > budget) {
  console.error(`\nBundle budget exceeded: ${kb(full.gzip)} gzip against a ${kb(budget)} target.`);
  process.exitCode = 1;
} else {
  console.log(`\nWithin the ${kb(budget)} gzip budget.`);
}
