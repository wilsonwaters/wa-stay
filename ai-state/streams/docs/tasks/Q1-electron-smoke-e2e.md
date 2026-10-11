# Q1 — Electron smoke E2E suite (Playwright `_electron`)

**Stream:** docs · **Depends on:** D3; E1 (Explore assertions); U1 (create-watch journey, DocQ1)

## Description

The current E2E suite tests a web page that no longer exists.

- `playwright.config.ts:20,30-35` starts the Vite dev server and opens it in desktop Chrome, so `window.api` is missing.
- `tests/e2e/login.spec.ts:18` expects an h1 of "ParkStay Bookings" and a password form.
- `bookings.spec.ts:30` uses `.bookings-list` / `.empty-state` CSS selectors.

Brief success criterion 9 requires an **Electron** smoke suite. It drives the *built* app (main, preload and renderer together) and catches what unit tests cannot:

- startup crashes;
- preload or sandbox breakage (P6);
- CSP violations (P4);
- broken routing (D3);
- a provider catalogue that never renders (V5/E1).

It must be deterministic: no real user data, no live ParkStay, no Mapbox tiles.

As a maintainer, I run `npm run test:e2e` locally or in CI and know within minutes that WA Stay launches to Explore, navigates, shows providers and starts a provider-first create flow.

## Size

M

## Scope

**In scope**

1. **Remove the stale specs.** Delete `tests/e2e/login.spec.ts` and `tests/e2e/bookings.spec.ts`. The login gate is gone (brief D2).
2. **Rewrite `playwright.config.ts`.**
   - `testDir: './tests/e2e'`, `testMatch: '**/*.spec.ts'`.
   - `fullyParallel: false`, `workers: 1`, `retries: CI ? 1 : 0`.
   - `timeout: 60_000`, `expect.timeout: 10_000`.
   - `reporter: [['list'], ['html', { open: 'never' }]]`.
   - `use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' }`.
   - `globalSetup` fails fast with "run `npm run build:e2e` first" when `dist/main/main/index.js` or `dist/renderer/index.html` is missing.
   - No `webServer`, `baseURL` or browser `projects`.
3. **Harness** in `tests/e2e/support/`.
   - A `test.extend` fixture, `launchWaStay()`, that:
     - makes a temp `userData` (`fs.mkdtemp`);
     - calls `_electron.launch({ args: [repoRoot, ...(linux && CI ? ['--no-sandbox'] : [])], cwd: repoRoot, env })`. Pass the repo root, not the JS file, so Electron reads `package.json` (name, version, `main`).
   - `env` is a copy of `process.env`:
     - **without** `ELECTRON_RENDERER_URL` and `MAPBOX_ACCESS_TOKEN`;
     - with `NODE_ENV=production` (dev mode loads the Vite URL and opens DevTools, `src/main/index.ts:67-80`);
     - with `TZ=Australia/Perth`, `LANG=en_AU.UTF-8`, `WA_STAY_USER_DATA_DIR=<tmp>` and `WA_STAY_E2E_FIXTURES_DIR=tests/e2e/fixtures/http`.
   - It exposes `{ app, window, userDataDir, consoleErrors, mainLog }`. `mainLog` is main-process stdout/stderr, attached to the report on failure.
   - On teardown it calls `app.close()` and removes the temp dir.
   - It first asserts `await app.evaluate(({ app }) => app.getPath('userData')) === tmp` and aborts if not. That check is the isolation guarantee.
4. **Fixture (network-free) mode** in the main process. Honoured **only when `app.isPackaged === false`**:
   - `src/main/testing/fixture-http-client.ts`: `FixtureHttpClient implements HttpClient` (architecture-notes §3).
     - It reads `<dir>/<providerId>/manifest.json` routes `{ method, path, query?, status?, file, contentType? }`.
     - An unmatched request throws `UnexpectedNetworkRequestError` and appends to `<userData>/e2e-unexpected-requests.log`.
   - The composition root (`src/main/app/container.ts`) gives every provider context this client when `WA_STAY_E2E_FIXTURES_DIR` is set.
   - `src/main/testing/network-guard.ts`: in fixture mode, `webRequest.onBeforeRequest` on `session.defaultSession` and every `persist:provider-*` partition cancels http(s) requests. It allows only hosts in `WA_STAY_E2E_ALLOW_HOSTS` (empty by default; used by Q2 screenshots, DocQ6) and logs each cancellation to the same file.
   - Add `WA_STAY_USER_DATA_DIR` to `src/main/app/paths.ts` if B3 has not landed. Use the B3 contract: unpackaged only, and the legacy source is disabled.
5. **Fixtures** in `tests/e2e/fixtures/http/parkstay/`:
   - `manifest.json`;
   - `campground_map.json`, trimmed from the real `GET /api/campground_map/` response to **8 campgrounds**. Include `campground_type` 0/1/2/4, at least 3 regions, images and features;
   - whatever else the Explore first load requests, such as bulk availability. Discover this from the unexpected-requests log.
   - Reuse V3/V5 test fixtures where they exist. Add a `README.md` covering provenance (public API, 2026-10-02, test-only, never shipped, O8) and how to refresh.
6. **Token-less build.** Add `"build:e2e"`, which runs the normal build with `MAPBOX_ACCESS_TOKEN` set to an **empty string** in the process environment (use a small Node wrapper, `scripts/build-e2e.js`, rather than relying on shell syntax). E1 resolves the token as `process.env.MAPBOX_ACCESS_TOKEN ?? env.MAPBOX_ACCESS_TOKEN ?? ''`, so an empty string overrides a developer's `.env` and Explore is deterministically list-only. Set `"test:e2e": "playwright test"`.
7. **Specs**, all selecting with `getByRole` / `getByLabel` / `getByText` and the names in `docs/design/shell.md` (D3), E1's spec and U1's spec:
   - `launch.spec.ts`
     - The window title is "WA Stay". `location.hash` is `#/`. There is exactly one `h1`.
     - The Explore search control is visible.
     - The result list has 8 items (fixture count).
     - The first item contains a provider badge with an accessible name matching `/ParkStay/`.
     - The list-only notice (no token) is visible.
   - `navigation.spec.ts`
     - Links "Watches", "Site Sniper, coming soon" and "Bookings, coming soon" each lead to an h1 of "Watches", "Site Sniper" or "Bookings", with `aria-current="page"` on the active link.
     - The "Account and settings" button → menu item "Settings" → h1 "Settings".
     - One full keyboard-only path (Tab to the nav, Enter).
   - `create-watch.spec.ts`
     - Watches → button "New watch" → `#/watches/new` (the final route, architecture-notes §12.10).
     - The element with `aria-current="step"` is the provider step. Its ParkStay option is checked and "Continue" is enabled.
   - `lifecycle.spec.ts`
     - Across a full journey there are no renderer console errors (ignoring only entries that the network guard caused and logged).
     - `e2e-unexpected-requests.log` is absent or empty.
     - `app.close()` resolves and the process exits within 10 s (no hanging scheduler timers).
     - A relaunch on the same `userData` reaches Explore (the DB reopens).
8. **Tooling.** Add `tests/e2e/tsconfig.json` (types `node` and `@playwright/test`) and append `&& tsc -p tests/e2e/tsconfig.json --noEmit` to `type-check`. Add `tests/e2e/**/*.ts` to the `format` and `format:check` globs.
9. **CI.** Add an `e2e` job to `.github/workflows/ci.yml` on `ubuntu-latest` with `timeout-minutes: 20`. It runs `npm ci`, then `npm run build:e2e`, then `xvfb-run -a npm run test:e2e`, and uploads `playwright-report/` and `test-results/` on failure (7 days). The `npm ci` postinstall (`electron-builder install-app-deps`) builds better-sqlite3 for **Electron**, so do **not** run `npm rebuild better-sqlite3` in this job.

   **Recommendation: wire it into CI**, not as a manual step. It is the only check that exercises the real preload/CSP/sandbox stack. With fixtures it is deterministic, and it costs about 4 minutes on one Linux runner. Leave it out of `build.yml`, so a flaky run cannot block a release tag. DocQ2 covers making it a required check.
10. **Docs.** Add an E2E section to `tests/README.md`: build, ABI note, xvfb, fixtures, how to refresh, how to debug with `--headed` / `PWDEBUG`.

**Out of scope**

- Packaged-installer and auto-update E2E (B2/B3 manual). Windows/macOS runners. Legacy-migration E2E (B3 Jest covers it; see Notes).

## Non-goals

- No axe or visual-regression dependency. No screenshot baselines.
- No live-network tests. No Mapbox tile assertions.
- No CSS-class, XPath or test-id selectors unless a role is impossible. Record any exception in the PR.
- No new production behaviour: fixture mode is inert in packaged builds.

## Completion Criteria

- [ ] `tests/e2e/login.spec.ts` and `bookings.spec.ts` are deleted. `playwright.config.ts` has no `webServer`, `baseURL` or `devices`.
- [ ] `grep -rnE "locator\(['\"][.#\[]|xpath=|data-testid" tests/e2e` prints nothing.
- [ ] `npm run build:e2e && xvfb-run -a npm run test:e2e` passes **3 consecutive times** locally. The command and its output go in the PR.
- [ ] The suite passes with outbound network blocked (e.g. `HTTPS_PROXY=http://127.0.0.1:9` or `unshare -n`), and the unexpected-requests log is empty.
- [ ] The isolation assertion runs in every test. After the run, no `%APPDATA%/WA Stay` or `~/.config/WA Stay` was created or modified (mtime check in the PR).
- [ ] The four journeys in Scope 7 exist and pass, including the keyboard path and route `aria-current`.
- [ ] Unit tests: `FixtureHttpClient` matches by method, path and query, and logs plus throws on unmatched requests; fixture mode and the network guard are **not installed when `isPackaged` is true**, even with the env vars set.
- [ ] `npm run type-check` includes `tests/e2e`. `npm run format:check` covers `tests/e2e`.
- [ ] The `e2e` job in `ci.yml` is green on the PR. On a deliberately failing run, the uploaded artifact contains the trace and `mainLog`.
- [ ] Accessibility:
  - [ ] Every interaction uses a role or label query.
  - [ ] The nav spec asserts `aria-current="page"`.
  - [ ] After each route change, focus is on the page `h1` or `main`, as D3 defines.
  - [ ] The create flow asserts `aria-current="step"`.
- [ ] `npm run lint` (0 errors), `npm run format:check`, `npm run type-check` and `npm test` all pass.

## Edge Cases

- **better-sqlite3 built for the Node ABI** (after `npm rebuild` for Jest) makes the app exit at launch with `NODE_MODULE_VERSION`. The harness surfaces `mainLog` in the failure message, and `tests/README.md` gives the fix (`npm run rebuild`; RUNBOOK).
- **Ubuntu 24.04 runners** restrict unprivileged user namespaces, so the Electron sandbox fails. Pass `--no-sandbox` only on Linux CI. Playwright adds it automatically only when running as root (`playwright-core/lib/server/electron/electron.js:133-136`).
- **The catalogue loads asynchronously.** Use web-first assertions (`toHaveCount`, `toBeVisible`) and never `waitForTimeout`.
- **A hidden launch** (`--hidden`, `index.ts:29-36`) would leave `firstWindow()` waiting forever. Never pass it. Wait for the h1, not `ready-to-show`.
- **Single-instance lock.** It is per `userData`, so sequential tests with fresh dirs never collide. A leftover process from a crashed test is killed in teardown (`app.process().kill()`).
- **Developer `.env` with a token.** `build:e2e` forces it empty. A test asserts the list-only notice, so a token leak fails loudly.
- **Provider parser changes** that break the fixture fail with the manifest route named. Refreshing the fixture is a documented manual step.
- **Remote images are blocked.** Cards must show their image fallback. Guard-cancelled requests are logged, not counted as console errors.

## Test Strategy

- **Unit (~6):** `FixtureHttpClient` (4) and fixture-mode gating (2). Jest, node environment.
- **Component:** none.
- **Integration / E2E (~9 tests, 4 specs):** as in Scope 7, against the built app under xvfb.

## Context Files to Read First

- `ai-state/architecture-notes.md` §3 (HttpClient, ProviderContext), §8 (tests assert roles and names), §1 (`app/container.ts`, `app/paths.ts`), §12 (final routes, provider step always shown). `ai-state/RUNBOOK.md`.
- `ai-state/streams/docs/master-plan.md`, `ai-state/streams/design-system/master-plan.md` (Q1 names), `docs/design/shell.md`, E1's spec, and `ai-state/streams/provider-ux/tasks/U1-watches-provider-first.md` (Step 1 criteria).
- `ai-state/streams/brand-migration/tasks/B3-legacy-install-migration.md` (paths and env contract).
- `playwright.config.ts`, `tests/e2e/*`, `package.json` scripts, `src/main/index.ts:44-101`, `.github/workflows/ci.yml`.
- `node_modules/playwright-core/types/types.d.ts` (`ElectronApplication`, `_electron.launch`). `ai-state/research/parkstay-api-review.md` (catalogue endpoint).

## Notes

- Playwright 1.56.1 is installed (`@playwright/test` and `playwright-core` pinned together, architecture-notes §10). Import `_electron` from `@playwright/test`.
- **Follow-up candidate:** once B3 lands, a `legacy-upgrade.spec.ts` can point `WA_STAY_LEGACY_DATA_DIR` at a materialised v5 fixture and assert the migrated watch appears. It is cheap with this harness. Add it if B3 merges before Q1 closes.
- Q2 reuses the harness for README screenshots (DocQ6).
