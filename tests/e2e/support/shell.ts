/**
 * The app shell as a user meets it, by role and accessible name only. The names are the D3
 * contract in `docs/design/shell.md` ("Stable names"); change them there and here together.
 */

import { expect, type Locator, type Page } from '@playwright/test';

/** The primary nav pages: link name → route → page heading. */
export const NAV_PAGES = {
  explore: { link: 'Explore', route: '/', heading: 'Explore places to stay' },
  watches: { link: 'Watches', route: '/watches', heading: 'Watches' },
  snipes: { link: 'Site Sniper, coming soon', route: '/site-sniper', heading: 'Site Sniper' },
  bookings: { link: 'Bookings, coming soon', route: '/bookings', heading: 'Bookings' },
} as const;

export type NavPage = (typeof NAV_PAGES)[keyof typeof NAV_PAGES];

/** Settings' sections (U4), in sub-navigation order: link name → route → section heading. */
export const SETTINGS_SECTIONS = [
  { link: 'Accounts', route: '/settings/accounts', heading: 'Accounts' },
  { link: 'Notifications', route: '/settings/notifications', heading: 'Notifications' },
  { link: 'App', route: '/settings/app', heading: 'App' },
  { link: 'About', route: '/settings/about', heading: 'About WA Stay' },
] as const;

export function primaryNav(window: Page): Locator {
  return window.getByRole('navigation', { name: 'Primary' });
}

export function navLink(window: Page, name: string): Locator {
  return primaryNav(window).getByRole('link', { name, exact: true });
}

export function pageHeading(window: Page): Locator {
  return window.getByRole('heading', { level: 1 });
}

export function accountMenuButton(window: Page): Locator {
  return window.getByRole('button', { name: 'Account and settings' });
}

/** The in-app route, as HashRouter reads it (an empty hash is `/`). */
export function currentRoute(window: Page): Promise<string> {
  return window.evaluate(() => location.hash.replace(/^#/, '') || '/');
}

export async function expectRoute(window: Page, route: string): Promise<void> {
  await expect.poll(() => currentRoute(window)).toBe(route);
}

/** Exactly `link` in the primary nav is the current page; with `null`, none is. */
export async function expectCurrentNavLink(window: Page, link: string | null): Promise<void> {
  for (const page of Object.values(NAV_PAGES)) {
    const item = navLink(window, page.link);
    if (page.link === link) await expect(item).toHaveAttribute('aria-current', 'page');
    else await expect(item).not.toHaveAttribute('aria-current');
  }
}

/** After a page change focus is on the page's `h1` (D3, `useRouteFocus`). */
export async function expectHeadingFocused(window: Page, heading: string): Promise<void> {
  await expect(pageHeading(window)).toHaveCount(1);
  await expect(pageHeading(window)).toHaveText(heading);
  await expect(pageHeading(window)).toBeFocused();
}

/**
 * In a create flow's step list (`StepFlow`), the step titled `title` is the current one
 * (`aria-current="step"`), and it is the only one.
 */
export async function expectCurrentStep(steps: Locator, title: string): Promise<void> {
  const items = steps.getByRole('listitem');
  await expect(items.filter({ hasText: title })).toHaveAttribute('aria-current', 'step');
  for (const item of await items.filter({ hasNotText: title }).all()) {
    await expect(item).not.toHaveAttribute('aria-current');
  }
}

/** Opens the account menu and picks one of its items. */
export async function chooseAccountMenuItem(window: Page, item: string): Promise<void> {
  await accountMenuButton(window).click();
  await window
    .getByRole('menu', { name: 'Account and settings' })
    .getByRole('menuitem', { name: item })
    .click();
}
