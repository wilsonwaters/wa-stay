# Database schema fixtures

SQL dumps that stand in for real user databases in the migration tests. They are dumps,
not `.db` files, because `*.db` is gitignored and a text dump diffs and reviews cleanly
(architecture-notes §12.13).

| File | Schema | Generated from `connection.ts` at | Represents |
| --- | --- | --- | --- |
| `v5-release-1.2.0.sql` | v5 | `dcccfa72a5c89f13aaec3c78f207e3e8ffc90147` (chore: prepare release v1.2.0) | A v1.2.0 install, the release users actually have |
| `v6-branch.sql` | v6 | `29bd91f78a1d17361e8b9126cb1f3fdd554634ab` (last pre-P2 commit; v6 landed in `ec66641`) | A dev build of the Site Sniper branch |

v6 never shipped, so real upgrades go v5 → v7 and dev builds go v6 → v7.

## How they are made

`generate.ts` reads both `connection.ts` versions with `git show` and runs their own
`SCHEMA_SQL` and `runMigrations`, so the schema is exactly what that code produced.

- **v5**: a fresh database migrated by the v1.2.0 code, then the rows below.
- **v6**: the v5 dump replayed, then started the way a pre-P2 dev build starts it
  (`foreign_keys=ON`, `SCHEMA_SQL`, `runMigrations`), then one Site Sniper row.
  Migration 006 renames `notifications` aside and drops it, so SQLite rewrites the
  delivery-log foreign key to `REFERENCES "notifications_old"(id)`. The dump keeps that
  broken FK, which is exactly what v7 must repair.

Each dump holds every `sqlite_master` statement in creation order (tables with their rows,
then `sqlite_sequence`, then indexes, then triggers) and the `migrations` rows. Values are
written with SQLite's `quote()`.

Regenerate from the repository root (needs the git history for both SHAs):

```bash
npx ts-node --transpile-only -O '{"module":"commonjs"}' tests/fixtures/db/generate.ts
```

The output is deterministic: IVs, keys and timestamps are fixed, and `migrations.applied_at`
is pinned. Regenerating without a change reproduces both files byte for byte.
**Never hand-edit a dump.** Change `generate.ts` and regenerate.

Load one in a test with `loadFixture(name)` from `tests/utils/database-helper.ts`. It replays
the dump into a fresh temp database with `foreign_keys=OFF`; release it with
`disposeFixture(db)`.

## Row inventory

The same rows are in both fixtures. v6 adds one `site_snipes` row and the v6 `migrations` row.

| Table | Rows | Notes |
| --- | --- | --- |
| `users` | 1 | id 1, `fixture.user@example.com`, password encrypted with the legacy scheme |
| `bookings` | 2 | one confirmed with `booking_data` JSON, one cancelled with NULL optionals |
| `watches` | 2 | id 1 has `preferred_sites` and `last_availability` JSON and `allow_partial_match = 1` |
| `notifications` | 3 | `watch_found`/`watch`, `info` with no related type, and legacy `stq_success`/`stq` |
| `notification_providers` | 1 | `email_smtp`, enabled, config encrypted with the legacy scheme |
| `notification_delivery_logs` | 2 | id 1 linked to notification 1 (sent), id 2 with NULL `notification_id` (failed) |
| `settings` | 3 | one each of `boolean`, `number` and `json` |
| `queue_session` | 1 | the singleton row |
| `skip_the_queue_entries` | 1 | dead feature; v7 drops the table |
| `job_logs` | 0 | |
| `site_snipes` | 1 (v6 only) | daily-rollover snipe for Osprey Bay |
| `migrations` | 5 (v5), 6 (v6) | |

`constants.ts` exports these counts as `V5_ROW_COUNTS` and `V6_ROW_COUNTS`.

## Fake secrets

The secrets are encrypted with the **legacy** v1.x algorithms (AES-256-GCM, key from
PBKDF2-SHA512 over machine id + app constant, 100,000 iterations), as in
`AuthService.ts` (`encryptPassword`/`getEncryptionKey`) and
`notifier.repository.ts` (`encryptConfig`/`getEncryptionKey`). P5 uses them to
test legacy decryption.

| Value | Plaintext |
| --- | --- |
| Machine id fed to the key derivation | `fixture-machine-id` |
| `users.encrypted_password` (user 1) | `fixture-password-1` |
| `auth.pass` inside the `email_smtp` notifier config | `fixture-smtp-app-password` |

The full notifier config plaintext is:

```json
{"preset":"gmail","host":"smtp.gmail.com","port":587,"secure":false,"auth":{"user":"fixture.user@example.com","pass":"fixture-smtp-app-password"},"toEmail":"fixture.user@example.com"}
```

These values are fake and exist only in this folder. `constants.ts` exports them.
