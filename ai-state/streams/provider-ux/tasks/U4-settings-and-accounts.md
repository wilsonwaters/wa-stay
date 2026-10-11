# U4 — Settings and Accounts

**Stream:** provider-ux · **Depends on:** D3, V6, P4, P5

## Description

As a WA Stay user, I manage the whole app from one Settings area. There I can:

- connect or disconnect each provider account;
- choose how I'm notified (desktop and email);
- control how the app starts;
- see the version and check for updates.

Every control there actually does something.

Today `pages/Settings.tsx` is 538 lines of mostly dead controls:

- **Gmail.** "Authorize" only sets local state (`:112-126`).
- **Notifications and app toggles.** Desktop notifications (`:344-362`), Sound (`:364-380`), Minimise to tray (`:425-443`) and Log level (`:466-472`) only show a toast.
- **Advanced.** "Open Folder" (`:497`) and "Clear All Data" (`:512`) have no handler.
- **Tabs.** They have no tab semantics (`:175-189`) and use emoji icons (`:133-139`).
- **Account.** It stores a ParkStay email and password (`:70-90`), but ParkStay uses an email link and that login was never implemented (tech-review #9).

The copy is misleading in several places: "never sent to any third-party servers" (`Settings.tsx:252-253`, `EmailSettingsCard.tsx:516-518`), "never leaves your device" (`Settings.tsx:325-326`) and "never sent to any external servers" (`Login.tsx:198-199`). `EmailSettingsCard` (547 lines) requires the password on every save (`:146-149`), even though its own hint says to leave it blank to keep the existing one (`:473-474`).

The main process already contains the hooks a working Notifications section needs, but nothing calls them. `NotificationService.setDesktopEnabled` and `setSoundEnabled` exist (`notification.service.ts:342,349`) but are never called, and `playNotificationSound` is a no-op (`:261`). There is no `Tray` anywhere in `src/main`. A launch with `--hidden` never shows the window (`index.ts:29-36,83-89`), and enabling auto-launch always adds that flag (`app.handler.ts:99`).

## Size

L. This task is cross-concern: renderer sections plus small main-process wiring for settings, notifications and window start-up.

## Scope

- **In scope**
  - **Feature layout.** Build `features/settings/` with routes `/settings` → `/settings/accounts` and `/settings/:section`. The sections are `accounts`, `notifications`, `app`, `about`, and `gmail` only if it is wired. On wide windows they sit in a left sub-nav (`nav` labelled "Settings sections"); narrow windows show a stacked list.
  - **Hooks.** Add `renderer/api/{settings,notifiers,app,updater}.ts`. Reuse U2's `renderer/api/accounts.ts`, and create it if it is missing.
  - **Accounts section.**
    - Show one `AccountRow` per provider from `providers.list()`, joined with `accounts.list()`. Each row has:
      - a `ProviderBadge` and the provider name;
      - a status: "Signed in as {label}", "Not connected" or "Session expired";
      - when it last signed in;
      - a "Needed for" sentence derived from `capabilities.account`, `holds` and `bookingImport`.
    - Rows for `account: 'none'` read "No account needed" and have no button.
    - **Connect** calls `accounts.signIn(id)`. While the in-app window is open the button shows "Waiting for sign-in…".
    - **Sign out** opens a `ConfirmDialog`, then calls `accounts.signOut(id)`.
    - `account:updated` refreshes the rows. `?provider=<id>` scrolls to that row and focuses it; U1, U2 and U3 link here.
  - **Notifications section.**
    - **Desktop and sound switches.** Add Desktop notifications and Play sound switches, persisted under the setting keys `notifications.desktop` and `notifications.sound` (default on).
      - The main process applies both at start-up and whenever they change. Wire them to `NotificationService.setDesktopEnabled` and `setSoundEnabled`, where sound maps to the OS toast's `silent` flag.
      - Delete the no-op `playNotificationSound`.
    - **Email notifier card.** Split `EmailSettingsCard` into:
      - `EmailNotifierCard`: status, an enable switch and a one-line summary;
      - `SmtpPresetFields`: Gmail, Outlook or Custom;
      - `CustomServerFields`;
      - `SecretField`, which is write-only. When `hasPassword` is true it shows "Password saved" with a **Replace** button. Saving without Replace omits the password, and main keeps the existing one (P5).
      - `RecipientField`;
      - `SendTestButton`: "Save and send test" when there are unsaved changes;
      - restyled `SetupInstructions` inside a `Disclosure`.
    - **Copy.** The notifier copy becomes: "Stored encrypted on this device and sent only to your mail server."
  - **Gmail section (conditional).**
    - At the start of the task, check `shared/contracts` for `gmail.status`, `gmail.connect` and `gmail.disconnect` wired by P4.
    - If they exist and have a consumer, build `GmailSection`: status plus Connect/Disconnect.
    - Otherwise remove every Gmail UI element (OQ7). Record which path was taken in the PR notes.
  - **App section.**
    - **Launch at login** uses `app.getAutoLaunch` / `setAutoLaunch`. An error such as the dev-build refusal at `app.handler.ts:81` is shown inline and the switch reverts.
    - **Start minimised** is a sub-option, enabled only while Launch at login is on. It is stored under `app.startMinimised`.
      - `setAutoLaunch` passes `--hidden` only when this option is set.
      - On a hidden launch, `main-window.ts` (P4) shows the window inactive and minimised to the taskbar instead of never showing it (OQ8).
    - **Removed controls:** Minimise to tray, Log level, Database location / Open Folder and Clear All Data.
  - **About section.** `AboutPanel`, which U5 reuses, shows:
    - "WA Stay" and the version from `app.getInfo()`;
    - **Check for updates** (`updater.checkForUpdates`), with the result as text: "You're up to date" / "Version X is available" / an error;
    - GitHub and Report an issue links to `https://github.com/wilsonwaters/wa-stay` and `/issues`;
    - **Open logs folder** (`app.openLogsFolder`);
    - the data folder path as selectable read-only text;
    - a "Technical details" `Disclosure` with the Electron, Chrome, Node and OS versions;
    - the licence.
  - **Remove Login.**
    - Delete `pages/Login.tsx` and the ParkStay email/password form.
    - Remove all renderer use of `window.api.auth`. D3 removes the gate in `App.tsx:62-68`; if any part remains, remove it here.
  - **Delete** `pages/Settings.tsx`, `components/settings/*` (now split under `features/settings/notifications/`) and `pages/Login.tsx`.
- **Out of scope**
  - The provider sign-in window, session partitions and account persistence (V6).
  - Secret storage (P5) and the notifier implementation (P3).
  - The Gmail OAuth back end (P4).
  - The AboutDialog shell (U5).

## Non-goals

- No profile editing (name, phone). V2 keeps the profile but no feature uses it yet.
- No new notifier types (SMS, push), and no per-watch notification routing.
- No theme or language settings. Dark theme is out of the project (brief).
- No data export, reset or "Clear all data". Uninstall-with-data already covers removal.
- No log-level control. Logging is P4's concern and is not a user setting.

## Completion Criteria

- [ ] `/settings` redirects to `/settings/accounts`.
  - The sub-nav lists Accounts, Notifications, App and About (plus Gmail only if wired).
  - The active item has `aria-current="page"`.
  - Each section loads directly by URL.
- [ ] Accounts shows one row per registered provider. Each row has a ProviderBadge, status, account label (when signed in) and "Needed for" text.
  - Connect calls `accounts.signIn('parkstay')` and shows "Waiting for sign-in…" until it resolves.
  - Sign out confirms first, then calls `accounts.signOut('parkstay')`.
  - An `account:updated` event updates the row without a reload.
- [ ] `/settings/accounts?provider=parkstay` focuses the ParkStay row's action button.
- [ ] Switching Desktop notifications off writes `notifications.desktop = false`, and the switch is still off after a remount. Main-side unit test: when it is false, `showDesktopNotification` is not invoked.
- [ ] Email notifier with `hasPassword: true`:
  - no password input is rendered; "Password saved" and "Replace" are shown;
  - Save without Replace calls `notifiers` configure with no password field and succeeds;
  - "Send test email" calls the notifier test and shows the result.
- [ ] No secret reaches the renderer. The notifier hook's response type exposes `hasPassword: boolean` and no password string.
- [ ] Gmail: either the Gmail section connects, disconnects and shows status through `gmail.*` hooks, or `grep -rni "gmail" src/renderer/features/settings` returns 0 results.
- [ ] Launch at login reflects `app.getAutoLaunch`. A rejected `setAutoLaunch` shows its error inline and the switch returns to off. Start minimised is disabled while Launch at login is off.
- [ ] Removed controls are absent: `grep -rni "minimi[sz]e to .*tray\|log level\|clear all data\|open folder" src/renderer` returns 0 results.
- [ ] About:
  - shows "WA Stay" and the version;
  - "Check for updates" renders a result message;
  - the GitHub link's href is `https://github.com/wilsonwaters/wa-stay`;
  - "Open logs folder" calls `app.openLogsFolder`.
- [ ] Legacy code and copy are gone:
  - `src/renderer/pages/Login.tsx`, `pages/Settings.tsx` and `components/settings/` are deleted;
  - `grep -rn "window.api.auth\|never sent to any\|never leaves your device" src/renderer` returns 0 results;
  - no file in `features/settings` exceeds 250 lines.
- **Accessibility**
  - [ ] The sub-nav is a labelled `nav` landmark with `aria-current`. Changing section moves focus to that section's `h2`.
  - [ ] Every toggle is `role="switch"` with a visible label, and its description is linked via `aria-describedby`. Saves are announced politely, e.g. "Desktop notifications off".
  - [ ] While sign-in is pending, the row's button has `aria-busy="true"`. When it ends, the result is announced and focus returns to the row's action button.
  - [ ] "Replace" moves focus into the new password field. "Cancel" restores "Password saved" and returns focus to Replace.
  - [ ] Field errors are linked via `aria-describedby`, and the test-email result appears in a polite live region.
- [ ] `npm run lint` (0 errors), `npm run format:check`, `npm run type-check` and `npm test` all pass.

## Edge Cases

- **Accounts**
  - A provider has no `provider_accounts` row: treat it as "Not connected".
  - `signIn` resolves after the user closed the window without signing in: the status is unchanged and the row reads "Not connected. Sign-in was cancelled."
  - `signIn` rejects with a provider error: show an inline error with Retry.
  - While one sign-in is pending, the other rows' Connect buttons are disabled.
  - Session expired: offer "Reconnect" instead of "Connect".
  - `signOut` fails: show an error toast and keep the status.
- **Notifications and settings values**
  - `settings.get` returns undefined: use the defaults (desktop on, sound on, start minimised off).
  - Sound is ignored while Desktop is off. Disable the Sound switch with the explanation "Requires desktop notifications".
- **Email notifier**
  - Turning it on when it is not configured opens the form without calling `enable`, matching today's guard at `EmailSettingsCard.tsx:214`.
  - The custom port must be 1–65535. If the port and the secure flag disagree (465 with STARTTLS, or 587 with TLS), show a hint.
  - A failed test shows the server's error message, and the status changes to "Error".
- **App section**
  - On a non-packaged dev build, auto-launch is refused with an explanatory message.
  - Update check while offline or failing shows "Couldn't check for updates", with Retry.
- **About section**
  - `app.getInfo` fails: the version reads "Unknown" and the rest still renders.
  - The logs folder is missing: `openLogsFolder` returns an error, which a toast shows.
- **Gmail:** the contract is only partly present (for example `status` without `connect`). Treat it as not wired and remove the section.

## Test Strategy

- **Unit (~5):**
  - "Needed for" text from capabilities;
  - setting defaults and parsing;
  - notifier form → payload, omitting the password unless replaced;
  - section route helper.
- **Main unit (~3):**
  - NotificationService honours `notifications.desktop` and `notifications.sound` at start-up and on change;
  - `setAutoLaunch` passes `--hidden` only when start minimised is set;
  - a hidden launch shows the window minimised.
- **Component (~14):**
  - settings layout: redirect, `aria-current`, focus on section change;
  - Accounts: rows, connect pending/success/cancel, sign-out confirm, deep-link focus, `none` row;
  - Notifications switches;
  - EmailNotifierCard: secret states, Replace focus, save payload, test result;
  - App: auto-launch error revert, start minimised disabled;
  - AboutPanel: links, update check, logs folder;
  - Gmail: conditional render.
- **Integration (none):** covered by the stream integration walkthrough.

## Context Files to Read First

- `CLAUDE.md`; `ai-state/architecture-notes.md` §4 (accounts, notifiers, gmail, settings, app, updater), §7, §8; `ai-state/streams/provider-ux/master-plan.md`
- `ai-state/research/ui-review.md` (#1, #7, #8, #9) and `ai-state/research/tech-review.md` (#5, #6, #8, #9)
- P4 and P5 PR notes and outputs:
  - `src/main/app/main-window.ts`, `src/main/security/*`;
  - `src/shared/contracts/{accounts,notifiers,gmail,settings,app,updater}*`
- U2 outputs: `renderer/api/accounts.ts`, `components/accounts/ConnectAccountPrompt.tsx`
- Current code to replace:
  - `src/renderer/pages/Settings.tsx`, `src/renderer/pages/Login.tsx`;
  - `src/renderer/components/settings/{EmailSettingsCard,SMTPSetupInstructions}.tsx`;
  - `src/renderer/components/AboutDialog.tsx`
- Main-process wiring: `src/main/services/notification/notification.service.ts` (or its `core/notifications` successor), `src/main/ipc/handlers/{app.handler,settings.handlers}.ts`, `src/main/index.ts:29-36,83-89`

## Notes

- **Setting keys.** Use typed setting keys declared in `shared/contracts/settings`: `notifications.desktop`, `notifications.sound` and `app.startMinimised`. The renderer must not choose `valueType`/`category`, which today's `settings.set(key, value, valueType, category)` lets it do. If P3 kept that signature, wrap it in the hook.
- **Gmail and Start minimised are open questions.** Gmail (OQ7) and Start minimised (OQ8) are recorded in the master plan. Follow its defaults unless the stakeholder decides otherwise.
- **About ownership.** `AboutPanel` is the single source for About content. U5 wraps it in a Dialog for the account menu, so do not duplicate it there.
- **Profile data.** The legacy ParkStay email and password migrate to the ParkStay account in V2/V6. This task shows no legacy credentials.
