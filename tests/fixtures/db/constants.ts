/**
 * Fake secrets baked into the schema fixtures by `generate.ts`. They are encrypted with the
 * legacy v1.x schemes using FIXTURE_MACHINE_ID, so tests can prove legacy decryption.
 */

/** Machine id fed to the legacy PBKDF2 key derivation. */
export const FIXTURE_MACHINE_ID = 'fixture-machine-id';

/** Plaintext of `users.encrypted_password` (user 1). */
export const FIXTURE_USER_PASSWORD = 'fixture-password-1';

/** Plaintext of `auth.pass` inside the `email_smtp` notifier config. */
export const FIXTURE_SMTP_PASSWORD = 'fixture-smtp-app-password';

export type FixtureName = 'v5-release-1.2.0' | 'v6-branch';

/** Rows in the v5 fixture, by table. The v6 fixture has the same plus one `site_snipes` row. */
export const V5_ROW_COUNTS: Readonly<Record<string, number>> = {
  users: 1,
  bookings: 2,
  watches: 2,
  notifications: 3,
  notification_providers: 1,
  notification_delivery_logs: 2,
  settings: 3,
  queue_session: 1,
  skip_the_queue_entries: 1,
  job_logs: 0,
  migrations: 5,
};

export const V6_ROW_COUNTS: Readonly<Record<string, number>> = {
  ...V5_ROW_COUNTS,
  site_snipes: 1,
  migrations: 6,
};
