/**
 * The acceptance criteria, in three real engines.
 *
 * Everything here is asserted against the compiled output running in Chromium,
 * Firefox and WebKit. The unit suite proves the same properties against a DOM
 * emulation; this suite proves the platform agrees.
 */
import { expect, test, type Page } from '@playwright/test';

type Probe = { setupRuns: number; rowSetupRuns: number; cleanups: number; handlerCalls: number };

const probe = (page: Page): Promise<Probe> =>
  page.evaluate(() =>
    (globalThis as unknown as { actions: Record<string, () => Probe> }).actions.probe(),
  );

const act = (page: Page, name: string, argument?: unknown): Promise<unknown> =>
  page.evaluate(
    ([action, value]) =>
      (globalThis as unknown as { actions: Record<string, (v?: unknown) => unknown> }).actions[
        action as string
      ]?.(value),
    [name, argument],
  );

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => (globalThis as unknown as { actions?: unknown }).actions !== undefined,
  );
});

test('a component function runs once per instance', async ({ page }) => {
  expect((await probe(page)).setupRuns).toBe(1);
  await page.click('#increment');
  await page.click('#increment');
  await page.click('#increment');
  expect(await page.textContent('#increment')).toBe('count: 3');
  expect((await probe(page)).setupRuns).toBe(1);
});

test('only the parts that read the state update', async ({ page }) => {
  const before = await page.evaluate(() => {
    const list = document.getElementById('rows');
    return { rowsHtml: list?.innerHTML };
  });
  await page.click('#increment');
  expect(await page.textContent('#doubled')).toBe('doubled: 2');
  const after = await page.evaluate(() => document.getElementById('rows')?.innerHTML);
  expect(after).toBe(before.rowsHtml);
});

test('class, style and boolean property parts update independently', async ({ page }) => {
  expect(await page.getAttribute('#increment', 'class')).toBe('low');
  expect(await page.evaluate(() => document.getElementById('doubled')?.style.opacity)).toBe('0');

  for (let i = 0; i < 3; i++) {
    await page.click('#increment');
  }

  expect(await page.getAttribute('#increment', 'class')).toBe('high');
  expect(await page.evaluate(() => document.getElementById('doubled')?.style.opacity)).toBe('1');
  expect(await page.isDisabled('#increment')).toBe(false);

  await page.click('#increment');
  await page.click('#increment');
  expect(await page.isDisabled('#increment')).toBe(true);
});

test('a conditional branch swaps and keeps its siblings', async ({ page }) => {
  await expect(page.locator('#small')).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await page.click('#increment');
  }
  await expect(page.locator('#large')).toBeVisible();
  expect(await page.locator('#small').count()).toBe(0);
  expect(await page.locator('#rows .row').count()).toBe(3);
});

test('event handlers are attached once and read current state', async ({ page }) => {
  await page.click('#increment');
  await page.click('#increment');
  const after = await probe(page);
  expect(after.handlerCalls).toBe(2);
  expect(await page.textContent('#increment')).toBe('count: 2');
});

test('updates are synchronous: the DOM is current before the next statement', async ({ page }) => {
  const result = await act(page, 'syncCheck');
  expect(result).toEqual({ text: 'count: 4', className: 'high' });
});

test('keyed rows keep their elements across a reorder', async ({ page }) => {
  const before = await page.evaluate(() =>
    [...document.querySelectorAll('#rows .row')].map((row) => row.getAttribute('data-id')),
  );
  expect(before).toEqual(['1', '2', '3']);

  const setupsBefore = (await probe(page)).rowSetupRuns;
  await act(page, 'reverse');

  const after = await page.evaluate(() =>
    [...document.querySelectorAll('#rows .row')].map((row) => row.getAttribute('data-id')),
  );
  expect(after).toEqual(['3', '2', '1']);
  // No row was re-created: the reconciler moved the existing elements.
  expect((await probe(page)).rowSetupRuns).toBe(setupsBefore);
});

test('a row whose data changes updates in place', async ({ page }) => {
  const setupsBefore = (await probe(page)).rowSetupRuns;
  await act(page, 'renameFirst');
  expect(await page.textContent('#rows .row:first-child')).toBe('renamed');
  expect((await probe(page)).rowSetupRuns).toBe(setupsBefore);
});

test('removing a row disposes exactly that row', async ({ page }) => {
  const cleanupsBefore = (await probe(page)).cleanups;
  await act(page, 'removeMiddle');
  expect(await page.locator('#rows .row').count()).toBe(2);
  expect((await probe(page)).cleanups).toBe(cleanupsBefore + 1);
});

test('a large list mounts and clears', async ({ page }) => {
  await act(page, 'addMany', 5000);
  expect(await page.locator('#rows .row').count()).toBe(5003);
  await act(page, 'clear');
  expect(await page.locator('#rows .row').count()).toBe(0);
});

test('context reaches a portal and updates it', async ({ page }) => {
  await act(page, 'openModal');
  const modal = page.locator('#modal');
  await expect(modal).toHaveText('modal sees light');
  // The portal's DOM parent is the body, not the component's element.
  expect(await page.evaluate(() => document.getElementById('modal')?.parentElement?.tagName)).toBe(
    'BODY',
  );

  await act(page, 'toggleTheme');
  await expect(modal).toHaveText('modal sees dark');

  await act(page, 'closeModal');
  expect(await page.locator('#modal').count()).toBe(0);
});

test('a shadow DOM component renders into its shadow root', async ({ page }) => {
  const inside = await page.evaluate(
    () => document.getElementById('host')?.shadowRoot?.getElementById('in-shadow')?.textContent,
  );
  expect(inside).toBe('shadow content');
  // Light DOM sees nothing of it.
  expect(await page.evaluate(() => document.getElementById('host')?.textContent)).toBe('');
});

test('disposing the root removes its DOM and stops every effect', async ({ page }) => {
  await act(page, 'disposeRoot');
  expect(await page.evaluate(() => document.getElementById('root')?.innerHTML)).toBe('');
  const cleanups = (await probe(page)).cleanups;
  expect(cleanups).toBeGreaterThanOrEqual(3);
});
