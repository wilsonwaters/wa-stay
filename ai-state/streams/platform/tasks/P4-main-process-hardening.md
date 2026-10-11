# P4 — Main-process hardening: single instance, window guards, CSP, logging, crash policy, no secrets to renderer, Gmail OAuth fixes

**Stream:** platform · **Depends on:** P3

## Description
Line references below are from before P3; P3 renames some of these files.

- **Two instances.** There is no single-instance lock, so two instances can run two schedulers against one DB (tech-review #4).
- **Unguarded window.** The main window runs with `sandbox: false` (`index.ts:59`), has no `setWindowOpenHandler` or `will-navigate` guard, and has no CSP anywhere. The renderer's `window.open` therefore spawns Electron windows (ui-review #10).
- **Logs in the wrong place.** The logger resolves its directory at import, before `ready`, and falls back to `os.tmpdir()/parkstay-bookings/logs` (`logger.ts:13-28`). "Open logs folder" opens `userData/logs` (`app.handler.ts:58`), which is empty. In addition, 79 `console.*` calls in `src/main` bypass the log files.
- **One throw kills everything.** Winston's exception handlers (`logger.ts:67-80`, with the default `exitOnError`) combine with `app.quit()` on any `uncaughtException` (`index.ts:228-231`). One throw in a snipe timer ends every snipe.
- **Secrets cross to the renderer:**
  - `auth:get-credentials` returns the decrypted password (`auth.handlers.ts:48-66`).
  - `gmail:get-credentials` returns the client secret (`gmail.handlers.ts:62-80`).
  - Notifier `get`/`list` return the SMTP `auth.pass` (`notification-provider.handlers.ts:26-70`).
- **Inbox reads are exposed:** `gmail:get-recent-emails` (`gmail.handlers.ts:232-261`), `gmail:test-search` (`:266-303`) and `gmail:wait-for-email` (`:174-227`).
- **Gmail OAuth loopback flaws** (`oauth2-handler.ts`):
  - It listens on all interfaces (`:232`).
  - It sends no `state` and no PKCE (`:239-244`).
  - The auth URL uses `http://localhost:<port>` (`:237`), but `getToken(code)` (`:214`) uses the client's redirect URI, which defaults to `http://localhost:3000/oauth2callback` (`gmail.handlers.ts:38`). The token exchange therefore cannot succeed.
  - Any request without `code`, such as `/favicon.ico`, aborts the flow (`:216-221`).
  - The 5-minute timer is never cleared (`:250-253`).

## Size
L. It sits at the top of L; implement it as the commit series in Notes.

## Scope
- **A. Shell**
  - `src/main/app/single-instance.ts`: `requestSingleInstanceLock()` runs before any DB or scheduler work. A losing instance exits. On `second-instance`, restore, show and focus the main window, unless that argv contains `--hidden`.
  - `src/main/app/main-window.ts`: `createMainWindow()`.
    - Moves the window code out of `index.ts:47-101`. Keep `contextIsolation: true`, `nodeIntegration: false` and `webviewTag: false`; `sandbox` is flipped by P6.
    - `setWindowOpenHandler` always denies. It passes `http:`, `https:` and `mailto:` URLs to `shell.openExternal`, and logs anything else.
    - `will-navigate` and `will-redirect` call `preventDefault` for any URL off the app origin.
    - Registers the window's webContents as a P3 trusted sender.
  - A global `web-contents-created` handler denies `will-attach-webview`.
- **B. CSP**
  - `src/main/app/csp.ts` is a pure function, `buildCsp({ dev, devOrigin })`, with no electron import.
  - Production policy: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://api.mapbox.com https://events.mapbox.com https://*.tiles.mapbox.com; worker-src 'self' blob:; child-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`.
  - Dev additionally allows `'unsafe-inline'` scripts (the Vite React preamble) plus `ws://` and `http://` connections to the dev origin.
  - `main-window.ts` applies the dev policy as a header via `session.webRequest.onHeadersReceived`.
  - Production loads `file://`, which has no response headers. A Vite plugin in `vite.config.ts` therefore injects the production policy as the first `<meta http-equiv>` in `<head>` at build time.
- **C. Logging**
  - At import, `logger.ts` creates only a console transport, with `exitOnError: false`.
  - `initFileLogging(dir)` is called after `ready`. It adds the rotating file, exception and rejection transports under `<userData>/logs` and returns that path, which `app:open-logs-folder` uses (creating the folder if needed).
  - Replace all `console.*` in `src/main` with module child loggers (`logger.child({ module })`). `connection.ts`'s verbose mode goes to `logger.debug`.
  - Add an ESLint `no-console: error` override for `src/main/**` and `src/preload/**`.
- **D. Crash policy** (`src/main/app/crash-policy.ts`)
  - Before the container is ready: log, call `dialog.showErrorBox`, then `app.exit(1)`.
  - After that, `uncaughtException` and `unhandledRejection` are logged with their stack. The user gets at most one error notification per 10 minutes through `NotificationService`, and the app keeps running.
  - `render-process-gone` is logged and the window is reloaded once.
  - Delete `index.ts:228-238`.
- **E. No secrets to the renderer**
  - `auth` credentials returns `{ email, hasPassword }`.
  - `gmail` credentials returns `{ clientId, hasClientSecret }`. `redirectUri` is no longer accepted or returned.
  - `notifiers.get`/`list` remove `config.auth.pass` and add `hasPassword`.
  - `notifiers.configure` with an empty or absent `auth.pass` keeps the stored password.
  - Minimal renderer change: `EmailSettingsCard.tsx:145-148` allows saving without a password when `hasPassword` is true.
- **F. Gmail**
  - Remove the three inbox-read channels from the contract, preload and handlers. Their service methods stay main-only for V6.
  - OAuth fixes:
    - `listen(0, '127.0.0.1')`.
    - Use the redirect URI `http://127.0.0.1:<port>/oauth2callback` in both `generateAuthUrl` and `getToken({ code, codeVerifier, redirect_uri })`.
    - `state` is 32 random bytes in base64url, compared in constant time.
    - PKCE uses S256 via `generateCodeVerifierAsync()` (google-auth-library 9.15.1).
    - An `error=` callback rejects with a clear message. Paths other than the callback return 404 without ending the flow.
    - Clear the timer and close the server on every exit path.
    - A second concurrent `authorize()` is rejected.

## Non-goals
- `sandbox: true` and the bundled preload (P6).
- Encryption at rest (P5).
- Provider sign-in and payment window policy (V6).
- Window title, OAuth success-page wording and `setAppUserModelId` (B2).
- Moving userData (B3).
- Mapbox token wiring (E1).
- Queue `'error'` listener (V3, #10).
- Scheduler timers (V4, #2/#11).
- Any crash-notification UI beyond the existing bell (U5).

## Completion Criteria
- [ ] **A.** A second instance exits within 2 s and the first window comes to the front. Only one "Application initialized" line is logged.
- [ ] **A.** A unit test shows `requestSingleInstanceLock` is called before `openDatabase`.
- [ ] **A.** `window.open('https://example.com')` leaves `BrowserWindow.getAllWindows().length === 1` and calls `shell.openExternal` once.
- [ ] **A.** `javascript:` and `file:` URLs are neither opened nor navigated to.
- [ ] **A.** A `<webview>` attach is denied.
- [ ] **B.** `buildCsp` unit tests pin the exact production string and the dev additions. `'unsafe-inline'` scripts appear only in dev.
- [ ] **B.** After `npm run build:renderer`, `dist/renderer/index.html` contains the production policy as the first child of `<head>`.
- [ ] **B.** The dev app and the built app both start with zero CSP violations in the DevTools console (runtime check).
- [ ] **C.** `grep -rnE "console\.(log|info|warn|error|debug)" src/main src/preload` returns nothing, and adding one fails `npm run lint`.
- [ ] **C.** After a start, `<userData>/logs/combined.log` contains the startup lines and nothing new appears under `os.tmpdir()/parkstay-bookings`.
- [ ] **D.** With a fake `process` emitter: a throw after startup is logged, produces one notification and does not call `app.quit`/`exit`. A second throw within 10 minutes produces no new notification. A failure during init calls `showErrorBox` and `exit(1)`.
- [ ] **E.** Secret sweep: seed a password, client secret and SMTP pass, invoke every read channel, and assert that none of the seeded strings appears in the serialised responses or the captured logs.
- [ ] **E.** `notifiers.configure` without a password keeps the dispatcher's stored password.
- [ ] **F.** `grep -rn "getRecentEmails\|testSearch\|waitForEmail" src/preload src/shared/contracts src/renderer` returns nothing.
- [ ] **F.** OAuth tests use a real loopback server, a stubbed `OAuth2Client` and a captured `openExternal`. They prove:
  - the server is bound to `127.0.0.1`;
  - the URL has `state`, `code_challenge`, `code_challenge_method=S256` and the 127.0.0.1 `redirect_uri`;
  - a wrong `state` gets 400 and the flow continues;
  - a valid callback calls `getToken` with `{ code, codeVerifier, redirect_uri }`;
  - `/favicon.ico` gets 404;
  - `access_denied` rejects;
  - a timeout rejects and closes the server.
- [ ] `npm run lint && npm run format:check && npm run type-check && npm test` pass.

## Edge Cases
- **Second instance before the window exists.** If a second instance arrives during startup, remember the request and focus the window once it is created. If `second-instance` argv has `--hidden` (a duplicate login item), do not show the window.
- **macOS `activate` with no window** recreates the window through `createMainWindow()`, not duplicated code.
- **Links.** `target=_blank` links, including Mapbox attribution, go to the system browser. Hash-route changes do not fire `will-navigate` and must keep working.
- **Logging edge cases.** If the logs folder is not writable, warn once and stay on console logging; never crash. In Jest, no log files are written unless `initFileLogging` is called.
- **Crash storms.** A burst of errors (for example, every poll failing) must not flood notifications or block the event loop.
- **OAuth.** The OS chooses the port. If the user closes the browser, the flow ends on timeout. Stored legacy credentials with `redirectUri: 'http://localhost:3000/oauth2callback'` are ignored, not used.
- **CSP and future providers.** New provider image hosts work without a CSP change (`img-src https:`; master-plan open question 5).

## Test Strategy
- **Unit:** about 30 tests.
  - `buildCsp` (3).
  - Window guards with mocked electron (6).
  - Single-instance ordering and focus (3).
  - Crash policy (4).
  - Logger init and path (3).
  - Secret sweep and configure-merge (4).
  - OAuth loopback (7).
- **Component:** `EmailSettingsCard` saves without re-entering the password when `hasPassword` is true (1).
- **Integration:** about 2 tests. A built renderer HTML meta-CSP check, and a container-level secret sweep across all handlers.
- **Runtime verification:** a built app under xvfb opens an external link (stubbed `openExternal`) and shows no CSP errors.

## Context Files to Read First
- `ai-state/architecture-notes.md` §1 (`app/`), §4 (gmail, notifiers, secrets) and §7. `ai-state/research/tech-review.md` findings 4, 5, 8 and 9. `ai-state/research/ui-review.md` "CSP" and item 10.
- `src/main/index.ts`, `src/main/utils/logger.ts`, `src/main/ipc/handlers/app.handler.ts` and `vite.config.ts`
- `src/main/ipc/handlers/{auth,gmail,notifiers}.handlers.ts` (post-P3 names), `src/main/services/gmail/oauth2-handler.ts` and `src/main/services/gmail/GmailOTPService.ts`
- `src/main/services/auth/AuthService.ts`, `src/main/database/repositories/notifier.repository.ts` and `src/renderer/components/settings/EmailSettingsCard.tsx:50-230`
- `src/shared/contracts/*` (from P3), `src/main/ipc/handle.ts` and `.eslintrc.json`

## Notes
- **Mapbox GL v3 CSP needs:** `worker-src blob:`, `child-src blob:`, `img-src data: blob:` and `connect-src` for `api.mapbox.com`, `events.mapbox.com` and `*.tiles.mapbox.com`.
- **Suggested commits:**
  1. single instance and main window;
  2. CSP;
  3. logging and crash policy;
  4. secrets out of IPC;
  5. Gmail.
- `oauth2-handler.ts:200` still says "ParkStay Bookings"; leave the wording to B2.
