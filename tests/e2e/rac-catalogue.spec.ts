/**
 * RAC Parks & Resorts on Explore, network-free: with ParkStay and RAC registered, the Booking site
 * chip's "RAC Parks & Resorts" leaves RAC's eight open parks (its seed: the catalogue sync
 * sends nothing), each card with RAC's badge. RAC Margaret River Nature Park's page lists its
 * categories (its dorms and its safari tent) from the trimmed book-now page in
 * `tests/e2e/fixtures/http/rac/`, as types of spot ("Bookable as 5 spot types"), never as a
 * count of spots: each category stands for several. Fixture mode refuses no request.
 */

import { expect, test, withoutGuardedRequests, withoutRemoteImages } from './support/wa-stay';
import { expectRoute } from './support/shell';

/** The catalogues sync 5 s after launch (V5); give them room on a slow runner. */
const CATALOGUE_TIMEOUT_MS = 30_000;
/** ParkStay's 11 campgrounds and RAC's 8 parks. */
const ALL_PLACES = 19;
const RAC_PARKS = 8;

test('the Booking site chip shows RAC’s eight parks, and a park’s page lists its categories', async ({
  launchWaStay,
}) => {
  test.setTimeout(60_000);
  const wa = await launchWaStay({ providers: ['parkstay', 'rac'] });
  const { window } = wa;
  const results = window.getByRole('region', { name: 'Results' });
  await expect(
    results.getByRole('heading', { level: 2, name: `${ALL_PLACES} places` })
  ).toBeVisible({ timeout: CATALOGUE_TIMEOUT_MS });

  // Booking site → RAC Parks & Resorts: its 8 parks, each with RAC's badge
  const filters = window.getByRole('group', { name: 'Filters' });
  await filters.getByRole('button', { name: 'Booking site' }).click();
  const providers = window.getByRole('dialog', { name: 'Booking site' });
  await providers
    .getByRole('checkbox', { name: `RAC Parks & Resorts, ${RAC_PARKS} places` })
    .click();
  await providers.getByRole('button', { name: 'Done' }).click();
  await expect(filters.getByRole('button', { name: 'Booking site, 1 selected' })).toBeFocused();
  await expect(
    results.getByRole('heading', { level: 2, name: `${RAC_PARKS} places` })
  ).toBeVisible();
  const cards = results.getByRole('link');
  await expect(cards).toHaveCount(RAC_PARKS);
  for (let i = 0; i < RAC_PARKS; i++) {
    await expect(cards.nth(i).getByRole('img', { name: 'RAC Parks & Resorts' })).toBeVisible();
  }
  await expect(cards.getByRole('img', { name: 'ParkStay WA' })).toHaveCount(0);

  // RAC Margaret River Nature Park's page: its categories from its book-now page
  await results.getByRole('link', { name: 'RAC Margaret River Nature Park' }).click();
  await expectRoute(window, '/places/rac/margaret-river');
  await expect(
    window.getByRole('heading', { level: 1, name: 'RAC Margaret River Nature Park' })
  ).toBeVisible();
  // Dorms, a safari tent, a lodge and a site: units of several kinds are "spots" (R9), and
  // each is a category, a type of spot, not one spot
  const spots = window.getByRole('region', { name: 'Spots' });
  await expect(spots.getByText('Bookable as 5 spot types', { exact: true })).toBeVisible();
  await spots.getByRole('button', { name: 'Show all 5 spot types' }).click();
  for (const category of [
    'Dorm Room - Sleeps 26',
    'Dorm Room - Sleeps 5',
    'Modern Safari Tent',
    '4 Bedroom Eco Lodge',
    'Powered Site',
  ]) {
    await expect(spots.getByRole('listitem').filter({ hasText: category })).toBeVisible();
  }

  // Nothing left the fixture: no request was refused
  const requests = wa.unexpectedRequests();
  expect(withoutRemoteImages(requests)).toEqual([]);
  expect(withoutGuardedRequests(await wa.consoleErrors(), requests)).toEqual([]);
});
