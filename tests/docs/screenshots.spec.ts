/**
 * @docs The README and user-guide screenshots in `docs/images/`, taken from the built app:
 *
 *   npm run docs:screenshots
 *
 * Network-free fixture mode with the recorded ParkStay responses (`tests/e2e/fixtures/http`),
 * so every run shows the same places, dates (10–12 Nov 2026, the fixtures' stay) and results.
 * With a Mapbox token in the build (`DOCS_MAP=1`, set by `scripts/docs-screenshots.js`), Explore
 * shows the map; without one it is list-only. Provider photos are hot-linked and fixture mode
 * does not load them, so cards show the photo placeholder.
 */

import fs from 'fs';
import path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { REPO_ROOT } from '../e2e/support/paths';
import { launchForDocs, type DocsApp } from './support/launch';

/** Where the raw captures go; the script optimises them into docs/images/. */
const OUT_DIR = process.env.DOCS_SCREENSHOTS_DIR ?? path.join(REPO_ROOT, 'test-results/docs');
const MAP = process.env.DOCS_MAP === '1';
const STAY = 'arrival=2026-11-10&departure=2026-11-12&adults=2';
/** The catalogue syncs 5 s after launch (V5). */
const CATALOGUE_TIMEOUT_MS = 30_000;

async function go(page: Page, route: string): Promise<void> {
  // An in-app (hash) navigation: no reload, which a WebGL map under xvfb does not survive.
  await page.evaluate((hash) => {
    location.hash = hash;
  }, `#${route}`);
}

/**
 * The window, or with `through`, a taller window that shows the page from its top down to that
 * element (a sticky header rules out a full-page capture).
 */
async function capture(docs: DocsApp, name: string, through?: Locator): Promise<void> {
  const { app, window: page } = docs;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const resize = (height: number) =>
    app.evaluate(({ BrowserWindow }, h) => {
      BrowserWindow.getAllWindows()[0].setContentSize(1280, h);
    }, height);
  if (through) {
    const bottom = await through.evaluate(
      (element) => element.getBoundingClientRect().bottom + window.scrollY
    );
    await resize(Math.ceil(bottom + 32));
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  // Let transitions, fades and the focus ring settle; no cursor or caret in the picture.
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
  if (through) await resize(800);
}

test.describe('@docs screenshots', () => {
  let docs: DocsApp;

  test.beforeAll(async () => {
    docs = await launchForDocs({ map: MAP });
  });

  test.afterAll(async () => {
    await docs?.close();
  });

  test('Explore', async () => {
    test.setTimeout(120_000);
    const { window } = docs;
    // The catalogue first (a sync adds places but never asks their availability), then the stay.
    const results = window.getByRole('region', { name: 'Results' });
    await expect(results.getByRole('link', { name: 'Bungarra', exact: true })).toBeVisible({
      timeout: CATALOGUE_TIMEOUT_MS,
    });
    await go(window, `/?${STAY}`);
    // ParkStay's bulk availability (the fixture) on the cards and pins.
    await expect(
      results.getByRole('heading', { level: 2, name: /places · [1-9]\d* available/ })
    ).toBeVisible({ timeout: CATALOGUE_TIMEOUT_MS });
    if (MAP) {
      await expect(window.locator('canvas.mapboxgl-canvas')).toBeVisible({ timeout: 30_000 });
      // Tiles stream in after the style: give them time to draw.
      await window.waitForTimeout(6_000);
    }
    await capture(docs, 'explore');
  });

  test('Place detail', async () => {
    test.setTimeout(90_000);
    const { window } = docs;
    await go(window, `/places/parkstay/20?${STAY}`);
    await expect(window.getByRole('heading', { level: 1, name: 'Bungarra' })).toBeVisible();
    const stayCard = window.getByRole('region', { name: 'Check your dates' });
    await stayCard.getByRole('button', { name: 'Check availability' }).click();
    const grid = window.getByRole('table', { name: /^Availability by night/ });
    await expect(grid).toBeVisible({ timeout: 30_000 });
    // The page from its title down to the nights.
    await capture(docs, 'place-detail', grid);
  });

  test('Watches', async () => {
    test.setTimeout(120_000);
    const { window } = docs;
    // A watch for Bungarra, created the way a person does: from the place page's stay.
    await go(window, `/watches/new?provider=parkstay&location=20&${STAY}`);
    await expect(window.getByRole('heading', { level: 1, name: 'New watch' })).toBeVisible();
    // The prefill settles the provider and place: the flow opens on "Your stay".
    for (const step of [/Your stay$/, /Alerts$/]) {
      await expect(window.getByRole('heading', { level: 2, name: step })).toBeVisible({
        timeout: CATALOGUE_TIMEOUT_MS,
      });
      await window.getByRole('button', { name: 'Continue' }).click();
    }
    await expect(window.getByRole('heading', { level: 2, name: /Review$/ })).toBeVisible();
    await window.getByRole('button', { name: 'Create watch' }).click();
    await expect.poll(() => window.evaluate(() => location.hash)).toMatch(/^#\/watches\/\d+$/);
    await go(window, '/watches');
    await expect(window.getByRole('heading', { level: 1, name: 'Watches' })).toBeVisible();
    // Its first check, from the fixture: the card shows what is free.
    const card = window.getByRole('article', { name: /^Bungarra/ });
    await card.getByRole('button', { name: 'Check now' }).click();
    await expect(card.getByText('Not checked yet')).toBeHidden({ timeout: 30_000 });
    await expect(
      window.getByRole('region', { name: 'Notifications' }).getByRole('listitem')
    ).toHaveCount(0, { timeout: 15_000 });
    await capture(docs, 'watches');
  });
});
