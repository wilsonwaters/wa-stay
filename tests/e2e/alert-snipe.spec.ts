/**
 * A snipe that alerts (R13, RS9), network-free. The profile is seeded with one ParkStay snipe at
 * Bungarra that alerts, armed and watching for cancellations, for two nights 7 days ahead
 * (`support/seed.ts`: only the snipe row). The app's own scheduler checks Bungarra at once;
 * its availability answer (`fixtures/http/parkstay`, moved to those nights by
 * `support/dated-fixtures.ts`) has sites 3 to 5 free, so the app itself records the alert and
 * sends its `snipe_alert` notification. The bell's notification opens the snipe, whose panel
 * names the site and offers "Book on ParkStay", a link to ParkStay's own booking page that is
 * never followed. Then a new snipe is created with "Alert me" and a scheduled release two weeks
 * away, as `create-snipe.spec.ts` does, and its page reads "When free: Alert me". Nothing is
 * ever held (architecture-notes §12.33), and fixture mode refuses no request.
 */

import { addDays, todayIn } from '../../src/shared/utils/calendar-date';
import { writeDatedFixtures } from './support/dated-fixtures';
import { seedAlertSnipe } from './support/seed';
import { expect, test, withoutGuardedRequests, withoutRemoteImages } from './support/wa-stay';
import {
  expectCurrentStep,
  expectHeadingFocused,
  expectRoute,
  NAV_PAGES,
  navLink,
} from './support/shell';

const SNIPE_NAME = 'Bungarra cancellation';
const NOTICE_TITLE = 'A site is free at Bungarra';
/** The first site the moved Bungarra fixture has free for both nights. */
const FREE_SITE = 'CAMPSITE 03';
/** The catalogue syncs 5 s after launch (V5); give it room on a slow runner. */
const CATALOGUE_TIMEOUT_MS = 30_000;

test('an alert snipe: the app alerts on a free site, its notification opens "Book on ParkStay"; a new snipe can alert too', async ({
  launchWaStay,
  tempDir,
}) => {
  test.setTimeout(120_000);
  const fixtures = writeDatedFixtures(tempDir('alert-dated'));
  const { arrival } = fixtures;
  const departure = addDays(arrival, 2);
  let snipeId = 0;
  const wa = await launchWaStay({
    // ParkStay alone: the only provider with Site Sniper, however many are built in
    providers: ['parkstay'],
    env: { WA_STAY_E2E_FIXTURES_DIR: fixtures.dir },
    prepare: (userDataDir) => {
      ({ snipeId } = seedAlertSnipe(userDataDir, {
        snipe: {
          name: SNIPE_NAME,
          location: { externalId: '20', name: 'Bungarra', areaName: 'Kennedy Range National Park' },
          stay: { arrival, departure, adults: 2 },
        },
      }));
    },
  });
  const { window } = wa;

  // 1. The app's alert: one unread notification, which leads to the snipe
  const bell = window.getByRole('button', { name: 'Notifications, 1 unread' });
  await expect(bell).toBeVisible({ timeout: 20_000 });
  await bell.click();
  const notices = window.getByRole('dialog', { name: 'Notifications' });
  await notices.getByRole('link', { name: NOTICE_TITLE }).click();
  await expectRoute(window, `/site-sniper/${snipeId}`);
  await expectHeadingFocused(window, SNIPE_NAME);

  // 2. What was free, and ParkStay's own booking page for the stay (never followed)
  const panel = window.getByRole('region', { name: `${FREE_SITE} was free` });
  await expect(panel).toContainText(/Alert sent \d{1,2}:\d\d [ap]m AWST/);
  await expect(panel).toContainText('Nothing is held, so book it on ParkStay');
  const book = panel.getByRole('link', { name: 'Book on ParkStay (opens in your browser)' });
  await expect(book).toBeVisible();
  const href = new URL((await book.getAttribute('href')) ?? '');
  expect(href.protocol).toBe('https:');
  expect(href.host).toBe('parkstay.dbca.wa.gov.au');
  expect(href.searchParams.get('campground_id')).toBe('20');
  expect(href.searchParams.get('arrival')).toBe(arrival.replaceAll('-', '/'));
  await expect(panel.getByRole('button', { name: 'Arm again' })).toBeVisible();
  await expect(window.getByRole('list', { name: 'Progress' })).toContainText('Alert sent');

  // 3. A new snipe that alerts: a scheduled release two weeks away, before a stay two months
  //    out, so nothing is tried while the test runs
  await navLink(window, NAV_PAGES.snipes.link).click();
  await expectHeadingFocused(window, NAV_PAGES.snipes.heading);
  await expect(window.getByRole('article', { name: SNIPE_NAME })).toBeVisible();
  await window.getByRole('link', { name: 'New snipe' }).click();
  await expectRoute(window, '/site-sniper/new');
  const steps = window.getByRole('navigation', { name: 'New snipe steps' });
  await expectCurrentStep(steps, 'Booking site');
  await expect(window.getByRole('radio', { name: 'ParkStay WA' })).toBeChecked();
  await window.getByRole('button', { name: 'Continue' }).click();

  const location = window.getByRole('combobox', { name: 'Location' });
  const bungarra = window.getByRole('option', { name: /Bungarra/ });
  await expect(async () => {
    await location.fill('');
    await location.fill('Bung');
    await expect(bungarra).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: CATALOGUE_TIMEOUT_MS });
  await bungarra.click();
  await window.getByRole('button', { name: 'Continue' }).click();

  await expect(window.getByRole('heading', { level: 2, name: /Your stay$/ })).toBeFocused();
  await window.getByRole('button', { name: /^Dates/ }).click();
  for (const key of ['PageDown', 'PageDown', 'Enter', 'ArrowRight', 'ArrowRight', 'Enter']) {
    await window.keyboard.press(key);
  }
  await window
    .getByRole('dialog', { name: 'Choose dates' })
    .getByRole('button', { name: 'Done' })
    .click();
  await window.getByRole('button', { name: 'Continue' }).click();

  await expect(
    window.getByRole('heading', { level: 2, name: /Release and timing$/ })
  ).toBeFocused();
  const modes = window.getByRole('radiogroup', { name: 'When are the sites released?' });
  await modes.getByText('At a scheduled time', { exact: true }).click();
  await window.getByLabel('Release date').fill(addDays(todayIn('Australia/Perth'), 14));
  await window.getByLabel(/^Release time/).fill('10:00');
  // ParkStay holds by default; this snipe alerts instead
  const whenFree = window.getByRole('radiogroup', { name: 'When the dates are free' });
  await expect(whenFree.getByRole('radio', { name: 'Hold it for me' })).toBeChecked();
  await whenFree.getByText('Alert me', { exact: true }).click();
  await expect(whenFree.getByRole('radio', { name: 'Alert me' })).toBeChecked();
  await window.getByRole('button', { name: 'Continue' }).click();

  await expect(window.getByRole('heading', { level: 2, name: /Review$/ })).toBeFocused();
  await expect(window.getByRole('region', { name: 'Release' })).toContainText(
    /When the dates are free\s*Alert me/
  );
  const name = await window.getByRole('textbox', { name: 'Name' }).inputValue();
  await window.getByRole('button', { name: 'Create snipe' }).click();

  await expect
    .poll(() => window.evaluate(() => document.location.hash))
    .toMatch(/^#\/site-sniper\/\d+$/);
  await expect(window.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(window.getByRole('region', { name: 'Release' })).toContainText(
    /When free\s*Alert me/
  );
  await expect(window.getByRole('timer', { name: /^Opens in/ })).toBeVisible();

  const requests = wa.unexpectedRequests();
  expect(withoutGuardedRequests(await wa.consoleErrors(), requests)).toEqual([]);
  expect(withoutRemoteImages(requests)).toEqual([]);
});
