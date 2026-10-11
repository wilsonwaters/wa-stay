/**
 * Lifecycle: a journey through every page and every Settings section stays clean (no renderer
 * console errors, nothing sent to the network), the app quits promptly with exit code 0 (no
 * timer keeps it alive), and a relaunch on the same profile reopens the database with its data.
 */

import type { Page } from '@playwright/test';
import { addDays, todayIn } from '../../src/shared/utils/calendar-date';
import {
  expect,
  test,
  within,
  withoutGuardedRequests,
  withoutRemoteImages,
} from './support/wa-stay';
import {
  chooseAccountMenuItem,
  expectCurrentNavLink,
  expectHeadingFocused,
  expectRoute,
  NAV_PAGES,
  navLink,
  pageHeading,
  SETTINGS_SECTIONS,
} from './support/shell';

const WATCH_NAME = 'Bungarra next month';

/**
 * Creates a watch through the real preload, IPC handler and SQLite database (the create flow
 * itself is `create-watch.spec.ts`). Bungarra, so its checks answer from the fixtures.
 */
function createWatch(window: Page): Promise<unknown> {
  const arrival = addDays(todayIn('Australia/Perth'), 30);
  const input = {
    providerId: 'parkstay',
    name: WATCH_NAME,
    location: { externalId: '20', name: 'Bungarra', areaName: 'Kennedy Range National Park' },
    stay: { arrival, departure: addDays(arrival, 2), adults: 2 },
  };
  return window.evaluate(
    (watch) =>
      (
        globalThis as unknown as {
          api: { watches: { create(input: unknown): Promise<unknown> } };
        }
      ).api.watches.create(watch),
    input
  );
}

test('a journey through every page logs no console errors and sends nothing to the network', async ({
  launchWaStay,
}) => {
  const wa = await launchWaStay();
  const { window } = wa;

  for (const page of [NAV_PAGES.watches, NAV_PAGES.snipes, NAV_PAGES.bookings]) {
    await navLink(window, page.link).click();
    await expectRoute(window, page.route);
    await expectCurrentNavLink(window, page.link);
  }

  // Settings opens its first section; each section from the sub-navigation is the current
  // item, and focus moves to its heading.
  await chooseAccountMenuItem(window, 'Settings');
  await expectHeadingFocused(window, 'Settings');
  await expectRoute(window, SETTINGS_SECTIONS[0].route);
  const sections = window.getByRole('navigation', { name: 'Settings sections' });
  for (const section of [...SETTINGS_SECTIONS.slice(1), SETTINGS_SECTIONS[0]]) {
    const link = sections.getByRole('link', { name: section.link, exact: true });
    await link.click();
    await expectRoute(window, section.route);
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(window.getByRole('heading', { level: 2, name: section.heading })).toBeFocused();
    await expect(pageHeading(window)).toHaveText('Settings');
  }

  await chooseAccountMenuItem(window, 'About WA Stay');
  const about = window.getByRole('dialog', { name: 'About WA Stay' });
  await expect(about.getByText(/^Version /)).toBeVisible();
  await about.getByRole('button', { name: 'Done' }).click();
  await expect(about).toBeHidden();
  await navLink(window, NAV_PAGES.explore.link).click();
  await expectHeadingFocused(window, NAV_PAGES.explore.heading);

  const requests = wa.unexpectedRequests();
  expect(withoutGuardedRequests(await wa.consoleErrors(), requests)).toEqual([]);
  // Explore's provider photos are hot-linked; fixture mode cancels them, which is expected.
  expect(withoutRemoteImages(requests)).toEqual([]);
});

test('quits within 10 s with exit code 0, and a relaunch on the same profile keeps its data', async ({
  launchWaStay,
}) => {
  const first = await launchWaStay();
  expect(await createWatch(first.window)).toMatchObject({
    success: true,
    data: { name: WATCH_NAME },
  });

  const exitCode = await within(first.close(), 10_000, 'Quitting WA Stay');
  expect(exitCode).toBe(0);
  expect(first.mainLog()).toContain('Application shut down successfully');
  expect(withoutRemoteImages(first.unexpectedRequests())).toEqual([]);

  // The database reopens with the watch in it.
  const second = await launchWaStay({ userDataDir: first.userDataDir });
  await expectRoute(second.window, '/');
  await expect(pageHeading(second.window)).toHaveText(NAV_PAGES.explore.heading);
  await navLink(second.window, NAV_PAGES.watches.link).click();
  await expectHeadingFocused(second.window, NAV_PAGES.watches.heading);
  await expect(second.window.getByRole('article', { name: WATCH_NAME })).toBeVisible();
  expect(withoutRemoteImages(second.unexpectedRequests())).toEqual([]);
});
