/**
 * Proof that Storybook works, rather than a claim that it should.
 *
 * Builds the static Storybook, checks that the stories are in its index, then
 * opens the built pages in a real browser and drives them: clicks the counter,
 * follows a router link, runs an action and waits for the resource that it
 * invalidated to show the new value. A configuration that compiles is not a
 * configuration that works.
 *
 *   npm install && npm test
 */
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, 'dist');
const port = 6007;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

console.log('building the static Storybook…');
execFileSync(
  process.execPath,
  [
    resolve(here, 'node_modules', 'storybook', 'bin', 'index.cjs'),
    'build',
    '--output-dir',
    'dist',
    '--quiet',
  ],
  { cwd: here, stdio: 'inherit' },
);

const index = JSON.parse(await readFile(join(dist, 'index.json'), 'utf8'));
const ids = Object.keys(index.entries);
const expected = [
  'components-counter--default',
  'components-counter--starts-high',
  'integration--routed',
  'integration--loaded',
  'graphql--from-a-file',
];
for (const id of expected) {
  if (!ids.includes(id)) {
    console.error(`missing story: ${id}\nindex holds: ${ids.join(', ')}`);
    process.exit(1);
  }
}
console.log(`index holds all ${String(expected.length)} stories`);

const server = createServer((request, response) => {
  let path = (request.url ?? '/').split('?')[0];
  if (path.endsWith('/')) {
    path += 'index.html';
  }
  readFile(join(dist, path))
    .then((body) => {
      response.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'text/plain' });
      response.end(body);
    })
    .catch(() => {
      response.writeHead(404);
      response.end('not found');
    });
});
await new Promise((ready) => server.listen(port, ready));

const browser = await chromium.launch();
const page = await browser.newPage();
const failures = [];

/** Opens one story's iframe, isolated exactly as Storybook's canvas does. */
const open = (id) =>
  page.goto(`http://127.0.0.1:${String(port)}/iframe.html?id=${id}&viewMode=story`);

const check = async (what, run) => {
  try {
    await run();
    console.log(`ok   ${what}`);
  } catch (error) {
    failures.push(what);
    console.error(`FAIL ${what}\n     ${String(error)}`);
  }
};

await check('the counter story renders and counts', async () => {
  await open('components-counter--default');
  const button = page.getByTestId('increment');
  await button.waitFor();
  if ((await button.textContent()) !== '0 × 2 = 0') {
    throw new Error(`initial text was ${String(await button.textContent())}`);
  }
  await button.click();
  await button.click();
  if ((await button.textContent()) !== '2 × 2 = 4') {
    throw new Error(`after two clicks: ${String(await button.textContent())}`);
  }
});

await check('args reach the component', async () => {
  await open('components-counter--starts-high');
  const button = page.getByTestId('increment');
  await button.waitFor();
  if ((await button.textContent()) !== '11 × 2 = 22') {
    throw new Error(`initial text was ${String(await button.textContent())}`);
  }
  await button.click();
  if ((await button.textContent()) !== '16 × 2 = 32') {
    throw new Error(`step was not applied: ${String(await button.textContent())}`);
  }
});

await check('the router story navigates', async () => {
  await open('integration--routed');
  await page.getByTestId('home').waitFor();
  await page.getByRole('link', { name: 'Grace' }).click();
  const heading = page.getByTestId('user');
  await heading.waitFor();
  if ((await heading.textContent()) !== 'User 2') {
    throw new Error(`heading was ${String(await heading.textContent())}`);
  }
});

await check('the data story loads, acts and invalidates', async () => {
  await open('integration--loaded');
  const heading = page.getByTestId('profile');
  await heading.waitFor();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="profile"]')?.textContent === 'Ada Lovelace',
  );
  await page.getByTestId('rename').click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="profile"]')?.textContent === 'Grace Hopper',
  );
});

await check('a .graphql file is loaded, stripped and tagged', async () => {
  await open('graphql--from-a-file');
  const heading = page.getByTestId('graphql-name');
  await heading.waitFor();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="graphql-name"]')?.textContent === 'Ada Lovelace',
  );

  // The document reached the browser parsed, with its tags read...
  const about = await page.getByTestId('graphql-operation').textContent();
  if (about !== 'User · tags: user') {
    throw new Error(`operation/tags were ${String(about)}`);
  }
  // ...and with the cache's directives gone from what would be sent.
  const source = (await page.getByTestId('graphql-source').textContent()) ?? '';
  if (source.includes('@tag')) {
    throw new Error(`the directive survived into the document:
${source}`);
  }

  // And the mutation's own directive invalidates the resource.
  await page.getByTestId('graphql-rename').click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="graphql-name"]')?.textContent === 'Grace Hopper',
  );
});

await browser.close();
server.close();

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} of 5 checks failed`);
  process.exit(1);
}
console.log(
  '\nStorybook renders and drives Firsthand components, the router, resources and actions,' +
    '\nand a .graphql file whose tags were read at build time.',
);
