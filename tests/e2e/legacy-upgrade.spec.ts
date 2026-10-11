/**
 * Upgrading from v1.x (B3), network-free: the first start of WA Stay on a machine with a
 * v1.2.0 data folder (the schema v5 fixture, `tests/fixtures/db/`) copies it into the new data
 * folder, migrates it, and says so: the welcome notice is in the bell and the v1.x watches are
 * listed. The v1.x database is left as it was. `WA_STAY_LEGACY_DATA_DIR` points the app at the
 * temp folder (a test-only hook, honoured only from source).
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { writeLegacyV1Data } from './support/seed';
import { expect, test, withoutGuardedRequests, withoutRemoteImages } from './support/wa-stay';
import { expectHeadingFocused, NAV_PAGES, navLink } from './support/shell';

const WELCOME_TITLE = 'Your data has moved to WA Stay';
/** The watches in the v5 fixture (`tests/fixtures/db/README.md`). */
const V1_WATCHES = ['Osprey Bay Easter', 'Lucky Bay long weekend'];

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('the first start after v1.2.0 copies its data, welcomes you and lists its watches', async ({
  launchWaStay,
  tempDir,
}) => {
  const legacyDir = tempDir('legacy');
  const legacyDb = writeLegacyV1Data(legacyDir);
  const before = sha256(legacyDb);

  const wa = await launchWaStay({ env: { WA_STAY_LEGACY_DATA_DIR: legacyDir } });
  const { window } = wa;

  // The welcome notice, unread, saying where the old data is kept.
  await window.getByRole('button', { name: /^Notifications, \d+ unread$/ }).click();
  const list = window.getByRole('dialog', { name: 'Notifications' });
  await expect(list.getByText(WELCOME_TITLE, { exact: true })).toBeVisible();
  await expect(list.getByText(`kept, unchanged, as a backup in ${legacyDir}`)).toBeVisible();
  await window.keyboard.press('Escape');
  await expect(list).toBeHidden();

  // The v1.x watches, migrated.
  await navLink(window, NAV_PAGES.watches.link).click();
  await expectHeadingFocused(window, NAV_PAGES.watches.heading);
  for (const name of V1_WATCHES) {
    await expect(window.getByRole('article', { name })).toBeVisible();
  }

  // The copy is recorded, and the v1.x database is untouched.
  const marker = JSON.parse(
    fs.readFileSync(path.join(wa.userDataDir, 'migration.json'), 'utf8')
  ) as { status: string };
  expect(marker.status).toBe('complete');
  expect(sha256(legacyDb)).toBe(before);

  const requests = wa.unexpectedRequests();
  expect(withoutGuardedRequests(await wa.consoleErrors(), requests)).toEqual([]);
  expect(withoutRemoteImages(requests)).toEqual([]);
});
