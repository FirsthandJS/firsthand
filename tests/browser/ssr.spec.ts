/**
 * Server rendering and hydration, in real browsers.
 *
 * The emulated DOM proves the semantics; this proves the thing the semantics
 * are for. Three claims, and each is asserted rather than described:
 *
 * 1. The markup a browser is *given* already has the content in it.
 * 2. Hydration **adopts** it — the nodes that were sent are the nodes that end
 *    up live, which a `MutationObserver` installed before any page script can
 *    see for itself.
 * 3. The page works: a filter that was never rendered by the browser filters,
 *    and a button that was never rendered by the browser responds.
 */
import { expect, test } from '@playwright/test';

const APP = process.env.SSR_URL ?? 'http://127.0.0.1:4175/';

test('sends a page with its content in it', async ({ request }) => {
  const response = await request.get(APP);
  const html = await response.text();
  expect(html).toContain('Setup runs once');
  expect(html).toContain('Rendered on the server');
  // The answers, for the browser to start from.
  expect(html).toContain('window.__FIRSTHAND_DATA__');
});

test('adopts what it was sent rather than building it again', async ({ page }) => {
  // Installed before any script the page carries, so it sees everything the
  // page's own code does to the tree.
  await page.addInitScript(() => {
    const removed: string[] = [];
    (window as unknown as { __removed: string[] }).__removed = removed;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (node.nodeType === 1) {
            removed.push((node as Element).tagName);
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });

  await page.goto(APP);
  await expect(page.locator('.status')).toContainText('Hydrated in');

  const removed = await page.evaluate(
    () => (window as unknown as { __removed: string[] }).__removed,
  );
  // Hydration removes the comments that said where the regions were, and
  // nothing else. Not one element the server sent is replaced.
  expect(removed).toEqual([]);
});

test('is interactive without having fetched anything', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (one) => requests.push(one.url()));

  await page.goto(APP);
  await expect(page.locator('.status')).toContainText('Hydrated in');

  // The count the page shows is the server process's, and it is 1: the one
  // request that produced this page. The browser made none of its own.
  await expect(page.locator('.status')).toContainText('Requests made by this process: 1');

  await expect(page.locator('.notes li')).toHaveCount(5);
  await page.locator('.filter input').fill('ssr');
  await expect(page.locator('.notes li')).toHaveCount(2);

  await page.locator('.notes li').first().locator('button').click();
  await expect(page.locator('.notes li').first().locator('button')).toHaveText('Liked');

  // Nothing that looks like data was asked for: only the document and the
  // assets it names.
  expect(requests.filter((url) => url.includes('/api'))).toEqual([]);
});

test('writes the text node the server sent, rather than a new one', async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator('.status')).toContainText('Hydrated in');

  const same = await page.evaluate(() => {
    const button = document.querySelector('.notes li button') as HTMLButtonElement;
    const before = button.firstChild;
    button.click();
    return before === button.firstChild && button.textContent === 'Liked';
  });
  expect(same).toBe(true);
});
