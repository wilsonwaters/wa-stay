/**
 * Stay Rottnest's notice, network-free (§12.37): with Stay Rottnest registered, WA Stay sends it
 * nothing until the person has read and accepted its notice.
 *
 * The journey starts without Stay Rottnest's fixture routes, so any request to it would be
 * refused and logged (`unexpectedRequests`). Explore lists the nine precincts from the seed.
 * With dates set, it offers the notice once, above the list, and Geordie Bay's card says why it
 * has no count; nothing has been asked. The routes are then put in place, and the person reads
 * the notice, ticks it and continues. The counts appear (Geordie Bay: 6 cabins free, from the
 * stakeholder's trimmed capture); the two nights are outside the peak's fixed dates. Dates in
 * the month the next Open Day opens read "Opens {that day}", asked of nobody (Stay Rottnest's
 * own release rules). Settings → Accounts reads "Notice accepted on {today}";
 * Withdraw, asked first, turns it back to "Notice not accepted", and Explore offers the notice
 * again.
 *
 * Fixture mode refuses no request, and the window logs no errors. Roles and accessible names
 * only.
 */

import fs from 'fs';
import path from 'path';
import { addDays, todayIn } from '../../src/shared/utils/calendar-date';
import { nextOpenDay, openDayMorning } from './support/rottnest';
import { chooseAccountMenuItem, currentRoute } from './support/shell';
import { expect, test, withoutGuardedRequests, withoutRemoteImages } from './support/wa-stay';

const HTTP_FIXTURES = path.join(__dirname, 'fixtures', 'http');
const PERTH = 'Australia/Perth';
const OFFER = "Stay Rottnest checks dates once you've read and accepted its notice.";
const CARD_LINE = "Read Stay Rottnest's notice to check dates";
const TITLE = 'Before WA Stay checks Stay Rottnest';
const CONFIRM = 'I understand, and I want WA Stay to check Stay Rottnest for me';

/**
 * Geordie Bay's fixed peak periods (first arrival, last departure: `booking-guides.ts`): there
 * its stays arrive and leave on set dates, so the journey's two nights avoid them.
 */
const GEORDIE_PEAKS: ReadonlyArray<readonly [string, string]> = [
  ['2026-11-24', '2027-02-02'],
  ['2027-03-24', '2027-03-30'],
  ['2027-04-09', '2027-04-28'],
];

/** The first two nights from `from` outside Geordie Bay's fixed peak periods. */
function ordinaryDates(from: string): { arrival: string; departure: string } {
  let arrival = from;
  for (let i = 0; i < 200; i++) {
    const departure = addDays(arrival, 2);
    if (!GEORDIE_PEAKS.some(([start, end]) => arrival < end && departure > start)) {
      return { arrival, departure };
    }
    arrival = addDays(arrival, 1);
  }
  throw new Error('No ordinary dates found');
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

  // 1. Dates on Explore: two nights from tomorrow, outside the peak's fixed dates
  const { arrival, departure } = ordinaryDates(addDays(todayIn(PERTH), 1));
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

  // 4b. Dates in the month the next Open Day opens: not on sale, and nothing asked
  const next = nextOpenDay();
  await window.evaluate((hash) => {
    location.hash = hash;
  }, `#/?arrival=${next.stayMonth}-06&departure=${next.stayMonth}-08`);
  const opens = new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: PERTH,
  })
    .format(new Date(`${next.date}T00:30:00.000Z`))
    .replace(',', '');
  await expect(geordie).toHaveAccessibleDescription(new RegExp(`Opens ${opens}`), {
    timeout: 20_000,
  });

  // 5. Settings → Accounts: accepted today; Withdraw asks first
  await chooseAccountMenuItem(window, 'Settings');
  const row = window
    .getByRole('list', { name: 'Booking site accounts' })
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
