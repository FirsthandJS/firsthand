import { defineConfig, devices } from '@playwright/test';

/**
 * Cross-engine tests.
 *
 * DOM behaviour is verified in real Chromium, Firefox and WebKit, not only in a
 * DOM emulation. The fixture is built by the published compiler before the
 * server starts, so these tests exercise the compiled path end to end.
 */
export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: [
    {
      command: 'node tests/browser/server.mjs',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // The examples, built by Vite with the published compiler plugin. An
      // example that only compiles is not an example that works.
      command: 'node tests/browser/examples-server.mjs',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
