/**
 * Resizing the window is not a map move (M1). Mapbox GL 3 ends a move with the window's own
 * `resize` event as its `originalEvent`, which Explore once took for the person panning: the
 * list narrowed to "in map area" and `map=` was written. Only the person's gestures count.
 *
 * - **List-only** (every run): the e2e build has no Mapbox token, so this checks that resizing
 *   leaves the results and the route alone without a map.
 * - **With the map** (opt-in, `E2E_MAP=1`): needs a build with a Mapbox token (`npm run build`
 *   with `MAPBOX_ACCESS_TOKEN` in `.env`) and Mapbox reachable; only `api.mapbox.com` is let
 *   through the network guard. Linux runs get SwiftShader, as `npm run docs:screenshots` does;
 *   `E2E_ELECTRON_ARGS` adds switches (space-separated), e.g. `--proxy-server=host:port`.
 *
 *   npm run build && E2E_MAP=1 xvfb-run -a npx playwright test explore-resize
 */

import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './support/wa-stay';

/** The 11 campgrounds in the ParkStay catalogue fixture. */
const FIXTURE_CAMPGROUNDS = 11;
/** The count is ParkStay's alone, however many providers are built in. */
const PROVIDERS = ['parkstay'];
/** The catalogue syncs from the fixture 5 s after the window opens (V5). */
const CATALOGUE_TIMEOUT_MS = 30_000;
/** Explore writes the camera 500 ms after a move ends; this leaves room for the move itself. */
const SETTLE_MS = 2_000;
/** Sizes a person resizes or maximises the window to, down to the 960 × 640 minimum. */
const SIZES: Array<[number, number]> = [
  [960, 640],
  [1440, 900],
  [1200, 800],
];

const MAP = process.env.E2E_MAP === '1';
const MAP_ARGS = [
  ...(process.platform === 'linux'
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : []),
  ...(process.env.E2E_ELECTRON_ARGS ?? '').split(/\s+/).filter(Boolean),
];

async function resize(app: ElectronApplication, page: Page, [width, height]: [number, number]) {
  await app.evaluate(
    ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h),
    [width, height]
  );
  await expect
    .poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight]))
    .toEqual([width, height]);
}

const route = (window: Page) => window.evaluate(() => location.hash);

function resultsHeading(window: Page) {
  return window.getByRole('region', { name: 'Results' }).getByRole('heading', { level: 2 }).first();
}

test('resizing the window keeps the list as it is and writes no map= (list-only)', async ({
  launchWaStay,
}) => {
  const { app, window } = await launchWaStay({ providers: PROVIDERS });
  await resize(app, window, [1280, 800]);
  await expect(resultsHeading(window)).toHaveText(`${FIXTURE_CAMPGROUNDS} places`, {
    timeout: CATALOGUE_TIMEOUT_MS,
  });

  for (const size of SIZES) {
    await resize(app, window, size);
    await window.waitForTimeout(SETTLE_MS);
    await expect(resultsHeading(window)).toHaveText(`${FIXTURE_CAMPGROUNDS} places`);
    expect(await route(window)).not.toContain('map=');
  }
});

test('with the map: resizing the window is not a map move, a zoom button is (M1)', async ({
  launchWaStay,
}) => {
  test.skip(!MAP, 'Needs a build with a Mapbox token and Mapbox reachable: set E2E_MAP=1');
  test.setTimeout(120_000);
  const { app, window } = await launchWaStay({
    providers: PROVIDERS,
    env: { WA_STAY_E2E_ALLOW_HOSTS: 'api.mapbox.com' },
    args: MAP_ARGS,
  });
  await resize(app, window, [1280, 800]);
  await expect(window.getByRole('region', { name: 'Map of places' })).toBeVisible();
  // Mapbox's zoom buttons are there once the map has loaded.
  const zoomIn = window.getByRole('button', { name: 'Zoom in' });
  await expect(zoomIn).toBeVisible({ timeout: CATALOGUE_TIMEOUT_MS });
  await expect(resultsHeading(window)).toHaveText(`${FIXTURE_CAMPGROUNDS} places`, {
    timeout: CATALOGUE_TIMEOUT_MS,
  });
  await window.waitForTimeout(SETTLE_MS);
  expect(await route(window)).not.toContain('map=');

  for (const size of SIZES) {
    await resize(app, window, size);
    await window.waitForTimeout(SETTLE_MS);
    await expect(resultsHeading(window)).toHaveText(`${FIXTURE_CAMPGROUNDS} places`);
    expect(await route(window)).not.toContain('map=');
  }

  // The person's own move still counts: the camera is written and the list follows the map.
  await zoomIn.click();
  await expect.poll(() => route(window), { timeout: 10_000 }).toContain('map=');
  await expect(resultsHeading(window)).toHaveText(/ in map area$/);
});
