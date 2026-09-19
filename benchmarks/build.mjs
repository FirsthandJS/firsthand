/**
 * Bundles the benchmark page.
 *
 * Both implementations are built as production bundles in one pass: React with
 * `NODE_ENV=production` (so no development warnings path), Firsthand through the
 * published compiler and the published package entry points.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { transform } from '../packages/compiler/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));

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
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: minify ? [firsthandCompiler] : [firsthandSources, firsthandCompiler],
  });
  return result.metafile;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildBenchmark();
  console.log('Benchmark page built.');
}
