# V6 design: provider accounts, in-app sign-in and payment hand-off (#24)

**Status:** for approval. No production code is written until this is approved.
**Inputs:** the V6 spec and both addenda; architecture-notes §3, §4, §7 and §12 (12.21–12.23, 12.26, 12.27, 12.30, 12.31); the approved V4 design (`a161801`), used as the contract; lane/a at `f49ed9e` (V1, V2, V3, V5, P5, B3 and D3 merged); the DBCA source (`parkstay_bs_v2`).

**DBCA source facts behind this design:**
- `create_booking` needs no sign-in (`api.py:2938-2947`) and sets `session['checkouthash'] = sha256(str(pk))` (`api.py:3375`). The ledger returns to `/success/?checkouthash=<sha256(pk)>` (`utils.py:1766`). `/success/` also serves `success-error.html` with a 200 (`views.py:886-893`).
- `/login-success/` renders either "Login Success" or "Session Expired" at the same URL. `SESSION_COOKIE_AGE = 3600` (`settings.py:217`). `/api/` is queue-gated, `/ssologin` is not (`queue_middleware.py:39`).

## 1. Module layout

| Path | New/changed | Contents |
|---|---|---|
| `providers/parkstay/auth.ts` | new | `createParkStayAuth(endpoints): BrowserSessionAuth` with the spec's `signInUrl`, five `allowedOrigins` and `completionUrlPatterns`. Also the pure `classifyProfileResponse()` (§2.2). |
| `providers/parkstay/holds.ts` | changed | `paymentOrigins: [PARKSTAY_BASE_URL, 'https://*.dbca.wa.gov.au']` (PQ5) and `bookedReference()` (§4.2) |
| `providers/parkstay/index.ts` | changed | `account: 'required-for-holds'`, `auth: createParkStayAuth(options.endpoints)` |
| `providers/sdk/url-patterns.ts` | new | Pure helpers. `matchOrigin(url, patterns)`: exact `https://host[:port]` or `https://*.suffix`. `matchUrlPattern(url, patterns)`: `*` wildcard on the full URL, anchored. `logUrl(url)`: the origin only, for logs. `describeUrl` moves here from `main-window.ts`. |
| `providers/sdk/provider.ts` | changed | `HoldsModule.bookedReference?(hold: { reference }, url): string \| null` (additive, optional) |
| `providers/registry.ts` | changed | `httpOf(id): HttpClient` (the ctx it already keeps). Rules: `completionUrlPatterns` and `paymentOrigins` must be valid https patterns. |
| `core/accounts/ports.ts` | new | Electron-free interfaces: `ProviderWindowOpener`, `ProviderWindowHandle`, `ProviderSessionStore`, `AccountGate` |
| `core/accounts/provider-account.service.ts` | new | `ProviderAccountService` (§2) |
| `core/holds/hold-payment.service.ts` | new | `HoldPaymentService`: `openForSnipe(id)` and `openForWatch(id)` share one path (§4) |
| `app/provider-windows.ts` | new | `ProviderWindows` implements the opener and the session store. Electron is injected (`BrowserWindow`, `session`, `shell`, `devTools`). Also `isProviderWindow(contents)`. |
| `ipc/handlers/accounts.handlers.ts` | rewritten | §5 |
| `core/snipes`, `core/watches`, `core/holds/night-guard.ts` (V4) | changed | Account gate, `markBooked`, watch hold columns, guard rule (§2.4, §3.2, §4) |

### 1.1 Window construction and hardening (`app/provider-windows.ts`)

There is one factory, `open({ providerId, title, kind, url, allow, openBlockedExternally })`. `url` must match `allow`; anything else is refused before `loadURL`.

- **Window.** `new BrowserWindow({ parent: mainWindow ?? undefined, width: 520, height: 760, title, show: false, autoHideMenuBar: true, webPreferences })`, then `setMenu(null)`. The window shows on `ready-to-show`. `page-title-updated` is prevented. The title is `'{name} — Sign in'` or `'{name} — Payment'`, with ` · {current host}` appended on each `did-navigate`, because the window has no address bar (deviation D5).
- **`webPreferences`:** `{ partition: providerPartition(id), sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, navigateOnDragDrop: false, spellcheck: false, safeDialogs: true, devTools: !app.isPackaged }`. No preload key at all, so the criterion grep finds nothing.
- **Top-level navigation.** `will-navigate` and `will-redirect` (main frame only, `isMainFrame`) call `preventDefault()` unless `matchOrigin(url, allow)`.
  - A blocked URL is logged by origin only (`logUrl`), never its path or query: magic links carry tokens, the success URL a hash.
  - The sign-in window sends a blocked http(s) URL to `shell.openExternal`; the payment window only logs it (PQ5 edge case).
  - Our own `loadURL` calls (the initial URL, a pasted link) do not fire `will-navigate`, so the factory and `load()` check `allow` first.
- **Subframes are not restricted** (PQ5: BPOINT and 3-D Secure frames), but are still sandboxed.
- **`setWindowOpenHandler`:** an allowed URL loads in the same window (`loadURL`, then `deny`). Any other http(s) URL opens externally; anything else is denied and logged.
- **Partition hardening, once per partition:** `setPermissionRequestHandler` → `cb(false)`, `setPermissionCheckHandler` and `setDevicePermissionHandler` → `false`. The UA is set to `CHROME_USER_AGENT`: idempotent with V1's client, and it covers fixture mode, whose client sets none.
- **Per-window events:** `certificate-error` → `preventDefault(); cb(false)`, with the host logged. `select-client-certificate` and `login` → `cb()` (nothing offered). `will-prevent-unload` → `preventDefault()`, so a page's `beforeunload` cannot stop the window closing.
- **CSP.** Provider pages keep their own CSP. No `webRequest` header hook is ever installed on a provider partition, and a test asserts it. `installDevCsp` stays on the main window's default session. Fixture mode's network guard covers the partition, which is intended (test-only).
- **Main window.** P4's guards are attached per webContents, to the main window only, so they never see provider windows.
  - `isProviderWindow(contents)` (a WeakSet) is added to `createSenderGuard` as defence in depth.
  - `attachMainWindow(win)`, called from `index.ts` `createWindow`, sets the parent and runs `closeAll()` on its `closed`.
- **Sessions.** `ProviderSessionStore.clear(id)` runs `clearStorageData()`, then `clearAuthCache()`. `flush(id)` runs `cookies.flushStore()` after a sign-in or sign-out completes.

### 1.2 One session for the HttpClient and the windows

`providerPartition(id)` (V1, `http-electron.ts`) is the only source of the partition string. `session.fromPartition()` returns the same `Session` object per process. So `ElectronSessionHttpClient` (API calls, holds), the sign-in window and the payment window share one cookie store, and therefore one Django session (`ps_booking`, `checkouthash`) and one queue cookie. The test compares the window's `webPreferences.partition` with `(providers.httpOf('parkstay') as ElectronSessionHttpClient).partition`.

### 1.3 Container wiring (`app/container.ts`, after V4's services)

```ts
const providerWindows = new ProviderWindows({ electron: { BrowserWindow, session, shell }, devTools: !app.isPackaged, logger });
const accounts = new ProviderAccountService({ providers, accounts: repositories.providerAccounts,
  windows: providerWindows, sessions: providerWindows, events: rendererEvents,
  isBusy: (id) => repositories.snipes.countByStatus(id, ['queueing', 'sniping', 'held']) > 0
    || repositories.watches.countUnexpiredHolds(id, new Date()) > 0 });
// V4: watchService { accountState: (id) => accounts.storedState(id) }; siteSniperService { accounts }
const holdPayments = new HoldPaymentService({ providers, repositories, bookingService, notifications: notificationService,
  windows: providerWindows, events: rendererEvents, transaction: (fn) => db.transaction(fn)() });
```

- `AppContainer` gains `providerWindows`, `accounts` and `holdPayments`, and loses `authService`.
- `dispose()` runs `revokeAll()`, then `providerWindows.closeAll()` (`destroy()`), `accounts.dispose()` and `holdPayments.dispose()`, then V4's `scheduler.stop()` sequence. No window event can write after `closeDatabase`, and pending `signIn` promises settle from memory.
- `index.ts` calls `attachMainWindow`, then `accounts.refreshStale()` (a 5 s unref'd timer, cancelled by `dispose`).

## 2. Account status model (`ProviderAccountService`)

### 2.1 States and transitions

The stored `provider_accounts.status` is the last **definite** answer: `unknown` (never checked), `signed-in` or `signed-out`.

| Probe result | Row write | `account:updated` |
|---|---|---|
| `signed-in {email, displayName}` | `status`, `email`, `display_name` from the profile (so an email change is picked up), `last_checked_at = now`. `last_signed_in_at = now` only when the previous status was not signed-in. | if anything visible changed |
| `signed-out` | `status`, `last_checked_at`. `email`/`display_name` are kept as a hint. | if status changed |
| `unknown {reason}` (queue, 5xx, network, timeout, parse) | **none**: the stored status stays (sticky), and the reason is logged at debug | no |

- A stored `signed-in` is not lost to a queue interstitial or a 502 at release time.
- A row that is still `unknown` means "not connected" everywhere.
- `users.email` is never read as signed-in.

### 2.2 How ParkStay sign-in is detected (`auth.ts`)

`isSignedIn(http, signal)` sends `GET {apiBase}/profile` (no trailing slash) with `parkstayApiHeaders('GET')`, `timeoutMs: 15_000` and `signal`. Then `classifyProfileResponse({ status, url, contentType, body })`:

| Response | Result |
|---|---|
| final URL on the queue origin or `/site-queue/`, or `isQueueInterstitial` | `unknown('queue')` |
| 200 JSON object with a string `email` | `signed-in`, `displayName = trim(first_name + ' ' + last_name) \|\| undefined`. Only these three fields are read; the address and phone fields are never touched. |
| 200 that is not that | `unknown('parse')` |
| 401 or 403 | `signed-out` |
| any other status | `unknown('http <n>')` |
| `ProviderHttpError` with status 0 or `ProviderTimeoutError` | `unknown('network' \| 'timeout')` |
| `AbortError` | rethrown |

### 2.3 `status`, sign-in completion, refresh and expiry

- **`status(id, { force })`:** throws `UnknownProviderError`, or `ProviderCapabilityError(id, 'account')` for `account === 'none'`. It is single-flight per provider, with a 60 s result cache that `force` bypasses (single-flight still applies). The probe has a 15 s timeout and is aborted by `dispose`.
- **`list()`:** every provider with `account !== 'none'`, merged with its row; with no row, `{ providerId, requirement, status: 'unknown' }`. No network.
- **`storedState(id)`:** synchronous, from the row. This is V4's `accountState` hook.
- **`signIn(id)`:** `browser-session` only (`credentials` and `automation` give `NOT_IMPLEMENTED`, §12.30). One session per provider: a second call focuses the window and returns the same promise. It opens `auth.signInUrl` with `allow = auth.allowedOrigins` and `openBlockedExternally: true`.
- **Completion.** Two signals, each confirmed by a probe:
  1. `did-navigate` to a URL matching `completionUrlPatterns` runs `status(id, { force: true })`. Only `signed-in` completes it, because ParkStay's `/login-success/` can also say "Session Expired".
  2. A chained 3 s poll (`force`) runs only while the window is on the `signInUrl` origin. It pauses on the B2C, auth2 and queue pages, where `/api/profile` cannot have changed (deviation D2).
  - On `signed-in`: `flush`, close the window, resolve with the account, and emit `account:updated` (through `status`).
- **User closes the window:** one `status(id)` (cached if under 60 s), so a sign-in that finished between two polls is not missed. Then resolve; if nothing changed, the status is unchanged.
- **The main window closes, or the app disposes:** the same path. On dispose, settle from memory without a probe.
- **Startup:** `refreshStale()` probes, in sequence, each provider whose `last_checked_at` is NULL or older than 6 h. Failures go to debug logs only.
- **Expiry:** a definite 401/403 from any later `status()` stores `signed-out`. Callers include the U4/U2 views, `ensureForHolds`, the startup refresh and sign-in close.

### 2.4 `ensureForHolds`, the hold-time check and the snipe service (V4 contract)

- **`ensureForHolds(id)`:** a no-op unless `requirement ∈ {required-for-holds, required}`. Otherwise it runs `status(id)` (cached) and throws `ProviderAuthRequiredError(id, 'Sign in to {shortName} first')` → `AUTH_REQUIRED` unless the effective status is `signed-in`.
- **Where V4's `SiteSniperService` uses it:**
  - **`activate(id)`:** after V4's HELD/BOOKED refusal, before `repo.activate`. On a throw, nothing is written or armed, and the handler never reaches `rescheduleSnipe`.
  - **`create(input)`:** the same check, without throwing. If the account is not ready, the snipe is saved **paused** (`is_active = 0`, status `disabled`, `lastError 'Sign in to ParkStay to arm this snipe'`), and V4's `arm()` skips it. This matches U2 ("remains unarmed"; "Arm" opens the connect prompt). See Q2.
  - **`execute()`:** just before `holds.create`, `storedState(providerId) !== 'signed-in'` on an account-required provider maps to V4's existing `auth-required` row (FAILED, "Sign in to {shortName}", deactivated). It is synchronous, with no network on the hot path, and covers `runNow`. This is the spec's "next hold attempt reports AUTH_REQUIRED". See Q1.
- **Watches:** V4's auto-hold already checks `accountState`. V6 only swaps in `accounts.storedState`.

### 2.5 `signOut(id)` and `ACCOUNT_BUSY`

1. If `isBusy(id)`, throw `AppError('ACCOUNT_BUSY')`: a snipe of that provider is QUEUEING, SNIPING or HELD, or a watch hold has `hold_expires_at > now` (deviation D3: a watch hold lives in the same session). Nothing is cleared.
2. Close an open sign-in window, which resolves its `signIn`.
3. `sessions.clear(id)` (once), then `flush`.
4. Upsert `status 'signed-out'`, keeping the email and name; clear the cache; emit `account:updated`.

Only the partition and the `provider_accounts` row are touched; the `users` row is never deleted (§12.22). ParkStay's access gate restores its queue cookie from `provider_state` (`access-gate.ts:491-512`), so clearing storage does not break it.

## 3. Migration v9 (`connection.ts`, `LATEST_SCHEMA_VERSION = 9`; P7 takes v10, §12.26)

### 3.1 The step

`applyMigration(db, 9, ['users', 'watches', 'provider_accounts'], …)`. Each part is idempotent (`columnsOf` guard):

1. **`v9RebuildUsers`**, the v8 pattern with no rename-aside: `CREATE TABLE users_v9 (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, first_name, last_name, phone, created_at, updated_at)`, copy those columns, `DROP TABLE users`, `ALTER TABLE users_v9 RENAME TO users`, then `idx_users_email`, the `update_users_timestamp` trigger and `restoreSequence`. The child FKs name `users`, so they bind to the new table; v8 adopted orphans, so the strict FK check on `users` holds.
2. **`watches`:** five `ALTER TABLE … ADD COLUMN` (§12.31, no rebuild): `hold_reference TEXT`, `hold_expires_at DATETIME`, `hold_unit_id TEXT`, `payment_url TEXT`, `last_error TEXT`.
3. **`provider_accounts`:** `ADD COLUMN last_checked_at DATETIME`. The spec's `last_checked_at` and its 6 h rule need it, and V2 did not create it (addition A1).

### 3.2 What moves where

- **Kept:** the email and names stay on `users` (the profile); v8 already copied them to the ParkStay account.
- **Dropped:** `encrypted_password`, `encryption_key`, `encryption_iv` and `encryption_auth_tag` (a ParkStay password that never worked). Nothing is migrated.
- **Upgrade order:** on a v5 or v6 install, `openDatabase` runs v6…v9 before `createContainer`, so P5's `migrateLegacySecrets` never sees a `users` password. Its `users` step, `decryptLegacyUserPassword` and their tests are deleted; notifiers and Gmail are unchanged.

### 3.3 Upgrade tests (`tests/integration/migration-v9.test.ts`)

- **v5 and v6 fixtures (`it.each`) → latest:** `users` has exactly the seven columns, with id 1, `fixture.user@example.com` and the names byte-identical. `PRAGMA foreign_key_check` is empty, and `foreign_key_list` on watches, site_snipes, bookings and notifications still targets `users`. Every other table is full-row identical to a v8 snapshot of the same fixture, apart from the new NULL columns. `sqlite_sequence`, the index and the trigger are present, and `provider_accounts` is unchanged with `last_checked_at` NULL.
- **Other cases:**
  - a fresh v8 database (`runMigrations(db, 8)`, NULL credentials) → v9;
  - idempotent re-run;
  - an injected failure in step 2 gives `MigrationError(9)`, and the database stays at v8;
  - `ON DELETE CASCADE` from the rebuilt `users`, proven with a throwaway second user.
- **Existing tests:**
  - `migration-v8.test.ts` is pinned to `runMigrations(db, 8)` (the precedent is `migrations.test.ts` pinned to 7). Its `LATEST_SCHEMA_VERSION` assertion, and the one in `legacy-upgrade.test.ts`, become `>= 8`.
  - `legacy-upgrade.test.ts` asserts the password is gone and the ParkStay account carries the fixture email.
  - `legacy-secret-migration.test.ts` loses its `users` cases.

## 4. Payment hand-off (`HoldPaymentService`)

### 4.1 Opening

- `snipes.openPayment(id)` and `watches.openPayment(id)` call `holdPayments.openForSnipe/openForWatch`. Both resolve once the window is shown, not when payment ends.
- **Preconditions, in order:**
  1. the row exists (`NOT_FOUND`);
  2. `registry.require(providerId, 'holds')`;
  3. snipe: `HELD` with a `holdReference` and `holdExpiresAt > clock()`; watch: `lastResult 'held'` with a `hold.reference` and `hold.expiresAt > clock()`. Otherwise `AppError('HOLD_EXPIRED')`.
- **URL:** `url = holds.paymentUrl({ ok: true, reference, expiresAt, unitId })`, which is `https://parkstay.dbca.wa.gov.au/booking/`. `allow = auth.allowedOrigins ∪ holds.paymentOrigins`, so B2C sign-in during payment works. A `url` outside `allow` is `PROVIDER_ERROR`.
- **One payment window per provider** (a ParkStay session holds one `ps_booking`). The same subject focuses it. A different subject also focuses it, and answers `VALIDATION` ("Finish or close the open payment window first").

### 4.2 Success, `'PB' + holdReference`, booking and events

The window's `did-navigate(url, 2xx)` calls `holds.bookedReference({ reference }, url)`. ParkStay returns `'PB' + reference` only for its own origin, a path under `/success/` and `checkouthash === sha256hex(reference)`. Any other `/success/` (a stale or different booking) is logged and ignored (deviation D1). On a match, in one `transaction`:

1. **Snipe:** `snipes.setBooked(id, 'PB…')` from HELD **or EXPIRED**, because the hash proves payment even if V4's expiry timer fired first. **Watch:** the new `watches.setBooked(id)`, which sets `last_result 'booked'` (new `WatchResult.BOOKED`) and keeps the hold columns.
2. **Booking:** `bookings.upsertConfirmed(userId, { providerId, bookingReference, location, stay, unitIds: [holdUnitId] if known, stayParams })`. It is keyed on `UNIQUE(provider_id, booking_reference)`, so reloading `/success/` cannot duplicate it, and its status is `confirmed`.
3. **After commit:**
   - notify: `notifySnipeBooked(snipe)` for a snipe, or `notifyBookingConfirmed(userId, providerId, bookingId, ref)` for a watch;
   - emit `snipe:updated` or `watch:updated`, then `booking:updated` (V4 DTOs, with `manageUrl` from `bookingService.toDto`).

A repeat success on a BOOKED row does nothing. The window stays on ParkStay's confirmation page until the user closes it.

### 4.3 Early close and expiry

- **Closed before `/success/`:** nothing changes. The snipe or watch stays held, and `openPayment` works again until expiry.
- **Expiry while the window is open:** ParkStay shows its own message, and the window is not force-closed. V4's timer moves the snipe HELD → EXPIRED; the night guard ignores the watch hold once `hold_expires_at` passes.
- **Quitting mid-payment** destroys the window. A payment that completed server-side but never reached `/success/` in the app is not recorded (risk R4).

### 4.4 V4 touch-points for watch holds (§12.31)

- **Auto-hold success:** V4's write (`last_result 'held'`, deactivate) also stores `hold_reference`, `hold_expires_at`, `hold_unit_id` and `payment_url`, in the same transaction. Every run writes `last_error` (a message, or NULL).
- **DTO:** the Watch DTO gains `hold?: { reference, expiresAt, unitId?, paymentUrl? }` and `lastError?`.
- **Night guard:** the watch rule becomes `(last_result = 'held' AND hold_expires_at > :now) OR last_result = 'booked'`. A pre-v9 `held` row with a NULL expiry (dev databases only) does not block nights.
- **Re-activation:** activating a `booked` watch is refused like a `held` one (`VALIDATION`).

## 5. IPC

| Method | Request (zod) | Response | Errors |
|---|---|---|---|
| `accounts.list` | `z.void()` | `ProviderAccount[]` | none |
| `accounts.status` | `{ providerId }` | `ProviderAccount` | `UNKNOWN_PROVIDER`, `CAPABILITY` |
| `accounts.signIn` | `{ providerId }` | `ProviderAccount` (on completion or close) | + `NOT_IMPLEMENTED` (non-browser kinds) |
| `accounts.signOut` | `{ providerId }` | `ProviderAccount` | + `ACCOUNT_BUSY` |
| `accounts.openSignInLink` | `{ providerId, url }` (https, V1 schema) | `void` | + `VALIDATION` (`issues: ['url']`) when off `allowedOrigins` |
| `snipes.openPayment` (new) | `idPayload` | `void` | `NOT_FOUND`, `HOLD_EXPIRED`, `CAPABILITY`, `VALIDATION` |
| `watches.openPayment` (new) | `idPayload` | `void` | same |

- **Contract.** The `accounts` contract is V1's, unchanged; V6 replaces its `NOT_IMPLEMENTED` stubs. `openSignInLink` loads the link into the open sign-in window, or opens one on the same completion flow; the result arrives as `account:updated`.
- **New:**
  - channels `snipes:open-payment` and `watches:open-payment`, with preload mappers `(id) => ({ id })`;
  - `ApiErrorCode` gains `ACCOUNT_BUSY` and `HOLD_EXPIRED`, with default messages;
  - the event stays `account:updated` (V1 contract; the dispatch's `account:status` is read as this).
- **Removed:** `CHANNELS.auth`, `contracts/auth.ts` and its index entry, `auth.handlers.ts`, the preload `auth` binding, and the mock-API entries. The parity tests (`contract.test.ts`, `preload.test.ts`) keep the four-way agreement, and also assert that no `auth:` channel remains and that both `open-payment` channels exist.
- **Secret sweep:**
  - `accounts:list` moves from `PENDING_READS` into `READS`, and `accounts:status` joins it; the `auth:*` reads and the ParkStay password seed go.
  - New seeds: a `provider_accounts` row, a partition cookie `SWEEP-SESSION-COOKIE` (from the mocked `session.cookies.get`), and an `openSignInLink` URL on `dbcab2c.b2clogin.com` carrying `SWEEP-MAGIC-TOKEN`. None may appear in any response or log line.
  - The electron mock gains a fake `BrowserWindow` (additive).
- **Nothing secret leaves main:**
  - `ProviderAccount` has no cookie or token field, and the service never reads cookie values;
  - `/api/profile` bodies and emails are never logged, and URLs are logged by origin only;
  - `handle.ts` already never logs payloads.

## 6. Legacy Login page and the `auth` namespace

- **`pages/Login.tsx` is already gone:** D3 deleted it with the gate (`e0b2092`).
- **Deleted:**
  - `services/auth/AuthService.ts`;
  - `UserRepository`'s credential methods (`create(email, pw)`, `findByEmail`, `updateCredentials`, `setCredentials`, `resealPassword`, `clearCredentials`);
  - `User.encryptedPassword`, `UserCredentials` and `UserInput.password`;
  - the `auth` contract, its handlers and the preload binding;
  - P5's `users` step, with `tests/unit/services/auth.test.ts` and `tests/integration/auth-flow.test.ts`.
- **Kept on `UserRepository`:** `createLocalProfileIfMissing` (now inserting `id` only), `getFirstUser`, `updateProfile` and `hasUsers`. Logout's data-loss path went with D3's Logout, and now with `deleteCredentials`.
- **Settings (minimal, in a legacy allow-listed file).** The Account tab's form becomes a status line ("Signed in as {email}", "Not connected", or "Session expired" when signed-out with `lastSignedInAt`). Below it, a **Connect ParkStay** button calls `window.api.accounts.signIn('parkstay')`. The tab reads `accounts.list()` on mount and listens to `account:updated`. U4 replaces it with U2's `renderer/api/accounts.ts` hooks; V6 adds no hooks.
- **Also:**
  - `AppShell.test.tsx` asserts "no `accounts.signIn` at startup" instead of its `auth.validateSession` assertion;
  - `docs/security.md` drops the ParkStay password rows and gains a "Provider sign-in sessions" note (cookies live in `userData/Partitions/provider-<id>`; no secret is stored);
  - CLAUDE.md gets migration v9, the Key Services table and the IPC namespaces.

## 7. Edge cases

| Spec edge case | Behaviour | Test |
|---|---|---|
| Second `signIn` while one is open | Focus the window; return the same promise | int `accounts-sign-in` › "a second signIn focuses and returns the same promise" |
| Main window closes during sign-in | `closeAll` → close path → resolve with the current status | int `accounts-sign-in` › "closing the main window closes the sign-in window and resolves" |
| Queue active during sign-in | `queue.dbca.wa.gov.au` allowed; probes return `unknown('queue')`, so there is no completion and nothing is stored | unit `parkstay/auth` › "queue interstitial → unknown"; unit `provider-windows` › "allows queue.dbca.wa.gov.au" |
| Magic link opened outside the app | The account stays signed-out; `openSignInLink` loads a pasted B2C link; a used link shows B2C's own error in the window | int `accounts-ipc` › "loads a b2clogin.com link in the window" |
| Session expiry | A definite 403 stores `signed-out`; the next activation gives `AUTH_REQUIRED`; the next hold gives FAILED "Sign in to ParkStay" | unit `provider-account.service` › "403 after signed-in stores signed-out"; unit `snipe-execute` › "signed-out account fails the hold step as auth-required" |
| Payment window opened twice | Focus the existing window | int `hold-payment` › "a second openPayment focuses the window" |
| Hold expires with the window open | V4's timer expires the snipe; a later matching `/success/` still books it | int `hold-payment` › "success after expiry still books (hash matches)" |
| Blocked third-party host during payment | `preventDefault`; log the origin; no external open | unit `provider-windows` › "payment window logs a blocked host and does not open it externally" |
| Profile row | No code path deletes `users`; sign-out keeps watches, snipes and bookings | int `accounts-ipc` › "sign-out keeps the profile row and its data"; the existing V2 "no code path deletes the profile row" test |
| Email changes between sessions | Upserted from `/api/profile` | unit `provider-account.service` › "updates the email from the profile" |
| `users` email only a hint | `list()` reads `provider_accounts`; v8's `unknown` is never treated as signed-in | int `accounts-service` › "migrated fixture is unknown, not signed-in" |

## 8. Test plan

### 8.1 Criteria and addenda mapped to tests

| Criterion or addendum | Test file › name |
|---|---|
| `isSignedIn` on `NodeHttpClient` and the fixture server (200 Ann Lee / 403 / interstitial / 502) | `tests/unit/providers/parkstay/auth.test.ts` › "200 profile is signed-in as Ann Lee", "403 is signed-out", "queue interstitial is unknown", "502 is unknown" (+ "redirect to the queue host", "network error"). The fixture server gains `/api/profile` modes. |
| `list()` on the V2-migrated fixture; `account:'none'` excluded | `tests/integration/accounts-service.test.ts` › "lists ParkStay from the migrated v5 fixture and leaves out an account:none FakeProvider" |
| Signed-in upsert, one event, one request for two calls | `tests/unit/core/provider-account.service.test.ts` › "signed-in sets last_signed_in_at and emits one account:updated", "two concurrent status calls make one request" (+ "cached for 60 s", "unknown keeps the stored status") |
| Window factory: partition, no preload, sandbox, nodeIntegration, evil blocked, b2clogin allowed, permissions false | `tests/unit/app/provider-windows.test.ts` › "creates a sandboxed persist:provider-parkstay window with no preload", "blocks will-navigate to https://evil.example/", "allows will-navigate to dbcab2c.b2clogin.com", "denies every permission request" |
| Sign-in flow: `/login-success/` resolves signed-in and closes; close first gives the unchanged status | `tests/integration/accounts-sign-in.test.ts` (mocked BrowserWindow; FakeProvider registered as `parkstay` with ParkStay's auth patterns and a settable `setAccount()`) › "login-success resolves signed-in and closes the window", "closing first resolves with the unchanged status" |
| `openSignInLink` | `tests/integration/accounts-ipc.test.ts` (P3 harness) › "evil.example link is VALIDATION", "b2clogin link loads in the window" |
| `signOut` busy and clear | `provider-account.service.test.ts` › "SNIPING snipe gives ACCOUNT_BUSY and clearStorageData is not called", "clears the partition once and sets signed-out" |
| Activate signed-out gives `AUTH_REQUIRED`, unarmed | `tests/integration/snipe-account-gate.test.ts` › "activating a ParkStay snipe while signed out returns AUTH_REQUIRED and leaves it unarmed" (real V4 service and scheduler; asserts no run is scheduled) |
| `snipes.openPayment`: partition, `HOLD_EXPIRED`, `/success/` | `tests/integration/hold-payment.test.ts` › "opens /booking/ on the HttpClient's partition", "an expired hold is HOLD_EXPIRED", "success marks BOOKED with PB+reference, creates one parkstay booking, emits snipe:updated and booking:updated" (real DB) |
| No `preload` in `provider-windows.ts` | `provider-windows.test.ts` › "never mentions preload outside comments" (`strip-comments` util) |
| Legacy credentials gone | `migration-v9.test.ts` › "v5/v6: users has no encrypt* columns, keeps id, email and names, and foreign_key_check is empty"; `tests/unit/lint/legacy-auth-removed.test.ts` › "no AuthService, window.api.auth or auth:store in src"; `src/renderer/features/settings/legacy/Settings.test.tsx` › "shows Connect ParkStay and calls accounts.signIn('parkstay')" |
| Runtime check | §8.3 plus the stakeholder checklist |
| Quality gate | lint, format:check, type-check and test before the commit |
| Addendum: sweep `READS` | `secret-sweep.test.ts` (§5) |
| Addendum: V1 SDK as-is | used unchanged, apart from the additive `httpOf`, `bookedReference` and pattern rules (`registry.test.ts` › "rejects an invalid paymentOrigins pattern") |
| Addendum (§12.31): v9 watch columns, persisted, guard | `migration-v9.test.ts` › "adds the five watch hold columns, NULL on existing rows"; `tests/unit/core/auto-hold.test.ts` › "a watch hold persists reference, expiry, unit and payment URL"; `night-guard.test.ts` › "ignores a watch hold past hold_expires_at" |
| Addendum: watch payment | `hold-payment.test.ts` › "watches.openPayment opens the same partitioned window", "expired watch hold is HOLD_EXPIRED", "success turns the watch hold into a confirmed booking and emits watch:updated and booking:updated" |

### 8.2 Other unit tests

- **`tests/unit/providers/url-patterns.test.ts` (~9):**
  - exact origin; one and several wildcard labels; the apex is not matched by `*.`;
  - the `evildbca.wa.gov.au` suffix trick and `userinfo@` tricks;
  - http rejected, except an explicit loopback `http://127.0.0.1:port` (registry-validated lists are https-only); a port mismatch;
  - completion-pattern anchoring and query strings.
- **Also:** `bookedReference` (right, wrong or missing hash; another origin), the `openPayment` preconditions (~3), and the sign-in poll pausing off the provider origin (fake timers).

### 8.3 Electron windows: mocks, live tests and runtime verification

- **Unit and integration:** an injected fake `BrowserWindow` (EventEmitter windows and webContents, a captured `setWindowOpenHandler`, `loadURL` spies, and a fake session that captures its handlers).
- **Live tests:** `tests/electron/provider-windows.electron.ts` (`npm run test:electron`) opens real windows against loopback servers, using an unregistered test auth whose list includes `http://127.0.0.1:<port>`. It checks:
  - window setup: `getLastWebPreferences()` has the sandbox settings and the partition, and page JS sees no `require` or `process`;
  - navigation: a scripted `location.href` to the other port is blocked; `window.open` stays in place for an allowed origin and calls the stubbed `openExternal` otherwise;
  - refusals: `Notification.requestPermission()` is denied, and a self-signed `https` loopback fails with `certificate-error`;
  - sign-in and session: `/login-success/` completes, and a cookie set by the window is visible to `ElectronSessionHttpClient` for the same provider id (and the reverse).
- **Runtime verification** (`npm run build`, Electron ABI, `_electron` under xvfb, `WA_STAY_USER_DATA_DIR`, sandbox NSS and proxy; about 10 DBCA and B2C requests in all):
  1. `accounts.list()` (no network);
  2. `accounts.status('parkstay')` → `signed-out`, which confirms the anonymous 403 half of PQ2;
  3. `accounts.signIn('parkstay')` → child window. Screenshot `/ssologin` → B2C and check the logs for blocked hosts (this validates the allow-list hops). Closing it resolves `signed-out`;
  4. a scripted navigation to `https://example.com` in that window is blocked (`shell.openExternal` stubbed through `app.evaluate`);
  5. a seeded HELD snipe → `openPayment` → a window on `/booking/` (screenshot; a live page with no `ps_booking` is harmless);
  6. a restart on the same user-data dir: a session cookie from run 1 survives, and Settings shows "Connect ParkStay".
  - No real hold is placed (DBCA genuine-intent terms).
- **Stakeholder checklist (needs credentials):**
  1. Connect ParkStay, and record whether the email carried a **code or a link** (PQ1). If a link, try `openSignInLink`.
  2. The window closes and Settings shows "Signed in as …". Record the field names of the `/api/profile` 200 (PQ2).
  3. After a restart, `accounts.status` is still signed-in.
  4. Still signed-in after about 2 h idle? This sizes Q1 against `SESSION_COOKIE_AGE = 3600`.
  5. Only with genuine intent: a real snipe hold → pay → BOOKED, plus a PB booking. Record any blocked payment host (PQ5).
  6. Sign out → signed-out, with watches and snipes intact.
  7. Only with genuine intent: an anonymous hold → sign in inside the payment window → the basket is kept → BOOKED (§12.32 Q1).
  8. Sign in, and pay, while the DBCA queue is active: the window passes the waiting room and comes back to the sign-in or payment page (review fix; `access.waitingRoomOrigins`).

## 9. Risks, open questions and deviations

**Deviations** (please confirm):
- **D1. `/success/` must carry `checkouthash = sha256(holdReference)`.** `/success/` alone can be `success-error.html`, or another booking's page.
- **D2. The sign-in poll runs only while the window is on the provider's own origin.** This saves 20–60 `/api/profile` calls per code-entry sign-in, and every completion is still confirmed by a probe.
- **D3. Sign-out is also busy while a watch hold is unexpired** (§12.31), because that hold lives in the same session.
- **D4. Snipe create while signed out saves the snipe paused** instead of arming it (Q2).
- **D5. The window title appends the current host,** because the window has no address bar.

**Additions:** A1 `provider_accounts.last_checked_at`, `registry.httpOf()`, `HoldsModule.bookedReference?`, origin-pattern validation in the registry, and `WatchResult.BOOKED` with `watches.setBooked`.

**Open questions:**
- **Q1. The hold-time account check against short ParkStay sessions.** `SESSION_COOKIE_AGE` is 1 h. Anonymous `create_booking` works, and the payment window allows B2C, so a user could sign in while paying. A stored `signed-out` therefore fails, at release time, a snipe that an anonymous hold would have won.
  - *Recommendation:* keep the spec (a stored-state check, no network, no warm-up re-probe), and measure the session lifetime with checklist item 4.
  - If sessions lapse within hours, drop the snipe hold-time check in a follow-up.
- **Q2. Snipe create while signed out.** *Recommendation:* save it paused with a `lastError` hint, as U2 expects. The alternative is to refuse with `AUTH_REQUIRED`.
- **Q3. ParkStay "credentials" carrying over** (brief success criterion 2 and D2). Only the email carries over (v8); the password, which never worked, is dropped (spec). *Recommendation:* accept, with a CHANGELOG line "connect ParkStay once in Settings".

**Risks:**
- **R1. User agent and client hints.** The UA says Chrome 131, but Chromium 120's client hints say 120. B2C may also offer social logins, and Google refuses embedded browsers. The stakeholder run would show either problem.
- **R2. PQ5.** An unlisted top-level payment host stops the payment silently; only the log shows it. This is mitigated by `*.dbca.wa.gov.au` and the stakeholder hold.
- **R3. V4 is not merged.** V6 edits V4's `core/snipes`, `core/watches`, the night guard, the handlers and `container.ts`, so implementation should start after V4 merges. The V4-free parts (auth, windows, the account service, v9, the auth removal) go first, in their own commit.
- **R4. Quitting mid-payment** can leave a paid hold unrecorded. The user still finds it through `manageUrl` ("My bookings").
- **R5. Downloads** in the windows (a confirmation PDF) use Electron's default save dialog.
