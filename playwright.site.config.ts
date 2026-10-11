import { defineConfig } from '@playwright/test';

/**
 * The product website's screenshots (`tests/site`), run by `npm run site:screenshots`
 * (`scripts/site-screenshots.js`), never by `npm run test:e2e`. They drive the built app with
 * Playwright's `_electron` launcher, in network-free fixture mode with the site's fixtures.
 */
export default defineConfig({
  testDir: './tests/site',
  testMatch: '**/*.spec.ts',
  grep: /@site/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: 'test-results/site-run/',
});
