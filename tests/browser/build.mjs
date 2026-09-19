/** Bundles the browser-test fixture with the published compiler. */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { transform } from '../../packages/compiler/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));

const firsthandCompiler = {
  name: 'firsthand',
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, (args) => ({
      contents: transform(readFileSync(args.path, 'utf8'), {
        filename: args.path,
        typescript: true,
        packageName: 'firsthand-browser-tests',
      }),
      loader: 'tsx',
    }));
  },
};

export async function buildFixture() {
  await esbuild.build({
    entryPoints: [resolve(here, 'fixture', 'app.tsx')],
    outfile: resolve(here, 'fixture', 'dist', 'app.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    legalComments: 'none',
    plugins: [firsthandCompiler],
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildFixture();
  console.log('Fixture built.');
}
