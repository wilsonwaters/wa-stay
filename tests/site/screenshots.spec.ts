/**
 * @site The product website's screenshots (`site/assets/screens/`), taken from the built app:
 *
 *   npm run site:screenshots
 *
 * The documentation run's launcher (`tests/docs/support/launch.ts`) with a bigger, sharper window
 * (1440 × 900 at 2× through Chromium's `--force-device-scale-factor`, a launch argument only) and
 * the site's own fixtures (`support/site-fixtures.ts`): network-free fixture mode serving all of
 * ParkStay's 169 campgrounds, illustrative availability for the stay, and Bungarra's recorded
 * campsite view, campground page and map. Two hosts are reached: Mapbox's API, for the map, and
 * ParkStay's site, for the places' photos only (anonymous GETs under `/media/`, checked at the
 * end). Showing the photos is the product owner's decision for the website; the documentation
 * run keeps them blocked.
 *
 * Only what the site shows: Explore (the window and its map), the South West's map, Bungarra's
 * header and availability, a watch's card and the notifications panel. Every shot is of the app
 * as a person would see it: the stay (10–12 Nov 2026, 2 adults) is set through Explore's URL,
 * the watch is made in the New watch flow and checked with "Check now", and the notification is
 * the one that check raises. Every capture waits for the photos in view to finish loading, and
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
/**
 * The Explore hero's window height: the list shows one row of cards (no second row of photo
 * tiles), and the map, framed afresh at this size, all of WA.
 */
const HERO_HEIGHT = 730;
const STAY = 'arrival=2026-11-10&departure=2026-11-12&adults=2';
const BUNGARRA = '/places/parkstay/20';
/**
 * The South West and its south coast: Busselton, Margaret River and Augusta to Bridgetown and
 * Pemberton, at a zoom where most places are pills rather than clusters.
 */
const COAST_CAMERA = '115.7,-34,8.1';
/** ParkStay's site, where the catalogue's photos are (`/media/parkstay/campground_images/…`). */
const PARKSTAY_HOST = 'parkstay.dbca.wa.gov.au';
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
  const [width, height] = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
  await page.mouse.move(width - 1, height - 1);
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

/**
 * Waits until every photo in view has loaded and faded in: each visible image complete, with
 * pixels and fully opaque, no photo placeholder ("No photo available for …") and no skeleton
 * shimmer left in view. Every place in the fixtures has a photo, so a placeholder means one
 * failed to load.
 */
async function waitForPhotos(page: Page, timeout = 60_000): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const inView = (element: Element | null): boolean => {
            if (!element) return false;
            const r = element.getBoundingClientRect();
            return (
              r.width > 0 &&
              r.height > 0 &&
              r.bottom > 0 &&
              r.right > 0 &&
              r.top < window.innerHeight &&
              r.left < window.innerWidth
            );
          };
          const loading = [...document.images].filter(
            (img) =>
              inView(img) &&
              !(img.complete && img.naturalWidth > 0 && getComputedStyle(img).opacity === '1')
          ).length;
          const placeholders = [
            ...document.querySelectorAll('[aria-label^="No photo available for"]'),
          ].filter(inView).length;
          const shimmering = document
            .getAnimations()
            .filter(
              (a) =>
                a instanceof CSSAnimation &&
                a.animationName === 'shimmer' &&
                a.effect instanceof KeyframeEffect &&
                inView(a.effect.target)
            ).length;
          return { loading, placeholders, shimmering };
        }),
      { timeout, message: 'Photos in view did not all load' }
    )
    .toEqual({ loading: 0, placeholders: 0, shimmering: 0 });
}

/** The photos in view, each as its file, its own size and the size it is shown at. */
function photoSizes(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...document.images]
      .filter((img) => {
        const r = img.getBoundingClientRect();
        return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
      })
      .map((img) => {
        const r = img.getBoundingClientRect();
        const file = new URL(img.currentSrc).pathname.split('/').pop();
        return `${file} ${img.naturalWidth}×${img.naturalHeight} shown ${Math.round(r.width)}×${Math.round(r.height)}`;
      })
      .join('; ')
  );
}

/** The whole window. */
async function captureWindow(site: DocsApp, name: string): Promise<void> {
  await waitForPhotos(site.window);
  await settle(site.window);
  await site.window.screenshot({ path: file(name) });
}

/** Room around an area's own edges, in logical pixels, so its picture has some air. */
const AREA_MARGIN = 24;

/** An element's box in the viewport (`scrollY` 0), or in the document with `inDocument`. */
function boxOf(element: Locator, inDocument = false) {
  return element.evaluate((node, inDocument) => {
    const rect = node.getBoundingClientRect();
    const dy = inDocument ? window.scrollY : 0;
    return { x: rect.left, y: rect.top + dy, width: rect.width, height: rect.height };
  }, inDocument);
}

/**
 * The area the `elements` cover together, with `AREA_MARGIN` of the page around it. The window
 * grows to show the page down to it, so nothing scrolls and the sticky header never covers it,
 * then returns to its size. It grows again while the area moves down as it grows (a place's
 * photo is taller in a taller window).
 */
async function captureArea(site: DocsApp, name: string, elements: Locator[]): Promise<void> {
  const page = site.window;
  let height = WINDOW.height;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    let bottom = 0;
    for (const element of elements) {
      const box = await boxOf(element, true);
      bottom = Math.max(bottom, box.y + box.height);
    }
    const needed = Math.ceil(bottom + 2 * AREA_MARGIN);
    if (needed <= height) break;
    height = needed;
    await resize(site, height);
  }
  const grow = height !== WINDOW.height;
  await page.evaluate(() => window.scrollTo(0, 0));
  await waitForPhotos(page);
  await settle(page);
  const boxes = [];
  for (const element of elements) boxes.push(await boxOf(element));
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const end = Math.max(...boxes.map((b) => b.y + b.height));
  if (end + AREA_MARGIN > (await page.evaluate(() => window.innerHeight))) {
    throw new Error(`${name}: the area runs past the bottom of the window`);
  }
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
  await waitForPhotos(site.window);
  await settle(site.window);
  const radius = await element.evaluate((node) => getComputedStyle(node).borderRadius);
  console.log(`${name}: border-radius ${radius}`);
  await element.screenshot({ path: file(name), animations: 'disabled' });
}

/** A request to ParkStay's site, as the main process saw it go out. */
interface ParkStayRequest {
  method: string;
  path: string;
  /** Which credential-bearing headers it carried. */
  cookie: boolean;
  authorization: boolean;
}

/**
 * Records every request to ParkStay's site that any session sends (the window's, the
 * provider's partition and any made later), from just after launch, before the catalogue
 * syncs. Only the method, the path and whether credentials went with it are kept.
 */
async function recordParkStayRequests(site: DocsApp): Promise<void> {
  await site.app.evaluate(({ app, session }, host) => {
    const seen: ParkStayRequest[] = [];
    (globalThis as unknown as { siteParkStayRequests: ParkStayRequest[] }).siteParkStayRequests =
      seen;
    const watch = (ses: typeof session.defaultSession): void => {
      ses.webRequest.onSendHeaders((details) => {
        const url = new URL(details.url);
        if (url.hostname !== host && !url.hostname.endsWith(`.${host}`)) return;
        const headers = Object.keys(details.requestHeaders).map((name) => name.toLowerCase());
        seen.push({
          method: details.method,
          path: url.pathname,
          cookie: headers.includes('cookie'),
          authorization: headers.includes('authorization'),
        });
      });
    };
    watch(session.defaultSession);
    watch(session.fromPartition('persist:provider-parkstay'));
    app.on('session-created', watch);
  }, PARKSTAY_HOST);
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
      // The places' photos, live from ParkStay (the product owner's decision for the website).
      allowHosts: [PARKSTAY_HOST],
      size: WINDOW,
      deviceScaleFactor: SCALE,
    });
    await recordParkStayRequests(site);
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
    await settle(window);
    await mapRegion(window).screenshot({ path: file('explore-map') });

    // The hero: a shorter window, with Explore opened afresh in it so the map frames all of WA
    // at that size (a resize alone keeps the camera).
    await resize(site, HERO_HEIGHT);
    await go(window, '/watches');
    await expect(window.getByRole('heading', { level: 1, name: 'Watches' })).toBeVisible();
    await go(window, `/?${STAY}`);
    await expect(
      results.getByRole('heading', { level: 2, name: /^169 places · [1-9]\d* available for / })
    ).toBeVisible({ timeout: CATALOGUE_TIMEOUT_MS });
    await waitForMap(window);
    await captureWindow(site, 'explore');
    console.log(`explore: photos in view ${await photoSizes(window)}`);
    await resize(site, WINDOW.height);
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

  test('Place header and availability', async () => {
    test.setTimeout(120_000);
    const { window } = site;
    await go(window, `${BUNGARRA}?${STAY}`);
    await expect(window.getByRole('heading', { level: 1, name: 'Bungarra' })).toBeVisible();
    // From the back link down to the bottom of the photo: title, provider and park, photo.
    const photo = window.getByRole('img', { name: 'Bungarra, photo 1 of 1' });
    await expect(photo).toBeVisible({ timeout: 30_000 });
    await captureArea(site, 'place-header', [
      window.getByRole('main').getByRole('link', { name: 'Explore', exact: true }),
      photo,
    ]);
    const size = await photo.evaluate((img: HTMLImageElement) => ({
      shown: `${Math.round(img.getBoundingClientRect().width)} × ${Math.round(img.getBoundingClientRect().height)}`,
      natural: `${img.naturalWidth} × ${img.naturalHeight}`,
    }));
    console.log(`place-header: photo shown at ${size.shown} (logical), image ${size.natural}`);

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
    await expect(card.getByRole('img', { name: 'Bungarra' })).toBeVisible();
    await captureElement(site, 'watch-card', card);

    await bell.click();
    const panel = window.getByRole('dialog', { name: 'Notifications' });
    await expect(panel.getByRole('link', { name: 'Sites available at Bungarra' })).toBeVisible();
    await captureElement(site, 'notification-panel', panel);
    await window.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });

  test('ParkStay was asked only for photos; every other provider request met a fixture', async () => {
    const userData = await site.app.evaluate(({ app }) => app.getPath('userData'));
    const refused = readUnexpectedRequests(unexpectedRequestsLogPath(userData));
    // Every provider request was answered from the fixtures…
    expect(refused.filter((r) => r.source !== 'network-guard')).toEqual([]);
    // …and the guard refused nothing but Mapbox's telemetry. Only hosts are compared and
    // reported: Mapbox's URLs carry the access token.
    const hosts = refused.map((r) => new URL(r.url).hostname);
    expect(hosts.filter((host) => !host.endsWith('.mapbox.com'))).toEqual([]);
    // What went to ParkStay: anonymous GETs of its photos, nothing else.
    const sent = await site.app.evaluate(
      () =>
        (globalThis as unknown as { siteParkStayRequests?: ParkStayRequest[] })
          .siteParkStayRequests ?? []
    );
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.filter((r) => r.method !== 'GET' || !r.path.startsWith('/media/'))).toEqual([]);
    expect(sent.filter((r) => r.cookie || r.authorization)).toEqual([]);
    const distinct = new Set(sent.map((r) => r.path)).size;
    console.log(
      `ParkStay requests: ${sent.length} GETs under /media/ (${distinct} distinct photos), on ${PARKSTAY_HOST}`
    );
  });
});
