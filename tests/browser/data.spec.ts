/**
 * Resources and invalidation in real engines.
 *
 * The request log the example renders is the assertion surface: it says what
 * actually went to the "network", so what reloaded and what did not is
 * something the test can check rather than assume.
 */
import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4174' });

const log = '#log li';

test('loads a list and a detail, and follows the selection', async ({ page }) => {
  await page.goto('/data/');

  await expect(page.locator('#name')).toHaveText('Ada Lovelace');
  await expect(page.locator(log)).toHaveText(['users', 'user:1']);

  await page.getByRole('button', { name: 'Grace Hopper' }).click();
  await expect(page.locator('#name')).toHaveText('Grace Hopper');
  await expect(page.locator(log)).toHaveText(['users', 'user:1', 'user:2']);

  // Back again, and nothing reaches the server: the cache sits at the
  // transport, in front of the pretend API, and the resource knows nothing
  // about it.
  await page.getByRole('button', { name: 'Ada Lovelace' }).click();
  await expect(page.locator('#name')).toHaveText('Ada Lovelace');
  await expect(page.locator(log)).toHaveText(['users', 'user:1', 'user:2']);
});

test('one action reloads two resources that know nothing about each other', async ({ page }) => {
  await page.goto('/data/');
  await expect(page.locator('#name')).toHaveText('Ada Lovelace');
  await expect(page.locator(log)).toHaveCount(2);

  await page.getByRole('button', { name: 'Rename' }).click();

  const renamed = page.locator('#name');
  await expect(renamed).not.toHaveText('Ada Lovelace');
  const name = (await renamed.textContent()) ?? '';
  expect(name.startsWith('Renamed')).toBe(true);

  // The list reloaded too, because the action invalidated `users` — and the
  // list component has never heard of the action.
  await expect(page.locator('#list button').first()).toHaveText(name);
  // The action itself, then both invalidated resources — in whichever order
  // the two came back.
  await expect(page.locator(log)).toHaveCount(5);
  const entries = await page.locator(log).allTextContents();
  expect(entries.slice(2).sort()).toEqual(['rename:1', 'user:1', 'users']);
});

test('an invalidation reaches through the transport cache', async ({ page }) => {
  await page.goto('/data/');
  await expect(page.locator('#name')).toHaveText('Ada Lovelace');
  await expect(page.locator(log)).toHaveCount(2);

  // A cached read would otherwise answer out of the very memory the
  // invalidation was meant to defeat, and the rename would not be on screen.
  await page.getByRole('button', { name: 'Rename' }).click();
  await expect(page.locator('#name')).not.toHaveText('Ada Lovelace');
  await expect(page.locator(log)).toHaveCount(5);
});

test('keeps the old value on screen while reloading', async ({ page }) => {
  await page.goto('/data/');
  await expect(page.locator('#name')).toHaveText('Ada Lovelace');

  await page.getByRole('button', { name: 'Refetch' }).click();

  // Still showing the previous value, and saying that it is asking again.
  await expect(page.locator('#detail')).toHaveAttribute('data-fetching', 'true');
  await expect(page.locator('#name')).toHaveText('Ada Lovelace');
  await expect(page.locator('#status')).toContainText('success');

  await expect(page.locator('#detail')).toHaveAttribute('data-fetching', 'false');
  await expect(page.locator('#name')).toHaveText('Ada Lovelace');
});

/*
 * There is deliberately no browser test for the first `loading` state. It
 * lasts one simulated round trip, which a test can only catch by racing the
 * page load — and a test that sometimes loses that race is worse than no test.
 * The semantics are asserted deterministically in
 * `packages/data/test/compiled/resource.test.tsx` instead.
 */
