/**
 * An RAC cancellation watch end to end (R10), network-free: with ParkStay and RAC registered, a
 * prefilled link opens a new watch at RAC Busselton Holiday Park for two nights, 7 and 8 days
 * ahead (Perth); the person chooses "Camping" as the stay type and creates it, then presses
 * "Check now". RAC's trimmed availability answer (`fixtures/http/rac/`, moved to those nights
 * by `support/dated-fixtures.ts`) frees the powered site, so the watch page shows the night grid
 * and "Book on RAC", whose link is RAC's booking page for the powered site, never its cart. The
 * link is never followed. Fixture mode refuses no request.
 */

import { addDays } from '../../src/shared/utils/calendar-date';
import { writeDatedFixtures } from './support/dated-fixtures';
import { expectCurrentStep, expectHeadingFocused } from './support/shell';
import { expect, test, withoutGuardedRequests, withoutRemoteImages } from './support/wa-stay';

/** The catalogues sync 5 s after launch (V5); give them room on a slow runner. */
const CATALOGUE_TIMEOUT_MS = 30_000;
/** ParkStay's 11 campgrounds and RAC's 8 parks. */
const ALL_PLACES = 19;

test('an RAC watch for camping at Busselton finds the powered site and links to RAC’s booking page', async ({
  launchWaStay,
  tempDir,
}) => {
  test.setTimeout(90_000);
  const fixtures = writeDatedFixtures(tempDir('rac-dated'));
  const { arrival } = fixtures;
  const departure = addDays(arrival, 2);
  const wa = await launchWaStay({
    providers: ['parkstay', 'rac'],
    env: { WA_STAY_E2E_FIXTURES_DIR: fixtures.dir },
  });
  const { window } = wa;

  // The catalogues are in (the watch flow finds the park in RAC's)
  await expect(
    window
      .getByRole('region', { name: 'Results' })
      .getByRole('heading', { level: 2, name: `${ALL_PLACES} places` })
  ).toBeVisible({ timeout: CATALOGUE_TIMEOUT_MS });

  // 1. A prefilled link: RAC, Busselton, the dates and two adults
  await window.evaluate((hash) => {
    location.hash = hash;
  }, `#/watches/new?provider=rac&location=busselton&arrival=${arrival}&departure=${departure}&adults=2`);
  await expectHeadingFocused(window, 'New watch');
  const steps = window.getByRole('navigation', { name: 'New watch steps' });
  await expectCurrentStep(steps, 'Your stay');
  await expect(steps.getByRole('button', { name: 'Provider, done' })).toBeVisible();

  // 2. Your stay: camping, from RAC's categories at Busselton (sites and cabins)
  const stayType = window.getByRole('group', { name: 'Stay type' });
  const camping = stayType.getByRole('button', { name: 'Camping' });
  await camping.click();
  await expect(camping).toHaveAttribute('aria-pressed', 'true');
  // RAC's own stay field: no pets unless the person adds them
  await expect(window.getByRole('group', { name: 'Pets' }).getByRole('status')).toHaveText('0');
  await window.getByRole('button', { name: 'Continue' }).click();

  // 3. Alerts: RAC holds nothing, so no automatic hold is offered
  await expect(window.getByRole('heading', { level: 2, name: /Alerts$/ })).toBeFocused();
  await expect(window.getByRole('checkbox', { name: /automatically/ })).toHaveCount(0);
  await window.getByRole('button', { name: 'Continue' }).click();

  // 4. Review and create
  await expect(window.getByRole('heading', { level: 2, name: /Review$/ })).toBeFocused();
  const name = await window.getByRole('textbox', { name: 'Name' }).inputValue();
  expect(name).toMatch(/^RAC Busselton Holiday Park · /);
  await window.getByRole('button', { name: 'Create watch' }).click();
  await expect
    .poll(() => window.evaluate(() => document.location.hash))
    .toMatch(/^#\/watches\/\d+$/);
  await expect(window.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(window.getByRole('img', { name: 'RAC Parks & Resorts' }).first()).toBeVisible();

  // 5. Check now: the night grid, and RAC's booking page for the powered site
  await window.getByRole('button', { name: 'Check now' }).click();
  await expect(window.getByRole('table', { name: /^Availability by night, / })).toBeVisible();
  const book = window.getByRole('link', { name: 'Book on RAC (opens in your browser)' });
  await expect(book).toBeVisible();
  const href = await book.getAttribute('href');
  expect(href).toMatch(/^https:\/\/parksandresorts\.rac\.com\.au\/busselton\/booking\/\?/);
  const query = new URL(href!).searchParams;
  expect(query.get('force_category_id')).toBe('4');
  expect([query.get('available_from'), query.get('available_to')]).toEqual([arrival, departure]);
  expect(href).not.toMatch(/cart|rest_api_data_id/);

  // Nothing left the fixtures, and the window logged no errors
  const requests = wa.unexpectedRequests();
  expect(withoutRemoteImages(requests)).toEqual([]);
  expect(withoutGuardedRequests(await wa.consoleErrors(), requests)).toEqual([]);
});
