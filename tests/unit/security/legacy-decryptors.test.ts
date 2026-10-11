/**
 * The v1.x notifier decryptor recovers the fixture plaintext: P2's notifier row (machine id
 * `fixture-machine-id`). A wrong key and malformed input throw LegacyDecryptError. The v1.x
 * ParkStay password is never decrypted: migration v9 drops it (§12.32). Nor is the v1.x Gmail
 * OTP file: that feature is gone and its file is deleted (P7).
 */

import type Database from 'better-sqlite3';
import * as decryptors from '@main/security/legacy-decryptors';
import {
  decryptLegacyNotifierConfig,
  legacyMachineId,
  LegacyDecryptError,
} from '@main/security/legacy-decryptors';
import { FIXTURE_MACHINE_ID, FIXTURE_SMTP_PASSWORD } from '@tests/fixtures/db/constants';
import { disposeFixture, loadFixture } from '@tests/utils/database-helper';

jest.mock('node-machine-id', () => ({ machineIdSync: () => 'mocked-machine-id' }));

/** The full notifier config plaintext documented in tests/fixtures/db/README.md. */
const FIXTURE_NOTIFIER_CONFIG = {
  preset: 'gmail',
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: { user: 'fixture.user@example.com', pass: FIXTURE_SMTP_PASSWORD },
  toEmail: 'fixture.user@example.com',
};

describe('legacy decryptors', () => {
  let db: Database.Database;
  let notifierConfig: string;

  beforeAll(() => {
    db = loadFixture('v5-release-1.2.0');
    notifierConfig = (
      db.prepare('SELECT config FROM notification_providers').get() as { config: string }
    ).config;
  });

  afterAll(() => disposeFixture(db));

  it('notifier: recovers the fixture SMTP config (iv:authTag:ciphertext)', () => {
    expect(notifierConfig).toMatch(/^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(JSON.parse(decryptLegacyNotifierConfig(notifierConfig, FIXTURE_MACHINE_ID))).toEqual(
      FIXTURE_NOTIFIER_CONFIG
    );
  });

  it('wrong key: another machine id throws', () => {
    expect(() => decryptLegacyNotifierConfig(notifierConfig, 'another-machine')).toThrow(
      LegacyDecryptError
    );
  });

  it('has no Gmail store decryptor any more', () => {
    expect(Object.keys(decryptors).filter((name) => /gmail/i.test(name))).toEqual([]);
    expect(Object.keys(decryptors)).toContain('decryptLegacyNotifierConfig');
  });

  it('malformed input throws LegacyDecryptError', () => {
    for (const config of [
      '',
      'not-hex:zz:yy',
      'a0b1:c2d3',
      `${'0'.repeat(32)}:${'0'.repeat(32)}:ab`,
    ]) {
      expect(() => decryptLegacyNotifierConfig(config, FIXTURE_MACHINE_ID)).toThrow(
        LegacyDecryptError
      );
    }
  });

  it('legacyMachineId reads node-machine-id (the hashed id the v1.x keys used)', () => {
    expect(legacyMachineId()).toBe('mocked-machine-id');
  });
});
