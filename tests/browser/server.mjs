/** Builds the fixture, then serves it for the Playwright projects. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixture } from './build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const directory = resolve(here, 'fixture');
const port = Number(process.env.PORT ?? 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

await buildFixture();

createServer((request, response) => {
  const url = request.url === '/' ? '/index.html' : (request.url ?? '/');
  const path = url.split('?')[0];
  readFile(join(directory, path))
    .then((body) => {
      response.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'text/plain' });
      response.end(body);
    })
    .catch(() => {
      response.writeHead(404);
      response.end('not found');
    });
}).listen(port, () => {
  console.log(`fixture served on http://127.0.0.1:${port}`);
});
