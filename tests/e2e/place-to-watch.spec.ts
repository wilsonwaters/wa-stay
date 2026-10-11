/**
 * From a place to a watch (E2 → U1), network-free: a place's page offers "Watch for
 * availability", which opens the create flow already filled in with the provider, the place and
 * the dates chosen on the page. The watch is created, and is still listed after a relaunch on
 * the same profile.
 */

import { addDays, todayIn } from '../../src/shared/utils/calendar-date';
import { expect, test, withoutGuardedRequests, withoutRemoteImages } from './support/wa-stay';
import {
  currentRoute,
  expectCurrentStep,
  expectHeadingFocused,
  expectRoute,
  NAV_PAGES,
  navLink,
} from './support/shell';

/** The catalogue syncs 5 s after launch (V5); give it room on a slow runner. */
const CATALOGUE_TIMEOUT_MS = 30_000;

test('a place’s "Watch for availability" opens a prefilled watch, which a relaunch keeps', async ({
  launchWaStay,
}) => {
  test.setTimeout(90_000);
  const first = await launchWaStay();
  const { window } = first;

  // Explore → the place.
  const results = window.getByRole('region', { name: 'Results' });
  await results
    .getByRole('link', { name: 'Bungarra', exact: true })
    .click({ timeout: CATALOGUE_TIMEOUT_MS });
  await expectRoute(window, '/places/parkstay/20');
  await expect(window.getByRole('heading', { level: 1, name: 'Bungarra' })).toBeVisible();

  // Dates on the place's page: tomorrow for two nights (Perth), with the keyboard.
  const stayCard = window.getByRole('region', { name: 'Check your dates' });
  const datesButton = stayCard.getByRole('button', { name: /^Dates/ });
  await datesButton.click();
  // Each pick is written to the address and read back; wait for it before the next key, as a
  // person would, or a slow machine reads the second Enter as another check-in. Keys sent before
  // the grid has focus are lost.
  await expect(window.locator('[role="grid"] button:focus')).toHaveCount(1);
  await window.keyboard.press('ArrowRight');
  await window.keyboard.press('Enter');
  await expect(datesButton).toHaveAccessibleName(/add check-out/);
  await window.keyboard.press('ArrowRight');
  await window.keyboard.press('ArrowRight');
  await window.keyboard.press('Enter');
  await expect(datesButton).not.toHaveAccessibleName(/add check-out/);
  await window
    .getByRole('dialog', { name: 'Choose dates' })
    .getByRole('button', { name: 'Done' })
    .click();
  const arrival = addDays(todayIn('Australia/Perth'), 1);
  const departure = addDays(arrival, 2);
  await expect
    .poll(async () =>
      new URLSearchParams((await currentRoute(window)).split('?')[1]).get('arrival')
    )
    .toBe(arrival);

  // "Watch for availability": the flow opens on "Your stay", the provider and place settled.
  await stayCard.getByRole('link', { name: 'Watch for availability' }).click();
  await expect
    .poll(async () => {
      const [route, query] = (await currentRoute(window)).split('?');
      return { route, ...Object.fromEntries(new URLSearchParams(query)) };
    })
    .toMatchObject({
      route: '/watches/new',
      provider: 'parkstay',
      location: '20',
      arrival,
      departure,
    });
  await expectHeadingFocused(window, 'New watch');
  const steps = window.getByRole('navigation', { name: 'New watch steps' });
  await expectCurrentStep(steps, 'Your stay');
  await expect(steps.getByRole('button', { name: 'Provider, done' })).toBeVisible();
  await expect(steps.getByRole('button', { name: 'Location, done' })).toBeVisible();
  await expect(window.getByRole('heading', { level: 2, name: /Your stay$/ })).toBeVisible();
  await expect(window.getByRole('button', { name: /^Dates .+ – .+/ })).toBeVisible();
  await window.getByRole('button', { name: 'Continue' }).click();

  await expect(window.getByRole('heading', { level: 2, name: /Alerts$/ })).toBeFocused();
  await window.getByRole('button', { name: 'Continue' }).click();

  await expect(window.getByRole('heading', { level: 2, name: /Review$/ })).toBeFocused();
  const name = await window.getByRole('textbox', { name: 'Name' }).inputValue();
  expect(name).toMatch(/^Bungarra · /);
  await window.getByRole('button', { name: 'Create watch' }).click();
  await expect
    .poll(() => window.evaluate(() => document.location.hash))
    .toMatch(/^#\/watches\/\d+$/);
  await expect(window.getByRole('heading', { level: 1, name })).toBeVisible();

  const requests = first.unexpectedRequests();
  expect(withoutGuardedRequests(await first.consoleErrors(), requests)).toEqual([]);
  expect(withoutRemoteImages(requests)).toEqual([]);
  expect(await first.close()).toBe(0);

  // A relaunch on the same profile still lists it, and opens it.
  const second = await launchWaStay({ userDataDir: first.userDataDir });
  await navLink(second.window, NAV_PAGES.watches.link).click();
  await expectHeadingFocused(second.window, NAV_PAGES.watches.heading);
  const card = second.window.getByRole('article', { name });
  await expect(card).toBeVisible();
  await card.getByRole('link', { name, exact: true }).click();
  await expectHeadingFocused(second.window, name);
  expect(withoutRemoteImages(second.unexpectedRequests())).toEqual([]);
});
