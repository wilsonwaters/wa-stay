# V6 — Provider accounts, in-app sign-in and payment hand-off

**Stream:** providers · **Depends on:** V1, V3, V4, P5 (soft: D3, which removes the login gate)

## Description

ParkStay sign-in has never worked:

- the app posts an email and password to the non-existent `/auth/login`;
- `setSession` is never called, so every request is anonymous (tech-review #9);
- holds are tied to a throwaway session;
- the "payment link" is a generic page that cannot see the hold (tech-review #3).

Stakeholder decision D5 replaces all of this with an in-app sign-in window. The window runs on the provider's Electron session partition (`persist:provider-parkstay`). The user signs in on ParkStay's real pages, and the app keeps that session for API calls, holds and the payment hand-off.

V6 adds three things:

- **`core/accounts/ProviderAccountService`**;
- **the ParkStay auth definition**;
- **the sign-in and payment windows**, with the `accounts.*` IPC namespace and `snipes.openPayment`.

After payment succeeds, the snipe is marked booked and a booking record is created.

Story: as a Site Sniper user, I connect my ParkStay account once in the app. When a site is held, one click opens ParkStay's payment page with my hold already in the basket.

## Size

L. It covers security-sensitive windows, session handling, a new core service, IPC, and a flow that reaches into the snipes and bookings services. Design approval is required.

## Scope

- **`src/main/providers/parkstay/auth.ts`.** `ProviderAuth` with these fields:
  - `kind: 'browser-session'`;
  - `signInUrl: https://parkstay.dbca.wa.gov.au/ssologin` (`templates/ps/base.html:69`);
  - `allowedOrigins`:
    - `https://parkstay.dbca.wa.gov.au`;
    - `https://auth2.dbca.wa.gov.au`;
    - `https://dbcab2c.b2clogin.com`;
    - `https://login.microsoftonline.com`;
    - `https://queue.dbca.wa.gov.au`;
  - `completionUrlPatterns: ['https://parkstay.dbca.wa.gov.au/login-success/*']` (`urls.py:107`);
  - `isSignedIn(http)`, which calls `GET /api/profile` (no trailing slash; `urls.py:58`, `IsAuthenticated` at `api.py:4720-4731`):
    - a 200 JSON body with `email` gives `{ state: 'signed-in', email, displayName: first_name + ' ' + last_name }`;
    - 401 or 403 gives `signed-out`;
    - a queue interstitial, 5xx or network error gives `{ state: 'unknown', reason }`.

  The ParkStay manifest becomes `capabilities.account: 'required-for-holds'`.
- **`src/main/core/accounts/provider-account.service.ts`:**
  - **`list()`** returns a `ProviderAccount` for every provider where `account !== 'none'`. It merges the `provider_accounts` row (V2), whose email was migrated from `users`, with `requirement`.
  - **`status(id)`:**
    - calls `auth.isSignedIn(ctx.http)` with a 15 s timeout;
    - upserts `status`, `email`, `display_name`, `last_checked_at`, and `last_signed_in_at` on the transition to signed in;
    - emits `account:updated`;
    - is single-flight, with results cached for 60 s.
  - **`signIn(id)`** opens the sign-in window and resolves to the final `ProviderAccount`, either when sign-in completes or when the user closes the window. If a window for this provider is already open, it is focused and the same promise is returned.
  - **`openSignInLink(id, url)`** loads a pasted magic link (PQ1) in the open sign-in window, or opens the window on that link. The URL is rejected unless it is https and on `allowedOrigins`.
  - **`signOut(id)`:**
    - refuses with `ACCOUNT_BUSY` while any snipe of that provider is `QUEUEING`, `SNIPING` or `HELD`, since clearing cookies would lose the queue position or the hold;
    - otherwise runs `ses.clearStorageData()` and `ses.clearAuthCache()` on the partition, sets `status: 'signed-out'`, keeps the email as a hint, and emits `account:updated`.
  - **`ensureForHolds(id)`** is used by `core/snipes` at activate time. When `requirement` is `required-for-holds` or `required` and the status is not `signed-in`, activation fails with `ProviderAuthRequiredError` (code `AUTH_REQUIRED`). U2 shows the connect prompt.
  - On startup, `status()` is called for each provider whose last check is over 6 h old. Failures are not surfaced.
- **`src/main/app/provider-windows.ts`.** The sign-in and payment windows share one factory.
  - **Window settings:**
    - `new BrowserWindow({ parent: mainWindow, width: 520, height: 760, title: '{name} — Sign in' | '— Payment' })`;
    - `webPreferences: { partition: 'persist:provider-<id>', sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: !app.isPackaged }`, with **no preload**;
    - a menu-less window.
  - **Navigation control:**
    - the `will-navigate` and `will-redirect` handlers allow only top-level https origins in the list: `allowedOrigins` for sign-in, `allowedOrigins ∪ holds.paymentOrigins ∪ https://*.dbca.wa.gov.au` for payment (PQ5);
    - any other navigation is blocked and its host is logged. The sign-in window opens the blocked URL in the system browser via `shell.openExternal`;
    - `setWindowOpenHandler`: allowed origins load in the same window, and everything else opens externally.
  - **Partition hardening:**
    - `ses.setPermissionRequestHandler` denies every permission;
    - `certificate-error` is rejected.
  - **Main-window guards.** P4's main-window guards must not intercept these windows. Expose `isProviderWindow(webContents)` and share it with P4's handler.
  - **Sign-in completion** is detected in either of two ways:
    - `did-navigate` matches one of `completionUrlPatterns`;
    - or a `status()` poll every 3 s while the window is open returns `signed-in`.

    On completion the window closes, `signIn` resolves, and `account:updated` fires.
- **`snipes.openPayment(id)`** is added to the V4 snipes contract and its handler.
  - It requires the snipe to be `HELD` with `holdExpiresAt > now`; otherwise it fails with code `HOLD_EXPIRED`.
  - It opens the payment window on `holds.paymentUrl(hold)`, which is `https://parkstay.dbca.wa.gov.au/booking/`. The window is on the same partition that placed the hold, so ParkStay's session `ps_booking` applies.
  - Navigation to `https://parkstay.dbca.wa.gov.au/success/*` (`urls.py:137`) does the following:
    1. marks the snipe `BOOKED` with `bookedReference = 'PB' + holdReference` (`models.py:1645`, `BOOKING_PREFIX` at `settings.py:206`);
    2. creates a booking through `core/bookings`, with `providerId`, location, stay, `unit_ids [holdUnitId]` and status `confirmed`;
    3. calls `notifySnipeBooked`;
    4. emits `snipe:updated` and `booking:updated`.

    If the window is closed without reaching that page, nothing changes.
- **`src/main/ipc/handlers/accounts.handlers.ts`.** Implements `accounts.list`, `status`, `signIn`, `signOut` and `openSignInLink` with V1's zod schemas. The preload exposes `accounts`, and `account:updated` is forwarded.
- **Partition user agent.** The sign-in window inherits the partition user agent that V1 set, which is the Chrome UA. ParkStay rejects library user agents (`queue_middleware.py:16-28`).
- **Retire the legacy ParkStay "credentials".** They were an email plus a password that ParkStay never uses (tech-review #9). The platform master plan has V6 replace the transitional `auth` namespace, and P5 lists dropping the password columns under "V2/V6".
  - **Migration v9** (the next free version in `connection.ts`) rebuilds `users`. It drops `encrypted_password`, `encryption_key`, `encryption_iv` and `encryption_auth_tag`, and keeps `id`, `email`, the names, `phone` and the timestamps. It uses P2's `applyMigration` with foreign keys off outside the transaction. P7's planned `job_logs` drop moves to the version after this one.
  - **Delete** `AuthService`, the credential methods of `UserRepository`, the `auth` contract file and its handlers, and the `users` step in P5's `migrateLegacySecrets`, with its tests.
  - **Minimal renderer edits.** In `pages/Settings.tsx`, the credentials form is replaced by a "Connect ParkStay" button that calls `accounts.signIn('parkstay')` and shows the status. U4 restyles it later. Delete `pages/Login.tsx` once D3 has removed the gate. Because logout called `auth.deleteCredentials`, which cascade-deleted every row (platform master plan "Data loss on logout"), that path disappears with it.

## Non-goals

- The Settings → Accounts UI, the connect prompt and the paste-link field (U4 and U2).
- Gmail OTP or magic-link auto-retrieval. `GmailOTPService` stays unwired (master plan, Out of scope).
- Automating any payment step. Importing existing ParkStay bookings.
- Browser-automation sign-in for non-API providers (V7 notes cover the pattern).

## Completion Criteria

- [ ] `isSignedIn` tests use a local fixture server on `NodeHttpClient`:
  - a 200 JSON `{id, email:'a@b.au', first_name:'Ann', last_name:'Lee', …}` gives signed-in, with `email` and `displayName: 'Ann Lee'`;
  - a 403 `{"detail":"Authentication credentials were not provided."}` gives `signed-out`;
  - the queue interstitial HTML gives `unknown`;
  - a 502 gives `unknown`.
- [ ] `accounts.list()` on the V2-migrated fixture DB returns one item:
  - `{ providerId: 'parkstay', requirement: 'required-for-holds', status: 'unknown', email: <fixture email> }`;
  - FakeProvider with `account: 'none'` is excluded.
- [ ] `status('parkstay')` returning signed-in upserts the row with `last_signed_in_at` and emits exactly one `account:updated`. Two concurrent calls make one HTTP request.
- [ ] Window factory test with mocked electron `BrowserWindow`:
  - `webPreferences.partition === 'persist:provider-parkstay'`, `preload === undefined`, `sandbox === true` and `nodeIntegration === false`;
  - `will-navigate` to `https://evil.example/` calls `preventDefault`;
  - `will-navigate` to `https://dbcab2c.b2clogin.com/...` is allowed;
  - the permission handler returns `false`.
- [ ] Sign-in flow test (mocked window, FakeProvider `auth`): emitting `did-navigate` to `https://parkstay.dbca.wa.gov.au/login-success/` resolves `signIn('parkstay')` as signed-in and closes the window. Closing the window first resolves with the unchanged status.
- [ ] `openSignInLink('parkstay', 'https://evil.example/x')` returns `VALIDATION`. A link on `dbcab2c.b2clogin.com` loads in the window.
- [ ] `signOut` tests:
  - with a SNIPING ParkStay snipe it returns `ACCOUNT_BUSY` and `ses.clearStorageData` is not called;
  - without one, `clearStorageData` is called once and the status becomes `signed-out`.
- [ ] Activating a ParkStay snipe while the status is `signed-out` returns `AUTH_REQUIRED`, and the snipe stays unarmed.
- [ ] `snipes.openPayment` tests:
  - on a HELD snipe it opens the payment window on `https://parkstay.dbca.wa.gov.au/booking/` with the same partition string the HttpClient used;
  - on an expired hold it returns `HOLD_EXPIRED`;
  - simulated navigation to `/success/` sets the snipe to `BOOKED` with `bookedReference 'PB' + holdReference`, creates one booking with `provider_id 'parkstay'`, and emits `snipe:updated` and `booking:updated`.
- [ ] `grep -rn "preload" src/main/app/provider-windows.ts` → 0 matches, apart from comments.
- [ ] Legacy credentials are gone:
  - from the v5 and v6 fixtures, migration v9 leaves `users` with no `encrypt*` columns, the same `id`, `email` and names, and `PRAGMA foreign_key_check` empty;
  - `grep -rn "AuthService\|window.api.auth\|auth:store" src` → 0 results;
  - Settings shows "Connect ParkStay", and clicking it calls `accounts.signIn('parkstay')`.
- [ ] Runtime check with the dev build. Ask the stakeholder to do the real sign-in:
  - `await window.api.accounts.signIn('parkstay')` opens the ParkStay sign-in page in a child window;
  - after signing in it resolves as signed-in, and `accounts.status('parkstay')` stays signed-in after an app restart;
  - record whether the email carried a code or a link (resolves PQ1) and confirm `/api/profile` behaviour (PQ2) in the PR.
- [ ] `npm run lint && npm run format:check && npm run type-check && npm test` passes.

## Edge Cases

- **Sign-in window behaviour:**
  - the user opens a second `signIn` while one is in progress: the same window is focused and the same promise returned;
  - the main window closes while a sign-in window is open: the child closes and `signIn` resolves with the current status;
  - the queue is active during sign-in (`/ssologin` is not gated, but `/` and `/api/` are, per `queue_middleware.py`): `queue.dbca.wa.gov.au` is allowed, and the status poll returns `unknown` until the user is through.
- **Magic link opened outside the app.** The link opens in the system browser (PQ1), so the session lands there. The account stays `signed-out`, and U4 offers the paste-link field. If the link has already been used, B2C shows its own error page in the window.
- **Session expiry.** The Django session expires (`app_sessionid` has `Max-Age=3600` for anonymous users, per the live `Set-Cookie`; the signed-in lifetime is unknown). `status()` then turns `signed-out`, and the next hold attempt reports `AUTH_REQUIRED`, not a silent failure.
- **Payment edge cases:**
  - the payment window is opened twice: focus the existing one;
  - the hold expires while the window is open: the ParkStay page shows its own message, and the snipe expires through V4's timers;
  - a blocked third-party top-level host during payment (PQ5) is logged with its host, so the allow-list can be extended.
- **Profile row.** No code path deletes the `users` profile row any more. Sign-out clears only the partition, so watches, snipes and bookings survive (they `ON DELETE CASCADE` from `users`).
- **Account data:**
  - the account email changes between sessions: the row is updated from `/api/profile`;
  - the `users` row email is only a hint and is never treated as signed-in.

## Test Strategy

- **Unit (~22):**
  - `isSignedIn` mapping (~5);
  - account service status, caching and events (~5);
  - sign-out guard (~2);
  - URL allow-list matching, including wildcard subdomains (~5);
  - completion-pattern matching (~2);
  - the `openPayment` preconditions (~3).
- **Component:** none.
- **Integration (~6):**
  - the sign-in flow with a mocked `BrowserWindow` and FakeProvider `auth`;
  - the activate-snipe `AUTH_REQUIRED` gate through V4's snipe service;
  - payment success, which marks the snipe booked, creates the booking and emits events, against a real DB;
  - the `accounts.*` handlers through P3's harness.

## Context Files to Read First

- `ai-state/brief.md` (D2, D5). `ai-state/architecture-notes.md` §3, §4, §7. `ai-state/research/tech-review.md` #3, #5, #9.
- `ai-state/streams/providers/master-plan.md` (PQ1, PQ2, PQ5). `ai-state/streams/provider-ux/tasks/U2-site-sniper-provider-first.md` (the connect prompt and `openPayment` usage).
- `docs/parkstay-api/AUTHENTICATION_FLOW.md:60-130` (hosts and B2C policy; the flow details are unverified).
- `src/main/providers/sdk/{provider,http-electron}.ts` (V1). `src/main/providers/parkstay/{index,holds}.ts` (V3). `src/main/core/snipes/*` and `src/main/core/bookings/*` (V4).
- `src/main/app/main-window.ts` (P4 guards). `src/main/security/legacy-migration.ts` (P5, the `users` step to delete). `ai-state/streams/platform/master-plan.md` ("Data loss on logout", open question 6) and `ai-state/streams/platform/tasks/P5-secret-vault.md` (Non-goals).
- `src/main/services/auth/AuthService.ts`, `src/main/ipc/handlers/auth.handlers.ts`, `src/renderer/pages/{Settings,Login}.tsx`.
- `src/main/database/repositories/provider-account.repository.ts` (V2).
- The DBCA backend: `parkstay/urls.py:58,107,134,137`, `parkstay/api.py:4720-4731`, `parkstay/serialisers.py:794-807`, `parkstay/views.py:877-917` (success view) and `parkstay/models.py:1643-1645`.

## Notes

- **Why no stored secret.** The session lives in the partition's cookie store. Electron persists it under `userData/Partitions/provider-parkstay`. Nothing ParkStay-specific needs the SecretVault. The legacy `users.encrypted_password` is a ParkStay "password" that never worked, so v9 drops it instead of migrating it.
- **Why the payment hand-off is now correct.** `create_booking` stores `ps_booking` in the Django session (`api.py:3373-3376`), and `/booking/` reads it. Placing the hold through `ses.fetch` on the same partition means the payment window sees the hold.
- **Commit.** `feat(accounts): in-app provider sign-in and payment hand-off (#<issue>)`.

## Orchestrator addendum (2026-10-03, from the V1 merge)
- [ ] Move `accounts:list` (and any other implemented read channel in this namespace) from `PENDING_READS` into `READS` in `tests/integration/secret-sweep.test.ts`. The sweep must pass with real data seeded.
- [ ] Use V1's merged SDK as-is: `HttpClient` with real redirect semantics, the frozen registry manifests, and `ProviderContext.manifest` / `limits` (architecture-notes §12.30).

## Orchestrator addendum (2026-10-04, from the V4 design review; architecture-notes §12.31)
- [ ] Migration v9 also adds `hold_reference`, `hold_expires_at`, `hold_unit_id`, `payment_url` and `last_error` to `watches`. V4 records watch auto-holds only as `last_result 'held'`; V6 persists the hold details when a watch auto-hold succeeds, and the night guard ignores a watch hold whose `hold_expires_at` has passed.
- [ ] Payment hand-off for watch holds: a `watches.openPayment(id)` (or a shared hold-payment helper used by both) opens the same partitioned payment window as `snipes.openPayment`. On `/success/` the watch's hold becomes a confirmed booking (as for snipes) and `watch:updated` + `booking:updated` are emitted. Tests mirror the snipe payment tests.
- V4 expires HELD snipes at `holdExpiresAt` with its own timer (re-armed on resume). `openPayment` still checks `holdExpiresAt > now` itself.
