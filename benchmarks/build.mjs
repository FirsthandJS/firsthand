/**
 * Bundles the benchmark page.
 *
 * Every implementation is built as a production bundle in one pass, each with
 * its own toolchain: React and Vue with `NODE_ENV=production` so neither takes
 * a development warnings path, Solid through `babel-preset-solid` because its
 * compiler is not an optional extra, and Firsthand through the published
 * compiler and the published package entry points.
 *
 * Solid and Vue are resolved out of `benchmarks/frameworks`, which has its own
 * install. `babel-preset-solid` wants Babel 7 and this repository is built on
 * Babel 8; giving the measured frameworks their own node_modules means neither
 * toolchain has to be bent to fit the other, and the exact versions the
 * published numbers came from are pinned there.
 */
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { transform } from '../packages/compiler/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Resolves out of `benchmarks/frameworks`, not out of the repository root. */
const frameworks = createRequire(resolve(here, 'frameworks', 'package.json'));

/** Solid's own compiler, which is how Solid is meant to be built. */
const solidCompiler = {
  name: 'solid',
  setup(build) {
    build.onLoad({ filter: /solid\.jsx$/ }, async (args) => {
      const babel = frameworks('@babel/core');
      const preset = frameworks('babel-preset-solid');
      const output = await babel.transformAsync(readFileSync(args.path, 'utf8'), {
        filename: args.path,
        presets: [[preset.default ?? preset, {}]],
        babelrc: false,
        configFile: false,
      });
      return { contents: output.code, loader: 'js' };
    });
  },
};

/** Runs the real Firsthand compiler over `.tsx`, exactly as the Vite plugin does. */
/**
 * Resolves `@firsthandjs/*` to the package sources.
 *
 * Only used for profiling: the published bundles are minified, so every
 * hotspot would be a one-letter name. The code is the same code; only the
 * identifiers differ.
 */
const firsthandSources = {
  name: 'firsthand-sources',
  setup(build) {
    build.onResolve({ filter: /^@firsthandjs\// }, (args) => {
      const [, name, sub] = args.path.split('/');
      const file = sub === undefined ? 'index.ts' : `${sub}.ts`;
      return { path: resolve(here, '..', 'packages', name, 'src', file) };
    });
  },
};

/**
 * The same `dev.js` -> `dev.prod.ts` swap the published build performs.
 *
 * Without it the source-resolved build profiles the *development* code: the
 * diagnostics seam is a separate module, so resolving `@firsthandjs/core` to
 * `src/` pulls in `dev.ts` rather than the stub the published bundle uses.
 * That put `hook`, `devCheckSetupRead` and their callers near the top of the
 * profile — hotspots that are not in any shipped bundle, ahead of the ones
 * that are. A profile that points at code nobody runs is worse than no
 * profile.
 */
const productionDev = {
  name: 'firsthand-production-dev',
  setup(build) {
    build.onResolve({ filter: /(^|\/)dev\.js$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.replace(/dev\.js$/, 'dev.prod.ts')),
    }));
  },
};

/** The hooks the published build annotates as pure, so their calls go too. */
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

const firsthandCompiler = {
  name: 'firsthand',
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, (args) => ({
      contents: transform(readFileSync(args.path, 'utf8'), {
        filename: args.path,
        typescript: true,
        packageName: 'firsthand-benchmark',
      }),
      loader: 'tsx',
    }));
  },
};

export async function buildBenchmark({ minify = true } = {}) {
  const result = await esbuild.build({
    entryPoints: [resolve(here, 'app', 'harness.js')],
    outfile: resolve(here, 'app', 'dist', 'harness.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify,
    // Names are what a profile is for: without them every hotspot is a
    // one-letter mystery.
    keepNames: !minify,
    metafile: true,
    legalComments: 'none',
    define: {
      'process.env.NODE_ENV': '"production"',
      // Vue's bundler build expects a build tool to answer these. Options API
      // is on because the components below are declared with `template`.
      __VUE_OPTIONS_API__: 'true',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    },
    // The published bundles are built this way, and the point of the
    // source-resolved build is readable names for the *same* code — not
    // different code.
    pure: pureDevHooks,
    // Where Solid and Vue are found. Left to esbuild rather than resolved by
    // hand, so that they are picked up under browser conditions — resolving
    // them from Node hands back Solid's server build, which refuses to run.
    nodePaths: [resolve(here, 'frameworks', 'node_modules')],
    plugins: minify
      ? [solidCompiler, firsthandCompiler]
      : [solidCompiler, firsthandSources, productionDev, firsthandCompiler],
  });
  return result.metafile;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildBenchmark();
  console.log('Benchmark page built.');
}
