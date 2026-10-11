# V2 — Provider-aware data model (migration v8)

**Stream:** providers · **Depends on:** P2, V1

## Description

Every persisted watch, snipe, booking and notification must say which provider it belongs to. The schema must also let a non-ParkStay provider save rows without inventing park ids or gear types.

V2 adds migration **v8** per architecture-notes §5 and the provider-aware domain types and contracts. It updates the repositories and makes mechanical consumer edits so behaviour is unchanged. V2 also creates the `provider_accounts`, `provider_state` and `locations` (+ FTS5) tables used by V3, V5 and V6.

The migration also normalises calendar dates that legacy code stored as ISO timestamps (tech-review #14).

Story: as an existing ParkStay Bookings user, after the upgrade every watch, snipe, booking and setting is still there and is labelled ParkStay.

## Size

L. This is a cross-cutting schema change with table rebuilds, and its migration correctness is critical (brief success criterion 2).

## Scope

- **Migration v8** goes in `src/main/database/connection.ts` `runMigrations()`, after P2's v7.
  - It is transactional, using P2's runner. `PRAGMA foreign_keys=OFF` is set *before* `BEGIN`, because inside a transaction the pragma is a no-op, and restored after.
  - It ends with `PRAGMA foreign_key_check` (which must return 0 rows) and records version 8.
  - It is idempotent: each step checks `sqlite_master` and `PRAGMA table_info`.
  - Rebuilds follow sqlite.org's "other kinds of table schema changes" recipe: create `X_v8`, copy, drop `X`, then `ALTER TABLE X_v8 RENAME TO X`. After that, recreate the indexes and the `update_*_timestamp` triggers.
  - `D(col)`, the calendar-date normalisation, is `CASE WHEN length(col) > 10 THEN COALESCE(date(col, '+12 hours'), substr(col,1,10)) ELSE col END`. This takes the nearest UTC midnight. It works for rows written at UTC midnight (`toISOString`) and at local midnight anywhere from UTC−11 to UTC+12, including AWST (`…T16:00:00.000Z`).
- **`watches` rebuild:**
  - `provider_id TEXT NOT NULL DEFAULT 'parkstay'`;
  - `location_external_id` ← `campground_id`;
  - `location_name` ← `campground_name`;
  - `area_name` ← `park_name`;
  - `arrival_date` / `departure_date` ← `D(...)`;
  - `num_adults` ← `num_guests`; `num_children`, `num_infants` and `num_concessions` = 0;
  - `unit_ids` ← `preferred_sites`;
  - `stay_params` ← `json_object('parkId', park_id, 'gearType', site_type)`, with null members dropped;
  - every other column copied 1:1: `check_interval_minutes`, `is_active`, `last_checked_at`, `next_check_at`, `last_result`, `found_count`, `auto_book`, `notify_only`, `allow_partial_match`, `max_price`, `notes`, `last_availability`, timestamps, `user_id` FK;
  - index `(provider_id, is_active)`.
- **`site_snipes` rebuild.** Drops the `release_mode` CHECK (`connection.ts:357-358`).
  - `provider_id`;
  - `location_external_id` ← `campground_id`;
  - `location_name` ← `campground_name`;
  - `area_name` NULL;
  - `unit_ids` ← `target_site_ids`;
  - dates ← `D(...)`;
  - `num_adults`, `num_children`, `num_infants`, `num_concessions` ← `num_adult`, `num_child`, `num_infant`, `num_concession`;
  - `stay_params` ← `{gearType: site_type, numVehicles: num_vehicle, postcode}`;
  - `access_gate_enabled` ← `queue_enabled`;
  - `hold_reference` ← `held_booking_pk`;
  - `hold_expires_at` ← `held_expires_at`;
  - new `hold_unit_id` NULL. Today the matched site is dropped (`site-sniper.repository.ts:204-219`);
  - every other column copied 1:1: `release_mode`, `release_at`, timing, status, attempts, results, `payment_url`, `booked_reference`, `notes`, timestamps.
- **`bookings` rebuild:**
  - `provider_id`;
  - `UNIQUE(provider_id, booking_reference)` replaces the inline `UNIQUE` (`connection.ts:42`);
  - `location_external_id` NULL;
  - `location_name` ← `campground_name`;
  - `area_name` ← `park_name`;
  - `unit_ids` ← `json_array(site_number)` when not null;
  - `stay_params` ← `{siteType: site_type}`;
  - dates ← `D(...)`;
  - every other column copied 1:1, including `booking_data`, `status` and its CHECK, `synced_at`;
  - index `(provider_id, arrival_date)`.
- **`notifications`.** `ADD COLUMN provider_id TEXT NULL`. Backfill `'parkstay'` where `related_type IN ('watch','snipe','booking')`. Add an index on it.
- **`provider_accounts`** is created per §5 with `status` default `'unknown'`.
  - It gets one `'parkstay'` row from the first `users` row (`ORDER BY id LIMIT 1`): `email`, `display_name = NULLIF(trim(first_name||' '||last_name),'')` and `last_signed_in_at` NULL.
  - The `users` table stays as the local profile (name, phone). P5 owns its encrypted columns.
- **`users` rebuild (credential-independent profile; platform open question 1).**
  - `email`, `encrypted_password`, `encryption_key`, `encryption_iv` and `encryption_auth_tag` become nullable. Their values are kept for P5's `migrateLegacySecrets`. V6 drops the credential columns later.
  - If the table is empty after v8, including on a fresh install, insert the single local profile row (`id 1`, every credential column NULL). After this, P3's `requireUserId()` never returns `NO_PROFILE`.
  - Recreate `idx_users_email` and `update_users_timestamp`.
  - `AuthService` and `UserRepository` must tolerate a NULL email (mechanical edit).
- **`provider_state`** is created per §5.
  - The singleton `queue_session` row (`connection.ts:297-307`) becomes `('parkstay', 'queue.session', json_object('sessionKey', session_key, 'status', status, 'position', position, 'estimatedWaitSeconds', estimated_wait_seconds, 'expirySeconds', expiry_seconds, 'expiresAt', expires_at, 'createdAt', created_at))`.
  - Then `DROP TABLE queue_session`. V3 reads this exact shape.
- **`locations`** is created per §5, plus two columns: `detail JSON` and `detail_fetched_at`.
  - Indexes: `(provider_id)`, `(kind)`, `(booking_mode)`, `(region)`, `(lat, lng)`.
  - `locations_fts` is FTS5 with `content='locations'`, `content_rowid='rowid'`, `tokenize='unicode61 remove_diacritics 2'`, over `name, area_name, region, summary`. AFTER INSERT, UPDATE and DELETE triggers keep it in sync.
- **Domain types and contracts.** Change these in `src/shared/types/{watch,site-sniper,booking,notification}.types.ts` and P3's `shared/contracts/{watches,snipes,bookings}`:
  - `Watch`/`SiteSnipe`/`Booking` gain `providerId`, `locationKey`, `location { externalId, name, areaName? }`, `stay` (arrival and departure as `YYYY-MM-DD`; `adults`, `children`, `infants`, `concessions`), `unitIds` and `stayParams`. `SiteSnipe` adds `accessGateEnabled`, `holdReference`, `holdExpiresAt` and `holdUnitId`.
  - `Notification` gains `providerId?`.
  - Instants (`lastCheckedAt`, `releaseAt`, …) stay `Date`.
  - The Inputs mirror these fields. `userId` is absent from the contracts.
  - zod uses V1's `CalendarDateSchema`.
- **`src/shared/utils/calendar-date.ts`.** Pure functions: `isCalendarDate`, `addDays`, `nightsBetween`, `eachNight(arrival, departure)`, `compareDates` and `todayIn(timeZone, now)` (via `Intl.DateTimeFormat`). There is no `Date`-from-string parsing that depends on the host timezone.
- **Repositories** follow P2's style (injected `Database`, parameterised SQL only). These are updated:
  - `WatchRepository`, `SiteSnipeRepository`, `BookingRepository`. The interpolated enums at `site-sniper.repository.ts:129-131` and `:139-143` become bound parameters.
  - `NotificationRepository`.

  These are new:
  - `ProviderStateRepository` and `SqliteKeyValueStore`, which implements V1's `KeyValueStore`. The container swaps it into `ProviderContext.state`, which also makes V1's scoped secrets persistent.
  - P2's `QueueSessionRepository` is repointed to `provider_state` `('parkstay', 'queue.session')`, using the agreed JSON shape, so the existing queue service keeps working until V3 deletes the repository.
  - `ProviderAccountRepository`: `get`, `list` and `upsert`.
  - `LocationRepository`. `upsertMany(providerId, summaries, fetchedAt)` runs in one transaction and deletes that provider's rows not in the set. It also has `get(providerId, externalId)`, `setDetail`/`getDetail` and `countByProvider`. Search is V5's job.
- **Mechanical consumer edits:**
  - services, IPC handlers and the existing renderer callers (`WatchForm`, `SiteSniperForm`, `ManualBookingForm`, `ImportBookingForm`, and the Watches, SiteSniper and Bookings pages) switch to the new field names and `YYYY-MM-DD` strings;
  - ParkStay calls are unchanged, mapping `location.externalId` to the campground id;
  - every new row is written with `providerId: 'parkstay'`;
  - there are no visual changes.
- **Fixtures and tests.** Use P2's two SQL-dump fixtures through `loadFixture(name)`: v5 (the released v1.2.0) and `v6-branch.sql`. `*.db` is gitignored. Real upgrades run v5 → v7 → v8.
  - Do not edit P2's dumps.
  - After `loadFixture`, and before migrating, the test inserts the extra rows below at the fixture's version, in the v5/v6 column layout.

  Extra rows that look real:
  - a user with encrypted creds;
  - 3 watches: one at UTC midnight, one at AWST midnight (`T16:00:00.000Z`), one inactive with `preferred_sites` and `site_type`;
  - 2 snipes, in the v6 fixture only (`site_snipes` arrives in v6): `daily_rollover`, and `scheduled` with `queue_enabled=1` and a held pk;
  - 2 bookings;
  - notifications with every `related_type`, including legacy `stq`;
  - a `queue_session` row;
  - settings;
  - an SMTP notifier row.

## Non-goals

- Using provider modules or the registry in services (V3, V4). Moving services to `core/` (V4).
- Catalogue search, FTS query building and sync (V5). Account sign-in (V6).
- Re-encrypting `users` secrets or `notification_providers` config (P5).
- Creating or editing the fixtures (P2 owns the v5 and v6 dumps). The legacy-folder copy (B3).
- Any renderer redesign (U1–U3).

## Completion Criteria

- [ ] From both the v5 and v6 fixtures, `runMigrations` reaches version 8 and passes these checks:
  - `PRAGMA foreign_key_check` returns 0 rows and `PRAGMA integrity_check` returns `ok`;
  - running it a second time is a no-op and the version stays 8.
- [ ] Watch rows, after migration:
  - the fixture watch at `2026-12-12T16:00:00.000Z` has `arrival_date = '2026-12-13'`;
  - the one at `2026-12-13T00:00:00.000Z` also has `'2026-12-13'`;
  - all rows have `provider_id = 'parkstay'`;
  - `location_external_id` equals the old `campground_id` and `area_name` the old `park_name`;
  - `stay_params` = `{"parkId":"…","gearType":"…"}`;
  - `unit_ids` equals the old `preferred_sites`.
- [ ] Snipe and booking rows, after migration:
  - the snipe keeps `release_mode`, `release_at`, `status` and `attempts_count`;
  - its `access_gate_enabled = 1`, `hold_reference` is the old pk, and `stay_params.numVehicles` and `stay_params.postcode` are preserved;
  - an insert with `release_mode = 'custom'` succeeds (the CHECK is gone);
  - a second booking with the same reference and `provider_id = 'fake'` inserts, while the same `(provider_id, reference)` pair fails with UNIQUE.
- [ ] Backfilled tables, after migration:
  - `provider_accounts` has one `parkstay` row with the fixture user's email and display name, and `status = 'unknown'`;
  - `provider_state` has `('parkstay','queue.session')`, whose JSON contains the fixture `sessionKey`;
  - `queue_session` no longer exists;
  - notifications with `related_type` `watch`/`snipe`/`booking` have `provider_id = 'parkstay'`, and `info` rows have NULL.
- [ ] `locations` and FTS: `LocationRepository.upsertMany('fake', [3 items])` followed by `SELECT … FROM locations_fts WHERE locations_fts MATCH 'bung*'` finds the inserted row. Re-upserting 2 items deletes the third, and FTS no longer finds it.
- [ ] A migration failure rolls back. A test injects a failing statement mid-v8; the DB stays at v7 and the original `watches` rows are intact.
- [ ] A fresh install (an empty DB through v1–v8) produces the same normalised `sqlite_master` as the migrated v5 and v6 fixtures. This is a schema-snapshot comparison test, matching P2's pattern.
- [ ] Profile row: a fresh DB at v8 has exactly one `users` row (`id 1`, `email` NULL), so `requireUserId()` returns 1. The fixture's existing user keeps its id, email and encrypted columns byte-identical, and no second row is added.
- [ ] P2's `QueueSessionRepository` reads back the fixture `queue_session` values from `provider_state` after migration.
- [ ] `grep -rn "\${SnipeStatus\|\${SnipeReleaseMode" src/main/database` → 0 results.
- [ ] The repositories round-trip the new domain types, with dates as `'YYYY-MM-DD'` strings, `stayParams` as an object and `unitIds` as an array. The contract zod schemas reject `arrival: '2026-07-19T00:00:00.000Z'`.
- [ ] The existing app still works on the migrated DB:
  - creating, listing, running and deleting a watch from the current Watches page succeeds;
  - Site Sniper and Bookings lists render their existing rows;
  - this is checked with the dev build against the migrated fixture copy.
- [ ] `npm run lint && npm run format:check && npm run type-check && npm test` passes.

## Edge Cases

- **Unexpected date values.**
  - An empty or NULL date stays as is (NOT NULL columns cannot be NULL in v6, but defend anyway).
  - A non-date string (`'garbage'`) is copied unchanged and counted in a migration warning log line. Repositories surface such rows with `stay.arrival` invalid, and the services mark them in error rather than crashing.
- **`users` table:**
  - 0 users: no `provider_accounts` row is created; the empty local profile row is inserted only after `provider_accounts` has been populated;
  - 2+ users: only the first is migrated and a warning is logged;
  - a user with an empty name gets `display_name` NULL.
- **`queue_session` table:**
  - absent (the v4 migration never ran on a weird install) or empty: skip;
  - an expired session is still migrated (V3 discards it).
- **Null and malformed JSON.**
  - `preferred_sites`/`target_site_ids` that are NULL or `'[]'` become `unit_ids` `'[]'`.
  - Malformed JSON is kept verbatim in `unit_ids` and parsed defensively, so a bad value reads as `[]` with a log line.
- **Rebuild side effects.**
  - The v6 `ALTER TABLE … RENAME` bug (tech-review #1) must not recur. Rename only the new `X_v8` table, never the old one.
  - After the rebuild, verify `sqlite_master` has no reference to `*_v8` or `*_old`.
- **Partial earlier run.** v8 was half-applied by a crashed earlier run. The transaction makes this impossible, but the idempotency checks also tolerate an existing `provider_state`.
- **FTS5.** The test asserts it is available in the bundled SQLite. If it is not, the migration fails loudly. It never skips FTS silently.

## Test Strategy

- **Unit (~25):**
  - `D()` normalisation cases (~6);
  - `calendar-date.ts` (~8, including month ends and leap years);
  - repository mapping for each table (~8);
  - `SqliteKeyValueStore` (~3).
- **Component:** none.
- **Integration (~12):** `tests/integration/migration-v8.test.ts` loads the v5 and v6 fixtures with P2's `loadFixture` into temp file DBs in WAL mode, seeds the extra rows, then runs:
  - full upgrade assertions per table;
  - the idempotency rerun;
  - the rollback-on-failure test;
  - the fresh-versus-migrated schema snapshot;
  - the FTS sync tests;
  - the UNIQUE `(provider_id, reference)` test.

## Context Files to Read First

- `ai-state/architecture-notes.md` §2, §5 (binding). `ai-state/research/tech-review.md` findings #1, #12, #14 and the Entities table.
- `ai-state/streams/providers/master-plan.md`: the v8 rows of "Contract additions".
- `ai-state/streams/platform/tasks/P2-database-foundation.md`: `applyMigration`, `loadFixture`, fixture rows, `QueueSessionRepository`. Also `ai-state/streams/platform/master-plan.md` (open question 1, the V2 notes) and `ai-state/streams/brand-migration/tasks/B3-legacy-install-migration.md` (v5/v6 expectations).
- `src/main/database/connection.ts:21-202` (v1 schema), `:210-423` (migrations v2–v6) and P2's v7 and transaction runner.
- `src/main/database/repositories/{watch,site-sniper,BookingRepository,notification,base.repository,BaseRepository}.ts`, as left by P2.
- `src/shared/types/{watch,site-sniper,booking,notification,common}.types.ts` and P3's `shared/contracts/{watches,snipes,bookings}`.
- `src/main/services/queue/queue.service.ts:68-145` (the `queue_session` read/write shape).
- `tests/utils/database-helper.ts` and `tests/fixtures/{watches,site-sniper,bookings,users}.ts`.

## Notes

- **Why rebuild rather than only add columns.** §5 says the tables "gain" generic columns. A pure `ADD COLUMN` would leave `park_id`, `park_name`, `campground_id` and `campground_name` as NOT NULL (`connection.ts:72-75`), plus the `release_mode` CHECK. Non-ParkStay rows would then need fake values, and the table would hold duplicate columns, which §1 forbids. The legacy values survive in `stay_params`. This is recorded as a contract addition in the master plan.
- **Why `+12 hours`.** All legacy rows are ParkStay (`Australia/Perth`, no DST). Rounding to the nearest UTC midnight is correct for the `toISOString()` writes at `BookingRepository.ts:115-116` and `base.repository.ts:130-133`. It is also correct for local-midnight `Date`s created by machines east or west of UTC.
- **Agreed shape.** The `queue.session` key and its JSON shape are agreed with V3; do not rename them.
- **Commit.** `feat(db): provider-aware data model, migration v8 (#<issue>)`.
