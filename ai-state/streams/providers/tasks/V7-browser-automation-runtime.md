# V7 — Browser automation runtime

**Stream:** providers · **Depends on:** V1

## Description

Many WA providers have no public API: Airbnb, holiday-park chains, and the RAC Parks & Resorts module that is the next project. Stakeholder decision D5 makes **Playwright** (`playwright-core` driving the installed Edge or Chrome) the automation runtime for them.

V7 adds the `BrowserAutomation` implementation behind V1's interface and exposes it on `ProviderContext.browser`. It proves the contract with a test-only browser-driven FakeProvider, and writes developer notes for authors of browser-driven providers. No production provider uses it yet. The goal is that the RAC project can start straight away without touching core.

This is a technical task.

## Size

M. One runtime module, its wiring and tests, plus developer notes. It is a single concern.

## Scope

- **`src/main/providers/sdk/browser-automation.ts` (`PlaywrightBrowserAutomation`).** It implements V1's `BrowserAutomation` and is created per provider by `createProviderContext` with `{ providerId, userDataDir: path.join(app.getPath('userData'), 'providers', <id>, 'browser'), logger, clock }`.
  - **Lazy loading.**
    - `playwright-core` is loaded with `await import('playwright-core')` on first use only, so app startup and providers that never automate pay nothing.
    - Use `import type` for every type.
    - Wrap a failed import in `BrowserUnavailableError('runtime-missing')`.
  - **Browser detection.** Use `chromium.launchPersistentContext(userDataDir, { channel, headless, … })` and try channels in platform order:
    - Windows: `msedge`, then `chrome`;
    - macOS/Linux: `chrome`, then `msedge`.
    - Playwright's `Chromium distribution '<name>' is not found…` and `…is not supported on <platform>` errors (`playwright-core/lib/server/registry/index.js:832,853`) move on to the next channel. The working channel is cached in `ctx.state` (`browser.channel`) and tried first next time.
    - An optional `executablePath` override in the factory options is used for development, read from the env var `WA_STAY_BROWSER_PATH`.
    - When no channel works, throw `BrowserUnavailableError('no-browser')` with the message "WA Stay needs Microsoft Edge or Google Chrome installed to use {provider}".
  - **`isAvailable()`** returns `{ available, channel?, reason? }`. It probes without keeping the browser open, and caches the result for the session.
  - **`withPage(fn, { headed = false, timeoutMs = 60_000, signal })`:**
    - lazily launches **one** persistent context per provider (Chromium locks the profile directory);
    - opens a new page, runs `fn(page)`, and always closes the page;
    - calls are serialised by a per-provider mutex, so the default concurrency is 1;
    - `page.setDefaultTimeout(timeoutMs)` and `setDefaultNavigationTimeout` are applied;
    - `signal` abort closes the page and rejects with `AbortError`.
  - **Headless and headed modes.** Headless is the default. `headed: true` is for interactive steps, such as a provider sign-in that cannot use V6's Electron window. A request for headed mode while a headless context is open (or the reverse) closes the context and relaunches it in the requested mode, with a log line.
  - **Context settings:**
    - `viewport { width: 1280, height: 800 }`, `locale 'en-AU'`, `timezoneId` from `manifest.timezone`;
    - `acceptDownloads: false`;
    - the default user agent, which is the real browser's own.
  - **Lifecycle.**
    - An idle context closes after 5 minutes with no `withPage` calls.
    - `close()` closes the context, waits at most 5 s, then kills the browser process.
    - `registry.disposeAll()` on `before-quit` (V1) calls `close()` for every provider.
    - A crashed or disconnected context (`context.on('close')`) is discarded, and the next `withPage` relaunches it.
- **Wiring.** `createProviderContext` (V1) gives every provider a `PlaywrightBrowserAutomation` in place of `UnavailableBrowserAutomation`. It costs nothing until it is used. The ParkStay module does not use it.
- **Packaging.** `electron-builder.json` gets `"asarUnpack": ["node_modules/playwright-core/**"]`, because `playwright-core` spawns its driver from files that must exist on disk.
  - Verify with `npm run dist:win` (or `electron-builder --dir`) that `resources/app.asar.unpacked/node_modules/playwright-core` exists.
  - B2 must keep this entry when it edits the file.
- **Dependency.** `playwright-core@1.56.1` is **already** in `dependencies` (architecture-notes §10, pinned because Electron 28 runs Node 18). Do not re-add or bump it. Assert the pin in a test.
- **`tests/utils/fake-browser-provider.ts`.** A test-only provider with `integration: 'browser'` and `capabilities { catalog, availability }`:
  - `listLocations` runs `ctx.browser.withPage(p => p.goto(url); p.$$eval('[data-location]', …))`;
  - `check` reads per-night cells from a page;
  - it maps the result to `LocationSummary` and `LocationAvailability`.
- **`docs/developer/browser-providers.md`.** Developer notes, which Q2 folds into the provider developer guide. They cover:
  - when to choose `browser` or `hybrid` over `api`;
  - the `withPage` lifecycle and serialisation;
  - selector strategy (roles and test ids, never CSS classes);
  - waiting with locators instead of sleeps;
  - honouring `signal`;
  - mapping to normalised types;
  - politeness, covering rate limits, `pollFloorMs` and no CAPTCHA solving;
  - provider terms and the "genuine intent" rule;
  - headed mode for human steps;
  - testing with a mocked `playwright-core`;
  - an optional real-browser smoke test (`WA_STAY_BROWSER_E2E=1`);
  - the persistent profile location and the privacy note that cookies live in `userData/providers/<id>/browser`.

## Non-goals

- Any real browser-driven provider, including RAC (next project).
- Using Playwright for ParkStay or for V6's sign-in, which uses an Electron window on the partition by design.
- Bundling or downloading browsers. The runtime uses only the installed Edge or Chrome.
- CAPTCHA handling, stealth plugins or fingerprint spoofing (provider terms).
- A user setting for the browser path. The env override is for development only; a UI setting can follow if needed.

## Completion Criteria

- [ ] Channel-order tests, with `jest.mock('playwright-core')` providing a fake `chromium.launchPersistentContext`:
  - on `win32` the launch is tried with `channel: 'msedge'` first;
  - when `msedge` rejects with "Chromium distribution 'msedge' is not found", `chrome` is tried next and succeeds, and `browser.channel = 'chrome'` is stored in the KV store;
  - on the next launch `chrome` is tried first.
- [ ] When every channel fails, `withPage` rejects with `BrowserUnavailableError`, `code: 'no-browser'`, and a message naming Edge and Chrome. `isAvailable()` returns `{ available: false, reason: 'no-browser' }`.
- [ ] `withPage` tests:
  - two concurrent calls on one provider run strictly one after the other (mutex test with deferred promises);
  - the page is closed even when `fn` throws;
  - the persistent context is launched once with `userDataDir` ending in `providers/fake/browser`.
- [ ] `withPage` with `signal` aborted mid-`fn` rejects with `AbortError` and closes the page. A `timeoutMs: 1000` value reaches `page.setDefaultTimeout(1000)`.
- [ ] Requesting `headed: true` after a headless call closes the context once and relaunches with `headless: false`.
- [ ] With fake timers, the context is closed after 5 minutes idle. `close()` resolves within 5 s even if `context.close()` hangs, because the kill path runs (`browser.process().kill` spy).
- [ ] `registry.disposeAll()` closes the browser contexts of all providers that launched one (spy).
- [ ] A test that has not called `withPage` shows `playwright-core` was never imported (spy on the mocked module factory).
- [ ] `describeProviderContract('fake-browser', …)` (V1) passes for `fake-browser-provider` with mocked pages that return fixture DOM data.
- [ ] `node -e "console.log(require('./package.json').dependencies['playwright-core'])"` prints `1.56.1`. `electron-builder.json` contains the `asarUnpack` entry.
- [ ] `docs/developer/browser-providers.md` exists and covers every topic listed under Scope. The reviewer ticks each one.
- [ ] Runtime check, if a browser is available locally:
  - `WA_STAY_BROWSER_E2E=1 npx jest tests/integration/browser-automation.smoke.test.ts` launches the installed Chrome or Edge headless against a local HTTP page, and reads one location;
  - the test is skipped, not failed, when the variable is unset.
- [ ] `npm run lint && npm run format:check && npm run type-check && npm test` passes.

## Edge Cases

- **Locked or damaged profile.** If the profile directory is locked by a previous crash (Chromium `SingletonLock`), retry once after 1 s. If it is still locked, raise `BrowserUnavailableError('profile-locked')` with the path in the log. Never delete the profile automatically.
- **Browser updates and crashes.** The installed browser updates while a context is open, or the process dies: treat it as a disconnect, and relaunch on the next call.
- **Missing user data path.** `app.getPath('userData')` is unavailable in tests. The factory takes `userDataDir` as a parameter, and only the container passes the real path.
- **Calls during quit.** A `withPage` called while `close()` is in progress rejects with `BrowserUnavailableError('closing')`. It does not relaunch.
- **Unsupported platforms.** On Linux CI there is no Edge or Chrome, so unit tests use only the mock and the smoke test skips. Do not assume Windows paths anywhere. Use `path.join`.
- **Long-running work.** `fn` must not leak pages or listeners. The contract suite asserts that `context.pages().length` is back to 0 after each call.

## Test Strategy

- **Unit (~16):**
  - channel order per platform and channel caching (~4);
  - no-browser error (~2);
  - mutex serialisation (~2);
  - abort and timeout (~3);
  - headed/headless relaunch (~1);
  - idle close and kill fallback (~2);
  - lazy import (~1);
  - the dependency pin (~1).
- **Component:** none.
- **Integration (~2):**
  - the browser-driven FakeProvider through `describeProviderContract` with a mocked `playwright-core`;
  - an opt-in real-browser smoke test, skipped by default.

## Context Files to Read First

- `ai-state/brief.md` (D5, Out of scope). `ai-state/architecture-notes.md` §1, §3, §10 (the version pin and Node 18).
- `ai-state/streams/providers/master-plan.md` (Integration points: B2 `asarUnpack`, Q2 docs).
- `src/main/providers/sdk/{browser,context,errors,provider}.ts` and `tests/utils/provider-contract.ts` (V1).
- `electron-builder.json` (`asar: true`, `files`). `package.json` (`dependencies`).
- `node_modules/playwright-core/types/types.d.ts`: `BrowserType.launchPersistentContext` and the `channel` option.
- `src/main/app/container.ts` (P3) and the `before-quit` handling (P4).

## Notes

- **Why one persistent context per provider.** A real browser profile keeps the provider's own cookies and login between runs. That matches what a human would do and avoids re-login loops. It also keeps each provider's data isolated in its own folder.
- **Why `msedge` first on Windows.** Edge is installed on every Windows 10/11 machine. Chrome is optional.
- **Commit.** `feat(providers): Playwright browser automation runtime (#<issue>)`.
