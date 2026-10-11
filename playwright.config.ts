import { defineConfig } from '@playwright/test';

/**
 * Electron smoke tests (`tests/e2e`): they drive the built app with Playwright's `_electron`
 * launcher, one app at a time, isolated and network-free (`tests/e2e/support/wa-stay.ts`).
 *
 *   npm run build:e2e && npm run test:e2e        # Linux without a display: xvfb-run -a npm run test:e2e
 *
 * There is no web server, base URL or browser project: the tests launch Electron themselves.
 * The harness records the Electron window's trace and screenshot and keeps them for failed
 * tests, with the main process's output and log (`tests/e2e/support/wa-stay.ts`).
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './tests/e2e/support/global-setup.ts',
  outputDir: 'test-results/',
  use: {
    // The test-level trace (steps, errors). The harness traces the Electron window itself.
    trace: 'retain-on-failure',
    // Off: Playwright's own failure screenshot of an Electron window is taken from a finished
    // fixture step ("Internal error: step id not found"). The harness attaches the same
    // screenshot itself when a test fails.
    screenshot: 'off',
  },
});
