/**
 * Explore's free counts with ParkStay and RAC, network-free (R11): with both registered, the
 * person sets dates (tomorrow, for two nights, Perth) and two adults in Explore's search pill.
 * RAC's eight parks are each asked once (`fixtures/http/rac/`, every answer moved to those
 * nights by `support/dated-fixtures.ts`): each RAC card reads its free units with their noun
 * and no total ("51 spots free", RS12) beside ParkStay's "2 of 3 sites available". Stay type →
 * "Cabins & villas" counts only the cabins: Busselton's answer lists no cabin, so its card turns
 * to "No cabins open for these dates", Esperance's reads its six free cabins, and Cervantes',
 * whose villas are booked out, "No cabin free every night". Busselton's page counts the same
 * 51 for the stay ("51 spots free for all 2 nights", no "of M"), and lists its categories as
 * types ("Bookable as 6 spot types"), never as a count of spots. Fixture mode refuses no
 * request, and the window logs no errors. Roles and accessible names only.
 */

import { stayRangeLabel } from '../../src/renderer/components/nightGridModel';
import { addDays } from '../../src/shared/utils/calendar-date';
import { writeDatedFixtures } from './support/dated-fixtures';
import { currentRoute, expectRoute } from './support/shell';
import { expect, test, withoutGuardedRequests, withoutRemoteImages } from './support/wa-stay';

/** The catalogues sync 5 s after launch (V5); give them room on a slow runner. */
const CATALOGUE_TIMEOUT_MS = 30_000;
/** ParkStay's 11 campgrounds and RAC's 8 parks. */
const ALL_PLACES = 19;
/** ParkStay's 3 campgrounds with a site free, and RAC's 8 parks, each with a spot free. */
const AVAILABLE = 11;

test('RAC parks read their free spots beside ParkStay’s “N of M”, and Stay type counts only cabins', async ({
  launchWaStay,
  tempDir,
}) => {
  test.setTimeout(90_000);
  const fixtures = writeDatedFixtures(tempDir('rac-explore'), { arrivalInDays: 1 });
  const { arrival } = fixtures;
  const departure = addDays(arrival, 2);
  const wa = await launchWaStay({
    providers: ['parkstay', 'rac'],
    env: { WA_STAY_E2E_FIXTURES_DIR: fixtures.dir },
  });
  const { window } = wa;
  const results = window.getByRole('region', { name: 'Results' });
  await expect(
    results.getByRole('heading', { level: 2, name: `${ALL_PLACES} places` })
  ).toBeVisible({ timeout: CATALOGUE_TIMEOUT_MS });

  // 1. When: tomorrow, for two nights, from the search pill's calendar. Each step waits for the
  // calendar's answer, as a person would.
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
  await expectRoute(window, `/?arrival=${arrival}&departure=${departure}`);

  // 2. Who: two adults (RAC's answer depends on the party)
  await window.getByRole('button', { name: 'Who Add guests' }).click();
  const guests = window.getByRole('dialog', { name: 'Choose guests' });
  await guests.getByRole('button', { name: 'Increase adults' }).click();
  await guests.getByRole('button', { name: 'Done' }).click();
  await expect(window.getByRole('button', { name: 'Who 2 adults' })).toBeVisible();
  await expect.poll(() => currentRoute(window)).toMatch(/[?&]adults=2(&|$)/);

  // 3. Both providers' counts
  const range = stayRangeLabel(arrival, departure);
  await expect(
    results.getByRole('heading', {
      level: 2,
      name: `${ALL_PLACES} places · ${AVAILABLE} available for ${range}`,
    })
  ).toBeVisible({ timeout: 20_000 });
  const card = (name: string) => results.getByRole('link', { name, exact: true });
  // The card is a link named by the place; its description says the free count and its noun
  const busselton = card('RAC Busselton Holiday Park');
  await expect(busselton).toHaveAccessibleDescription(/51 spots free/);
  await expect(busselton).not.toHaveAccessibleDescription(/\b\d+ of \d+\b/);
  await expect(busselton.getByText('51 spots free', { exact: true })).toBeVisible();
  await expect(card('RAC Monkey Mia Dolphin Resort')).toHaveAccessibleDescription(/75 spots free/);
  await expect(card('RAC Margaret River Nature Park')).toHaveAccessibleDescription(/2 spots free/);
  // ParkStay keeps its total
  await expect(card('Bungarra')).toHaveAccessibleDescription(/2 of 3 sites available/);

  // 4. Stay type → Cabins & villas: a named chip whose options are checkboxes
  const filters = window.getByRole('group', { name: 'Filters' });
  await filters.getByRole('button', { name: 'Stay type' }).click();
  const stayType = window.getByRole('dialog', { name: 'Stay type' });
  const cabins = stayType.getByRole('checkbox', { name: /^Cabins & villas, \d+ places$/ });
  await expect(cabins).not.toBeChecked();
  await cabins.click();
  await expect(cabins).toBeChecked();
  await stayType.getByRole('button', { name: 'Done' }).click();
  await expect(filters.getByRole('button', { name: 'Stay type, 1 selected' })).toBeFocused();
  await expect.poll(() => currentRoute(window)).toMatch(/[?&]stay=cabin(&|$)/);
  // Busselton's answer lists no cabin: from its spots to its cabins, none of which is open
  await expect(busselton).toHaveAccessibleDescription(/No cabins open for these dates/);
  await expect(busselton).not.toHaveAccessibleDescription(/spots free/);
  await expect(card('RAC Esperance Holiday Park')).toHaveAccessibleDescription(/6 cabins free/);
  // Cervantes' villas are booked out: none free, not "not open"
  await expect(card('RAC Cervantes Holiday Park')).toHaveAccessibleDescription(
    /No cabin free every night/
  );

  // 5. Busselton's page, for the same stay: the same 51 as its card, and no total
  await busselton.click();
  await expect.poll(() => currentRoute(window)).toMatch(/^\/places\/rac\/busselton\?/);
  await window
    .getByRole('region', { name: 'Check your dates' })
    .getByRole('button', { name: 'Check availability' })
    .click();
  const availability = window.getByRole('region', { name: 'Availability', exact: true });
  await expect(
    availability.getByText('51 spots free for all 2 nights', { exact: true })
  ).toBeVisible({ timeout: 20_000 });
  await expect(availability.getByText(/\b\d+ of \d+ spots free/)).toHaveCount(0);
  // Its categories are types of spot, not a count of spots beside the 51 free
  const spots = window.getByRole('region', { name: 'Spots', exact: true });
  await expect(spots.getByText('Bookable as 6 spot types', { exact: true })).toBeVisible();
  await expect(spots.getByRole('button', { name: 'Show all 6 spot types' })).toBeVisible();
  await expect(spots.getByText(/^\d+ spots$/)).toHaveCount(0);

  // Nothing left the fixtures, and the window logged no errors
  const requests = wa.unexpectedRequests();
  expect(withoutRemoteImages(requests)).toEqual([]);
  expect(withoutGuardedRequests(await wa.consoleErrors(), requests)).toEqual([]);
});
