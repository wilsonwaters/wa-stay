import { defineConfig } from '@playwright/test';

/**
 * The documentation screenshots (`tests/docs`), run by `npm run docs:screenshots`
 * (`scripts/docs-screenshots.js`), never by `npm run test:e2e`. They drive the built app with
 * Playwright's `_electron` launcher, in network-free fixture mode.
 */
export default defineConfig({
  testDir: './tests/docs',
  testMatch: '**/*.spec.ts',
  grep: /@docs/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: 'test-results/docs-run/',
});
