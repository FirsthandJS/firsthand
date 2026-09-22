/**
 * Builds the SSR example the way it would be deployed, and serves it.
 *
 * Production, not the dev server: hydration is about the markup a browser is
 * given, and the dev server's markup goes through a different pipeline. What
 * the specs open is what a deployment would send.
 */
import { execFileSync, spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const app = resolve(root, 'examples', 'ssr');
const port = String(process.env.SSR_PORT ?? 4175);

// The example imports the built packages, so the build has to be current.
execFileSync(process.execPath, [resolve(root, 'scripts', 'build.mjs')], {
  cwd: root,
  stdio: 'inherit',
});

const vite = resolve(root, 'node_modules', 'vite', 'bin', 'vite.js');
execFileSync(process.execPath, [vite, 'build', '--outDir', 'dist/client'], {
  cwd: app,
  stdio: 'inherit',
});
execFileSync(
  process.execPath,
  [vite, 'build', '--ssr', 'src/entry-server.tsx', '--outDir', 'dist/server'],
  { cwd: app, stdio: 'inherit' },
);

const server = spawn(process.execPath, ['server.mjs'], {
  cwd: app,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production', PORT: port },
});

process.on('exit', () => server.kill());
