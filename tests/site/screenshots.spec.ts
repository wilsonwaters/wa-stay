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
 * Every shot is of the app as a person would see it: the stay (10–12 Nov 2026, 2 adults) is
 * set through Explore's URL, the watch is made in the New watch flow and checked with "Check
 * now", and the notification is the one that check raises. No provider photo appears (the
 * fixtures carry none, brief O8), and the campground map document is never opened.
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

/** Room around an element's own edges, in logical pixels, so its picture has some air. */
const ELEMENT_MARGIN = 24;

/**
 * One element, with `ELEMENT_MARGIN` of the page around it. The window grows to show the page
 * down to it, so nothing scrolls and the sticky header never covers it, then returns to its size.
 */
async function captureElement(site: DocsApp, name: string, element: Locator): Promise<void> {
  const page = site.window;
  const bottom = await element.evaluate(
    (node) => node.getBoundingClientRect().bottom + window.scrollY
  );
  const grow = bottom + 2 * ELEMENT_MARGIN > WINDOW.height;
  if (grow) await resize(site, Math.ceil(bottom + 2 * ELEMENT_MARGIN));
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);
  const box = await element.boundingBox();
  if (!box) throw new Error(`${name}: the element is not on the page`);
  await page.screenshot({
    path: file(name),
    clip: {
      x: box.x - ELEMENT_MARGIN,
      y: box.y - ELEMENT_MARGIN,
      width: box.width + 2 * ELEMENT_MARGIN,
      height: box.height + 2 * ELEMENT_MARGIN,
    },
  });
  if (grow) await resize(site, WINDOW.height);
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

  test('Place availability and about', async () => {
    test.setTimeout(120_000);
    const { window } = site;
    await go(window, `${BUNGARRA}?${STAY}`);
    await expect(window.getByRole('heading', { level: 1, name: 'Bungarra' })).toBeVisible();
    const about = window.getByRole('region', { name: 'About' });
    await expect(about.getByRole('list', { name: 'Notices from ParkStay' })).toBeVisible({
      timeout: 30_000,
    });
    // The accordion opens on its first section.
    await expect(about.getByRole('button', { expanded: true }).first()).toBeVisible();
    await captureElement(site, 'place-about', about);

    const stayCard = window.getByRole('region', { name: 'Check your dates' });
    await stayCard.getByRole('button', { name: 'Check availability' }).click();
    const grid = window.getByRole('table', { name: /^Availability by night/ });
    await expect(grid).toBeVisible({ timeout: 30_000 });
    await captureElement(
      site,
      'place-availability',
      window.getByRole('region', { name: 'Availability', exact: true })
    );
  });

  test('New watch, Watches and the notification', async () => {
    test.setTimeout(180_000);
    const { window } = site;
    // A watch for Bungarra, made the way a person does: the place page's stay, prefilled.
    await go(window, `/watches/new?provider=parkstay&location=20&${STAY}`);
    await expect(window.getByRole('heading', { level: 1, name: 'New watch' })).toBeVisible();
    await expect(window.getByRole('heading', { level: 2, name: /Your stay$/ })).toBeVisible({
      timeout: CATALOGUE_TIMEOUT_MS,
    });
    await captureWindow(site, 'watch-new');

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
    await captureWindow(site, 'watches');

    await bell.click();
    const panel = window.getByRole('dialog', { name: 'Notifications' });
    await expect(panel.getByRole('link', { name: 'Sites available at Bungarra' })).toBeVisible();
    await captureWindow(site, 'notifications');
    await window.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });

  test('Settings, notifications', async () => {
    test.setTimeout(60_000);
    const { window } = site;
    await go(window, '/settings/notifications');
    await expect(window.getByRole('heading', { level: 2, name: 'Notifications' })).toBeVisible();
    await expect(window.getByRole('heading', { level: 3, name: 'Email' })).toBeVisible();
    await captureWindow(site, 'settings-notifications');
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
