/**
 * RAC Parks & Resorts on Explore, network-free: with ParkStay and RAC registered, the Provider
 * chip's "RAC Parks & Resorts" leaves RAC's eight open parks (its seed: the catalogue sync
 * sends nothing), each card with RAC's badge. RAC Margaret River Nature Park's page lists its
 * categories (its dorms and its safari tent) from the trimmed book-now page in
 * `tests/e2e/fixtures/http/rac/`. Fixture mode refuses no request.
 */

import { expect, test, withoutGuardedRequests, withoutRemoteImages } from './support/wa-stay';
import { expectRoute } from './support/shell';

/** The catalogues sync 5 s after launch (V5); give them room on a slow runner. */
const CATALOGUE_TIMEOUT_MS = 30_000;
/** ParkStay's 11 campgrounds and RAC's 8 parks. */
const ALL_PLACES = 19;
const RAC_PARKS = 8;

test('the Provider chip shows RAC’s eight parks, and a park’s page lists its categories', async ({
  launchWaStay,
}) => {
  test.setTimeout(60_000);
  const wa = await launchWaStay({ providers: ['parkstay', 'rac'] });
  const { window } = wa;
  const results = window.getByRole('region', { name: 'Results' });
  await expect(
    results.getByRole('heading', { level: 2, name: `${ALL_PLACES} places` })
  ).toBeVisible({ timeout: CATALOGUE_TIMEOUT_MS });

  // Provider → RAC Parks & Resorts: its 8 parks, each with RAC's badge
  const filters = window.getByRole('group', { name: 'Filters' });
  await filters.getByRole('button', { name: 'Provider' }).click();
  const providers = window.getByRole('dialog', { name: 'Provider' });
  await providers
    .getByRole('checkbox', { name: `RAC Parks & Resorts, ${RAC_PARKS} places` })
    .click();
  await providers.getByRole('button', { name: 'Done' }).click();
  await expect(filters.getByRole('button', { name: 'Provider, 1 selected' })).toBeFocused();
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
  const sites = window.getByRole('region', { name: 'Sites' });
  await sites.getByRole('button', { name: 'Show all 5 sites' }).click();
  for (const category of [
    'Dorm Room - Sleeps 26',
    'Dorm Room - Sleeps 5',
    'Modern Safari Tent',
    '4 Bedroom Eco Lodge',
    'Powered Site',
  ]) {
    await expect(sites.getByRole('listitem').filter({ hasText: category })).toBeVisible();
  }

  // Nothing left the fixture: no request was refused
  const requests = wa.unexpectedRequests();
  expect(withoutRemoteImages(requests)).toEqual([]);
  expect(withoutGuardedRequests(await wa.consoleErrors(), requests)).toEqual([]);
});
