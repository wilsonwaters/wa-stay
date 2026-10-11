/**
 * A place's campground map, network-free: Bungarra's About offers "Campground map", which opens
 * the map (a PDF) in a window of its own, titled "Bungarra · Campground map", in the built-in PDF
 * viewer. Fixture mode serves the PDF on the window's own partition
 * (`tests/e2e/fixtures/http/parkstay/campground_map_20.pdf`); nothing leaves the machine. A
 * second press focuses the same window.
 */

import { expect, test, withoutGuardedRequests, withoutRemoteImages } from './support/wa-stay';
import { expectRoute } from './support/shell';

/** The catalogue syncs 5 s after launch (V5); give it room on a slow runner. */
const CATALOGUE_TIMEOUT_MS = 30_000;
const MAP_URL =
  'https://parkstay.dbca.wa.gov.au/media/parkstay/campground_maps/20/Bungarra_Campground_mud_map.pdf';
const MAP_TITLE = 'Bungarra · Campground map';

test('a place’s "Campground map" opens the map in its own window, from the fixture', async ({
  launchWaStay,
}) => {
  test.setTimeout(60_000);
  const launch = await launchWaStay();
  const { app, window } = launch;

  await window
    .getByRole('region', { name: 'Results' })
    .getByRole('link', { name: 'Bungarra', exact: true })
    .click({ timeout: CATALOGUE_TIMEOUT_MS });
  await expectRoute(window, '/places/parkstay/20');
  const about = window.getByRole('region', { name: 'About' });
  const button = about.getByRole('button', { name: 'Campground map' });
  await expect(button).toBeVisible();

  const opened = app.waitForEvent('window');
  await button.click();
  const map = await opened;

  // The map window: its title is the app's, and it shows the document's own URL
  const titles = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()));
  await expect.poll(titles).toContain(MAP_TITLE);
  expect(map.url()).toBe(MAP_URL);
  // Opened: the button is back from "Opening…"
  await expect(button).toHaveAccessibleName('Campground map');
  await expect(button).not.toHaveAttribute('aria-busy', 'true');
  // The PDF viewer took the document (its frame is the viewer extension's)
  await expect
    .poll(() => map.frames().some((frame) => frame.url().startsWith('chrome-extension://')))
    .toBe(true);

  // A second press focuses the same window
  await button.click();
  await expect(button).toHaveAccessibleName('Campground map');
  expect((await titles()).filter((title) => title === MAP_TITLE)).toHaveLength(1);

  // Nothing left the fixture: no request was refused, the map's included
  const requests = launch.unexpectedRequests();
  expect(withoutRemoteImages(requests)).toEqual([]);
  expect(withoutGuardedRequests(await launch.consoleErrors(), requests)).toEqual([]);
});
