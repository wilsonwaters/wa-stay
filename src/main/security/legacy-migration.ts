/**
 * Startup migration of the v1.x secrets to SecretVault envelopes (architecture-notes §7):
 * each legacy ciphertext is decrypted once with the legacy algorithm and re-encrypted.
 *
 * Runs in `createContainer` after the database migrations and before anything reads a
 * secret, on every start. It is idempotent and migrates each item on its own (one
 * transaction per database row), so a crash leaves each item either old or new and the next
 * start finishes the job. An item that cannot be decrypted is left exactly as it is: its
 * consumer reports it as `unreadable`, and the next start tries again. Values are never
 * logged.
 *
 * The legacy value is the only copy, so each new envelope is decrypted and compared with
 * the plaintext (`vault.encryptVerified`) before it replaces it. One that does not read back
 * leaves the item unchanged and counts it as `failed`.
 *
 * - `notifiers.config`: replaced by the envelope.
 *
 * The v1.x ParkStay password (`users`) is not migrated: ParkStay never used it, and migration
 * v9 drops its columns before this runs (architecture-notes §12.32).
 *
 * The Gmail OTP sign-in (`gmail-oauth.json`) is not migrated either: the feature is gone (P7),
 * and `removeRetiredGmailStore` deletes the file instead.
 *
 * An empty legacy notifier config migrates to `''`, which reads as `missing`.
 */

import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { decryptLegacyNotifierConfig } from './legacy-decryptors';
import { SecretVaultNotReadyError, type SecretVault } from './secret-vault';

export interface MigrateLegacySecretsOptions {
  db: Database.Database;
  vault: SecretVault;
  /**
   * Reads the machine id the v1.x keys were derived from (`legacyMachineId`). Called only
   * when a machine-bound legacy value is found, at most once per run.
   */
  machineId: () => string;
}

export interface LegacyMigrationResult {
  /** Items re-encrypted (or emptied) in this run. */
  migrated: number;
  /** Items already vault envelopes, or with nothing stored. */
  current: number;
  /** Items that could not be decrypted; left unchanged. */
  failed: number;
}

interface NotifierRow {
  id: number;
  channel: string;
  config: string;
}

type Outcome = keyof LegacyMigrationResult;

export function migrateLegacySecrets({
  db,
  vault,
  machineId,
}: MigrateLegacySecretsOptions): LegacyMigrationResult {
  const result: LegacyMigrationResult = { migrated: 0, current: 0, failed: 0 };
  const count = (outcome: Outcome): void => {
    result[outcome] += 1;
  };
  let cachedMachineId: string | undefined;
  const getMachineId = (): string => (cachedMachineId ??= machineId());

  const notifiers = db.prepare('SELECT id, channel, config FROM notifiers').all() as NotifierRow[];
  for (const row of notifiers) {
    count(attempt(`notifier ${row.channel}`, () => migrateNotifier(row)));
  }

  logger.info(
    `Legacy secrets: ${result.migrated} migrated, ${result.current} current, ${result.failed} failed`
  );
  return result;

  function migrateNotifier(row: NotifierRow): Outcome {
    if (row.config === '' || vault.isEnvelope(row.config)) return 'current';

    const config = decryptLegacyNotifierConfig(row.config, getMachineId());
    const envelope = isEmptyConfig(config) ? '' : vault.encryptVerified(config);
    db.transaction(() => {
      db.prepare('UPDATE notifiers SET config = ? WHERE id = ? AND config = ?').run(
        envelope,
        row.id,
        row.config
      );
    })();
    return 'migrated';
  }
}

/** Runs one item's migration; a failure is logged (by name only) and counted, never thrown. */
function attempt(item: string, migrate: () => Outcome): Outcome {
  try {
    return migrate();
  } catch (error) {
    // A startup-order bug, not a bad item: fail the start
    if (error instanceof SecretVaultNotReadyError) throw error;
    logger.warn(
      `Legacy secrets: ${item} could not be migrated and was left unchanged (${describe(error)})`
    );
    return 'failed';
  }
}

/** The error's message for our own errors; never anything that could carry a value. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

/** `''` or a JSON object with no fields: nothing worth storing. */
function isEmptyConfig(config: string): boolean {
  if (config.trim() === '') return true;
  try {
    const parsed: unknown = JSON.parse(config);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length === 0
    );
  } catch {
    return false;
  }
}

/** The retired Gmail OTP sign-in file, in the data folder (the v1.x electron-store `name`). */
export const RETIRED_GMAIL_STORE_FILE_NAME = 'gmail-oauth.json';

/**
 * Deletes the retired Gmail OTP sign-in from the data folder `userDataDir`, and returns how
 * many files went. Nothing has read it since the feature was removed (P7), and it holds a
 * Google OAuth client secret and a refresh token with read access to the inbox (as vault
 * envelopes, or as the v1.x file an earlier WA Stay build copied), so it is deleted rather
 * than left on disk. Leftovers of earlier builds go with it: a `.migrating` copy, `.corrupt-*`
 * files set aside and `.tmp` writes. Runs on every start; a no-op once they are gone. The
 * v1.x data folder's own copy is never touched: the legacy install keeps that folder as the
 * user's backup. A file that cannot be deleted is logged (by name only) and tried again at
 * the next start.
 */
export function removeRetiredGmailStore(userDataDir: string): number {
  const name = RETIRED_GMAIL_STORE_FILE_NAME;
  let entries: string[];
  try {
    entries = fs.readdirSync(userDataDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn(`Retired Gmail sign-in: the data folder could not be read (${describe(error)})`);
    }
    return 0;
  }
  const retired = entries.filter(
    (entry) =>
      entry === name ||
      entry === `${name}.migrating` ||
      entry.startsWith(`${name}.corrupt-`) ||
      (entry.startsWith(`.${name}.`) && entry.endsWith('.tmp'))
  );
  let removed = 0;
  for (const entry of retired) {
    try {
      fs.rmSync(path.join(userDataDir, entry), { force: true });
      removed += 1;
    } catch (error) {
      logger.warn(`Retired Gmail sign-in: ${entry} could not be deleted (${describe(error)})`);
    }
  }
  if (removed > 0) logger.info(`Retired Gmail sign-in: deleted ${removed} file(s)`);
  return removed;
}
