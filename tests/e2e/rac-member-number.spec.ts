/**
 * An RAC member number end to end (R16), network-free, with ParkStay and RAC registered. In
 * Settings → Accounts, RAC's row adds the person's own member number: "Save" waits for all
 * three statements; once saved the row says so, the field is empty when the form opens again,
 * and the number is nowhere in the page. RAC Busselton Holiday Park's page then shows "Copy RAC
 * member number" right after "Book on RAC", which puts the made-up number on the clipboard with
 * its leading zero, and its check prices the powered site at the member rate ($68 a night,
 * "Rate: RAC member rate"; RAC's trimmed answer, moved to 7 and 8 days ahead). Removed, the
 * button goes and the check is back at the public rate ($75). Fixture mode refuses no request:
 * the number is never sent. Each step's screenshot is attached to the report.
 */

import type { Page, TestInfo } from '@playwright/test';
import { addDays } from '../../src/shared/utils/calendar-date';
import { writeDatedFixtures } from './support/dated-fixtures';
import { chooseAccountMenuItem, currentRoute } from './support/shell';
import { expect, test, withoutGuardedRequests, withoutRemoteImages } from './support/wa-stay';

/** The catalogues sync 5 s after launch (V5); give them room on a slow runner. */
const CATALOGUE_TIMEOUT_MS = 30_000;
/** ParkStay's 11 campgrounds and RAC's 8 parks. */
const ALL_PLACES = 19;
/** Made up (RS13): never a real member number. A leading zero, which must survive. */
const NUMBER = '012345678';
const STATEMENTS = [
  'This is my own RAC member number',
  'I will stay at the park myself',
  'I will book in the name on my RAC card',
];

async function screenshot(window: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = testInfo.outputPath(`${name}.png`);
  await window.screenshot({ path: file, fullPage: true });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}

test('an RAC member number: saved with its statements, copied beside "Book on RAC" with its leading zero, member prices, then removed', async ({
  launchWaStay,
  tempDir,
}, testInfo) => {
  test.setTimeout(120_000);
  const fixtures = writeDatedFixtures(tempDir('rac-dated'));
  const { arrival } = fixtures;
  const departure = addDays(arrival, 2);
  const wa = await launchWaStay({
    providers: ['parkstay', 'rac'],
    env: { WA_STAY_E2E_FIXTURES_DIR: fixtures.dir },
  });
  const { app, window } = wa;
  const clipboard = () => app.evaluate(({ clipboard: board }) => board.readText());
  const clearClipboard = () => app.evaluate(({ clipboard: board }) => board.writeText(''));
  await expect(
    window
      .getByRole('region', { name: 'Results' })
      .getByRole('heading', { level: 2, name: `${ALL_PLACES} places` })
  ).toBeVisible({ timeout: CATALOGUE_TIMEOUT_MS });

  // 1. Settings → Accounts: RAC's row, nothing saved
  await chooseAccountMenuItem(window, 'Settings');
  const accounts = window.getByRole('list', { name: 'Provider accounts' });
  const racRow = accounts
    .getByRole('listitem')
    .filter({ has: window.getByRole('heading', { level: 3, name: 'RAC Parks & Resorts' }) });
  await expect(racRow.getByText('Not added')).toBeVisible();
  await racRow.getByRole('button', { name: 'Add RAC member number' }).click();

  // 2. The form: a masked field with its help; Save waits for all three statements
  const form = window.getByRole('dialog', { name: 'RAC account' });
  const field = form.getByRole('textbox', { name: 'RAC member number' });
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('type', 'password');
  await expect(field).toHaveAccessibleDescription(/On your RAC card or in myRAC/);
  await field.fill(NUMBER);
  const save = form.getByRole('button', { name: 'Save' });
  for (const statement of STATEMENTS) {
    await expect(save).toBeDisabled();
    await form.getByRole('checkbox', { name: statement }).check();
  }
  await expect(save).toBeEnabled();
  await screenshot(window, testInfo, 'settings-rac-form');
  await save.click();

  // 3. Saved: the row says so, the number is nowhere in the page, the form opens empty
  await expect(form).toBeHidden();
  await expect(racRow.getByText(/member number saved/i)).toBeVisible();
  expect(await window.content()).not.toContain(NUMBER);
  await racRow.getByRole('button', { name: 'Replace' }).click();
  await expect(
    window
      .getByRole('dialog', { name: 'RAC account' })
      .getByRole('textbox', { name: 'RAC member number' })
  ).toHaveValue('');
  await window
    .getByRole('dialog', { name: 'RAC account' })
    .getByRole('button', { name: 'Cancel' })
    .click();
  await expect(window.getByRole('dialog', { name: 'RAC account' })).toBeHidden();
  const settingsCopy = racRow.getByRole('button', { name: 'Copy RAC member number' });
  await settingsCopy.click();
  await expect.poll(clipboard).toBe(NUMBER);
  await expect(settingsCopy).toBeFocused();
  await screenshot(window, testInfo, 'settings-rac-saved');

  // 4. RAC Busselton's page, with the dates: "Copy RAC member number" right after "Book on RAC"
  await clearClipboard();
  await window.evaluate((hash) => {
    location.hash = hash;
  }, `#/places/rac/busselton?arrival=${arrival}&departure=${departure}&adults=2`);
  await expect.poll(() => currentRoute(window)).toMatch(/^\/places\/rac\/busselton\?/);
  const stayCard = window.getByRole('region', { name: 'Check your dates' });
  const book = stayCard.getByRole('link', { name: /^Book on RAC/ });
  const copy = stayCard.getByRole('button', { name: 'Copy RAC member number' });
  await expect(book).toBeVisible();
  await expect(copy).toBeVisible();
  // Beside it: in the same "Check your dates" region, the control right after "Book on RAC" in
  // reading order (its links and buttons, by role), with no value in its name or a title
  const controls = stayCard.getByRole('link').or(stayCard.getByRole('button'));
  const names = (await controls.allInnerTexts()).map((text) => text.replace(/\s+/g, ' ').trim());
  const bookAt = names.findIndex((name) => name.startsWith('Book on RAC'));
  expect(bookAt).toBeGreaterThanOrEqual(0);
  expect(names[bookAt + 1]).toBe('Copy RAC member number');
  await expect(copy).toHaveAccessibleName('Copy RAC member number');
  await expect(copy).not.toHaveAttribute('title');

  // 5. Its check: the member rate on the powered site
  await stayCard.getByRole('button', { name: 'Check availability' }).click();
  const availability = window.getByRole('region', { name: 'Availability', exact: true });
  const grid = availability.getByRole('table', { name: /^Availability by night, / });
  await expect(grid).toBeVisible();
  const poweredRow = grid.getByRole('row').filter({ hasText: 'Powered Site' });
  await expect(poweredRow.getByText('Rate: RAC member rate')).toBeVisible();
  await expect(poweredRow).toContainText('$68');
  await expect(poweredRow).not.toContainText('$75');

  // 6. Copy: the made-up number, leading zero kept, on the clipboard; focus stays
  await copy.click();
  await expect.poll(clipboard).toBe(NUMBER);
  await expect(copy).toBeFocused();
  expect(await window.content()).not.toContain(NUMBER);
  await screenshot(window, testInfo, 'place-member-rate');

  // 7. Removed: the button goes, and the same check is back at the public rate
  await chooseAccountMenuItem(window, 'Settings');
  await racRow.getByRole('button', { name: 'Remove' }).click();
  const confirm = window.getByRole('alertdialog', { name: 'Remove your RAC member number?' });
  await confirm.getByRole('button', { name: 'Remove' }).click();
  await expect(racRow.getByRole('button', { name: 'Add RAC member number' })).toBeVisible();
  await expect(racRow.getByRole('button', { name: 'Copy RAC member number' })).toHaveCount(0);
  await screenshot(window, testInfo, 'settings-rac-removed');
  await window.evaluate((hash) => {
    location.hash = hash;
  }, `#/places/rac/busselton?arrival=${arrival}&departure=${departure}&adults=2`);
  await expect(stayCard.getByRole('link', { name: /^Book on RAC/ })).toBeVisible();
  await expect(stayCard.getByRole('button', { name: 'Copy RAC member number' })).toHaveCount(0);
  await stayCard.getByRole('button', { name: 'Check availability' }).click();
  await expect(grid).toBeVisible();
  await expect(poweredRow).toContainText('$75');
  await expect(poweredRow.getByText(/^Rate:/)).toHaveCount(0);
  await screenshot(window, testInfo, 'place-public-rate');

  // Nothing left the fixtures, and the window logged no errors
  const requests = wa.unexpectedRequests();
  expect(withoutRemoteImages(requests)).toEqual([]);
  expect(JSON.stringify(requests)).not.toContain(NUMBER);
  expect(withoutGuardedRequests(await wa.consoleErrors(), requests)).toEqual([]);
});
