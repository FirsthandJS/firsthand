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
import { readFileSync, readdirSync } from 'node:fs';
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
    // To the log, not to the visitor: a stack trace names the files a server
    // is made of, and whoever asked for this page is not who should read it.
    console.error(error);
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Internal Server Error');
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

/**
 * The built assets, read once and served by name.
 *
 * A request never reaches the file system: the URL is a key into a map built
 * from what the bundler produced. That is not a hardening measure bolted on
 * afterwards — joining a path with something a visitor typed is how a server
 * ends up serving `/etc/passwd`, and there is no reason to do it when the set
 * of files is known before the first request arrives.
 *
 * A real deployment would put a CDN here instead.
 */
const TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function readAssets() {
  const assets = new Map();
  if (!production) {
    return assets;
  }
  const directory = resolve(root, 'dist', 'client', 'assets');
  for (const name of readdirSync(directory)) {
    const dot = name.lastIndexOf('.');
    assets.set(`/assets/${name}`, {
      body: readFileSync(resolve(directory, name)),
      type: TYPES[name.slice(dot)] ?? 'application/octet-stream',
    });
  }
  return assets;
}

const assets = readAssets();

async function serveStatic(request, response) {
  const url = (request.url ?? '/').split('?')[0];
  const asset = assets.get(url);
  if (asset !== undefined) {
    response.writeHead(200, { 'content-type': asset.type });
    response.end(asset.body);
    return;
  }
  await serve(request, response);
}

server.listen(port, () => {
  console.log(`  Firsthand SSR example on http://localhost:${port}/`);
});
