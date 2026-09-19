/**
 * The router in real engines.
 *
 * The example is built by Vite with the published compiler plugin, so the
 * dynamic import in the route table really has become its own chunk. That is
 * what makes the network assertions below meaningful rather than decorative:
 * they watch which files the browser actually asks for and when.
 */
import { expect, test, type Page } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4174' });

/** Records every script the page requests, in order. */
function scriptRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') {
      seen.push(new URL(request.url()).pathname);
    }
  });
  return seen;
}

const isReports = (path: string): boolean => /reports/i.test(path);

test('navigates without reloading and keeps the layout', async ({ page }) => {
  const setups: string[] = [];
  page.on('console', (message) => {
    if (message.text().endsWith('setup')) {
      setups.push(message.text());
    }
  });

  await page.goto('/router/');
  await expect(page.locator('[data-page="home"] h2')).toHaveText('Home');
  expect(setups.filter((entry) => entry === 'shell setup')).toHaveLength(1);

  // Tag the layout: if it survives, it was kept rather than re-created.
  await page.locator('#nav').evaluate((element) => {
    element.setAttribute('data-probe', 'kept');
  });

  await page.getByRole('link', { name: 'Users' }).click();

  await expect(page).toHaveURL('/router/users');
  await expect(page.locator('[data-page="users"] h2')).toHaveText('Users');
  await expect(page.locator('#nav')).toHaveAttribute('data-probe', 'kept');
  expect(setups.filter((entry) => entry === 'shell setup')).toHaveLength(1);
});

test('updates a page in place when only a parameter changes', async ({ page }) => {
  const setups: string[] = [];
  page.on('console', (message) => {
    if (message.text() === 'user setup') {
      setups.push(message.text());
    }
  });

  await page.goto('/router/users');
  await page.getByRole('link', { name: 'Ada Lovelace' }).click();
  await expect(page.locator('#user-name')).toHaveText('Ada Lovelace');
  expect(setups).toHaveLength(1);

  await page.locator('[data-page="user"]').evaluate((element) => {
    element.setAttribute('data-probe', 'kept');
  });

  await page.getByRole('link', { name: 'Grace Hopper' }).click();

  await expect(page.locator('#user-name')).toHaveText('Grace Hopper');
  await expect(page.locator('#user-role')).toHaveText('Rear Admiral');
  // The same element, and the component body did not run again.
  await expect(page.locator('[data-page="user"]')).toHaveAttribute('data-probe', 'kept');
  expect(setups).toHaveLength(1);
});

test('loads the reports chunk only when the route is entered', async ({ page }) => {
  const scripts = scriptRequests(page);

  await page.goto('/router/');
  await expect(page.locator('[data-page="home"]')).toBeVisible();
  // Nothing about reports has been downloaded yet.
  expect(scripts.filter(isReports)).toHaveLength(0);

  // Navigate with the keyboard, so that no hover preload fires first.
  await page.getByRole('link', { name: 'Reports' }).click({ force: true, noWaitAfter: true });

  await expect(page.locator('[data-page="reports"] h2')).toHaveText('Reports');
  expect(scripts.filter(isReports).length).toBeGreaterThan(0);

  // And it is a working page, not just a loaded file.
  await page.getByRole('button', { name: 'add 1 000' }).click();
  await expect(page.locator('#total')).toHaveText('571,570');
});

test('preloads the chunk on hover, before any click', async ({ page }) => {
  const scripts = scriptRequests(page);

  await page.goto('/router/');
  await expect(page.locator('[data-page="home"]')).toBeVisible();
  expect(scripts.filter(isReports)).toHaveLength(0);

  await page.getByRole('link', { name: 'Reports' }).hover();

  await expect.poll(() => scripts.filter(isReports).length, { timeout: 5000 }).toBeGreaterThan(0);
  // Still on the home page: hovering fetches, it does not navigate.
  await expect(page.locator('[data-page="home"]')).toBeVisible();
});

test('supports a deep link and the browser back button', async ({ page }) => {
  // A hard load of a path only the router knows about, as any SPA host serves
  // it: one document, the router does the rest.
  await page.goto('/router/users/2');
  await expect(page.locator('#user-name')).toHaveText('Grace Hopper');

  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.locator('[data-page="home"]')).toBeVisible();

  await page.goBack();
  await expect(page.locator('#user-name')).toHaveText('Grace Hopper');

  await page.goForward();
  await expect(page.locator('[data-page="home"]')).toBeVisible();
});

test('navigates back through useNavigate(-1)', async ({ page }) => {
  await page.goto('/router/');
  await page.getByRole('link', { name: 'Users' }).click();
  await page.getByRole('link', { name: 'Ada Lovelace' }).click();
  await expect(page.locator('#user-name')).toHaveText('Ada Lovelace');

  await page.getByRole('button', { name: 'back' }).click();

  await expect(page).toHaveURL('/router/users');
  await expect(page.locator('[data-page="user"]')).toHaveCount(0);
});

test('renders the catch-all route for an unknown path', async ({ page }) => {
  await page.goto('/router/nowhere-at-all');
  await expect(page.locator('[data-page="missing"] h2')).toHaveText('Nothing here');

  await page.getByRole('link', { name: 'Go home' }).click();
  await expect(page.locator('[data-page="home"]')).toBeVisible();
});

test('marks the active link', async ({ page }) => {
  await page.goto('/router/');
  await expect(page.getByRole('link', { name: 'Home', exact: true })).toHaveClass(/active/);

  await page.getByRole('link', { name: 'Users' }).click();

  await expect(page.getByRole('link', { name: 'Home', exact: true })).not.toHaveClass(/active/);
  await expect(page.getByRole('link', { name: 'Users' })).toHaveClass(/active/);
});
