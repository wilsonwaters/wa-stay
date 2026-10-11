# Brand & migration — master plan

**Label:** `stream:brand-migration` · **Lanes:** B1 in lane A (assets/docs), B2 → B3 in lane M (main process) · **Size:** M

## Goal

The app is **WA Stay** everywhere a user can see a name, and every existing WA ParkStay Bookings install upgrades in place with nothing for the user to do. The stream delivers three things:

1. **An original brand (B1).** It is an SVG logo (mark, horizontal lockup and monochrome variants) with a WA mood: Indian Ocean blue brushstroke, sun gold, black-swan ink and a sparing coral accent (architecture-notes §9). It is never the WA Tourism Commission swan. A reproducible script turns it into the Windows icon, the Linux/macOS PNG set, real 24-bit BMP NSIS art, the README banner and a renderer copy.
2. **A single app identity (B2).** This covers the product and package names, window, constants, email notifier, OAuth page, electron-builder (artifact names, publish `wilsonwaters/wa-stay`, Linux entry), installer script, CI and release links. A branding guard test stops the legacy names from coming back. `appId` stays `com.parkstay.bookings` (O1) and the DBCA identifiers stay unchanged.
3. **A seamless upgrade (B3).** `userData` becomes `<appData>/WA Stay` before `ready`. On first run the legacy `parkstay.db` is copied with `backup()` to `wa-stay.db`, together with `gmail-oauth.json`, and a marker is written. The copy is idempotent and the legacy folder is never deleted. Auto-launch is re-registered and the AppUserModelId is set. All of this is tested from real v5 (released v1.2.0) and v6 (main) databases through the v8 migrations.

Stream success = brief success criteria 1 and 2: the app, installer and emails say WA Stay, and a v1.2.0 install upgrades with all its data. Automated tests cover both.

## Task list

| ID | Task | Size | Depends | Status |
|---|---|---|---|---|
| B1 | [Brand assets](tasks/B1-brand-assets.md): original SVG mark, lockup and mono variants; `npm run icons` pipeline (ICO 16–256, PNG set to 1024, 24-bit BMP installer header/sidebar, 1280×640 README banner, renderer copies); `Logo` component; contact sheet; asset tests; CI asset check | M | D1 | ⬜ |
| B2 | [App identity rename](tasks/B2-app-identity-rename.md): package/product/window/constants; email notifier and OAuth page; electron-builder (hyphenated artifacts, publish `wa-stay` ×4, Linux entry, vendor; appId kept); `installer.nsh` (legacy shortcut cleanup, update-safe uninstall, pre-upgrade legacy snapshot); CI names; release links; branding guard test | M | P4 (soft: V4 for provider name in emails) | ⬜ |
| B3 | [Legacy install migration](tasks/B3-legacy-install-migration.md): `app/paths.ts`, `migration/legacy-install.ts` (`backup()`, marker, idempotent, locked/corrupt/partial/both-present/portable), auto-launch re-registration, `setAppUserModelId`, welcome notice, tests from v5 and v6 fixtures through v8 | M | B2, V2 (interplay: P4, P5) | ⬜ |

Execution order:

- **B1** starts as soon as D1 lands (lane A). It runs in parallel with lane M.
- **B2** runs after P4. In lane M it sits after V6, so V4's `providerId` on notifications already exists.
- **B3** runs after B2 and V2.
- **Do not cut a release between B2 and B3.** B2 alone moves `userData`, so a build made at that point starts with an empty database.

## Integration points

| With | What crosses the boundary | Seam owner |
|---|---|---|
| **D1** tokens | B1 colours are exact D1 palette hex values from the token source named in `docs/design/design-language.md`. B1 reuses D1's brushstroke atoms (`src/renderer/assets/brush/`) so the logo stroke and the nav indicator match. B2's email colours come from the same palette through `src/shared/constants/brand.ts`. | D1 → B1, B2 |
| **D3** app shell | D3 shows `src/renderer/assets/brand/logo-lockup.svg` when B1 has landed, and otherwise a Fraunces text wordmark (design-system master plan). B1 must produce that exact path and the `Logo` component. | B1 → D3 |
| **U5** About / notifications | About uses B1's `Logo` and B2's `APP_NAME`, `APP_REPO_URL` and `APP_ISSUES_URL` constants. U5 owns the About layout. | B2 → U5 |
| **P3** notifier rename | The SMTP notifier moves from `services/notification/providers/email-smtp.provider.ts` into `core/notifications/notifiers/`. B2 edits it wherever P3 put it. | P3 → B2 |
| **P4** shell hardening | B2 sets only the title and icon in `src/main/app/main-window.ts`. B3 owns ordering: `setPath('userData')` → `setAppUserModelId` → `requestSingleInstanceLock()` (P4) → `ready` → migration → DB init. The Electron lock lives in `userData`, so the path must be set first. P4's after-ready logger then writes to `<WA Stay>/logs`. | P4 ↔ B3 |
| **P2 / V2** migrations | B3 copies a v5/v6 database and the normal `initializeDatabase` then runs v6→v8. B3 reuses P2's v6 fixture and adds a v5 (v1.2.0) fixture. Fixtures are SQL dumps because `.gitignore:12` ignores `*.db`. | P2/V2 → B3 |
| **P5** SecretVault | The copied database still holds legacy PBKDF2 ciphertexts (`AuthService.ts:13,218-224`, `notification-provider.repository.ts:21,400-406`). These keys are machine-ID based and do not depend on the path, so the copy decrypts. P5 re-encrypts after B3 copies. The safeStorage `Local State` is created fresh in the new `userData`. B3 must not copy Chromium profile files. | B3 → P5 |
| **B2 ↔ B3** installer snapshot | B2's `installer.nsh` takes a snapshot of `$APPDATA\parkstay-bookings\{parkstay.db*,gmail-oauth.json}` into `$APPDATA\WA Stay\legacy-snapshot\` before the old v1 uninstaller runs. B3 uses that snapshot as a secondary source and deletes it after a successful migration. | B2 → B3 |
| **Q1** smoke E2E | Test hooks are honoured only when `app.isPackaged === false`: `WA_STAY_USER_DATA_DIR`, and `WA_STAY_LEGACY_DATA_DIR` for migration tests. Q1 may add the user-data override to `paths.ts` first if it lands before B3, and B3 must keep it. | B3 ↔ Q1 |
| **Q2** docs | Q2 writes the upgrade note, data locations and the release checklist (repo rename, redirect check). B2 changes only links and artifact names in `docs/release-process.md` and `.claude/commands/release.md`. | B2 → Q2 |
| **Shared files** | B1 and B2 both edit `electron-builder.json`, `package.json` and `.github/workflows/build.yml`, in different keys: B1 owns icon and installer-image keys, the `icons` script and the asset-check step; B2 owns names, artifacts, publish, Linux metadata and workflow names. Rebase rather than overwrite. | B1/B2 |

## Out of scope

- macOS and Linux release builds, `.icns` authoring and code signing. Configs are kept buildable. `mac.icon` points at the 1024 PNG, which electron-builder converts.
- Changing `appId` or the NSIS GUID, and renaming DBCA identifiers (`QUEUE_GROUP 'parkstayv2'` at `app-constants.ts:69`, the `PARKSTAY_*_URL` constants at `:7-8`, the `sitequeuesession` cookie, `parkstay:*` IPC channels) or "ParkStay" where it names the provider.
- Changing encryption constants. P5 owns secret migration.
- Copying Chromium profile data (Local Storage holds only the ComingSoonBanner dismissal, `ComingSoonBanner.tsx:16-20`), logs or caches.
- Deleting or modifying the legacy `parkstay-bookings` folder, and downgrade support (v2 → v1 reads its own untouched folder, so changes made in v2 are not visible).
- The repo rename itself and the GitHub description (stakeholder; OPEN-QUESTIONS Q2/Q3). Docs content belongs to Q2.

## Open questions

| # | Question | Blocks | Proposed default |
|---|---|---|---|
| BQ1 | Logo concept sign-off. B1 delivers a primary concept and one alternative on a contact sheet. | B1 completion | Ship the primary (sun setting into an ocean brushstroke, under an ink roofline) unless the stakeholder picks the alternative in review. |
| BQ2 | **The v1 uninstaller asks to delete data during upgrades.** electron-builder runs the *old* uninstaller with `/S --updated` (`app-builder-lib/templates/nsis/include/installUtil.nsh:205-224`), and its `customUnInstall` always runs (`uninstaller.nsh:238`). v1's macro shows `MessageBox MB_YESNO` with no `/SD` and no `isUpdated` guard (`resources/installer.nsh:71-77`). In NSIS a MessageBox without `/SD` still shows in silent mode, so "Yes" deletes `$APPDATA\parkstay-bookings` before WA Stay first runs. | B2 installer, B3 sources | Confirm on a Windows VM. Mitigate with the B2 pre-uninstall snapshot (`customCheckAppRunning` hook) and the B3 secondary source. Fix the v2 macro (`isUpdated` guard, `/SD IDNO`). |
| BQ3 | Is a Windows VM (or the stakeholder) available for the installer and upgrade checks marked "manual, Windows" in B2 and B3? | B2/B3 sign-off | The stakeholder runs the checklist in each task on the PR's `windows-artifacts` build. The results go in the PR notes. |
| BQ4 | What is the value name of the v1 auto-launch `Run` entry? v1 never called `setAppUserModelId`, so Electron used its default. | B3 auto-launch criterion | Find it through `app.getLoginItemSettings({ path: <legacy exe> }).launchItems` and also remove the likely candidates. Record the real name from `reg query` in the PR. |
| BQ5 | When the user uninstalls WA Stay with "delete data", should the legacy backup folder go too? | B2 | Use a separate second prompt that names the folder, default **No** (`/SD IDNO`). |
| BQ6 | Should `WA_STAY_USER_DATA_DIR` work in packaged builds, for portable-on-USB users? | B3 | No. Test hooks only work when the app is unpackaged. Revisit after 2.0. |
| BQ7 | **Known limitation (B2 review): the install folder after an upgrade from v1 depends on how the installer runs.** An unattended `/S` update keeps v1's folder, `%LOCALAPPDATA%\Programs\WA ParkStay Bookings\` (NSIS reads `InstallLocation` from the appId's key). An interactive upgrade (the installer run by hand, or `quitAndInstall` with its UI) installs into `…\Programs\WA ParkStay Bookings\WA Stay\`, because electron-builder's `instFilesPre` adds the app name to a folder that lacks it (`assistedInstaller.nsh`). Both work; it is cosmetic. | Nothing | Accept for 2.0 and leave the install-dir logic alone. Q2's upgrade notes explain it (Q2 addendum). Revisit only if users report confusion. |

## Changelog

- **2026-10-02:** Created. B1–B3 specs written. Findings that differ from the planning brief:
  - `scripts/generate-icons.js` is tracked and **not** gitignored (`git ls-files`, `git check-ignore`).
  - Icons are committed today, but only `icon.ico` and two PNGs. `icon.png`, which `notification.service.ts:241` uses, does not exist.
  - NSIS art is PNG although NSIS needs BMP (`NsisTarget.js:396-406` passes the path straight to `MUI_HEADERIMAGE_BITMAP`).
  - The released v1.2.0 has schema **v5** (v6 landed after the release), so B3 tests both.
  - BQ2 above.
- **2026-10-04:** BQ7 (install folder after an upgrade from v1) recorded as a known limitation from the B2 review.
