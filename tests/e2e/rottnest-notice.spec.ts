/**
 * Stay Rottnest's notice, network-free (§12.36): with Stay Rottnest registered, WA Stay sends it
 * nothing until the person has read and accepted its notice.
 *
 * The journey starts without Stay Rottnest's fixture routes, so any request to it would be
 * refused and logged (`unexpectedRequests`). Explore lists the nine precincts from the seed.
 * With dates set, it offers the notice once, above the list, and Geordie Bay's card says why it
 * has no count; nothing has been asked. The routes are then put in place, and the person reads
 * the notice, ticks it and continues. The counts appear (Geordie Bay: 6 cabins free, from the
 * stakeholder's trimmed capture). Settings → Accounts reads "Notice accepted on {today}";
 * Withdraw, asked first, turns it back to "Notice not accepted", and Explore offers the notice
 * again.
 *
 * Fixture mode refuses no request, and the window logs no errors. Roles and accessible names
 * only.
 */

import fs from 'fs';
import path from 'path';
import { addDays, todayIn } from '../../src/shared/utils/calendar-date';
import { chooseAccountMenuItem, currentRoute } from './support/shell';
import { expect, test, withoutGuardedRequests, withoutRemoteImages } from './support/wa-stay';

const HTTP_FIXTURES = path.join(__dirname, 'fixtures', 'http');
const PERTH = 'Australia/Perth';
const OFFER = "Stay Rottnest checks dates once you've read and accepted its notice.";
const CARD_LINE = "Read Stay Rottnest's notice to check dates";
const TITLE = 'Before WA Stay checks Stay Rottnest';
const CONFIRM = 'I understand, and I want WA Stay to check Stay Rottnest for me';

/**
 * Whether now is an Open Day morning in Perth (05:30 to noon on the first Wednesday of the
 * month, a week later when that is New Year's Day): Stay Rottnest's checks pause then
 * (`open-days.ts`), so the counts would not come.
 */
function openDayMorning(now = new Date()): boolean {
  const today = todayIn(PERTH, now);
  const [year, month] = today.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  let day = 1 + ((3 - first + 7) % 7);
  if (month === 1 && day === 1) day += 7;
  if (Number(today.slice(8)) !== day) return false;
  const hm = new Intl.DateTimeFormat('en-GB', {
    timeZone: PERTH,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  return hm >= '05:30' && hm < '12:00';
}

test('Stay Rottnest is asked nothing until its notice is accepted; withdrawing asks again', async ({
  launchWaStay,
  tempDir,
}) => {
  test.skip(openDayMorning(), "Stay Rottnest's checks pause on an Open Day morning");
  test.setTimeout(90_000);
  const fixtures = tempDir('rottnest-notice');
  fs.cpSync(HTTP_FIXTURES, fixtures, { recursive: true });
  const routes = path.join(fixtures, 'rottnest', 'manifest.json');
  const recorded = fs.readFileSync(routes, 'utf8');
  fs.rmSync(routes);

  const wa = await launchWaStay({
    providers: ['rottnest'],
    env: { WA_STAY_E2E_FIXTURES_DIR: fixtures },
  });
  const { window } = wa;
  const results = window.getByRole('region', { name: 'Results' });
  await expect(results.getByRole('heading', { level: 2, name: '9 places' })).toBeVisible({
    timeout: 30_000,
  });

  // 1. Dates on Explore: tomorrow, for two nights
  const arrival = addDays(todayIn(PERTH), 1);
  const departure = addDays(arrival, 2);
  await window.evaluate((hash) => {
    location.hash = hash;
  }, `#/?arrival=${arrival}&departure=${departure}`);
  await expect.poll(() => currentRoute(window)).toContain(`arrival=${arrival}`);

  // 2. The notice is offered once; the cards say why they have no count; nothing was asked
  await expect(window.getByText(OFFER)).toBeVisible({ timeout: 20_000 });
  const geordie = results.getByRole('link', { name: 'Geordie Bay', exact: true });
  await expect(geordie).toHaveAccessibleDescription(new RegExp(CARD_LINE));
  expect(wa.unexpectedRequests()).toEqual([]);

  // 3. The routes in place, the person reads the notice, ticks it and continues
  fs.writeFileSync(routes, recorded);
  await window.getByRole('button', { name: "Read Stay Rottnest's notice" }).click();
  const dialog = window.getByRole('dialog', { name: TITLE });
  await expect(dialog).toContainText('clause 4, Use of Automated Software');
  const go = dialog.getByRole('button', { name: 'Continue' });
  await expect(go).toBeDisabled();
  await dialog.getByRole('checkbox', { name: CONFIRM }).check();
  await go.click();
  await expect(dialog).toBeHidden();

  // 4. The counts come
  await expect(geordie).toHaveAccessibleDescription(/6 cabins free/, { timeout: 20_000 });
  await expect(window.getByText(OFFER)).toBeHidden();

  // 5. Settings → Accounts: accepted today; Withdraw asks first
  await chooseAccountMenuItem(window, 'Settings');
  const row = window
    .getByRole('list', { name: 'Provider accounts' })
    .getByRole('listitem')
    .filter({ has: window.getByRole('heading', { level: 3, name: 'Stay Rottnest' }) });
  const today = new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: PERTH,
  }).format(new Date());
  await expect(row.getByText(`Notice accepted on ${today}`)).toBeVisible();
  await row.getByRole('button', { name: 'Withdraw' }).click();
  const confirm = window.getByRole('alertdialog', {
    name: "Withdraw your acceptance of Stay Rottnest's notice?",
  });
  await confirm.getByRole('button', { name: 'Withdraw' }).click();
  await expect(row.getByText('Notice not accepted')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Read the notice' })).toBeVisible();

  // 6. Back on Explore, the notice is offered again
  await window.evaluate((hash) => {
    location.hash = hash;
  }, `#/?arrival=${arrival}&departure=${departure}`);
  await expect(window.getByText(OFFER)).toBeVisible({ timeout: 20_000 });
  await expect(geordie).toHaveAccessibleDescription(new RegExp(CARD_LINE));

  // Nothing left the fixtures, and the window logged no errors
  const requests = wa.unexpectedRequests();
  expect(withoutRemoteImages(requests)).toEqual([]);
  expect(withoutGuardedRequests(await wa.consoleErrors(), requests)).toEqual([]);
});
