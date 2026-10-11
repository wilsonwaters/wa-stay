# B2 — App identity rename (product, package, window, emails, installer, publish repo)

**Stream:** brand-migration · **Depends on:** P4 (soft: V4, for `providerId` on notifier messages)

## Description

Make every name a user, installer, email or update feed sees say **WA Stay**. Two things must stay exactly as they are:

- the identifiers existing installs and DBCA depend on;
- "ParkStay" wherever it names the provider.

The repo will become `wilsonwaters/wa-stay` (OPEN-QUESTIONS Q2). v1 clients reach it through GitHub's rename redirect. v2 clients publish to and update from the new name directly.

The task also fixes the NSIS script so upgrades and uninstalls never surprise the user. That includes guarding against the v1 uninstaller's data-deletion prompt, which can appear during an upgrade (BQ2).

As an existing user who updates, I see "WA Stay" in the installer, shortcuts, window, notifications and emails. I end up with exactly one working shortcut, and my data is never offered for deletion during an update.

## Size

M

## Scope

**In scope**

1. **`package.json` (`:2-13`, `:123-129`).**
   - `name: "wa-stay"`.
   - Add a top-level `productName: "WA Stay"`, so `app.getName()` (used by `app.handler.ts:32` for About) returns "WA Stay" in dev and packaged builds.
   - `description`: "Find and book places to stay across Western Australia".
   - `author`: `{ "name": "Wilson Waters", "email": "wilsonwaters@users.noreply.github.com" }`. NSIS uses this as the Publisher.
   - `repository`, `homepage` and a new `bugs` → `wa-stay`.
   - `keywords`: accommodation, camping, western-australia, parkstay, booking, electron.
2. **`electron-builder.json`.**
   - `productName` "WA Stay" (`:3`). Copyright "© 2025-2026 Wilson Waters" (`:4`).
   - **`appId` unchanged** (`:2`). Do not add `nsis.guid`.
   - Artifact names:
     - `win.artifactName` `WA-Stay-Setup-${version}.${ext}` (`:84`);
     - `portable.artifactName` `WA-Stay-Portable-${version}.${ext}` (`:120`);
     - mac, linux, appImage, deb and rpm `WA-Stay-${version}-${arch}.${ext}` (`:42,146,159,172,182`).
     - Never use `${productName}` in a file name. PR #8 (`49b4dea`) fixed a 404 caused by spaces becoming dots.
   - All 4 `publish` blocks use `repo: "wa-stay"` (`:43-47,89-93,151-155,184-188`).
   - Linux `desktop`: Name "WA Stay"; Comment "Find and book places to stay across Western Australia"; Keywords `camping;caravan;holiday;accommodation;parkstay;booking;`; **StartupWMClass** = the WM_CLASS the built app actually reports.
   - `synopsis`, `description`, and `vendor` "WA Stay" (`:140-150`).
3. **Main process.**
   - Window `title: 'WA Stay'`. Today it is `index.ts:61`; after P4 it is in `app/main-window.ts`.
   - Set `icon` on Linux/dev, using a `getBrandIconPath()` helper in `src/main/app/paths.ts` (create a minimal file if B3 has not landed): packaged → `process.resourcesPath/icons/icon.png` (`extraResources`, `electron-builder.json:15-21`); dev → `<appPath>/resources/icons/icon.png`.
   - Use the same helper for the OS notification icon. Today `notification.service.ts:241` uses `app.getAppPath()/resources/...`, which is inside `app.asar` when packaged and so is wrong.
4. **Renderer.**
   - `src/renderer/index.html:6` `<title>WA Stay</title>`. The page title overrides the window title.
   - `src/shared/constants/app-constants.ts:3`: `APP_NAME = 'WA Stay'`. Add `APP_REPO_URL = 'https://github.com/wilsonwaters/wa-stay'` and `APP_ISSUES_URL`.
   - About and Settings use these constants instead of literals (`AboutDialog.tsx:59,101,109`, `Settings.tsx:524`, or their U-stream replacements).
   - Fix any other legacy-name string the guard test finds.
5. **SMTP email notifier** (`email-smtp.provider.ts`, or its P3 location under `core/notifications/notifiers/`).
   - From name `"WA Stay"` (`:99,146`).
   - Subject `WA Stay: <title> · <provider shortName> · <location>`. Omit absent parts (`buildSubject`, `:257-265`).
   - Header wordmark "WA Stay", footer "Sent by WA Stay", test-email copy (`:148-159,304,323,336,349`).
   - Replace every `#2d5a27` (`:152,275,287,302-303`) with D1 palette hex values held in a new `src/shared/constants/brand.ts`. Ink is for text; the D1-designated accent is for the button. Each pair must be AA against its background.
   - Rename the "Campground:" label to "Location:".
   - Escape `actionUrl` and allow only `http(s):`.
6. **Gmail OAuth success page** (`oauth2-handler.ts:175,199-200`): title "WA Stay – Gmail connected"; body "You can close this window and return to WA Stay."
7. **`resources/installer.nsh`**, rewritten:
   - Rebrand the text (`:1,7,51,96,112-122`).
   - **Stop creating custom shortcuts** (`:12-29`). electron-builder already creates them (`createDesktopShortcut: "always"`, `createStartMenuShortcut`, `electron-builder.json:104-106`).
   - `customInstall` removes legacy `$DESKTOP\WA ParkStay Bookings.lnk`, `$SMPROGRAMS\WA ParkStay Bookings.lnk` and `$SMPROGRAMS\WA ParkStay Bookings\`, in both shell contexts.
   - `customUnInstall` runs data cleanup only when `${isUpdated}` is false. Every `MessageBox` uses `/SD IDNO`.
   - "Yes" removes `$APPDATA\WA Stay` and `$LOCALAPPDATA\wa-stay-updater`.
   - The legacy `$APPDATA\parkstay-bookings` is removed only after a **second** prompt that names it, default No (BQ5).
   - `!macro customCheckAppRunning`: run `!insertmacro _CHECK_APP_RUNNING`, then take the legacy snapshot. If `$APPDATA\parkstay-bookings\parkstay.db` exists and `$APPDATA\WA Stay\migration.json` does not, copy `parkstay.db`, `-wal`, `-shm` and `gmail-oauth.json` into `$APPDATA\WA Stay\legacy-snapshot\`. This hook runs immediately before the old uninstaller (`installSection.nsh:33-52`).
8. **CI and release links.**
   - Workflow `name:`s "WA Stay CI" and "WA Stay Build and Release" (`ci.yml:1`, `build.yml:1`).
   - Dependency-check `project: 'wa-stay'` (`ci.yml:116`).
   - `.claude/commands/release.md:42` and `docs/release-process.md:126,146-147`: repo URL and artifact names (the portable row is wrong today).
9. **Guard tests.**
   - `tests/unit/brand/branding-guard.test.ts` scans `src/**/*.{ts,tsx,html,css}`, `resources/installer.nsh`, `package.json`, `electron-builder.json`, `.github/workflows/*.yml` and `.claude/commands/*.md` for `/WA ParkStay|ParkStay Bookings|parkstay-bookings/i`.
   - Any matching line must carry the marker `legacy-name-ok`. JSON files allow none.
   - `tests/unit/build/electron-builder-config.test.ts` asserts Scope 2.

**Out of scope**

- The userData move, DB file name, migration and auto-launch (B3).
- Docs and README prose (Q2). Logo and icons (B1).

## Non-goals

- Do not touch DBCA identifiers: `QUEUE_GROUP 'parkstayv2'` (`app-constants.ts:69`), `PARKSTAY_*_URL` (`:7-8`), `sitequeuesession`, `browser-headers.ts`, or the `parkstay:*` IPC channels.
- Do not touch encryption constants: `AuthService.ts:13,220`, `notification-provider.repository.ts:21,402` and `oauth2-handler.ts:32` get the marker comment, nothing else.
- Do not rename "ParkStay" where it names the provider.
- No `appId` change, and no Linux/mac release.

## Completion Criteria

- [ ] Config test passes: `appId === 'com.parkstay.bookings'`; `productName === 'WA Stay'`; every `publish.repo === 'wa-stay'` (4 blocks); no `artifactName` contains `${productName}` or a space; the win and portable names match Scope 2.
- [ ] `package.json` has `name` "wa-stay", `productName` "WA Stay", the new description, author and bugs, and repo URLs ending in `/wa-stay(.git)`.
- [ ] The branding guard test passes. `grep -rn "2d5a27" src` returns nothing.
- [ ] Notifier unit tests: the From header is `"WA Stay" <addr>`; a message with providerId `parkstay` and location "Dales" gives the subject `WA Stay: <title> · ParkStay · Dales`; the HTML contains no `#2d5a27`; `javascript:` action URLs are dropped.
- [ ] `getBrandIconPath()` unit test covers the packaged and dev branches. The notification service uses it.
- [ ] The OAuth success page HTML contains "WA Stay" and no "ParkStay Bookings" (unit test of the page builder).
- [ ] `installer.nsh` text test: no `CreateShortCut`; every `MessageBox` has `/SD`; the cleanup block is wrapped in `${ifNot} ${isUpdated}`; `RMDir /r "$APPDATA\parkstay-bookings"` appears only inside the second-prompt branch; `customCheckAppRunning` is defined and inserts `_CHECK_APP_RUNNING`.
- [ ] A test asserts `QUEUE_GROUP === 'parkstayv2'` and `PARKSTAY_BASE_URL === 'https://parkstay.dbca.wa.gov.au'`.
- [ ] Under xvfb, the built app's window title is "WA Stay". The `StartupWMClass` value matches `xprop WM_CLASS` (or an equivalent probe), with evidence in the PR.
- [ ] The CI `Build Windows` job is green. Its artifacts are `WA-Stay-Setup-<v>.exe`, `WA-Stay-Portable-<v>.exe` and `latest.yml`, and `latest.yml` references the hyphenated file name.
- [ ] Manual, Windows (BQ3):
  - [ ] Fresh install creates a single "WA Stay" desktop shortcut and a single Start-menu shortcut.
  - [ ] Over v1.2.0, the upgrade removes the legacy shortcuts and leaves one "WA Stay" shortcut. Apps & features lists one "WA Stay" entry.
  - [ ] The v1 uninstaller prompt is observed and recorded (BQ2), and `legacy-snapshot\` exists afterwards.
  - [ ] Uninstall with "No" keeps `%APPDATA%\WA Stay`.
- [ ] `npm run lint` (0 errors), `npm run format:check`, `npm run type-check` and `npm test` all pass.

## Edge Cases

- **Upgrade in place.** The install directory stays the old one (e.g. `…\Programs\WA ParkStay Bookings\`), because NSIS reads `InstallLocation` from the GUID key derived from `appId` (`multiUser.nsh:26`). Only fresh installs use `…\Programs\WA Stay`. Do not "fix" this.
- **Pinned taskbar items** point at the old exe name (`WA ParkStay Bookings.exe` → `WA Stay.exe`) and break. Record this for Q2's upgrade note.
- **The old uninstaller** (v1, compiled from today's `installer.nsh`) still runs its own `customUnInstall` during the upgrade. It deletes its own shortcuts and may show the data prompt (BQ2). The new installer can only act before it runs (`customCheckAppRunning`) and after it runs (`customInstall`).
- **Elevated installs.** `CHECK_APP_RUNNING` is skipped in the UAC inner instance (`installSection.nsh:35-37`), so no snapshot is taken there. Document this as a known limitation. Per-user auto-updates do not elevate.
- **Snapshot.** Skip it when it already exists (re-running the installer). Never overwrite an existing `wa-stay.db`.
- **Differential update.** The old blockmap URL is derived from the new file name, gets a 404, and electron-updater falls back to a full download. That is expected; check `main.log` once.
- **No providerId.** If a notifier message has none, or the registry does not know it, omit the provider segment and do not throw.

## Test Strategy

- **Unit (~14):** config test (5 assertions); branding guard; DBCA constants; notifier From, subject, colours and URL sanitising (4); OAuth page; `getBrandIconPath` (2); `installer.nsh` text checks (5 assertions in one file). Use `@jest-environment node`.
- **Component:** none new. Update existing renderer tests that assert old strings, by role and name.
- **Integration:** none in Jest. The CI Windows packaging job plus the manual Windows checklist cover it.

## Context Files to Read First

- `ai-state/architecture-notes.md` §6 and §11. `ai-state/research/tech-review.md` "Rename risks". `ai-state/research/ui-review.md` "Branding inventory".
- `ai-state/streams/brand-migration/master-plan.md` (BQ2–BQ5, shared-file ownership).
- `package.json`, `electron-builder.json`, `resources/installer.nsh`, `.github/workflows/{ci,build}.yml`, `.claude/commands/release.md`, `docs/release-process.md:120-160`.
- `node_modules/app-builder-lib/templates/nsis/{installSection.nsh,uninstaller.nsh,include/installUtil.nsh,include/allowOnlyOneInstallerInstance.nsh}`.
- The SMTP notifier file, `src/main/services/gmail/oauth2-handler.ts:160-210`, `src/main/services/notification/notification.service.ts:235-245`, `src/shared/constants/app-constants.ts`.

## Notes

- `productName` lives in two places (package.json for Electron at runtime, electron-builder.json for packaging). Keep both identical; the config test asserts equality.
- After B2 alone, the app's default `userData` becomes `%APPDATA%\WA Stay` and the dev database starts empty until B3 lands. Do not release in between.
- v1 `app-update.yml` points at `parkstay-bookings`. The update works only once the stakeholder renames the repo and never recreates the old name. Q2 adds the redirect check to the release checklist.
