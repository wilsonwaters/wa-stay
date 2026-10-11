# P7 — Dead code and constants cleanup, scheduled data cleanup, stale root docs

**Stream:** platform · **Depends on:** V3, V4 (scheduled last in lane M, after B3)

## Description
The technical review ("Dead/duplicate code") lists code, constants, a table and documents that nothing uses. P1 and P2 remove the test and database leftovers. V3 removes the fake ParkStay endpoints (`login`, `validateSession`, `createBooking`, …). This task sweeps up everything that is still dead once those streams have landed. It also wires up the cleanup job that today does nothing.

What remains dead today:

- **Unused constants.** On 2026-10-02, the check command in Completion Criteria reports **33 of the 43** exported constants in `src/shared/constants/app-constants.ts` as unreferenced. Examples:
  - `APP_NAME` and `APP_VERSION` (`:3-4`), the latter claiming `1.0.0`;
  - `REBOOK_ADVANCE_DAYS_MIN/MAX` (`:12-13`);
  - `MIN/MAX_WATCH_INTERVAL` (`:25-26`);
  - `MAX_CONCURRENT_WATCHES` (`:39`);
  - `DB_NAME` (`:43`);
  - `MAX_RETRIES` and the retry and back-off constants (`:46-49`);
  - `RATE_LIMIT_*` (`:52-53`);
  - `SESSION_TIMEOUT_HOURS` (`:56`).

  ParkStay domain values such as `BOOKING_WINDOW_DAYS`, `NINGALOO_RELEASE_HOUR_AWST` and the `DEFAULT_SNIPE_*` defaults are also unreferenced today. V3 is expected to adopt or move them into `providers/parkstay/`, so whatever is still unreferenced after V3 is deleted here.
- **Booking placeholders.** `BookingService.importBooking` and `syncBooking` (`BookingService.ts:184-215`) are placeholders, and `getBookingStats` (`:292`) is unused. Behind them sit the `booking:sync` and `booking:sync-all` channels (`booking.handlers.ts:141-185`).
- **Site Sniper.** `SiteSniperService.runSnipeWindow` (`sitesniper.service.ts:305`) is never called.
- **Cleanup job.** `JobScheduler.runCleanup` (`job-scheduler.ts:438-440`) only logs. Its 02:00 AWST cron (`:409-423`) therefore deletes nothing, so notifications and delivery logs grow without bound.
- **`job_logs` table.** It is never written, and its CHECK would reject `JobType.SNIPE`. Related code: `JobType`/`JobStatus`/`JobLog` types (`common.types.ts:61-70,119,129`), `JOB_LOG_RETENTION_DAYS`, and test references at `tests/integration/database.test.ts:47` and `tests/utils/database-helper.ts:95`.
- **Leftover types:**
  - ParkStay request types in `api.types.ts:3,32,78,91`, if V3 left them unreferenced;
  - `AppSettings` (`common.types.ts:146`) and `settingsSchema` (`shared/schemas/settings.schema.ts`);
  - the `DESKTOP` channel value on `NotifierChannel`, which has no notifier.
- **Stale root docs.** Fifteen status and fix-log markdown files sit at the repo root:
  - ADVANCED_FEATURES_IMPLEMENTATION, DEPLOYMENT-CHECKLIST, ELECTRON-START-FIX, FINAL-STATUS, FIXES
  - HOW-TO-RUN, IMPLEMENTATION, IMPLEMENTATION_COMPLETE, MODULE-SYSTEM-FIX, PATH-ALIAS-FIX
  - QA_REPORT, QUICK-START, READY-TO-RUN, SUCCESS, TROUBLESHOOTING

  Together they are about 4,800 lines that describe the old app.

## Size
M. This was S in `streams.md`. It includes a migration, the cleanup wiring and folding docs content (see the master-plan changelog).

## Scope
- **Constants.** Delete every exported constant in `app-constants.ts` that has no reference outside that file.
  - A constant used only by tests is inlined into those tests.
  - Keep `NOTIFICATION_RETENTION_DAYS`, which is unreferenced today, because the cleanup below starts using it.
- **Booking dead code.** Remove `getBookingStats` and the placeholder `syncBooking`/`importBooking` together with their channels, contract entries and preload methods. **Exception:** if V4 or U3 has already replaced `import` with a provider-backed `bookings.import(providerId, reference)`, keep that and remove only the placeholder.
- **Site Sniper dead code.** Remove `runSnipeWindow` and any helper used only by it, such as the private `delay`. Do the same for `setBooked`/`notifySnipeBooked` if they are still never triggered after V4.
- **Cleanup job.** Implement `runCleanup`:
  - Delete notifications whose `created_at` is older than `NOTIFICATION_RETENTION_DAYS` (30). Their delivery logs go with them through P2's `ON DELETE CASCADE`.
  - Delete delivery logs older than 30 days (`NotifierRepository.cleanupDeliveryLogs`).
  - Log both counts.
  - Run it on the existing cron, and also once about 5 minutes after start. The PC may be off at 02:00.
- **`job_logs`.** Drop it in a new migration with the next free version. Expect v9 after V2's v8, but check `connection.ts`. Use P2's `applyMigration`. Remove the related types, the constant and the test references. Update the migration list in CLAUDE.md.
- **Leftover types.** Remove the types and schema listed above if they are still unreferenced.
- **Root docs.**
  - Delete the 15 root files.
  - Fold the still-accurate troubleshooting from `TROUBLESHOOTING.md` and `HOW-TO-RUN.md` into the existing "Troubleshooting Development Issues" section of `docs/development.md` (`:16`): the port already in use, a blank window, the two-terminal dev flow, and the native ABI consistent with P1's guard.
  - Fix links to the deleted files in `docs/README.md`, `docs/DEPLOYMENT-SUMMARY.md` and `docs/IMPLEMENTATION_PLAN.md`. Fix links only; Q2 owns rewriting those docs.

## Non-goals
- Rewriting the README, `docs/` or the CHANGELOG (Q2). History entries in `CHANGELOG.md` stay as they are.
- Removing ParkStay fake endpoints (V3, a prerequisite).
- Notification stubs and the "Auto-book" no-op (#15: V4/U5).
- Scheduler correctness (V4).
- Dead renderer controls (U4).
- Stale files inside `docs/` other than link fixes (Q2).
- Adding new linting or dead-code tooling dependencies (knip, ts-prune).

## Completion Criteria
- [ ] This command prints nothing:
  ```sh
  for c in $(grep -oP 'export const \K\w+' src/shared/constants/app-constants.ts); do
    grep -rqw "$c" src --include=*.ts --include=*.tsx --exclude=app-constants.ts || echo "UNUSED $c"
  done
  ```
- [ ] `grep -rn "runSnipeWindow\|getBookingStats\|syncBooking\|booking:sync" src tests` returns nothing.
- [ ] No placeholder `TODO: In real implementation` remains in `BookingService`.
- [ ] Seed notifications and delivery logs at 31 and 29 days old. Use both `CURRENT_TIMESTAMP` format (`YYYY-MM-DD HH:MM:SS`) and ISO `…T…Z` timestamps. After `runCleanup`, only the 29-day-old rows remain, and the `PRAGMA foreign_key_check` is clean.
- [ ] With fake timers, `runCleanup` runs once about 5 minutes after `JobScheduler.start()`, then on the 02:00 `Australia/Perth` cron.
- [ ] The new migration drops `job_logs`:
  - a fresh DB has no `job_logs`;
  - the v5 and v6 fixtures upgrade with a clean `foreign_key_check`/`integrity_check`;
  - `grep -rn "job_logs\|JobType\|JOB_LOG_RETENTION" src tests` matches only historical v1 `SCHEMA_SQL` and the drop migration.
- [ ] `ls *.md` at the repo root lists only `CHANGELOG.md`, `CLAUDE.md` and `README.md`.
- [ ] Searching every `*.md` outside `node_modules`, `ai-state` and `CHANGELOG.md` for the 15 deleted file names finds nothing.
- [ ] `docs/development.md`'s Troubleshooting section covers the port in use, a blank window and the native ABI, and matches P1's guard message.
- [ ] `npm run test:coverage` passes with the unchanged thresholds.
- [ ] `npm run lint && npm run format:check && npm run type-check && npm test` pass.

## Edge Cases
- **Constants other streams still use.** A constant B2 now uses for app identity (for example `APP_NAME`) stays if it is referenced. The check above decides.
- **Renderer references** count as references. Constants used only in `src/renderer` stay.
- **Timestamp formats.** `notifications.created_at` defaults to `CURRENT_TIMESTAMP` (space separator), while JS writes ISO strings. Compare with `julianday(created_at) < julianday('now', '-30 days')`, not a string compare. The current `deleteOld` (`notification.repository.ts:86-90`) compares strings.
- **Unread notifications** older than 30 days are deleted too. The policy is documented in the code comment; their payment and hold links have long expired.
- **Locked DB.** If cleanup runs while the DB is busy (another transaction), it logs and retries on the next schedule. It never throws into the timer.
- **Rows in `job_logs`.** If a user's `job_logs` somehow holds rows, they are dropped with the table. Log the count.
- **Pre-v9 DBs.** Dropping `NotifierChannel.DESKTOP` must not break reading DBs that have no `desktop` row. None was ever created.

## Test Strategy
- **Unit:** about 6 tests.
  - `runCleanup` retention (3): old and new rows, both timestamp formats, FK cascade.
  - Startup run and cron with fake timers (2).
  - Constants check as a scripted test, optional (1).
- **Component:** none.
- **Integration:** about 2 tests. The migration drops `job_logs` from the v5 and v6 fixtures, plus the fresh-DB shape. Extend P2's schema-equivalence test.

## Context Files to Read First
- `ai-state/research/tech-review.md` "Dead/duplicate code". `ai-state/streams/platform/master-plan.md`.
- `src/shared/constants/app-constants.ts`, `src/shared/types/common.types.ts` and `src/shared/types/api.types.ts`
- `src/main/services/booking/BookingService.ts` (or its V4 location under `core/bookings/`), `src/main/ipc/handlers/bookings.handlers.ts` and `src/shared/contracts/bookings.ts`
- `src/main/services/sitesniper/sitesniper.service.ts` (or `core/snipes/`) and `src/main/scheduler/job-scheduler.ts:400-445`
- `src/main/database/connection.ts` (latest version and `applyMigration`), `notification.repository.ts` and `notifier.repository.ts`
- `TROUBLESHOOTING.md`, `HOW-TO-RUN.md` and `docs/development.md`

## Notes
- Run the dead-code sweep with `npm run type-check`; `noUnusedLocals` is already on. Use `grep -rnw` for exported symbols that tsc cannot flag.
- Check `git log --oneline -- <file>` before deleting a root doc that might have been edited recently by another stream. As of 2026-10-02 none had been edited.
- Commit deletions separately from code changes so the review diff stays readable.

## Orchestrator addendum (2026-10-04, from P5)
- [ ] Remove the now-unused `electron-store` dependency (P5 moved Gmail secrets to the vault). Confirm nothing imports it, then update package.json and the lockfile.
- [ ] Hand stale docs that describe the old AES-256-GCM / electron-store secret scheme to Q2: CLAUDE.md, README.md, docs/installation.md, docs/gmail-otp-setup.md and GMAIL-INTEGRATION-SUMMARY.md.

## Orchestrator addendum (2026-10-10, before dispatch)
- Already done by V4: the booking placeholders and `booking:sync*` channels, `runSnipeWindow`, and the no-op cleanup cron (node-cron is gone; the scheduler is chained timers). P7 still wires a real **retention job** for `notifications` and `notification_delivery_logs` into V4's scheduler (chained `setTimeout`, daily, bounded batch deletes, aborted on `stop()`), with the retention periods as typed settings keys (main-owned) and tests with fake timers.
- **Gmail OTP back end.** U4 removed the Gmail OTP UI (OQ7 default: nothing consumes it). Remove `GmailOTPService`, the `gmail.*` contract, handlers and preload bindings, its vault keys' readers (leave stored secrets inert or delete them in a migration step — decide and document), and the `googleapis` dependency if nothing else uses it. The SMTP notifier's "Gmail" preset is SMTP and stays. Update parity tests and the secret sweep.
- **Migration v10** drops `job_logs` (§12.26 numbering). Follow the connection.ts rules and add upgrade tests from the v5/v6 fixtures.
- **Flaky test.** `ExploreMap` timing test (E1) fails under heavy CPU load (seen twice by U3). Make it deterministic (fake timers or event-driven waits); no weakened assertions.
- **Coordinate:** U2 (Site Sniper, lane M) is about to merge and deletes `legacy-mapping` and the snipe legacy files. Don't touch `src/renderer/features/snipes/**`, `components/forms/**` or `legacy-mapping*`; if a constant P7 would delete is used by U2's lane, leave it and note it.
- Stale root docs: delete status/fix logs; fold anything still true into `docs/` (Q2 does the full docs pass, so keep folding minimal and factual).
