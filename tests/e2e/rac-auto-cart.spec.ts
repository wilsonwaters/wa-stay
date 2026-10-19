/**
 * RAC's auto-cart (R19), network-free, with ParkStay and RAC registered. It ships off: no cart
 * is ever created, and RAC's e2e fixtures have no route for a cart address, the cart page,
 * NewBook's proxy or its card store.
 *
 * 1. Off, nothing holds: RAC's watch form offers no automatic hold. In Settings → Accounts,
 *    RAC's row turns on "Put stays in my RAC cart automatically", which asks first with its
 *    warning; it takes effect after a restart (as `lifecycle.spec.ts` relaunches on the same
 *    profile): the switch reads on, the row suggests adding a member number before a release,
 *    and RAC's watch form offers the automatic hold, with the equipment a site needs.
 * 2. A launch seeded with the experiment on and a held RAC watch (a made-up reference; no cart
 *    is created): the watch's page shows the hold, "about" its expiry, "Pay now" and "Let it
 *    go". "Pay now" opens RAC's cart page, which the network guard cancels, so the window closes
 *    and the page says so; a first page that failed lets nothing go, so the hold stays.
 *
 * No request, guarded or refused by fixtures, carries a cart address or its token, and none
 * goes to NewBook's card store. Each step's screenshot is attached to the report.
 */

import type { Page, TestInfo } from '@playwright/test';
import { addDays, todayIn } from '../../src/shared/utils/calendar-date';
import type { UnexpectedRequest } from '../../src/main/testing/request-log';
import { seedHeldWatch } from './support/seed';
import {
  chooseAccountMenuItem,
  currentRoute,
  expectCurrentStep,
  expectHeadingFocused,
} from './support/shell';
import {
  expect,
  test,
  within,
  withoutGuardedRequests,
  withoutRemoteImages,
} from './support/wa-stay';

/** The catalogues sync 5 s after launch (V5); give them room on a slow runner. */
const CATALOGUE_TIMEOUT_MS = 30_000;
/** ParkStay's 11 campgrounds and RAC's 8 parks. */
const ALL_PLACES = 19;
const SWITCH = 'Put stays in my RAC cart automatically';
const DIALOG = `Turn on ${SWITCH}?`;
const RAC_ROW_PURPOSE =
  'Optional. Add your RAC member number before a release if you have one. Holds work without it.';
/** RAC's cart page for Busselton: what "Pay now" opens (never a cart address). */
const CART_PAGE = 'https://parksandresorts.rac.com.au/busselton/booking/';

async function screenshot(window: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = testInfo.outputPath(`${name}.png`);
  await window.screenshot({ path: file, fullPage: true });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}

/** No request carries a cart address or its token, or went to NewBook's card store. */
function expectNoCart(requests: readonly UnexpectedRequest[]): void {
  for (const request of requests) {
    expect(request.url).not.toMatch(/cart&|[?&]cart\b|rest_api_data_id|newbook\.cloud\/cc_secure/);
    expect(request.url).not.toContain('apiau.newbook.cloud');
  }
}

async function waitForCatalogues(window: Page): Promise<void> {
  await expect(
    window
      .getByRole('region', { name: 'Results' })
      .getByRole('heading', { level: 2, name: `${ALL_PLACES} places` })
  ).toBeVisible({ timeout: CATALOGUE_TIMEOUT_MS });
}

/** RAC's row in Settings → Accounts. */
async function racRow(window: Page) {
  await chooseAccountMenuItem(window, 'Settings');
  return window
    .getByRole('list', { name: 'Booking site accounts' })
    .getByRole('listitem')
    .filter({ has: window.getByRole('heading', { level: 3, name: 'RAC Parks & Resorts' }) });
}

/** A new RAC watch at Busselton, prefilled, up to its Alerts step, camping chosen. */
async function watchFormAlerts(window: Page, arrival: string): Promise<void> {
  await window.evaluate(
    (hash) => {
      location.hash = hash;
    },
    `#/watches/new?provider=rac&location=busselton&arrival=${arrival}&departure=${addDays(arrival, 2)}&adults=2`
  );
  await expectHeadingFocused(window, 'New watch');
  const steps = window.getByRole('navigation', { name: 'New watch steps' });
  await expectCurrentStep(steps, 'Your stay');
  const camping = window.getByRole('group', { name: 'Stay type' }).getByRole('button', {
    name: 'Camping',
  });
  await camping.click();
  await expect(camping).toHaveAttribute('aria-pressed', 'true');
  await window.getByRole('button', { name: 'Continue' }).click();
  await expect(window.getByRole('heading', { level: 2, name: /Alerts$/ })).toBeFocused();
}

test('auto-cart: off, nothing holds; turned on in Settings, it takes effect after a restart, and the RAC watch form offers the automatic hold', async ({
  launchWaStay,
}, testInfo) => {
  test.setTimeout(150_000);
  const arrival = addDays(todayIn('Australia/Perth'), 30);
  const first = await launchWaStay({ providers: ['parkstay', 'rac'] });
  await waitForCatalogues(first.window);

  // Off: RAC holds nothing, so its watch form offers no automatic hold
  await watchFormAlerts(first.window, arrival);
  await expect(first.window.getByRole('checkbox', { name: /automatically/ })).toHaveCount(0);

  // Settings → Accounts: the Experimental switch, off, shown to everyone
  let row = await racRow(first.window);
  let toggle = row.getByRole('switch', { name: SWITCH });
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toHaveAccessibleDescription(/adds it to your RAC cart/);
  await expect(row.getByText('Optional.', { exact: true })).toBeVisible();
  await screenshot(first.window, testInfo, 'settings-rac-auto-cart-off');

  // Turning it on asks first, with its warning
  await toggle.click();
  const dialog = first.window.getByRole('alertdialog', { name: DIALOG });
  await expect(dialog).toContainText(
    'Experimental: not yet checked with a real booking. A cart is not a booking: only a paid booking secures your stay.'
  );
  await expect(dialog).toContainText('Takes effect when WA Stay restarts.');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await screenshot(first.window, testInfo, 'settings-rac-auto-cart-confirm');
  await dialog.getByRole('button', { name: 'Turn on' }).click();
  await expect(dialog).toBeHidden();
  await expect(toggle).toBeChecked();
  await expect(row.getByText('Turns on when WA Stay restarts.')).toBeVisible();
  await screenshot(first.window, testInfo, 'settings-rac-auto-cart-pending');

  // Not before the restart: still no automatic hold in this run
  await watchFormAlerts(first.window, arrival);
  await expect(first.window.getByRole('checkbox', { name: /automatically/ })).toHaveCount(0);
  const firstRequests = first.unexpectedRequests();
  expect(withoutRemoteImages(firstRequests)).toEqual([]);
  expectNoCart(firstRequests);
  expect(await within(first.close(), 10_000, 'Quitting WA Stay')).toBe(0);

  // The restart: the switch reads on, nothing pending, and the row suggests a member number
  const second = await launchWaStay({
    providers: ['parkstay', 'rac'],
    userDataDir: first.userDataDir,
  });
  await waitForCatalogues(second.window);
  row = await racRow(second.window);
  toggle = row.getByRole('switch', { name: SWITCH });
  await expect(toggle).toBeChecked();
  await expect(row.getByText(/^Turns (on|off) when WA Stay restarts\.$/)).toHaveCount(0);
  await expect(row.getByText(RAC_ROW_PURPOSE)).toBeVisible();
  await screenshot(second.window, testInfo, 'settings-rac-auto-cart-on');

  // RAC's watch form now offers the automatic hold, with the equipment a site needs
  await watchFormAlerts(second.window, arrival);
  const hold = second.window.getByRole('checkbox', {
    name: 'Hold a site automatically when found',
  });
  await expect(hold).not.toBeChecked();
  await expect(
    second.window.getByRole('link', { name: 'add your RAC member number in Settings' })
  ).toBeVisible();
  await hold.check();
  await expect(second.window.getByRole('combobox', { name: /^Equipment/ })).toHaveValue('');
  await expect(
    second.window.getByRole('textbox', { name: /Equipment length \(metres\)/ })
  ).toBeVisible();
  await expect(
    second.window.getByRole('textbox', { name: /Equipment width \(metres\)/ })
  ).toBeVisible();
  await screenshot(second.window, testInfo, 'watch-form-rac-auto-cart');
  expect(await currentRoute(second.window)).toMatch(/^\/watches\/new\?/);

  const requests = second.unexpectedRequests();
  expect(withoutRemoteImages(requests)).toEqual([]);
  expectNoCart(requests);
  expect(withoutGuardedRequests(await second.consoleErrors(), requests)).toEqual([]);
});

test('a held RAC cart (seeded): "Pay now" reaches only the guarded cart page, and the hold stays', async ({
  launchWaStay,
}, testInfo) => {
  test.setTimeout(90_000);
  const arrival = addDays(todayIn('Australia/Perth'), 30);
  const name = 'Busselton cart';
  let watchId = 0;
  const wa = await launchWaStay({
    providers: ['parkstay', 'rac'],
    prepare: (userDataDir) => {
      ({ watchId } = seedHeldWatch(userDataDir, {
        // Auto-cart on, as Settings → Accounts stores it
        experiments: { autoCart: true },
        watch: {
          providerId: 'rac',
          name,
          location: { externalId: 'busselton', name: 'RAC Busselton Holiday Park' },
          stay: { arrival, departure: addDays(arrival, 2), adults: 2 },
          unitKinds: ['campsite'],
          checkIntervalMinutes: 15,
          autoHold: true,
          stayParams: {
            pets: 0,
            equipmentType: '1',
            equipmentLength: '6.5',
            equipmentWidth: '2.5',
          },
        },
        // A made-up reference: no cart was created, and none is
        hold: {
          reference: `rac-cart:busselton:${arrival}:e2e0e2e0`,
          expiresAt: new Date(Date.now() + 20 * 60_000),
          expiresEstimated: true,
          unitId: 'cat:4',
          paymentUrl: CART_PAGE,
        },
      }));
    },
  });
  const { window } = wa;
  await waitForCatalogues(window);

  await window.evaluate((hash) => {
    location.hash = hash;
  }, `#/watches/${watchId}`);
  await expect.poll(() => currentRoute(window)).toBe(`/watches/${watchId}`);
  await expect(window.getByRole('heading', { level: 1, name })).toBeVisible();

  // The hold: "about" its expiry (RAC's cart shows no countdown), Pay now and Let it go
  const panel = window.getByRole('region', { name: 'Hold at RAC Busselton Holiday Park' });
  await expect(panel).toContainText(/Held until about /);
  const payNow = panel.getByRole('button', { name: 'Pay now' });
  const letGo = panel.getByRole('button', { name: 'Let it go' });
  await expect(payNow).toBeEnabled();
  await expect(letGo).toBeEnabled();
  await screenshot(window, testInfo, 'watch-rac-cart-held');

  // Pay now: RAC's cart page, which the network guard cancels; the page says so
  await payNow.click();
  await expect(
    window
      .getByRole('region', { name: 'Notifications' })
      .getByText(/RAC's page could not be loaded/)
  ).toBeVisible();
  await screenshot(window, testInfo, 'watch-rac-cart-pay-now-guarded');
  // A first page that failed lets nothing go: the hold stays
  await expect(payNow).toBeEnabled();
  await expect(letGo).toBeVisible();
  await expect(panel).toContainText(/Held until about /);

  const requests = wa.unexpectedRequests();
  expect(withoutGuardedRequests(await wa.consoleErrors(), requests)).toEqual([]);
  // The cart page is the only request stopped (besides provider photos): nothing let go
  expect(withoutRemoteImages(requests)).toEqual([
    expect.objectContaining({ source: 'network-guard', url: CART_PAGE, resourceType: 'mainFrame' }),
  ]);
  expectNoCart(requests);
});
