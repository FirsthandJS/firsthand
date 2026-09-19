/**
 * The example applications, executed.
 *
 * They are built by Vite with the published compiler plugin (see
 * `tests/browser/examples-server.mjs`) and then driven like a user would. An
 * example that only compiles is not an example that works, and these are the
 * first thing a reader of the repository will try.
 */
import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4174' });

test('counter: setup runs once, three parts update', async ({ page }) => {
  const setupLogs: string[] = [];
  page.on('console', (message) => {
    if (message.text() === 'setup') {
      setupLogs.push(message.text());
    }
  });

  await page.goto('/counter/');
  const buttons = page.locator('button');
  await expect(buttons).toHaveCount(2);

  // Two instances, each initialised once.
  expect(setupLogs).toHaveLength(2);

  const first = buttons.first();
  await expect(first).toHaveText('8 × 2 = 16');
  await expect(first).toHaveClass('normal');
  expect(await page.locator('strong').count()).toBe(0);

  await first.click();
  await first.click();
  await first.click();

  await expect(first).toHaveText('11 × 2 = 22');
  await expect(first).toHaveClass('high');
  await expect(page.locator('strong')).toHaveText(' large value');
  // Still two setups: nothing re-ran.
  expect(setupLogs).toHaveLength(2);

  // The second counter is untouched.
  await expect(buttons.nth(1)).toHaveText('0 × 2 = 0');
});

test('todo: rows survive a toggle, counters follow', async ({ page }) => {
  await page.goto('/todo/');
  const items = page.locator('li');
  await expect(items).toHaveCount(3);
  await expect(page.locator('p').nth(1)).toContainText('2 open of 3');

  const second = items.nth(1);
  // Tagging the element is how the test asks "is this the same node?": the tag
  // survives only if the row was updated in place rather than re-created.
  await second.evaluate((row) => row.setAttribute('data-probe', 'kept'));
  await second.locator('input[type=checkbox]').check();

  await expect(page.locator('p').nth(1)).toContainText('1 open of 3');
  await expect(items.nth(1)).toHaveAttribute('data-probe', 'kept');

  await page.getByRole('button', { name: 'open', exact: true }).click();
  await expect(items).toHaveCount(1);

  await page.getByRole('button', { name: 'all', exact: true }).click();
  await expect(items).toHaveCount(3);

  await page.locator('input[type=text]').fill('added by the test');
  await page.getByRole('button', { name: 'add' }).click();
  await expect(items).toHaveCount(4);
  await expect(items.last()).toContainText('added by the test');

  await items.last().getByRole('button', { name: 'remove' }).click();
  await expect(items).toHaveCount(3);
});

test('context: a change reaches every leaf without re-running components', async ({ page }) => {
  await page.goto('/context/');
  const leaves = page.locator('li');
  await expect(leaves).toHaveCount(12);
  await expect(leaves.first()).toHaveText('leaf 0 sees light');

  await leaves.first().evaluate((leaf) => leaf.setAttribute('data-probe', 'kept'));
  await page.getByRole('button', { name: 'toggle theme' }).click();

  await expect(leaves.first()).toHaveText('leaf 0 sees dark');
  await expect(leaves.last()).toHaveText('leaf 11 sees dark');
  // Updated in place: the same element, new text.
  await expect(leaves.first()).toHaveAttribute('data-probe', 'kept');
});

test('portal: the modal lands in the body and keeps its context', async ({ page }) => {
  await page.goto('/portal/');
  expect(await page.locator('h2').count()).toBe(0);

  await page.getByRole('button', { name: 'open modal' }).click();
  await expect(page.locator('h2')).toHaveText('Hello Ada');

  // Its DOM parent is the body, not the component that wrote it.
  const parent = await page.evaluate(
    () => document.querySelector('h2')?.closest('body > div')?.parentElement?.tagName,
  );
  expect(parent).toBe('BODY');

  await page.getByRole('button', { name: 'close' }).click();
  expect(await page.locator('h2').count()).toBe(0);
});

test('massive table: 100 000 rows mount, update and clear', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/massive-table/');

  await page.getByRole('button', { name: 'create 100 000' }).click();
  await expect(page.locator('p').nth(1)).toContainText('100000 rows', { timeout: 120_000 });
  expect(await page.locator('tbody tr').count()).toBe(100_000);

  await page.getByRole('button', { name: 'update every 10th' }).click();
  await expect(page.locator('tbody tr').first()).toContainText('!!!', { timeout: 120_000 });

  await page.getByRole('button', { name: 'clear' }).click();
  await expect(page.locator('p').nth(1)).toContainText('0 rows', { timeout: 60_000 });
  expect(await page.locator('tbody tr').count()).toBe(0);
});
