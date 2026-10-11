/**
 * A snipe that holds a site (U2, V6), network-free: the profile is seeded before launch with a
 * HELD snipe at Bungarra and its `snipe_held` notification (`support/seed.ts`); no hold is ever
 * placed (architecture-notes §12.33). The bell's notification opens the snipe's page, which
 * shows the held site by its name, the time left to pay and "Pay now". The network guard
 * cancels ParkStay's payment page, so the payment window closes itself and the page says so.
 */

import { addDays, todayIn } from '../../src/shared/utils/calendar-date';
import { seedHeldSnipe } from './support/seed';
import { expect, test, withoutGuardedRequests, withoutRemoteImages } from './support/wa-stay';
import { expectHeadingFocused, expectRoute } from './support/shell';

const SNIPE_NAME = 'Bungarra school holidays';
const NOTICE_TITLE = 'Site held at Bungarra';
/** ParkStay's payment page (`holds.paymentUrl`), which the payment window opens. */
const PAYMENT_PAGE = 'https://parkstay.dbca.wa.gov.au/booking/';

test('a held snipe: its notification opens it, it shows the hold and countdown, and Pay now fails honestly', async ({
  launchWaStay,
}) => {
  const arrival = addDays(todayIn('Australia/Perth'), 40);
  let snipeId = 0;
  const wa = await launchWaStay({
    // ParkStay alone: its fixture is the "11 places" below, however many providers are built in
    providers: ['parkstay'],
    prepare: (userDataDir) => {
      ({ snipeId } = seedHeldSnipe(userDataDir, {
        snipe: {
          name: SNIPE_NAME,
          location: { externalId: '20', name: 'Bungarra', areaName: 'Kennedy Range National Park' },
          stay: { arrival, departure: addDays(arrival, 2), adults: 2 },
        },
        // Site 2 of the Bungarra fixture, held for another 20 minutes (a made-up reference).
        hold: {
          reference: 'E2E-HOLD-1',
          expiresAt: new Date(Date.now() + 20 * 60_000),
          unitId: '2',
        },
        notification: {
          title: NOTICE_TITLE,
          message: 'Site held at Bungarra. Complete payment within 20 minutes.',
        },
      }));
    },
  });
  const { window } = wa;

  // A profile that holds a site has its catalogue: wait for the first sync (5 s after launch,
  // V5), which also names the held site from the place's units.
  await expect(
    window.getByRole('region', { name: 'Results' }).getByRole('heading', { name: '11 places' })
  ).toBeVisible({ timeout: 20_000 });

  // The bell: one unread notification, which leads to the snipe.
  await window.getByRole('button', { name: 'Notifications, 1 unread' }).click();
  const list = window.getByRole('dialog', { name: 'Notifications' });
  await list.getByRole('link', { name: NOTICE_TITLE }).click();
  await expectRoute(window, `/site-sniper/${snipeId}`);
  await expectHeadingFocused(window, SNIPE_NAME);
  await expect(window.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();

  // The hold: the site by its own name (from the place's units), the time left, Pay now.
  const hold = window.getByRole('region', { name: 'Hold at Bungarra' });
  await expect(hold).toContainText(/^CAMPSITE 02 is held for you/i);
  const timer = hold.getByRole('timer', { name: /left to pay$/ });
  await expect(timer).toHaveText(/^(19|20):\d\d$/);
  await expect(hold).toContainText(/Held until (?:\w{3} \d{1,2} \w{3}, )?\d{1,2}:\d\d/);
  const payNow = hold.getByRole('button', { name: 'Pay now' });

  // Pay now: the DBCA queue answers from its fixture, then the network guard cancels the
  // payment page, so the payment window closes and the page says why. The hold stays.
  await payNow.click();
  await expect(
    window
      .getByRole('region', { name: 'Notifications' })
      .getByText(/^The payment page couldn't be opened\. ParkStay's page could not be loaded/)
  ).toBeVisible();
  await expect(payNow).toBeEnabled();
  await expect(timer).toBeVisible();

  const requests = wa.unexpectedRequests();
  expect(withoutGuardedRequests(await wa.consoleErrors(), requests)).toEqual([]);
  // The payment page is the only request the guard stopped (besides provider photos).
  expect(withoutRemoteImages(requests)).toEqual([
    expect.objectContaining({
      source: 'network-guard',
      url: PAYMENT_PAGE,
      resourceType: 'mainFrame',
    }),
  ]);
});
