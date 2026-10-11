# P2 — Database foundation: one injected repository pattern, transactional migrations, v7 integrity migration

**Stream:** platform · **Depends on:** P1

## Description
The data layer has two repository styles, unsafe SQL APIs, non-atomic migrations and a live data-integrity bug.

1. **Two base classes.**
   - `repositories/BaseRepository.ts` takes an injected DB and is used by User, Booking, Settings and NotificationProvider.
   - `repositories/base.repository.ts` calls `getDatabase()` in its constructor (`:11-13`) and is used by Watch, SiteSniper and Notification.
   - Services build their own repositories (`watch.service.ts:17`, `notification.service.ts:27`, `sitesniper.service.ts:37`). `queue.service.ts:70,115,140` calls `getDatabase()` directly.
2. **SQL-fragment APIs.** `findWhere`, `findOneWhere`, `deleteWhere` and `count(condition)` (`base.repository.ts:36-79`) and `count(where)` (`BaseRepository.ts:70-81`) all take raw SQL text. Enum values are interpolated into SQL at `site-sniper.repository.ts:129-130,139-140`.
3. **Non-atomic migrations.** `runMigrations` (`connection.ts:210-423`) applies v2–v6 without transactions. `SCHEMA_SQL` (v1) runs on every startup (`connection.ts:454`), so it would re-create any table a later migration drops.
4. **Live bug (verified 2026-10-02, SQLite 3.45.3).**
   - Migration 006 (`connection.ts:394-418`) renames `notifications` to `notifications_old`. SQLite ≥3.26 then rewrites the FK in `notification_delivery_logs` to point at `"notifications_old"`, and the migration drops that table.
   - After that, every insert into `notification_delivery_logs` fails with `no such table: main.notifications_old`, even when `notification_id` is NULL.
   - `NotificationDispatcher` logs a delivery after every send (`notification-dispatcher.ts:103`). The catch block's second `logDelivery` (`:129`) throws again, which aborts dispatch to the remaining notifiers.
5. **Fixture baseline.** The **released v1.2.0 (`dcccfa7`) ships schema v5.** v6 exists only on this branch. Real upgrades therefore run v5 → v7, and dev builds run v6 → v7.
6. **Dead code.** `src/main/database/schema.sql` is unreferenced. The connection helpers at `connection.ts:492-547` are unused. `setDatabase` (`:477`) exists only for tests.

## Size
L

## Scope
- **One base class**, `repositories/base.repository.ts`:
  - `constructor(db: Database.Database)`, `protected abstract readonly tableName` and `protected abstract mapRow(row): T`.
  - `findById(id): T | null`, `findAll()`, `deleteById(id): boolean` and `exists(id)`.
  - Helpers: `parseJson`, `stringifyJson` (NULL only for `null`/`undefined`), `parseDate`, `formatDate` and `protected transaction(fn)`.
  - **No method accepts a SQL fragment.**
  - Delete `BaseRepository.ts`. Rename `UserRepository.ts`, `BookingRepository.ts` and `SettingsRepository.ts` to `user.repository.ts`, `booking.repository.ts` and `settings.repository.ts`, keeping the class names. Update `repositories/index.ts`.
- **Injection everywhere:**
  - `WatchService(watchRepo, parkStay, notifications)`
  - `NotificationService(notificationRepo, dispatcher?)`
  - `SiteSniperService(snipeRepo, parkStay, queue, notifications)`
  - `QueueService(queueSessionRepo, config?)`, with a new `queue-session.repository.ts` holding the three queries now at `queue.service.ts:68-145`.
  - `index.ts` wires all of this for now; P3 moves the wiring into the container.
- **Parameterised SQL only.** Replace each `findWhere`/`count`/`deleteWhere` caller with an explicit prepared statement:
  - `watch.repository.ts:138,145,153`
  - `site-sniper.repository.ts:115,122,129,139`
  - `notification.repository.ts:64,89,96`
  - Bind enums as `?` parameters.
  - Table names (code constants) and dynamic `SET` lists built from code-literal column names are allowed. Say so in a comment in the base class.
- **`connection.ts` API.** Exports `openDatabase(filePath)` (sets `foreign_keys=ON`, `journal_mode=WAL` and runs migrations), `closeDatabase(db)` and `runMigrations(db)`.
  - No module singleton, and no `getDatabase`, `setDatabase` or `initializeDatabase`. **No `electron` import.**
  - `index.ts` passes `path.join(app.getPath('userData'), 'parkstay.db')`. B3 changes the name later.
- **Migration runner.** Keep one `if (currentVersion < N)` block per version inside `runMigrations()`, as CLAUDE.md requires, and wrap each body in `applyMigration(db, N, fn)`:
  - `applyMigration` runs `fn` and the `INSERT INTO migrations` in one `db.transaction()`.
  - It runs `PRAGMA foreign_key_check` before commit and throws `MigrationError(version, cause)` on any violation in the tables it touched.
  - `PRAGMA foreign_keys=OFF` is set before the first step and `ON` after the last step, **outside** any transaction (the pragma is a no-op inside one).
  - `SCHEMA_SQL` runs only as v1 (`currentVersion < 1`).
  - Historical v2–v6 SQL stays unchanged, except that v6's in-`exec` PRAGMA lines are removed (they are no-ops inside a transaction).
- **Migration v7** (architecture-notes §5 plus the §2 "notifier" vocabulary; master-plan open question 2). Rebuild tables only with the pattern *create under a temp name → copy → drop old → rename new → final*. Never rename the old table aside.
  1. Rebuild `notifications` without either CHECK constraint, then recreate its 4 indexes.
  2. Rebuild `notification_delivery_logs` with `FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE`. Rename `provider_channel` → `notifier_channel`. Copy orphan `notification_id` values as NULL. Recreate the indexes, with `idx_delivery_logs_provider` becoming `idx_delivery_logs_notifier`.
  3. `ALTER TABLE notification_providers RENAME TO notifiers`. SQLite cannot rename an index, so drop its two indexes and recreate them as `idx_notifiers_*`.
  4. `DROP TRIGGER update_stq_timestamp` and `DROP TABLE skip_the_queue_entries`. Log the number of discarded rows.
  - Update the SQL in `notification-provider.repository.ts` to the new names. Class and file renames are P3's job.
- **Code-level validation.** The CHECKs are gone, so `NotificationRepository.create` must reject a `type` or `relatedType` outside `NotificationType`/`RelatedType`. Reading must tolerate the legacy values `stq_success` and `stq`.
- **Fixtures** in `tests/fixtures/db/`. Per architecture-notes §12.13 these are **SQL dumps**; `*.db` is gitignored.
  - `v5-release-1.2.0.sql`, generated with `connection.ts` from `dcccfa7`.
  - `v6-branch.sql`, generated with `connection.ts` from `ec66641` or any later pre-P2 commit, such as `29bd91f`.
  - Each dump contains every `sqlite_master` statement in creation order (tables, then indexes, then triggers), all rows, `sqlite_sequence` and the `migrations` rows. A helper `loadFixture(name)` replays a dump into a fresh temp DB with `foreign_keys=OFF`.
  - Include a generator script and a `README.md` with the source SHAs, the row inventory and the fake plaintexts.
- **Tests and helpers.** Update `tests/utils/database-helper.ts` (no `setDatabase`, no `SCHEMA_SQL`). Replace module mocks with constructor fakes in `queue.test.ts:21-27` and `sitesniper.service.test.ts:12-37`.
- **Deletions.** Delete `schema.sql` and `connection.ts:492-547`.
- **CLAUDE.md** "Database" section: the migration list up to v7, and the `applyMigration` step in "Adding a new migration".

## Non-goals
- Provider-aware schema, `provider_accounts`, `locations` and `provider_state` (v8, **V2**).
- Calendar-date storage (#14, **V2**).
- Queue behaviour (#10, **V3**).
- Moving services into `core/` (**V4**).
- Notifier class, file and channel renames (**P3**).
- Re-encrypting secrets (**P5**).
- DB filename and userData path (**B3**).
- `job_logs` (**P7**).

## Completion Criteria
- [ ] Before any v7 code exists, a test (fresh DB → `runMigrations` → insert a delivery log with and without `notification_id`) fails with `no such table: main.notifications_old`. Record this in the PR notes. The test passes once v7 lands.
- [ ] `ls src/main/database/repositories` shows only `index.ts` and kebab-case `*.repository.ts` files. Exactly one of them is a base class (`base.repository.ts`).
- [ ] `grep -rn "getDatabase\|setDatabase\|findWhere\|findOneWhere\|deleteWhere" src tests` returns nothing.
- [ ] `grep -rn "new [A-Za-z]*Repository(" src/main/services` returns nothing.
- [ ] `grep -rnE "'\\$\{[A-Z][A-Za-z]+\.[A-Z_]+\}'" src/main/database` returns nothing (no interpolated enums). Today it matches `site-sniper.repository.ts:130,140`.
- [ ] `grep -n "electron" src/main/database/connection.ts` returns nothing.
- [ ] A fresh DB reaches `MAX(version)` = 7. Its tables are exactly users, bookings, watches, notifications, notification_delivery_logs, notifiers, job_logs, settings, queue_session, site_snipes and migrations (plus `sqlite_*`).
- [ ] The v5 and v6 fixtures, loaded with `loadFixture`, upgrade to v7 and meet all of the following:
  - row counts are preserved for every kept table;
  - `PRAGMA foreign_key_check` returns `[]` and `PRAGMA integrity_check` returns `ok`;
  - `PRAGMA foreign_key_list(notification_delivery_logs)` targets `notifications`;
  - the `notifiers` config ciphertext is byte-identical.
- [ ] The normalised `sqlite_master` (type, name, tbl_name, sql) is identical for a fresh v7 DB, an upgraded v5 fixture and an upgraded v6 fixture.
- [ ] Running `runMigrations` a second time changes nothing and throws nothing.
- [ ] To force a failure inside v7, pre-create its temp table name in a loaded fixture. Then:
  - a `MigrationError(7)` is thrown;
  - the version is unchanged and every original table and row is intact;
  - `PRAGMA foreign_keys` is back to 1.
- [ ] A DB whose version is above 7 is refused with a clear `DatabaseTooNewError`, and no migration runs.
- [ ] `NotificationRepository.create` rejects an unknown `type`. A legacy `stq_success` row is still readable.
- [ ] Integration: with a fake notifier, dispatching writes a delivery-log row, and a throwing notifier does not stop the next notifier from receiving the message.
- [ ] `schema.sql` and the unused connection helpers are deleted. CLAUDE.md is updated.
- [ ] `npm run lint && npm run format:check && npm run type-check && npm test` pass.

## Edge Cases
- `PRAGMA foreign_keys` and `journal_mode` are ignored inside transactions. Set them only outside `applyMigration`.
- Replaying a dump must reproduce the v6 bug byte-for-byte: `CREATE TABLE … REFERENCES "notifications_old"(id)` is accepted at create time. Assert in the loader test that `PRAGMA foreign_key_list(notification_delivery_logs)` on the loaded v6 fixture targets `notifications_old`.
- Index names are global across the schema. Create a rebuilt table's indexes only after the old table is dropped, or the names clash.
- Delivery-log rows whose `notification_id` has no parent are copied with NULL, not dropped.
- `skip_the_queue_entries` rows are discarded. The feature is gone, so log the count at info.
- Pre-v2 installs that have tables but no `migrations` rows start at version 0. v1's `CREATE … IF NOT EXISTS` must stay harmless there.
- `stringifyJson(false | 0 | '')` now stores JSON rather than NULL. Check `booking_data`, `preferred_sites` and `target_site_ids` round-trips.
- `findById` now returns `null` instead of `undefined`. Update callers and tests that use `toBeUndefined()`.
- `foreign_key_check` failures in tables a step did not touch are logged as warnings, not fatal, so old orphan data cannot brick startup. The step's own tables must be clean.
- A crash between steps leaves the DB at the last committed version. The next start resumes from there.

## Test Strategy
- **Unit:** about 18 tests.
  - Base repository (6).
  - Parameterised finders, including enum binding (6).
  - Notification type validation (2).
  - `applyMigration` (4): commit, rollback, FK toggling, too-new version.
- **Component:** none.
- **Integration:** about 12 tests.
  - The bug reproduction (2).
  - Fresh-DB shape (1).
  - v5 and v6 fixture upgrades (4).
  - Schema equivalence (1).
  - Idempotency and atomicity (2).
  - Dispatcher delivery logging (2).
  - Update `tests/integration/database.test.ts` and `tests/unit/database/site-sniper.repository.test.ts` to the new API.

## Context Files to Read First
- `ai-state/architecture-notes.md` §1, §2, §5 and §12.13. `CLAUDE.md`, "Database" section.
- `ai-state/research/tech-review.md`, findings 1, 3 and 12, and "Dead/duplicate code".
- `src/main/database/connection.ts`, `src/main/database/repositories/*` and `src/main/database/schema.sql`
- `src/main/services/watch/watch.service.ts:1-40`, `src/main/services/notification/notification.service.ts:1-50`, `src/main/services/sitesniper/sitesniper.service.ts:20-50`, `src/main/services/queue/queue.service.ts:40-145`
- `src/main/services/notification/notification-dispatcher.ts:85-135` and `src/main/index.ts:106-161`
- `tests/utils/database-helper.ts`, `tests/integration/database.test.ts`, `tests/unit/services/queue.test.ts:15-30` and `tests/unit/services/sitesniper.service.test.ts:1-40`
- `.gitignore` (`*.db`) and `git show dcccfa7:src/main/database/connection.ts`

## Notes
- SQLite's documented rebuild procedure is at <https://www.sqlite.org/lang_altertable.html#otheralter>. Renaming the *new* table to the final name leaves the FKs that point at the final name intact.
- **Fixture rows** (the same set in both fixtures, plus one snipe in v6): 1 user, 2 bookings, 2 watches (one with `last_availability` JSON), 3 notifications (one legacy `stq_success`/`stq`), 1 `email_smtp` notifier, 2 delivery logs, 3 settings, 1 queue_session and 1 skip_the_queue entry.
- The user password and the SMTP config are encrypted with the **legacy** algorithms (`AuthService.ts:165-227`, `notification-provider.repository.ts:395-460`) using machine id `fixture-machine-id`. Record the fake plaintexts in the fixture README. P5 uses these rows to test legacy decryption.
- Generate the v6 dump by migrating a copy of the v5 data with the v6 code, then dumping it. Delivery-log rows therefore exist with the broken FK text, which is exactly what v7 must repair. Hand-editing a dump is not allowed; regenerate it instead.
- Commit as a short series: tests and fixtures → repositories and injection → runner and v7.
