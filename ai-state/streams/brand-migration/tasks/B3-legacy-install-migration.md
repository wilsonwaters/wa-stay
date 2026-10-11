# B3 — Legacy install migration (userData move, DB copy, auto-launch, AUMID)

**Stream:** brand-migration · **Depends on:** B2, V2 (interplay: P4 single-instance/logger, P5 vault)

## Description

WA Stay keeps its data in `<appData>/WA Stay`; v1 kept it in `<appData>/parkstay-bookings`.

- v1's location came from `package.json` `name` (`package.json:2`).
- The DB file name is hard-coded as `parkstay.db` (`connection.ts:434-435`).
- `gmail-oauth.json` is an electron-store file in `userData` (`oauth2-handler.ts:30-33`).

This task implements architecture-notes §6. On first run, WA Stay copies the legacy data safely, records what it did, and never touches the legacy folder. The copied database then goes through the normal v6→v8 migrations.

It also re-registers launch-at-login under the new identity and sets the AppUserModelId, so shortcuts, toasts and the Run key all agree.

As a v1.2.0 user, after the update WA Stay opens with my watches, snipes, bookings, settings, notifier config and Gmail connection intact, and launch-at-login still works.

## Size

M

## Scope

**In scope**

1. **`src/main/app/paths.ts`** (extend it if P4/B2 created it). It exports a pure `resolveAppPaths({ appData, env, isPackaged })` returning:
   - `userData` (`<appData>/WA Stay`);
   - `dbPath` (`<userData>/wa-stay.db`);
   - `legacyUserData` (`<appData>/parkstay-bookings`) and `legacyDbPath`;
   - `snapshotDir` (`<userData>/legacy-snapshot`, written by B2's installer);
   - `markerPath` (`<userData>/migration.json`).

   It also exports `configureAppPaths(app)`, which calls `app.setPath('userData', …)`.

   Test hooks are honoured only when `!isPackaged`:
   - `WA_STAY_USER_DATA_DIR` replaces `userData`;
   - `WA_STAY_LEGACY_DATA_DIR` replaces the legacy dir.
   - When the first is set without the second, the legacy source is **disabled**, so tests never read the real `%APPDATA%`.
2. **Bootstrap order** in the main entry, enforced by an exported `bootstrapShell(app)`:
   1. `configureAppPaths`;
   2. `app.setAppUserModelId(isPackaged ? 'com.parkstay.bookings' : process.execPath)`;
   3. P4's `requestSingleInstanceLock()`;
   4. on `ready`, `migrateLegacyInstall()`;
   5. then DB init.

   The paths module must load before any module that reads `userData` at import time (`logger.ts:13-25`, electron-store). Electron's single-instance lock lives in `userData`, so ordering matters.
3. **`initializeDatabase`** takes `dbPath` from `paths.ts`. Remove the `parkstay.db` literal (`connection.ts:435`) and the unused `DB_NAME` (`app-constants.ts:43`).
4. **`src/main/migration/legacy-install.ts`** exports `migrateLegacyInstall(paths, deps)`. `deps` = `{ fs, openDatabase, prompt, logger, clock, appVersion }`, all injectable. The algorithm:
   1. Marker `status` is `complete`, `declined` or `skipped` → return `already-done`. These states are terminal.
   2. Choose the source: `legacyDbPath` if it exists, else `snapshotDir/parkstay.db`, else return `fresh-install`. A fresh install writes no marker, so a later installer snapshot can still be used.
   3. `wa-stay.db` exists and there is no `in-progress` marker → `target-exists`. Write the marker as `skipped`, log a warning, and **never overwrite**.
      - If the marker *is* `in-progress`, the previous run crashed between the rename and the marker write. Redo the copy; the rename replaces our own earlier copy.
   4. Write the marker `{status:'in-progress', startedAt}`.
   5. Open the source with `{ readonly: true, fileMustExist: true, timeout: 5000 }`. Run `PRAGMA quick_check`, then `await source.backup(<dbPath>.migrating)`.
   6. Open the copy and run `PRAGMA integrity_check`, which must be `ok`. Read `MAX(version)` from `migrations`. Close it and `fs.renameSync` it to `dbPath`.
   7. Copy `gmail-oauth.json` if it exists next to the source and is absent in the target.
   8. Write the marker `{version:1, status:'complete', source, sourceSchemaVersion, migratedAt, appVersion, copied:[…]}`.
   9. Delete `snapshotDir` if it was the source or is no longer needed. Never delete anything under the legacy dir.
5. **Failure handling.** On SQLITE_BUSY/LOCKED, retry 3 times with backoff. On SQLITE_CORRUPT/NOTADB, a failed integrity check or ENOSPC:
   - delete `*.migrating`;
   - write the marker as `failed` with the reason;
   - call `deps.prompt` (production: `dialog.showMessageBox`) with "Retry", "Start fresh" (marker `declined`; the legacy folder is kept and its path is shown) and "Quit".
6. **Auto-launch.**
   - Move the Windows login-item logic out of `app.handler.ts:90-101` into `src/main/app/login-item.ts` `setLaunchAtLogin(enabled)`. It uses the default name (= the AUMID), `args ['--hidden']`, and `path` = `process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath`.
   - After a `complete` migration with setting `launchOnStartup = true`, on win32 and only when packaged:
     - find the legacy entries with `app.getLoginItemSettings({ path: <dir(execPath)>/WA ParkStay Bookings.exe }).launchItems`, plus the candidate names `electron.app.parkstay-bookings` and `electron.app.WA ParkStay Bookings` (BQ4);
     - remove each one with `setLoginItemSettings({ openAtLogin:false, name, path })`;
     - then call `setLaunchAtLogin(true)`.
7. **Welcome notice.** After a `complete` migration, create one in-app notification, `NotificationType.INFO`, titled "Your data has moved to WA Stay". The message names the kept legacy folder.
8. **Logging.** Write `legacy-install:` lines (source, outcome, schema version, bytes, duration). Never log row data or secrets.
9. **Branding guard.** Extend B2's guard pattern with `parkstay\.db`. Legacy names in `paths.ts` and `migration/` carry `legacy-name-ok`.

**Out of scope**

- Re-encrypting secrets (P5). Schema changes (V2/P2). Installer scripts (B2). Upgrade docs (Q2).

## Non-goals

- Do not copy Chromium profile data, logs or caches. Do not merge two databases. No "import from old folder" UI.
- Do not migrate macOS/Linux login items (they are not shipped). The paths logic is still platform-neutral (`app.getPath('appData')`).
- No downgrade support.

## Completion Criteria

- [ ] `resolveAppPaths` unit tests: default Windows-style paths; `WA_STAY_USER_DATA_DIR` honoured when unpackaged and **ignored when packaged**; the legacy source disabled when only the user-data override is set.
- [ ] `bootstrapShell` test (mocked `app`) asserts the call order `setPath` → `setAppUserModelId('com.parkstay.bookings')` → `requestSingleInstanceLock`, and `process.execPath` as the AUMID when unpackaged.
- [ ] `connection.ts` contains no `parkstay.db`. The DB opens at `<userData>/wa-stay.db`.
- [ ] Migration tests, each in a fresh `fs.mkdtempSync` dir, assert the outcome and marker for: fresh install, legacy v5, legacy v6, snapshot-only, already complete, declined, target exists, stale `in-progress` + `.migrating` (cleaned and redone), locked (retry, then success), corrupt (prompt → Start fresh → `declined`), and ENOSPC (injected fs).
- [ ] From the **v5 fixture (released v1.2.0)** and the **v6 fixture**, after migration plus `initializeDatabase`: `MAX(version)` = 8; watch, snipe, booking, notification, notification-provider and settings counts are unchanged; every watch, snipe and booking has `provider_id = 'parkstay'`; encrypted columns are byte-identical; `PRAGMA foreign_key_check` returns no rows.
- [ ] Un-checkpointed WAL test: a row present only in the legacy `-wal` exists in `wa-stay.db`.
- [ ] Legacy `parkstay.db` and `gmail-oauth.json` sha256 are unchanged and no legacy file is deleted (SQLite `-shm`/`-wal` sidecars may appear). `gmail-oauth.json` is copied byte-identical and never overwrites an existing target.
- [ ] Login-item tests (mocked `app`, win32, packaged): legacy names from `launchItems` and the candidates are removed; the new entry is registered with `['--hidden']`; the portable path uses `PORTABLE_EXECUTABLE_FILE`; nothing is registered when `launchOnStartup` is false or the app is unpackaged.
- [ ] Exactly one INFO notification after a `complete` migration, and none on later launches.
- [ ] Manual, Windows (BQ3):
  - [ ] v1.2.0 with data and launch-at-login → upgrade → WA Stay shows the same watches and settings, and the Gmail status is connected.
  - [ ] `%APPDATA%\parkstay-bookings` is intact.
  - [ ] `reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Run` shows only the new entry. The legacy name is recorded in the PR (BQ4).
  - [ ] A toast shows "WA Stay" as the app name.
- [ ] `npm run lint` (0 errors), `npm run format:check`, `npm run type-check` and `npm test` all pass.

## Edge Cases

- **Legacy DB still in use.** A v1 portable or another install may still be running. Its single-instance lock is in the other `userData`, so it does not block WA Stay. `backup()` gives a consistent snapshot; on busy, retry, then prompt.
- **Legacy folder present but unreadable**, or `-wal` present without `-shm` in a read-only dir (SQLITE_CANTOPEN): copy `db` + `-wal` into a temp staging dir under `userData` and back up from there.
- **Both present.** v1 data plus a `wa-stay.db` created by a dev build or a failed run: never overwrite. Mark `skipped` and log the paths.
- **Legacy schema newer than 8** (a future build): back it up anyway. `runMigrations` is a no-op, so log a warning.
- **The v1 uninstaller deleted the legacy folder during the upgrade** (BQ2). Use `legacy-snapshot/`. If that is absent as well, it is a fresh install.
- **Portable build.** `userData` is still `%APPDATA%\WA Stay`; the exe is extracted to a temp dir, so login items must use `PORTABLE_EXECUTABLE_FILE`.
- **Crash or kill at any step.** The next launch resumes from the marker state, and `.migrating` is removed.
- **Paths with spaces or Unicode** (`WA Stay`, user names): use `path.join` only.
- **Migration takes long** (a large `notifications` table): no window exists yet. If it exceeds 2 s, log progress; there is no splash in scope.

## Test Strategy

- **Unit (~22):** `paths` (4); bootstrap order (2); `legacy-install` outcomes (11), using real better-sqlite3 in temp dirs with an injected `prompt` and fs fault injection; login-item (4); welcome notice (1). Use `@jest-environment node`. Requires the Node ABI build of better-sqlite3 (RUNBOOK).
- **Integration (~3):** `tests/integration/legacy-upgrade.test.ts` covers v5 → v8, v6 → v8 and the WAL case. The fixtures are `tests/fixtures/db/v5-v1.2.0.sql` (new) and P2's v6 dump. They are materialised into a temp dir in WAL mode. Build v5 from `git show dcccfa7:src/main/database/connection.ts` (the v1.2.0 release commit) and seed representative rows: a user with encrypted creds, watches, a booking, notifications, an SMTP notifier row, settings (`launchOnStartup=true`) and `queue_session`.
- **Component:** none (the native dialog only).

## Context Files to Read First

- `ai-state/architecture-notes.md` §1 (`app/paths.ts`, `migration/`), §5, §6. `ai-state/research/tech-review.md` "Rename risks".
- `ai-state/streams/brand-migration/master-plan.md` (BQ2, BQ4, snapshot contract), and B2's spec (§7 installer snapshot).
- `src/main/index.ts`, or P4's `app/` shell, plus `single-instance.ts`. `src/main/database/connection.ts:210-460`.
- `src/main/ipc/handlers/app.handler.ts:71-139`, `src/main/services/gmail/oauth2-handler.ts:24-34`, `src/main/utils/logger.ts`.
- `tests/utils/database-helper.ts`, P2/V2 migration tests and fixtures.
- `node_modules/electron/electron.d.ts`: `LoginItemSettings`, `LaunchItems`, `Settings.name` (≈17081, 18346, 19143).

## Notes

- Released v1.2.0 is schema **v5**. Site Sniper's v6 landed after the release (`ec66641` follows `dcccfa7`). The architecture's "real v6 fixture" alone would miss the path most users take.
- Credentials keep working after the copy, because the PBKDF2 keys use the machine ID plus constants, not paths (`AuthService.ts:13,218-224`). Do not change those constants (P5's job).
- `better-sqlite3` `backup()` returns a Promise. Await it before `close()`.
- `.gitignore:12` ignores `*.db`, so commit SQL dumps, never binary fixtures.

## Orchestrator addendum (2026-10-04, from the P5, V7 and V2 reviews)
- [ ] The untouched legacy folder (`%APPDATA%\parkstay-bookings`, or the installer's `legacy-snapshot`) is the backup of the pre-vault secrets. Never delete or modify it. Document this in the migration notes.
- [ ] `app.setPath('userData', …)` runs before `createContainer`. This matters for the vault (§12.23) and for V7's browser profile path (`userData/providers/<id>/browser`).
- [ ] Replace B2's temporary `setPath(userData, …/parkstay-bookings)` (`// B3 replaces this`) with the WA Stay path plus migration.
