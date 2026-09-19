/**
 * Builds the example applications with Vite and the published compiler plugin,
 * then serves them for the example smoke tests.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const port = Number(process.env.EXAMPLES_PORT ?? 4174);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

// The examples import the built packages, so the build has to be current.
execFileSync(process.execPath, [resolve(root, 'scripts', 'build.mjs')], {
  cwd: root,
  stdio: 'inherit',
});

execFileSync(
  process.execPath,
  [
    resolve(root, 'node_modules', 'vite', 'bin', 'vite.js'),
    'build',
    '--config',
    'examples/vite.config.ts',
  ],
  { cwd: root, stdio: 'inherit' },
);

const directory = resolve(root, 'dist', 'examples');

createServer((request, response) => {
  const url = request.url ?? '/';
  let path = url.split('?')[0];
  if (path.endsWith('/')) {
    path += 'index.html';
  }
  const fallback = `/${path.split('/')[1] ?? ''}/index.html`;
  readFile(join(directory, path))
    .catch(() => readFile(join(root, 'dist', path)))
    // A client-side router owns paths the file system knows nothing about, so
    // an unknown path under an application falls back to that application's
    // document — which is what any SPA host has to be configured to do.
    .catch(() => readFile(join(directory, fallback)).then((body) => ((path = fallback), body)))
    .then((body) => {
      response.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'text/plain' });
      response.end(body);
    })
    .catch(() => {
      response.writeHead(404);
      response.end('not found');
    });
}).listen(port, () => {
  console.log(`examples served on http://127.0.0.1:${port}`);
});
