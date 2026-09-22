/**
 * The smallest server that can serve this.
 *
 * `node:http` and Vite, and nothing else — no framework, because there is
 * nothing here a framework would do. In development Vite is a middleware and
 * the modules are loaded through it, so an edit is on the page before the
 * request finishes. In production the two builds are read off disk.
 *
 *   node server.mjs               # development
 *   npm run build && npm start    # production
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = import.meta.dirname;
const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 5174);

const vite = production
  ? null
  : await (
      await import('vite')
    ).createServer({
      root,
      appType: 'custom',
      server: { middlewareMode: true },
    });

/** In production the template and the entry are read once, at startup. */
const built = production
  ? {
      template: readFileSync(resolve(root, 'dist/client/index.html'), 'utf8'),
      entry: await import('./dist/server/entry-server.js'),
    }
  : null;

const serve = async (request, response) => {
  try {
    const url = request.url ?? '/';
    const { template, render } = production
      ? { template: built.template, render: built.entry.render }
      : {
          template: await vite.transformIndexHtml(
            url,
            readFileSync(resolve(root, 'index.html'), 'utf8'),
          ),
          render: (await vite.ssrLoadModule('/src/entry-server.tsx')).render,
        };

    const { html, state } = await render();
    const page = template.replace('<!--app-html-->', html).replace('<!--app-state-->', state);

    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page);
  } catch (error) {
    vite?.ssrFixStacktrace(error);
    console.error(error);
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(String(error));
  }
};

const server = createServer((request, response) => {
  if (production) {
    void serveStatic(request, response);
    return;
  }
  // Vite answers for anything it owns — modules, assets, its own client — and
  // calls through to the page for everything else.
  vite.middlewares(request, response, () => {
    void serve(request, response);
  });
});

/** Assets in production. A real deployment would put a CDN here instead. */
async function serveStatic(request, response) {
  const url = (request.url ?? '/').split('?')[0];
  if (url !== '/' && !url.endsWith('/')) {
    try {
      const file = readFileSync(resolve(root, 'dist/client', `.${url}`));
      response.writeHead(200, { 'content-type': typeOf(url) });
      response.end(file);
      return;
    } catch {
      // Not an asset. It is a page.
    }
  }
  await serve(request, response);
}

function typeOf(url) {
  if (url.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (url.endsWith('.css')) return 'text/css; charset=utf-8';
  if (url.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

server.listen(port, () => {
  console.log(`  Firsthand SSR example on http://localhost:${port}/`);
});
