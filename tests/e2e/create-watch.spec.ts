/**
 * Creating a watch in the built app (U1, Q1 phase 2), network-free: the ParkStay catalogue
 * and availability come from `fixtures/http/parkstay`. Provider step → location → stay →
 * alerts → review → the new watch's page, by role and accessible name only.
 */

import { expect, test, withoutGuardedRequests, withoutRemoteImages } from './support/wa-stay';
import {
  expectCurrentStep,
  expectHeadingFocused,
  expectRoute,
  NAV_PAGES,
  navLink,
} from './support/shell';

/** The catalogue syncs 5 s after launch (V5); give it room on a slow runner. */
const CATALOGUE_TIMEOUT_MS = 30_000;

test('creates a ParkStay watch through the provider-first flow', async ({ launchWaStay }) => {
  test.setTimeout(90_000);
  // ParkStay alone, so it is the only provider with watches, however many are built in
  const wa = await launchWaStay({ providers: ['parkstay'] });
  const { window } = wa;

  await navLink(window, NAV_PAGES.watches.link).click();
  await expectHeadingFocused(window, NAV_PAGES.watches.heading);
  await expect(window.getByRole('heading', { name: 'No watches yet' })).toBeVisible();
  await window.getByRole('link', { name: 'New watch' }).click();
  await expectRoute(window, '/watches/new');
  await expectHeadingFocused(window, 'New watch');

  // 1. Provider: the only provider with watches, chosen for you but shown.
  const steps = window.getByRole('navigation', { name: 'New watch steps' });
  await expectCurrentStep(steps, 'Provider');
  await expect(window.getByRole('radio', { name: 'ParkStay WA' })).toBeChecked();
  await window.getByRole('button', { name: 'Continue' }).click();

  // 2. Location: search the synced catalogue.
  await expect(window.getByRole('heading', { level: 2, name: /Location$/ })).toBeFocused();
  const location = window.getByRole('combobox', { name: 'Location' });
  const bungarra = window.getByRole('option', { name: /Bungarra/ });
  await expect(async () => {
    await location.fill('');
    await location.fill('Bung');
    await expect(bungarra).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: CATALOGUE_TIMEOUT_MS });
  await bungarra.click();
  await expect(location).toHaveValue('Bungarra');
  await window.getByRole('button', { name: 'Continue' }).click();

  // 3. Stay: two nights, picked with the keyboard.
  await expect(window.getByRole('heading', { level: 2, name: /Your stay$/ })).toBeFocused();
  await window.getByRole('button', { name: /^Dates/ }).click();
  // Each step waits for the calendar's answer, as a person would: keys sent before the grid has
  // focus are lost on a slow machine.
  await expect(window.locator('[role="grid"] button:focus')).toHaveCount(1);
  await window.keyboard.press('ArrowRight');
  await window.keyboard.press('Enter');
  await expect(window.getByRole('button', { name: /, check-in$/ })).toHaveCount(1);
  await window.keyboard.press('ArrowRight');
  await window.keyboard.press('ArrowRight');
  await window.keyboard.press('Enter');
  await expect(window.getByRole('button', { name: /, check-out$/ })).toHaveCount(1);
  await window
    .getByRole('dialog', { name: 'Choose dates' })
    .getByRole('button', { name: 'Done' })
    .click();
  await expect(window.getByRole('button', { name: /^Dates .+ – .+/ })).toBeVisible();
  await expect(window.getByRole('combobox', { name: 'Camping with' })).toHaveValue('all');
  await window.getByRole('button', { name: 'Continue' }).click();

  // 4. Alerts: ParkStay has holds, so the automatic hold is offered (left off).
  await expect(window.getByRole('heading', { level: 2, name: /Alerts$/ })).toBeFocused();
  await expect(
    window.getByRole('checkbox', { name: 'Hold a site automatically when found' })
  ).not.toBeChecked();
  await window.getByRole('button', { name: 'Continue' }).click();

  // 5. Review and create.
  await expect(window.getByRole('heading', { level: 2, name: /Review$/ })).toBeFocused();
  const name = await window.getByRole('textbox', { name: 'Name' }).inputValue();
  expect(name).toMatch(/^Bungarra · /);
  await window.getByRole('button', { name: 'Create watch' }).click();

  await expect
    .poll(() => window.evaluate(() => document.location.hash))
    .toMatch(/^#\/watches\/\d+$/);
  await expect(window.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(
    window.getByRole('region', { name: 'Notifications' }).getByText('Watch created')
  ).toBeVisible();
  await expect(window.getByRole('img', { name: 'ParkStay WA' }).first()).toBeVisible();

  // The list shows it.
  await navLink(window, NAV_PAGES.watches.link).click();
  await expect(window.getByRole('article', { name })).toBeVisible();

  const requests = wa.unexpectedRequests();
  expect(withoutGuardedRequests(await wa.consoleErrors(), requests)).toEqual([]);
  expect(withoutRemoteImages(requests)).toEqual([]);
});
