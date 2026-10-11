# U4 design: Settings and accounts (#38)

**Status:** for approval. No production code is written until this design is approved.
**Inputs:** the U4 spec; the provider-ux master plan (OQ7, OQ8); architecture-notes §4, §7–§9 and §12 (12.7, 12.9, 12.11, 12.21–12.23, 12.25, 12.31, 12.32); `docs/design/*`; lane/a at `2dffc49`; U1 on lane/m (`useAccountStatus`, `ROUTES.settings(section, { provider })`); U5's in-flight edits on lane W (`notification.service.ts`).
**Assumes merged before implementation:** U1. U2, U3 and U5 are reused if they have landed (lane order U3 → U5 → U2 → U4).

**Facts that shape the design**
- No new IPC channel is needed. Every control maps onto an existing `settings`, `app`, `accounts`, `notifiers` or `updater` method. Two contract shapes change (§2).
- `accounts.list()` returns only providers that have sign-in. Rows therefore come from `providers.list()`, joined by id.
- `ProviderAccount.status` is `signed-in | signed-out | unknown`. Main cannot tell an expired session from a sign-out: both store `signed-out` and keep `lastSignedInAt`.
- `notifiers.configure` treats a missing `enabled` as `false` (`notifiers.handlers.ts`), so the form always sends it.
- Gmail: the contract has `setCredentials/getCredentials/authorize/checkAuthStatus/revokeAuth`, not `status/connect/disconnect`, and nothing in main reads an OTP. `GmailOTPService.waitForEmail` has no caller, and the providers plan says it "stays unwired". **OQ7 path: remove every Gmail OTP element.**
- `Login.tsx` and `pages/Settings.tsx` are already gone. D3 moved Settings to `features/settings/legacy/`, and V6 removed the `auth` namespace.

## 1. Information architecture

| Path | Renders |
|---|---|
| `/settings` | `<Navigate replace>` to `/settings/accounts`, keeping the query string |
| `/settings/:section` | `SettingsPage`. `section` is one of `accounts`, `notifications`, `app`, `about`. Any other value redirects to `accounts` (old links and typos). |
| `/settings/accounts?provider=<id>` | Scrolls to that provider's row and focuses its action button (§3) |

**Layout.**
- `PageHeader` with the `h1` "Settings". From `lg` up, a grid `grid-cols-[13rem_minmax(0,1fr)] gap-12`, at most `max-w-5xl`.
- Left: `SettingsNav`, a `<nav aria-label="Settings sections">` holding a `ul` of router `NavLink`s.
  - Each is a 40 px row with a lucide icon: `CircleUser` Accounts, `Bell` Notifications, `AppWindow` App, `Info` About.
  - The active row has `aria-current="page"`, weight 600 and a `surface-subtle` fill. No coral and no brushstroke: the brushstroke belongs to the primary nav.
- Below `lg` (reached only by zooming, since the minimum window is 960 px), the same nav stacks above the section as a full-width list.
- The content column is `max-w-2xl`. Each `SettingsSection` has an `h2` (`text-xl`, `tabIndex={-1}`), one `fg-secondary` line, and groups separated by space. Hairlines appear only between list rows.

**Focus.**
- Changing section moves focus to the new section's `h2` (`useSectionFocus`).
- **Shell change, small, tested in `useRouteFocus.test.tsx`.** Today a section change would make `useRouteFocus` pull focus back to the `h1`.
  - It now keys on `routeFocusKey(pathname)` (`app/routes.ts`), which treats `/settings/*` as one page.
  - A page that moves focus inside `<main>` before the route-focus frame keeps it (a `focusin` listener armed at navigation). Without this, the `?provider=` focus loses to the `h1` whenever the accounts query is already cached.

**Files** (each ≤ 250 lines; tests sit beside them):
```
features/settings/  SettingsPage.tsx  SettingsNav.tsx  SettingsSection.tsx  sections.ts (ids, labels, icons, isSettingsSection)  useSectionFocus.ts
  accounts/         AccountsSection.tsx  AccountRow.tsx  SignInLinkField.tsx  accountText.ts (status line, "Needed for")  useProviderDeepLink.ts
  notifications/    NotificationsSection.tsx  DesktopSwitches.tsx
    email/          EmailNotifierCard.tsx  EmailNotifierForm.tsx  SmtpPresetFields.tsx  CustomServerFields.tsx  SecretField.tsx
                    RecipientField.tsx  SendTestButton.tsx  SetupInstructions.tsx  emailForm.ts (zod schema, defaults, toConfigureInput)
  app/              AppSection.tsx
  about/            AboutPanel.tsx (shared with U5's AboutDialog)  UpdateCheck.tsx  AboutSection.tsx (h2 + AboutPanel)
```

**Hooks** (`renderer/api/`). These are the only files that touch `window.api`. Query keys are added to `queryKeys.ts`.
- `settings.ts`: `useSetting(key)` reads `settings.get`, falling back to `settingDefault(key)`. `useSetSetting(key)` is optimistic and rolls back on error; only renderer-writable keys type-check.
- `notifiers.ts`: `useEmailNotifier()` returns `EmailNotifierView | null`, which is `NotifierView` with `config: SMTPConfigView`, so no `pass` exists in the type. Also `useConfigureEmailNotifier`, `useSetEmailNotifierEnabled` and `useTestEmailNotifier`.
- `app.ts` (extended): `useLaunchAtLogin()` and `useSetLaunchAtLogin()`.
- `updater.ts`: `useCheckForUpdates()` calls `checkForUpdates`, then `getStatus`. It is added to U5's file if that exists.
- `accounts.ts` (U1's file; U2's hooks are reused if they exist):
  - `useAccounts()`, on the same query key as `useAccountStatus`;
  - `useAccountCheck(id)` → `accounts.status`, fresh for 60 s, never retried, and only while the Accounts section is mounted;
  - `useSignIn()`, `useSignOut()` and `useOpenSignInLink()`.

## 2. Every control, and what it drives in main

**`contracts/settings.ts`.** `SettingDefinition` gains `default` and `rendererWritable?: false`. `settings.set` accepts only writable keys and answers any other key with `VALIDATION`. `settings.get` returns the stored value, or the default.

| Key | Type / category | Default | Written by |
|---|---|---|---|
| `notifications.desktop` (new) | boolean / NOTIFICATIONS | `true` | `settings.set` |
| `notifications.sound` (new) | boolean / NOTIFICATIONS | `true` | `settings.set` |
| `app.startMinimised` (new) | boolean / GENERAL | `false` | `app.setAutoLaunch` only (`rendererWritable: false`) |
| `launchOnStartup` (kept: the name B3 migrates from v1) | boolean / GENERAL | `false` | `app.setAutoLaunch` only (`rendererWritable: false`). Today the renderer can desync it from the OS. |

**`contracts/app.ts`** (the preload mapper and parity tests are updated):
- `getAutoLaunch` now returns `LaunchAtLogin { enabled: boolean; startMinimised: boolean }`.
- `setAutoLaunch` takes `{ enabled: boolean; startMinimised?: boolean }`, with positional args `[enabled, startMinimised?]`, and returns `LaunchAtLogin`. An omitted `startMinimised` keeps the stored value.

| Section | Control | IPC / key | Main behaviour |
|---|---|---|---|
| Accounts | Connect / Reconnect | `accounts.signIn(id)` | V6 sign-in window on the provider partition; resolves on sign-in or close |
| Accounts | Sign out (after ConfirmDialog) | `accounts.signOut(id)` | Clears the partition and the `provider_accounts` status only, never `users` (§12.22). Returns `ACCOUNT_BUSY` while a snipe or hold needs the session. |
| Accounts | Sign-in link + "Open link" | `accounts.openSignInLink(id, url)` | Loads the link in the sign-in window if it matches the provider's origins, otherwise `VALIDATION` |
| Accounts | (on visit) | `accounts.status(id)` | One read-only signed-in check per provider (ParkStay `/api/profile`), cached 60 s. `account:updated` refreshes the rows. |
| Notifications | Desktop notifications | `notifications.desktop` | `NotificationService` shows no OS toast when false. The in-app list, events and email are unchanged. |
| Notifications | Play a sound | `notifications.sound` | The toast's `silent = !sound`. Disabled while desktop is off. |
| Notifications | Email on/off | `notifiers.enable/disable(EMAIL_SMTP)` | Repository flag plus `dispatcher.loadNotifierConfigurations()` |
| Notifications | Save (email form) | `notifiers.configure` | `withStoredPassword` keeps the saved password only for the same host, port and user; the vault encrypts it (P5) |
| Notifications | Send test email | `notifiers.test` | `verify()` and a real test message, using only the stored settings; `lastTestedAt` and `lastError` are stored |
| App | Start WA Stay when you sign in | `app.setAutoLaunch({ enabled })` | `setLaunchAtLogin`. Refused when not packaged (error shown inline). |
| App | Start minimised | `app.setAutoLaunch({ enabled: true, startMinimised })` | Re-registers the login item with `--hidden` only when this is on (§5) |
| About | Check for updates | `updater.checkForUpdates` → `getStatus` | electron-updater check. `null` means it couldn't check. |
| About | Open logs folder | `app.openLogsFolder` | `shell.openPath(<userData>/logs)`. Main computes the path; the renderer never sends one. |
| About | Data folder, version, technical details | `app.getInfo` | Read-only. `userDataPath`, versions, `secretStorage.backend`. |

**Removed (decided):**
- **Gmail OTP tab** (OQ7): it has no consumer. P4's `gmail.*` channels and B3's `gmail-oauth.json` copy are left alone.
- **Minimise to tray**: there is no `Tray`, and closing the window quits the app. Start minimised replaces it.
- **Log level**: a spec non-goal (P4's concern).
- **Database location and "Open Folder"**: the path is read-only text in About. The logs folder is the only folder WA Stay opens.
- **Clear All Data**: a spec non-goal. Uninstall-with-data covers it, and no Settings path can reach the profile row (§12.22), so there is no destructive control and no confirm.
- **Dead code**: the ParkStay email/password form (gone since V6), and the shared `AppSettings` and `settingsSchema`, which have no consumer.

## 3. Accounts UI

There is one `AccountRow` per manifest from `providers.list()` (§12.9: shown even when only ParkStay is registered), in a `ul` with hairlines. Each row shows a `ProviderBadge` and name, the status line (icon and words, never colour alone), a meta line ("{email} · last signed in Fri 3 Oct 2026", when known), the "Needed for" sentence, and one action button on the right (`secondary`, never coral).

**Status line** (`accountText.ts`, pure and unit-tested):
- `account: 'none'` → "No account needed", with no button.
- `signed-in` → "Signed in as {displayName ?? email}" (or "Signed in"), button **Sign out**.
- Signed out with a `lastSignedInAt` → "Signed out", button **Reconnect**. This deviates from the spec's "Session expired": main cannot tell expiry from sign-out, and copy must say only what is true.
- Otherwise → "Not connected", button **Connect**.

**"Needed for"**, from the manifest:
- `optional` with `holds`: "Optional. Connect {shortName} before a release so checkout is quicker. Holds work without it." This is the §12.32 soft hint.
- `optional` without holds: "Optional."
- `required-for-holds`: "Needed for holds (Site Sniper and automatic holds)."
- `required`: "Needed for everything WA Stay does on {shortName}."
- `bookingImport` adds "Also used to import your bookings."
- For `required*` while not signed in, the status takes the warning tone: "Not connected. {shortName} holds can't be placed until you connect." FakeProvider covers this in tests, since ParkStay is `optional`.

**Sign-in.**
- Connect calls `useSignIn().mutate(id)`. The button reads "Waiting for sign-in…" (`loading`, `aria-busy="true"`), and every other row's Connect is disabled until it settles.
- If it resolves signed in, "Signed in to ParkStay as …" is announced. If it resolves not signed in (a closed window, or a check that couldn't confirm), the row adds "Sign-in wasn't completed." and announces it. If it rejects, an inline danger `Notice` shows the error with **Retry**.
- In every case focus returns to the row's action button, which may now be "Sign out".

**Pasted-link fallback.**
- While a row is not signed in, a quiet `Disclosure` "Have a sign-in link?" holds `SignInLinkField`: a "Sign-in link" TextField and **Open link**.
- The renderer checks the link is https. Main's `VALIDATION` ("That link is not a ParkStay sign-in link") becomes the field error, linked with `aria-describedby`. On success the field clears and "Sign-in link opened" is announced; the outcome arrives as `account:updated`.

**Sign out.**
- A `ConfirmDialog` (`tone="danger"`, Cancel focused first): "Sign out of ParkStay?" / "WA Stay forgets your ParkStay session on this computer. Watches and snipes keep running, and you can sign in again at any time."
- `onConfirm` returns the promise. A rejection, including `ACCOUNT_BUSY` with main's copy "A snipe or hold on ParkStay is in progress…", stays in the dialog as its alert. This is the D2 behaviour, and it replaces the spec's "error toast".

**Deep link.** `useProviderDeepLink` runs once per arrival, after the rows render. It scrolls the row into view (`block: 'center'`, instant) and focuses its action button, or the row's name (`tabIndex -1`) for a `none` row. An unknown id does nothing.

## 4. Secrets UX (email notifier)

**`EmailNotifierCard`** is the one `Card` in Settings.
- It shows the status ("Not set up", "On", "Off" or "Error: {lastError}") and a summary: "Sends to {toEmail ?? user} through {host} · last tested {date}".
- The "Email notifications" switch, turned on while email is not configured, opens the form and does not call `enable`. "Set up email" or "Edit settings" opens `EmailNotifierForm` inline; Cancel restores the summary.

**The form** (react-hook-form with zod, `emailForm.ts`):
- **`SmtpPresetFields`**: a `RadioGroup` "Mail service" with Gmail, Outlook and "Other mail server". Gmail and Outlook fill host, port and security from `SMTP_PRESETS`.
- **`CustomServerFields`**: server; port, an integer 1–65535 ("Enter a port from 1 to 65535"); a security `Select` ("SSL/TLS" or "STARTTLS"); an optional "From address". A mismatch (465 with STARTTLS, or 587 with SSL/TLS) shows a hint, not an error.
- **`RecipientField`**: "Send alerts to", optional, with the hint "Leave empty to send to {user}".

**`SecretField`** is write-only.
- While `hasPassword` is true and host, port and user still match the stored ones (`isSameSmtpAccount`, shared), it shows "Password saved" and **Replace**.
- Replace renders a `type="password"` field (`autoComplete="new-password"`) and focuses it. **Cancel** restores "Password saved" and focuses Replace.
- A changed server or account forces the field into entry mode, with the hint "Enter the password for this server and account." This mirrors main's `SMTP_NEW_ACCOUNT_PASSWORD`.
- `secretState === 'unreadable'` also forces entry mode, with "The saved password couldn't be read on this computer. Enter it again."
- Its copy reads "Stored encrypted on this device and sent only to your mail server." When `AppInfo.secretStorage.backend === 'local'` it adds "This computer has no system key store, so the key is kept in WA Stay's data folder."

**Payload and buttons.**
- `toConfigureInput(values, { enterPassword })` includes `auth.pass` only in entry mode with a value. It always sends `enabled`: the current state, or `true` on first setup.
- On success the form resets. The typed password lives only in form state, and a test proves no query cache holds it.
- **Save** is `primary`. It is the only coral button in Settings, and only while the form is open.
- **`SendTestButton`** reads "Send test email" (`secondary`), or "Save and send test" when there are unsaved changes.
- The result goes to a polite live region: "Test email sent to {to}. Check your inbox.", or the server's error in danger text. The status then refreshes to "Error", which main stored.
- **`SetupInstructions`** sits in a `Disclosure` "How to get an app password": Gmail and Outlook steps, each with an `ExternalLink` to the app-password page, and the custom-server case (Australian English).

## 5. Main-process wiring (§12.11: wiring only)

**Notification preferences.**
- `NotificationServiceOptions` gains `preferences: () => { desktop: boolean; sound: boolean }`. The container passes a reader over `repositories.settings` that applies the defaults. `notify()` reads it on every call and, when desktop is on, calls `showDesktopNotification(n, { silent: !sound })`.
- `setDesktopEnabled`, `setSoundEnabled` (never called), their fields and the no-op `playNotificationSound` are deleted. This is a deviation: the values are read at use rather than pushed, so start-up and changes need no extra wiring and cannot drift.
- The dispatcher is unchanged: email follows the notifier's own `enabled` flag.

**Launch at login (`app/login-item.ts`).**
- `setLaunchAtLogin({ enabled, startMinimised }, host)`: on Windows `args = enabled && startMinimised ? [HIDDEN_ARG] : []`; on macOS `openAsHidden = enabled && startMinimised`.
- The `app.setAutoLaunch` handler refuses `enabled` in dev builds ("Starting at sign-in is only available in the installed app, not when running from source."). It resolves `startMinimised` (request, or stored), registers, stores both keys and returns `LaunchAtLogin`.

**Hidden start (OQ8, `app/main-window.ts`).**
- `startHidden` becomes `startMinimised`. On `ready-to-show` the window calls `minimize()` instead of returning, and never `show()` or `focus()`. The aim is a taskbar entry that doesn't steal focus; the Windows result is confirmed manually (R2).
- `isHiddenLaunch()` (`--hidden`, or macOS `wasOpenedAsHidden`) is unchanged.
- A normal second launch already restores and focuses (`single-instance.ts` `bringToFront`), and so does U5's notification click (`showMainWindow`).

**B3.** `replaceLegacyLoginItems` takes `{ launchOnStartup, startMinimised }`. A v1 install with launch at login on always started `--hidden`, so `finishLegacyInstall` stores `app.startMinimised = true` and registers with `--hidden` (OQ-3).

**V7 quit hold.** With no tray there is no zero-window keep-alive.
- Closing the last window still goes `window-all-closed` → `app.quit()` → the quit hold (hide, dispose, bounded wait), unchanged. A minimised window still counts as a window, so the scheduler keeps running.
- The App section says so: "Closing the WA Stay window quits it; watches stop until you open it again."

**Other §12 constraints.**
- §12.23: the preferences reader touches only the plain `settings` table, after the database opens; nothing new touches `safeStorage`.
- §12.25: no CSP change. External links are anchors that go through `setWindowOpenHandler` → `shell.openExternal`, and a pasted sign-in link loads only in the provider window.
- §12.21/22: U4 never deletes or touches `users`.

## 6. Accessibility and design

**Calm, not AI-looking.**
- Plain section headings and list rows on the canvas, with space between groups.
- No card per section (the only Card is the email notifier group), and no boxes in boxes.
- No emoji, gradients or brushstrokes. lucide icons at 20 px, only beside text. Figtree only.

**One coral.** The only `primary` is the email form's Save. Connect, Reconnect, Sign out, Send test, Open link, Check for updates and Open logs folder are `secondary` or `ghost`. Danger appears only as the solid confirm in the sign-out ConfirmDialog.

**D2 primitives only:** Switch, RadioGroup, Select, TextField and Field, Disclosure, ConfirmDialog, Notice, Card, Button, ProviderBadge and PageHeader, plus `ExternalLink` and the decorative `Logo` lockup in About. The sub-nav is router links, not a hand-rolled primitive.

**Switches** are all D2 `Switch` (`role="switch"`), each with a visible label and a description linked by `aria-describedby`:

| Switch | Description |
|---|---|
| Desktop notifications | "Pop-up alerts on your desktop when a watch finds a site or a site is held. Everything also appears under the bell." While off, it adds: "Held sites expire quickly; you'll only see them in WA Stay or by email." |
| Play a sound | "Uses your system's notification sound". While desktop is off: "Requires desktop notifications". |
| Start minimised | "Opens in the taskbar instead of on screen". While launch at login is off: "Requires starting at sign-in". |

Each save is announced politely ("Desktop notifications off"). A failed save reverts the switch and shows `toast.error` ("Couldn't save that setting. Try again.").

**About.** `AboutPanel` shows:
- "WA Stay", "Version 2.0.0" ("Unknown" if `getInfo` fails) and the description.
- Check for updates, with the result in a polite live region: "You're up to date", "Version X is available", "Version X is ready to install", or "Couldn't check for updates" with **Retry**.
- `ExternalLink`s "GitHub" (`APP_REPO_URL`) and "Report an issue" (`/issues`), and Open logs folder (an error shows as a toast).
- "Data folder" as selectable read-only text, a `Disclosure` "Technical details" (Electron, Chrome, Node, OS and arch, and the secret-storage backend in words), and "MIT License".

## 7. Test plan (each Completion Criterion mapped to a test)

| Criterion | Test (file → name) |
|---|---|
| Redirect, sub-nav, `aria-current`, direct URL | `features/settings/SettingsPage.test.tsx` → "redirects /settings to /settings/accounts (keeps ?provider)"; "lists Accounts, Notifications, App and About in the Settings sections nav"; "marks the current section aria-current=page"; it.each "loads {section} directly by URL"; "an unknown section redirects to accounts" |
| Accounts rows, Connect, Sign out, `account:updated` | `accounts/AccountsSection.test.tsx` → "one row per registered provider: badge, status, label, needed-for" (ParkStay + Fake `required-for-holds` + Fake `none`); "Connect calls accounts.signIn('parkstay') and shows Waiting for sign-in… until it resolves"; "other Connect buttons are disabled while one is pending"; "a closed window reads Sign-in wasn't completed"; "a rejected sign-in shows the error with Retry"; "Sign out confirms, then calls accounts.signOut('parkstay')"; "ACCOUNT_BUSY stays in the dialog"; "account:updated updates the row without a reload"; "a none row reads No account needed and has no button"; "a pasted link calls openSignInLink; VALIDATION shows on the field". `accounts/accountText.test.ts` → status lines and "Needed for" for every requirement and capability combination |
| `?provider=parkstay` focus | `AccountsSection.test.tsx` → "?provider=parkstay focuses the ParkStay row's action button" (through `renderWithApp`, so route focus takes part); `app/useRouteFocus.test.tsx` → "settings sections are one page for route focus"; "a page that placed focus inside main keeps it" |
| Desktop switch persists; main honours it | `notifications/NotificationsSection.test.tsx` → "switching Desktop notifications off writes notifications.desktop=false and stays off after a remount"; "Sound is disabled with Requires desktop notifications"; "announces Desktop notifications off"; "a failed save reverts and shows an error toast". `tests/unit/core/notifications/notification-preferences.test.ts` → "desktop false: no Electron Notification is shown"; "sound false: silent toast"; "a change applies to the next notify with no restart"; "the container reads stored settings, with defaults" |
| Email notifier with `hasPassword` | `notifications/email/EmailNotifierCard.test.tsx` → "no password input; Password saved and Replace shown"; "Save without Replace calls configure with no auth.pass and succeeds"; "Replace focuses the new field; Cancel restores and focuses Replace"; "changing host or user asks for the password"; "Send test email calls notifiers.test; result in a polite live region"; "Save and send test when there are unsaved changes"; "a failed test shows the server error and status Error"; "turning on when not set up opens the form without enable"; "port out of range is linked by aria-describedby; 465/STARTTLS hint"; "an unreadable secret asks for re-entry". `email/emailForm.test.ts` → "toConfigureInput omits pass unless entered; always sends enabled" |
| No secret reaches the renderer | `api/notifiers.test.tsx` → compile-time `assertTypeEquals<keyof EmailNotifierView['config']['auth'], 'user'>` and `hasPassword: boolean`; "after Save, no query cache entry contains the typed password". `tests/integration/secret-sweep.test.ts`: no new channels, so READS stays complete (its own coverage test enforces this); only `app:get-auto-launch`'s new shape is swept |
| Gmail removed | `tests/unit/renderer/settings-cleanup.test.ts` → "no Gmail OTP UI in the renderer" (narrowed grep, OQ-1) |
| Launch at login, error revert, Start minimised | `app/AppSection.test.tsx` → "reflects app.getAutoLaunch"; "a rejected setAutoLaunch shows its error inline and the switch returns to off"; "Start minimised is disabled while launch at login is off"; "Start minimised calls setAutoLaunch(true, true)". `tests/unit/app/login-item.test.ts` → "passes --hidden only when start minimised is set" (Windows + macOS); "legacy replacement registers with start minimised". `tests/unit/app/main-window.test.ts` → "a hidden launch minimises the window and never shows or focuses it". `tests/unit/ipc/settings-app.handlers.test.ts` → "main-only keys are refused by settings.set"; "settings.get returns defaults"; "setAutoLaunch stores both keys and keeps the stored startMinimised when omitted" |
| Removed controls absent | `settings-cleanup.test.ts` → "no minimise to tray, log level, clear all data or open folder in src/renderer" (the spec's grep, verbatim) |
| About | `about/AboutPanel.test.tsx` → "shows WA Stay and the version"; "Unknown when getInfo fails"; "GitHub href is https://github.com/wilsonwaters/wa-stay"; "Open logs folder calls app.openLogsFolder; failure toasts"; "Check for updates: up to date / available / couldn't check with Retry" |
| Legacy gone, ≤ 250 lines | `settings-cleanup.test.ts` → "legacy Settings, components/settings and AboutDialog are deleted"; "no window.api.auth or misleading copy"; "no file in features/settings exceeds 250 lines". `api-boundary.test.ts`: two allow-list entries removed, MAX lowered |
| Accessibility items | covered in the files above (switch role and description, aria-busy and focus return, Replace/Cancel focus, live regions, h2 focus on section change) |
| Gate | lint (0 errors), format, type-check, `npm test`; e2e: `navigation.spec` expects `/settings/accounts`; `lifecycle.spec` persists `notifications.desktop` (`launchOnStartup` is now main-only) |

**Runtime verification** (screenshots in `scratchpad/shots/U4/`, Electron ABI, `WA_STAY_USER_DATA_DIR`). Each state is checked with axe (0 critical or serious) and against the console and main logs: (1) Accounts signed out; (2) waiting for sign-in, with the live ParkStay sign-in page loaded once and nothing typed (no holds, §12.33); (3) `?provider=parkstay` focus; (4) sign-out confirm, on a seeded signed-in row; (5) the notification switches; (6) email "Password saved", configured through IPC; (7) a failed test against `smtp.invalid`; (8) the dev-build refusal shown inline in App; (9) About; (10) 200 % zoom with the stacked nav; (11) a `--hidden` launch, where `isMinimized()` is true and `isFocused()` false.

## 8. Deviations, risks and open questions (each with a recommendation)

**Deviations:**
- Preferences are read at notify time, and the setters are removed.
- Start minimised goes through `app.setAutoLaunch`, and `getAutoLaunch` returns an object.
- The account status reads "Signed out" / "Reconnect", not "Session expired", and an unfinished sign-in reads "Sign-in wasn't completed".
- Sign-out errors stay in the ConfirmDialog instead of a toast.
- `features/settings/legacy/` is what gets deleted: `pages/*` and `Login.tsx` are already gone.
- Two small shell changes (§1), and the Gmail grep is narrowed (OQ-1).

**Open questions:**
- **OQ-1, Gmail grep vs the Gmail SMTP preset.** The spec's `grep -rni gmail src/renderer/features/settings` would also remove the Gmail mail-server preset and its app-password steps, which are P3's notifier and are wanted. **Recommend:** keep the preset and assert instead that `grep -rniE "gmail\.(authorize|checkAuthStatus|revokeAuth|setCredentials|getCredentials)|gmail otp|GmailSection" src/renderer` returns 0 and that `renderer/api` has no `gmail` hooks.
- **OQ-2, freshness of the Accounts status.** Stored `signed-in` can be up to 6 h stale against ParkStay's 1 h session. **Recommend:** one `accounts.status` check per provider per visit (cached 60 s; the e2e fixture already serves `/api/profile`).
- **OQ-3, start-up for v1 upgraders with launch at login.** **Recommend:** `app.startMinimised = true`. v1 always started hidden, so a window popping up at login would be new.
- **OQ-4, `AboutPanel` ownership.** U5 lands first and its AboutDialog wraps U4's panel. **Recommend:** the orchestrator tells lane W to create `features/settings/about/AboutPanel.tsx` with the §6 content (without the update check if it prefers). U4 then adds `UpdateCheck` and the data-folder line, and never duplicates the panel.
- **OQ-5, main-only keys.** `launchOnStartup` and `app.startMinimised` become `rendererWritable: false`. **Recommend:** yes. This is a small schema change and stops the renderer from lying about the OS state.

**Risks:**
- **R1.** U5 also edits `notification.service.ts` (titles, the click → `app:navigate`, `showDesktopNotification`). Rebase after U5; U4's hunks are `notify()`, the options and the `silent` flag.
- **R2.** `minimize()` on a never-shown window is checked on Linux (xvfb) only. Add the Windows taskbar check to the stakeholder's manual checklist.
- **R3.** `getAutoLaunch` reports the stored choice, not Windows' Task Manager "disabled" state. Leave it as is, and note it in the docs (Q2).
- **R4.** Dev builds always show "Couldn't check for updates", because electron-updater skips unpackaged builds. This is acceptable. A later `AppInfo.packaged` field could word it better; it is not part of this task.
