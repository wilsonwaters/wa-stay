/**
 * @site The product website's screenshots (`site/assets/screens/`), taken from the built app:
 *
 *   npm run site:screenshots
 *
 * The documentation run's launcher (`tests/docs/support/launch.ts`) with a bigger, sharper window
 * (1440 × 900 at 2× through Chromium's `--force-device-scale-factor`, a launch argument only) and
 * the site's own fixtures (`support/site-fixtures.ts`): network-free fixture mode serving all of
 * ParkStay's 169 campgrounds, illustrative availability for the stay, and Bungarra's recorded
 * campsite view, campground page and map. Only Mapbox's API host is reached, for the map.
 *
 * Only what the site shows: Explore (the window and its map), the South West's map, Bungarra's
 * availability and notices, a watch's card and the notifications panel. Every shot is of the app
 * as a person would see it: the stay (10–12 Nov 2026, 2 adults) is set through Explore's URL,
 * the watch is made in the New watch flow and checked with "Check now", and the notification is
 * the one that check raises. No provider photo appears (the fixtures carry none, brief O8), and
 * the campground map document is never opened.
 */

import fs from 'fs';
import path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { REPO_ROOT } from '../e2e/support/paths';
import {
  readUnexpectedRequests,
  unexpectedRequestsLogPath,
} from '../../src/main/testing/request-log';
import { launchForDocs, type DocsApp } from '../docs/support/launch';
import { writeSiteFixtures } from './support/site-fixtures';

/** Where the raw captures go; the script turns them into WebP in site/assets/screens/. */
const OUT_DIR = process.env.SITE_SCREENSHOTS_DIR ?? path.join(REPO_ROOT, 'test-results/site');
/** The window's content size in logical pixels, rendered at `SCALE`×. */
const WINDOW = { width: 1440, height: 900 };
const SCALE = 2;
const STAY = 'arrival=2026-11-10&departure=2026-11-12&adults=2';
const BUNGARRA = '/places/parkstay/20';
/**
 * The South West and its south coast: Busselton, Margaret River and Augusta to Bridgetown and
 * Pemberton, at a zoom where most places are pills rather than clusters.
 */
const COAST_CAMERA = '115.7,-34,8.1';
/** The catalogue syncs 5 s after launch (V5). */
const CATALOGUE_TIMEOUT_MS = 30_000;

async function go(page: Page, route: string): Promise<void> {
  // An in-app (hash) navigation: no reload, which a WebGL map under xvfb does not survive.
  await page.evaluate((hash) => {
    location.hash = hash;
  }, `#${route}`);
}

async function resize(site: DocsApp, height: number): Promise<void> {
  await site.app.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height);
    },
    { width: WINDOW.width, height }
  );
  // A display smaller than the window would clamp it; the images must be the size they say.
  await expect
    .poll(() => site.window.evaluate(() => [window.innerWidth, window.innerHeight]))
    .toEqual([WINDOW.width, height]);
}

/** No cursor, focus ring or transition in the picture. */
async function settle(page: Page): Promise<void> {
  await page.mouse.move(WINDOW.width - 1, WINDOW.height - 1);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(800);
}

/**
 * Waits until `target` draws the same picture twice running: the map has its tiles, labels
 * and pills, and nothing is fading or pulsing.
 */
async function waitForStill(target: Locator, timeout = 60_000): Promise<void> {
  const page = target.page();
  const deadline = Date.now() + timeout;
  let last = await target.screenshot({ scale: 'css' });
  let same = 0;
  while (same < 2) {
    if (Date.now() > deadline) throw new Error('The view kept changing');
    await page.waitForTimeout(1_500);
    const next = await target.screenshot({ scale: 'css' });
    same = next.equals(last) ? same + 1 : 0;
    last = next;
  }
}

function file(name: string): string {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  return path.join(OUT_DIR, `${name}.png`);
}

/** The whole window. */
async function captureWindow(site: DocsApp, name: string): Promise<void> {
  await settle(site.window);
  await site.window.screenshot({ path: file(name) });
}

/** Room around an area's own edges, in logical pixels, so its picture has some air. */
const AREA_MARGIN = 24;

/**
 * Part of an area: an element's box, or with `text`, only the extent of its text (a heading's
 * box spans the column however short the heading is).
 */
type AreaPart = Locator | { text: Locator };

/** A part's box in the viewport (`scrollY` 0), or in the document with `inDocument`. */
function partBox(part: AreaPart, inDocument = false) {
  const element = 'text' in part ? part.text : part;
  return element.evaluate(
    (node, { textOnly, inDocument }) => {
      let rect = node.getBoundingClientRect();
      if (textOnly) {
        const range = document.createRange();
        range.selectNodeContents(node);
        rect = range.getBoundingClientRect();
      }
      const dy = inDocument ? window.scrollY : 0;
      return { x: rect.left, y: rect.top + dy, width: rect.width, height: rect.height };
    },
    { textOnly: 'text' in part, inDocument }
  );
}

/**
 * The area the `parts` cover together, with `AREA_MARGIN` of the page around it. The window
 * grows to show the page down to it, so nothing scrolls and the sticky header never covers it,
 * then returns to its size.
 */
async function captureArea(site: DocsApp, name: string, parts: AreaPart[]): Promise<void> {
  const page = site.window;
  let bottom = 0;
  for (const part of parts) {
    const box = await partBox(part, true);
    bottom = Math.max(bottom, box.y + box.height);
  }
  const grow = bottom + 2 * AREA_MARGIN > WINDOW.height;
  if (grow) await resize(site, Math.ceil(bottom + 2 * AREA_MARGIN));
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);
  const boxes = [];
  for (const part of parts) boxes.push(await partBox(part));
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const end = Math.max(...boxes.map((b) => b.y + b.height));
  await page.screenshot({
    path: file(name),
    clip: {
      x: left - AREA_MARGIN,
      y: top - AREA_MARGIN,
      width: right - left + 2 * AREA_MARGIN,
      height: end - top + 2 * AREA_MARGIN,
    },
  });
  if (grow) await resize(site, WINDOW.height);
}

/**
 * One element at its exact bounds, with nothing hovered or focused. Its entrance animations
 * (a popover's scale-in) finish first, and endless ones (the "Watching" pill's ping) are shown
 * at rest. Logs its corner radius, which the site's frame for it matches.
 */
async function captureElement(site: DocsApp, name: string, element: Locator): Promise<void> {
  await element.evaluate((node) =>
    Promise.all(
      node
        .getAnimations({ subtree: true })
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished)
    )
  );
  await settle(site.window);
  const radius = await element.evaluate((node) => getComputedStyle(node).borderRadius);
  console.log(`${name}: border-radius ${radius}`);
  await element.screenshot({ path: file(name), animations: 'disabled' });
}

function mapRegion(page: Page): Locator {
  return page.getByRole('region', { name: 'Map of places' });
}

async function waitForMap(page: Page): Promise<void> {
  await expect(mapRegion(page).locator('canvas.mapboxgl-canvas')).toBeVisible({
    timeout: 30_000,
  });
  await waitForStill(mapRegion(page));
}

test.describe('@site screenshots', () => {
  let site: DocsApp;
  let fixturesDir: string;

  test.beforeAll(async () => {
    fixturesDir = writeSiteFixtures();
    site = await launchForDocs({
      map: true,
      fixturesDir,
      size: WINDOW,
      deviceScaleFactor: SCALE,
    });
    await resize(site, WINDOW.height);
    expect(await site.window.evaluate(() => window.devicePixelRatio)).toBe(SCALE);
    // The images show the app, not the platform's scrollbars (layout and content unchanged).
    const cdp = await site.window.context().newCDPSession(site.window);
    await cdp.send('Emulation.setScrollbarsHidden', { hidden: true });
  });

  test.afterAll(async () => {
    await site?.close();
    if (fixturesDir) fs.rmSync(fixturesDir, { recursive: true, force: true });
  });

  test('Explore', async () => {
    test.setTimeout(180_000);
    const { window } = site;
    const results = window.getByRole('region', { name: 'Results' });
    // The catalogue first (a sync adds places but never asks their availability), then the stay.
    await expect(results.getByRole('heading', { level: 2, name: '169 places' })).toBeVisible({
      timeout: CATALOGUE_TIMEOUT_MS,
    });
    await go(window, `/?${STAY}`);
    await expect(
      results.getByRole('heading', { level: 2, name: /^169 places · [1-9]\d* available for / })
    ).toBeVisible({ timeout: CATALOGUE_TIMEOUT_MS });
    await waitForMap(window);
    await captureWindow(site, 'explore');
    await settle(window);
    await mapRegion(window).screenshot({ path: file('explore-map') });
  });

  test('Explore, the South West and south coast', async () => {
    test.setTimeout(180_000);
    const { window } = site;
    // Explore opened afresh at a camera of the person's, as a shared link opens it.
    await go(window, '/watches');
    await expect(window.getByRole('heading', { level: 1, name: 'Watches' })).toBeVisible();
    await go(window, `/?${STAY}&map=${COAST_CAMERA}`);
    await expect(
      window
        .getByRole('region', { name: 'Results' })
        .getByRole('heading', { level: 2, name: /places in map area · [1-9]\d* available for / })
    ).toBeVisible({ timeout: CATALOGUE_TIMEOUT_MS });
    await waitForMap(window);
    await settle(window);
    await mapRegion(window).screenshot({ path: file('explore-coast') });
  });

  test('Place availability and notices', async () => {
    test.setTimeout(120_000);
    const { window } = site;
    await go(window, `${BUNGARRA}?${STAY}`);
    await expect(window.getByRole('heading', { level: 1, name: 'Bungarra' })).toBeVisible();
    const about = window.getByRole('region', { name: 'About' });
    const notices = about.getByRole('list', { name: 'Notices from ParkStay' });
    await expect(notices).toBeVisible({ timeout: 30_000 });
    // From the heading down to the campground map's button: the notices, not the accordion.
    await captureArea(site, 'place-notices', [
      { text: about.getByRole('heading', { level: 2, name: 'About' }) },
      ...(await notices.getByRole('listitem').all()),
      about.getByRole('button', { name: /^Show all \d+ notices$/ }),
      about.getByRole('button', { name: 'Campground map' }),
    ]);

    const stayCard = window.getByRole('region', { name: 'Check your dates' });
    await stayCard.getByRole('button', { name: 'Check availability' }).click();
    const grid = window.getByRole('table', { name: /^Availability by night/ });
    await expect(grid).toBeVisible({ timeout: 30_000 });
    await captureArea(site, 'place-availability', [
      window.getByRole('region', { name: 'Availability', exact: true }),
    ]);
  });

  test("A watch's card and its notification", async () => {
    test.setTimeout(180_000);
    const { window } = site;
    // A watch for Bungarra, made the way a person does: the place page's stay, prefilled.
    await go(window, `/watches/new?provider=parkstay&location=20&${STAY}`);
    await expect(window.getByRole('heading', { level: 1, name: 'New watch' })).toBeVisible();
    await expect(window.getByRole('heading', { level: 2, name: /Your stay$/ })).toBeVisible({
      timeout: CATALOGUE_TIMEOUT_MS,
    });
    await window.getByRole('button', { name: 'Continue' }).click();
    await expect(window.getByRole('heading', { level: 2, name: /Alerts$/ })).toBeVisible();
    // Keep checking after the first alert, so the card reads as a watch at work, not paused.
    await window.getByRole('checkbox', { name: 'Stop watching after the first alert' }).uncheck();
    await window.getByRole('button', { name: 'Continue' }).click();
    await expect(window.getByRole('heading', { level: 2, name: /Review$/ })).toBeVisible();
    await window.getByRole('button', { name: 'Create watch' }).click();
    await expect.poll(() => window.evaluate(() => location.hash)).toMatch(/^#\/watches\/\d+$/);

    await go(window, '/watches');
    await expect(window.getByRole('heading', { level: 1, name: 'Watches' })).toBeVisible();
    // Its first check, from the fixture: the card shows what is free, and the app notifies.
    const card = window.getByRole('article', { name: /^Bungarra/ });
    await card.getByRole('button', { name: 'Check now' }).click();
    await expect(card.getByText('Not checked yet')).toBeHidden({ timeout: 30_000 });
    const bell = window.getByRole('button', { name: 'Notifications, 1 unread' });
    await expect(bell).toBeVisible({ timeout: 15_000 });
    // Toasts gone, so they cover nothing.
    await expect(
      window.getByRole('region', { name: 'Notifications' }).getByRole('listitem')
    ).toHaveCount(0, { timeout: 15_000 });
    await expect(card.getByText('Watching', { exact: true })).toBeVisible();
    await expect(card.getByText('3 sites available', { exact: true })).toBeVisible();
    await captureElement(site, 'watch-card', card);

    await bell.click();
    const panel = window.getByRole('dialog', { name: 'Notifications' });
    await expect(panel.getByRole('link', { name: 'Sites available at Bungarra' })).toBeVisible();
    await captureElement(site, 'notification-panel', panel);
    await window.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });

  test('No provider request went unanswered, and no photo was asked for', async () => {
    const userData = await site.app.evaluate(({ app }) => app.getPath('userData'));
    const refused = readUnexpectedRequests(unexpectedRequestsLogPath(userData));
    // Every provider request was answered from the fixtures…
    expect(refused.filter((r) => r.source !== 'network-guard')).toEqual([]);
    // …and nothing but Mapbox was even attempted from the window (its telemetry is refused).
    // Only hosts are compared and reported: Mapbox's URLs carry the access token.
    const hosts = refused.map((r) => new URL(r.url).hostname);
    expect(hosts.filter((host) => !host.endsWith('.mapbox.com'))).toEqual([]);
  });
});
