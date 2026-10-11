/**
 * Navigation: the primary nav and the account menu reach every page, by role and name. The
 * current nav item has `aria-current="page"`, and after each page change focus is on the
 * page's `h1`, or on `main` when the page has none (D3, docs/design/shell.md).
 */

import fs from 'fs';
import path from 'path';
import { expect, test } from './support/wa-stay';
import {
  accountMenuButton,
  chooseAccountMenuItem,
  expectCurrentNavLink,
  expectHeadingFocused,
  expectRoute,
  NAV_PAGES,
  navLink,
} from './support/shell';
import { REPO_ROOT } from './support/paths';

const { version } = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
  version: string;
};

test.describe('primary navigation', () => {
  test('Watches and Site Sniper open their pages; Explore leads back', async ({ launchWaStay }) => {
    const { window } = await launchWaStay();

    for (const page of [NAV_PAGES.watches, NAV_PAGES.snipes, NAV_PAGES.explore]) {
      await navLink(window, page.link).click();
      await expectRoute(window, page.route);
      await expectCurrentNavLink(window, page.link);
      await expectHeadingFocused(window, page.heading);
    }
  });

  test('Bookings opens its page as the current item, with "Add booking"', async ({
    launchWaStay,
  }) => {
    const { window } = await launchWaStay();

    await navLink(window, NAV_PAGES.bookings.link).click();
    await expectRoute(window, NAV_PAGES.bookings.route);
    await expectCurrentNavLink(window, NAV_PAGES.bookings.link);
    await expect(window.getByRole('button', { name: 'Add booking' })).toBeVisible();
  });

  test('the Bookings page has the h1 "Bookings"', async ({ launchWaStay }) => {
    const { window } = await launchWaStay();

    await navLink(window, NAV_PAGES.bookings.link).click();
    await expectHeadingFocused(window, NAV_PAGES.bookings.heading);
  });

  test('keyboard only: Tab into the nav, Enter opens Watches', async ({ launchWaStay }) => {
    const { window } = await launchWaStay();

    // The skip link is the first Tab stop, then the logo, then the nav
    for (const link of ['Skip to content', 'WA Stay, Explore']) {
      await window.keyboard.press('Tab');
      await expect(window.getByRole('link', { name: link, exact: true })).toBeFocused();
    }
    for (const page of [NAV_PAGES.explore, NAV_PAGES.watches]) {
      await window.keyboard.press('Tab');
      await expect(navLink(window, page.link)).toBeFocused();
    }
    await window.keyboard.press('Enter');

    await expectRoute(window, NAV_PAGES.watches.route);
    await expectCurrentNavLink(window, NAV_PAGES.watches.link);
    await expectHeadingFocused(window, NAV_PAGES.watches.heading);
  });
});

test.describe('account menu', () => {
  test('Settings opens Settings, where no nav item is current', async ({ launchWaStay }) => {
    const { window } = await launchWaStay();

    await chooseAccountMenuItem(window, 'Settings');

    // `/settings` opens its first section
    await expectRoute(window, '/settings/accounts');
    await expectHeadingFocused(window, 'Settings');
    await expectCurrentNavLink(window, null);
  });

  test('About WA Stay shows the version from the main process; Done returns focus', async ({
    launchWaStay,
  }) => {
    const { window } = await launchWaStay();

    await chooseAccountMenuItem(window, 'About WA Stay');

    const dialog = window.getByRole('dialog', { name: 'About WA Stay' });
    await expect(dialog).toBeVisible();
    // Answered over IPC by the main process (app:get-info), through the sandboxed preload
    await expect(dialog.getByText(`Version ${version}`, { exact: true })).toBeVisible();
    const done = dialog.getByRole('button', { name: 'Done' });
    await expect(done).toBeFocused();

    await window.keyboard.press('Enter');

    await expect(dialog).toBeHidden();
    await expect(accountMenuButton(window)).toBeFocused();
  });
});
