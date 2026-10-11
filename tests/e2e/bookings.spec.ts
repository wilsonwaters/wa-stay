/**
 * Bookings in the built app (U3), network-free: bookings are seeded through the real preload,
 * IPC handler and SQLite database (`bookings.create`), then the Trips list and a booking's page
 * are used by role and accessible name only. Nothing is sent to any provider: "Manage on
 * ParkStay" is checked, never followed.
 */

import type { Page } from '@playwright/test';
import { expect, test, withoutGuardedRequests, withoutRemoteImages } from './support/wa-stay';
import { expectHeadingFocused, expectRoute, NAV_PAGES, navLink } from './support/shell';

interface SeedBooking {
  providerId: string;
  bookingReference: string;
  location: { externalId?: string; name: string; areaName?: string };
  stay: { arrival: string; departure: string; adults: number };
  unitIds?: string[];
  totalCost?: number;
}

/** `days` from today in Perth (the e2e run's zone), as `YYYY-MM-DD`. */
function perthDay(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' }).format(
    new Date()
  );
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function seed(window: Page, booking: SeedBooking) {
  return window.evaluate(
    (input) =>
      (
        globalThis as unknown as {
          api: { bookings: { create(i: unknown): Promise<{ success: boolean }> } };
        }
      ).api.bookings.create(input),
    booking
  );
}

test('lists seeded trips in tabs and opens one with its manage link, then removes it', async ({
  launchWaStay,
}) => {
  const wa = await launchWaStay();
  const { window } = wa;

  const bookings: SeedBooking[] = [
    {
      providerId: 'parkstay',
      bookingReference: 'PB0001234',
      location: { externalId: '20', name: 'Bungarra', areaName: 'Kennedy Range National Park' },
      stay: { arrival: perthDay(-1), departure: perthDay(1), adults: 2 },
      unitIds: ['7'],
      totalCost: 45,
    },
    {
      providerId: 'parkstay',
      bookingReference: 'PB0005678',
      location: { name: 'Dales Campground', areaName: 'Karijini National Park' },
      stay: { arrival: perthDay(-30), departure: perthDay(-27), adults: 4 },
    },
  ];
  for (const booking of bookings) {
    expect(await seed(window, booking)).toMatchObject({ success: true });
  }

  await navLink(window, NAV_PAGES.bookings.link).click();
  await expectHeadingFocused(window, 'Bookings');
  await expect(window.getByText('Bookings is still being finalised.')).toBeVisible();
  await expect(window.getByRole('button', { name: 'Add booking' })).toBeVisible();
  await expect(window.getByRole('button', { name: 'Import booking' })).toHaveCount(0);

  const upcoming = window.getByRole('tab', { name: 'Upcoming, 1 trip' });
  await expect(upcoming).toHaveAttribute('aria-selected', 'true');
  await expect(window.getByRole('tab', { name: 'Past, 1 trip' })).toBeVisible();
  await expect(window.getByRole('tab', { name: 'Cancelled, 0 trips' })).toBeVisible();
  const bungarra = window.getByRole('article', { name: 'Bungarra' });
  await expect(bungarra.getByText('Happening now')).toBeVisible();
  await expect(bungarra.getByRole('img', { name: 'ParkStay WA' })).toBeVisible();
  await expect(bungarra).toContainText('Ref PB0001234');

  // Past, by keyboard, kept in the URL.
  await upcoming.focus();
  await window.keyboard.press('ArrowRight');
  await expectRoute(window, '/bookings?tab=past');
  await expect(window.getByRole('article', { name: 'Dales Campground' })).toBeVisible();
  await window.getByRole('searchbox', { name: 'Search trips' }).fill('karijini');
  await expectRoute(window, '/bookings?tab=past&q=karijini');
  await window.reload();
  await expect(window.getByRole('article', { name: 'Dales Campground' })).toBeVisible();
  await expect(window.getByRole('tab', { name: 'Past, 1 trip' })).toHaveAttribute(
    'aria-selected',
    'true'
  );

  // The detail page. Each change lands in the address before the next one, so a slow machine
  // cannot have the tab's update bring the old search back.
  await window.getByRole('tab', { name: /^Upcoming/ }).click();
  await expectRoute(window, '/bookings?q=karijini');
  await window.getByRole('searchbox', { name: 'Search trips' }).fill('');
  await expectRoute(window, '/bookings');
  await window.getByRole('link', { name: 'Bungarra', exact: true }).click();
  await expect(window.getByRole('heading', { level: 1, name: 'Bungarra' })).toBeVisible();
  const manage = window.getByRole('link', { name: 'Manage on ParkStay (opens in your browser)' });
  await expect(manage).toHaveAttribute('href', 'https://parkstay.dbca.wa.gov.au/mybookings/');
  await expect(manage).toHaveAttribute('target', '_blank');
  await expect(manage).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(window.getByRole('link', { name: 'About Bungarra' })).toHaveAttribute(
    'href',
    '#/places/parkstay/20'
  );
  await expect(window.getByRole('region', { name: 'Cost' })).toContainText('$45.00');
  await expect(window.getByRole('button', { name: 'Copy reference PB0001234' })).toBeVisible();

  // The main window's session refuses every permission but the clipboard write that copying
  // needs (main-window.ts guardPermissions): copying works, and the reference is on the clipboard.
  const permissionStates = await window.evaluate(() =>
    Promise.all(
      (['clipboard-write', 'geolocation', 'notifications', 'camera'] as PermissionName[]).map(
        (name) => navigator.permissions.query({ name }).then((status) => `${name}: ${status.state}`)
      )
    )
  );
  expect(permissionStates).toEqual([
    'clipboard-write: granted',
    'geolocation: denied',
    'notifications: denied',
    'camera: denied',
  ]);
  await window.getByRole('button', { name: 'Copy reference PB0001234' }).click();
  await expect(window.getByText('Copied', { exact: true })).toBeVisible();
  expect(await wa.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('PB0001234');

  // Remove it from WA Stay (nothing changes at ParkStay).
  await window.getByRole('button', { name: 'More actions for Bungarra' }).click();
  await window.getByRole('menuitem', { name: 'Remove from WA Stay' }).click();
  const confirm = window.getByRole('alertdialog', { name: 'Remove Bungarra from WA Stay?' });
  await expect(confirm).toContainText('It does not cancel it on ParkStay.');
  await confirm.getByRole('button', { name: 'Remove from WA Stay' }).click();
  await expectRoute(window, '/bookings');
  await expect(
    window.getByRole('region', { name: 'Notifications' }).getByText('Removed Bungarra from WA Stay')
  ).toBeVisible();
  await expect(window.getByRole('tab', { name: 'Upcoming, 0 trips' })).toBeVisible();
  await expect(window.getByRole('article', { name: 'Bungarra' })).toHaveCount(0);

  const requests = wa.unexpectedRequests();
  expect(withoutGuardedRequests(await wa.consoleErrors(), requests)).toEqual([]);
  expect(withoutRemoteImages(requests)).toEqual([]);
});
