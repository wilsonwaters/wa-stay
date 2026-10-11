/**
 * Launch: WA Stay opens straight on Explore, with no login gate (brief D2).
 *
 * Explore (E1): the search pill, the filters, the list-only notice (the e2e build has no
 * Mapbox token, so there is no map), and the campgrounds from the ParkStay catalogue fixture
 * (tests/e2e/fixtures/http/parkstay/campground_map.json). With dates (E3): each campground's
 * availability from the bulk fixture (campground_availabilty_view.json) and "Available only".
 */

import { stayRangeLabel } from '../../src/renderer/components/nightGridModel';
import { addDays, todayIn } from '../../src/shared/utils/calendar-date';
import { expect, test, withoutGuardedRequests, withoutRemoteImages } from './support/wa-stay';
import { expectCurrentNavLink, expectRoute, NAV_PAGES, pageHeading } from './support/shell';

/** The 11 campgrounds in the ParkStay catalogue fixture. */
const FIXTURE_CAMPGROUNDS = 11;
/** The counts and suggestions below are ParkStay's alone, however many providers are built in. */
const PARKSTAY_ONLY = { providers: ['parkstay'] };

test('opens straight on Explore, with no login gate', async ({ launchWaStay }) => {
  const { window } = await launchWaStay();

  await expectRoute(window, '/');
  await expect(pageHeading(window)).toHaveCount(1);
  await expect(pageHeading(window)).toHaveText(NAV_PAGES.explore.heading);
  await expectCurrentNavLink(window, NAV_PAGES.explore.link);
  await expect(window.getByRole('banner')).toHaveCount(1);
  await expect(window.getByRole('main')).toBeVisible();
  await expect(window.getByLabel('Password')).toHaveCount(0);
});

test('Explore shows the search pill, the filters and, with no token, the list instead of a map', async ({
  launchWaStay,
}) => {
  const wa = await launchWaStay();
  const { window } = wa;

  const search = window.getByRole('search', { name: 'Search places' });
  await expect(search).toBeVisible();
  await expect(search.getByRole('combobox', { name: 'Where' })).toBeVisible();
  await expect(search.getByRole('button', { name: 'Search' })).toBeVisible();
  const filters = window.getByRole('group', { name: 'Filters' });
  for (const chip of ['Provider', 'Region', 'Facilities', 'Book online', 'Available only']) {
    await expect(filters.getByRole('button', { name: chip, exact: true })).toBeVisible();
  }

  await expect(
    window.getByText("The map isn't available in this build, so places are shown as a list.")
  ).toBeVisible();
  await expect(window.getByRole('region', { name: 'Map of places' })).toHaveCount(0);
  // The production build never shows the developer hint.
  await expect(window.getByText(/MAPBOX_ACCESS_TOKEN/)).toHaveCount(0);

  expect(withoutGuardedRequests(await wa.consoleErrors(), wa.unexpectedRequests())).toEqual([]);
  expect(withoutRemoteImages(wa.unexpectedRequests())).toEqual([]);
});

test('Explore lists the ParkStay campgrounds from the catalogue fixture', async ({
  launchWaStay,
}) => {
  const wa = await launchWaStay(PARKSTAY_ONLY);
  const { window } = wa;
  const results = window.getByRole('region', { name: 'Results' });

  // The catalogue syncs from the fixture 5 s after the window opens (V5).
  await expect(
    results.getByRole('heading', { level: 2, name: `${FIXTURE_CAMPGROUNDS} places` })
  ).toBeVisible({ timeout: 20_000 });
  const first = results.getByRole('link').first();
  await expect(first.getByRole('img', { name: /ParkStay/ })).toBeVisible();
  await expect(results.getByRole('link', { name: 'Bungarra' })).toBeVisible();

  // Provider photos are not loaded in fixture mode: the placeholder stands in.
  await expect(results.getByRole('img', { name: 'No photo available for Bungarra' })).toBeVisible();

  // Filter by region, then open a place.
  await window
    .getByRole('group', { name: 'Filters' })
    .getByRole('button', { name: 'Region' })
    .click();
  const region = window.getByRole('dialog', { name: 'Region' });
  await region.getByRole('checkbox', { name: 'Pilbara, 3 places' }).click();
  await region.getByRole('button', { name: 'Done' }).click();
  await expect(window.getByRole('button', { name: 'Region, 1 selected' })).toBeFocused();
  await expect(results.getByRole('heading', { level: 2, name: '3 places' })).toBeVisible();
  await results.getByRole('link', { name: 'Bungarra' }).click();
  await expectRoute(window, '/places/parkstay/20');
  // Its detail page (E2): the name, and its sites from the fixture.
  await expect(window.getByRole('heading', { level: 1, name: 'Bungarra' })).toBeVisible();
  await expect(window.getByRole('heading', { level: 2, name: 'Sites' })).toBeVisible();
  // Its About from the campground page (PD2): the notices, the first 3 shown and the rest
  // behind "Show all 11 notices" (PD4), then the sections as an accordion, the intro open and
  // the rest closed until opened.
  const about = window.getByRole('region', { name: 'About' });
  const notices = about.getByRole('list', { name: 'Notices from ParkStay' }).getByRole('listitem');
  await expect(notices).toHaveCount(3);
  await expect(about.getByText('Warning: No campfires at any time')).toBeVisible();
  const allNotices = about.getByRole('button', { name: 'Show all 11 notices' });
  await expect(allNotices).toHaveAttribute('aria-expanded', 'false');
  await allNotices.click();
  await expect(notices).toHaveCount(11);
  const fewerNotices = about.getByRole('button', { name: 'Show fewer notices' });
  await expect(fewerNotices).toHaveAttribute('aria-expanded', 'true');
  await expect(fewerNotices).toBeFocused();
  await expect(
    about.getByText(
      "Information: To pay entry fee separately: deselect 'Pay park entry' at next screen"
    )
  ).toBeVisible();
  await expect(about.getByRole('button', { name: 'Overview' })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  await expect(about.getByText(/shore-based fishing is permitted/)).toBeVisible();
  const fees = about.getByRole('button', { name: 'Fees' });
  await expect(fees).toHaveAttribute('aria-expanded', 'false');
  await fees.click();
  await expect(fees).toHaveAttribute('aria-expanded', 'true');
  await expect(about.getByRole('link', { name: 'More about fees' })).toBeVisible();

  expect(withoutGuardedRequests(await wa.consoleErrors(), wa.unexpectedRequests())).toEqual([]);
  expect(withoutRemoteImages(wa.unexpectedRequests())).toEqual([]);
});

test('Explore with dates shows each campground’s availability and narrows to "Available only"', async ({
  launchWaStay,
}) => {
  const wa = await launchWaStay(PARKSTAY_ONLY);
  const { window } = wa;
  const results = window.getByRole('region', { name: 'Results' });
  await expect(
    results.getByRole('heading', { level: 2, name: `${FIXTURE_CAMPGROUNDS} places` })
  ).toBeVisible({ timeout: 20_000 });

  // "Available only" needs dates first, and says so.
  const filters = window.getByRole('group', { name: 'Filters' });
  const availableOnly = filters.getByRole('button', { name: 'Available only' });
  await expect(availableOnly).toHaveAttribute('aria-disabled', 'true');
  await availableOnly.focus();
  await expect(window.getByRole('tooltip')).toHaveText('Add dates to filter by availability');

  // Dates from the search pill: tomorrow, for 2 nights (Perth). Each step waits for the
  // calendar's answer, as a person would: on a slow machine, keys sent before the grid has focus
  // are lost.
  await window.getByRole('button', { name: /^When/ }).click();
  await expect(window.locator('[role="grid"] button:focus')).toHaveCount(1);
  await window.keyboard.press('ArrowRight');
  await window.keyboard.press('Enter');
  await expect(window.getByRole('button', { name: /, check-in$/ })).toHaveCount(1);
  await window.keyboard.press('ArrowRight');
  await window.keyboard.press('ArrowRight');
  await window.keyboard.press('Enter');
  await expect(window.getByRole('button', { name: /, check-out$/ })).toHaveCount(1);
  await window.keyboard.press('Escape');
  const arrival = addDays(todayIn('Australia/Perth'), 1);
  const departure = addDays(arrival, 2);
  await expectRoute(window, `/?arrival=${arrival}&departure=${departure}`);

  // ParkStay's bulk availability (the fixture), on every card.
  const range = stayRangeLabel(arrival, departure);
  await expect(
    results.getByRole('heading', {
      level: 2,
      name: `${FIXTURE_CAMPGROUNDS} places · 3 available for ${range}`,
    })
  ).toBeVisible({ timeout: 20_000 });
  const card = (name: string) => results.getByRole('link', { name, exact: true });
  await expect(card('Bungarra')).toContainText('2 of 3 sites available');
  await expect(card('Kurrajong (Cape Range)')).toContainText('No site free every night');
  await expect(card('Temple Gorge')).toContainText('No sites open for these dates');
  await expect(card('Lake Mason Homestead')).toContainText('Info only');
  await expect(card('Lake Mason Homestead')).not.toContainText('Not bookable online');

  // Available only: the three with a site free, most free first; kept in the URL.
  await availableOnly.click();
  await expect(availableOnly).toHaveAttribute('aria-pressed', 'true');
  await expectRoute(window, `/?arrival=${arrival}&departure=${departure}&avail=1`);
  await expect(results.getByRole('link')).toHaveCount(3);
  const names = await results
    .getByRole('link')
    .evaluateAll((links) =>
      links.map(
        (link) => document.getElementById(link.getAttribute('aria-labelledby') ?? '')?.textContent
      )
    );
  expect(names).toEqual(['Lucky Bay (Cape Le Grand)', 'Bungarra', 'Workmans Pool']);

  // The card opens the place with the same stay.
  await card('Bungarra').click();
  await expectRoute(window, `/places/parkstay/20?arrival=${arrival}&departure=${departure}`);
  await expect(window.getByRole('heading', { level: 1, name: 'Bungarra' })).toBeVisible();

  expect(withoutGuardedRequests(await wa.consoleErrors(), wa.unexpectedRequests())).toEqual([]);
  expect(withoutRemoteImages(wa.unexpectedRequests())).toEqual([]);
});

test('Explore’s "Where" shows 8 two-line suggestions without scrolling at the 960 × 640 minimum', async ({
  launchWaStay,
}) => {
  const { app, window } = await launchWaStay(PARKSTAY_ONLY);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(960, 640);
  });
  await expect.poll(() => window.evaluate(() => document.documentElement.clientHeight)).toBe(640);
  await expect(
    window
      .getByRole('region', { name: 'Results' })
      .getByRole('heading', { level: 2, name: `${FIXTURE_CAMPGROUNDS} places` })
  ).toBeVisible({ timeout: 20_000 });

  // "a" matches regions, areas and places: the most suggestions (8), under 3 headings
  const where = window.getByRole('combobox', { name: 'Where' });
  await where.fill('a');
  const list = window.getByRole('listbox', { name: 'Where' });
  await expect(list.getByRole('option')).toHaveCount(8);
  await expect(list.getByRole('group')).toHaveCount(3);
  const layout = await list.evaluate((el) => {
    const anchor = document.querySelector('[role="combobox"]')?.parentElement;
    const lines = Array.from(el.querySelectorAll('[role="option"]')).map(
      (option) => option.querySelector('span > span + span') !== null
    );
    return {
      twoLines: lines.every(Boolean),
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      top: el.getBoundingClientRect().top,
      bottom: el.getBoundingClientRect().bottom,
      anchorBottom: anchor?.getBoundingClientRect().bottom ?? Number.NaN,
    };
  });
  expect(layout.twoLines).toBe(true);
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.clientHeight);
  // Below the input, never over it, and inside the window
  expect(layout.top).toBeGreaterThanOrEqual(layout.anchorBottom);
  expect(layout.bottom).toBeLessThanOrEqual(640);
});

test('the window is titled WA Stay', async ({ launchWaStay }) => {
  const { window } = await launchWaStay();

  await expect(window).toHaveTitle('WA Stay');
});
