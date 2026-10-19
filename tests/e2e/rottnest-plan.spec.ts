/**
 * An Open Day plan for Stay Rottnest (§12.38), network-free: Site Sniper only reminds there, so
 * a plan is made, armed and shown without a request to Stay Rottnest and without its notice.
 *
 * The journey starts without Stay Rottnest's fixture routes, so any request to it would be
 * refused and logged (`unexpectedRequests`). Explore, with two nights in the month the Open Day
 * after next opens (three weeks away at least, so no reminder is due while it runs), leads to
 * Geordie Bay's page, whose booking rules say when the stay opens, and whose Site Sniper
 * hand-off reads "Set release reminders". The Release step offers only "On its Open Day", says when the stay
 * opens (from Stay Rottnest's own release rules, asked of nobody), lists the three reminders and
 * what to have ready, and has no "When the dates are free" choice or timing. Review says it
 * reminds; "Create plan" opens the plan's page: "Reminders set", its next reminder ("Open Day
 * tomorrow", 6 pm the day before), and no Run now.
 *
 * Fixture mode refuses no request, and the window logs no errors. Roles and accessible names
 * only.
 */

import fs from 'fs';
import path from 'path';
import { addDays } from '../../src/shared/utils/calendar-date';
import { nextOpenDay } from './support/rottnest';
import { currentRoute } from './support/shell';
import { expect, test, withoutGuardedRequests, withoutRemoteImages } from './support/wa-stay';

const HTTP_FIXTURES = path.join(__dirname, 'fixtures', 'http');
/** How Stay Rottnest's rules say a stay opens: "Opens Wed 2 Dec 2026, 8:30 am, …". */
const OPENS = /^Opens \w{3} \d{1,2} \w{3,4} \d{4}, 8:30 am, Stay Rottnest's Open Day for /;

test('a Stay Rottnest Open Day plan is made and armed without asking Stay Rottnest anything', async ({
  launchWaStay,
  tempDir,
}) => {
  test.setTimeout(90_000);
  const fixtures = tempDir('rottnest-plan');
  fs.cpSync(HTTP_FIXTURES, fixtures, { recursive: true });
  fs.rmSync(path.join(fixtures, 'rottnest', 'manifest.json'));

  // The Open Day after next, so its first reminder is weeks away
  const next = nextOpenDay();
  const later = nextOpenDay(new Date(`${addDays(next.date, 1)}T00:00:00.000Z`));
  const arrival = `${later.stayMonth}-06`;
  const departure = `${later.stayMonth}-08`;

  const wa = await launchWaStay({
    providers: ['rottnest'],
    env: { WA_STAY_E2E_FIXTURES_DIR: fixtures },
  });
  const { window } = wa;
  const results = window.getByRole('region', { name: 'Results' });
  await expect(results.getByRole('heading', { level: 2, name: '9 places' })).toBeVisible({
    timeout: 30_000,
  });

  // 1. Explore, with the dates, to Geordie Bay's page: not on sale yet, said by the rules
  await window.evaluate((hash) => {
    location.hash = hash;
  }, `#/?arrival=${arrival}&departure=${departure}`);
  await expect.poll(() => currentRoute(window)).toContain(`arrival=${arrival}`);
  await results.getByRole('link', { name: 'Geordie Bay', exact: true }).click();
  await expect(window.getByRole('heading', { level: 1, name: 'Geordie Bay' })).toBeVisible();
  const card = window.getByRole('region', { name: 'Check your dates' });
  await expect(card.getByText(OPENS)).toBeVisible({ timeout: 20_000 });

  // 2. Site Sniper's hand-off there only sets reminders
  await card.getByRole('link', { name: 'Set release reminders, coming soon' }).click();
  await expect(window.getByRole('heading', { level: 2, name: /Your stay$/ })).toBeVisible({
    timeout: 20_000,
  });
  await window.getByRole('button', { name: 'Continue' }).click();

  // 1. Release: the stay's Open Day, the reminders and what to have ready, and nothing to time
  await expect(
    window.getByRole('heading', { level: 2, name: /Release and timing$/ })
  ).toBeVisible();
  await expect(window.getByRole('radio', { name: /On its Open Day/ })).toBeChecked();
  await expect(window.getByText(OPENS)).toBeVisible({ timeout: 20_000 });
  const reminders = window.getByRole('region', { name: 'Your reminders' });
  await expect(reminders.getByRole('listitem')).toHaveCount(3);
  await expect(reminders.getByRole('listitem').first()).toContainText(
    '6:00 pm AWST · Open Day tomorrow'
  );
  await expect(window.getByRole('region', { name: 'Have ready' })).toContainText(
    'A Visa or Mastercard.'
  );
  await expect(window.getByRole('radio', { name: 'Alert me' })).toHaveCount(0);
  await expect(window.getByRole('button', { name: 'Advanced timing' })).toHaveCount(0);

  // 2. Review says it reminds; Create plan
  await window.getByRole('button', { name: 'Continue' }).click();
  const release = window.getByRole('region', { name: 'Release' });
  await expect(release.getByText('Reminds you before the release')).toBeVisible();
  await window.getByRole('button', { name: 'Create plan' }).click();

  // 3. The plan's page: armed, its next reminder, and no Run now
  await expect.poll(() => currentRoute(window)).toMatch(/^\/site-sniper\/\d+$/);
  await expect(window.getByText('Status').locator('..')).toContainText('Reminders set', {
    timeout: 20_000,
  });
  await expect(window.getByText(/^Next reminder .*6:00 pm AWST: Open Day tomorrow$/)).toBeVisible();
  await window.getByRole('button', { name: /^More actions for/ }).click();
  await expect(window.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  await expect(window.getByRole('menuitem', { name: 'Run now' })).toHaveCount(0);
  await window.keyboard.press('Escape');

  // Nothing was asked of Stay Rottnest, and the window logged no errors
  const requests = wa.unexpectedRequests();
  expect(withoutRemoteImages(requests)).toEqual([]);
  expect(withoutGuardedRequests(await wa.consoleErrors(), requests)).toEqual([]);
});
