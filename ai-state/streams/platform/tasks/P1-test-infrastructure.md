# P1 — Test infrastructure: Jest projects, honest setup files, native-ABI guard

**Stream:** platform · **Depends on:** none

## Description
Every later task relies on the test suite. Today the suite hides problems instead of exposing them:

- **Wrong environment.** `jest.config.js:3` runs every test in `jsdom`, including main-process and database tests.
- **Mocks the wrong API.** `src/setupTests.ts:9-65` mocks `window.electron`, but the app exposes `window.api` (`src/preload/index.ts:373`).
- **Silenced errors.** `src/setupTests.ts:68-72` replaces `console.error` and `console.warn` with `jest.fn()` for every test.
- **Dead setup file.** `tests/setup.ts` (electron, logger, node-cron and machine-id mocks) is never loaded. It is ignored at `jest.config.js:15` and absent from `setupFilesAfterEnv`.
- **Debug script.** `src/shared/schemas/watch.schema.test-debug.ts` is a console script, not a test.
- **Wall-clock dates.** Several tests build dates from the real clock ("tomorrow").
- **Opaque native-module failure.** `postinstall` (`electron-builder install-app-deps`) compiles `better-sqlite3` for Electron's ABI (NODE_MODULE_VERSION 119). After a fresh `npm ci`, `npm test` therefore fails with a `dlopen`/`NODE_MODULE_VERSION` error until someone runs `npm rebuild better-sqlite3`. CI does that rebuild explicitly (`.github/workflows/ci.yml:80-81`); a developer gets no hint.

Baseline (2026-10-02, Node 22, after `npm rebuild better-sqlite3`): **16 suites, 191 tests passing.**

## Size
M

## Scope
- **Jest projects.** Rewrite `jest.config.js` with two projects built from a shared base object. Jest projects do not inherit root options, so `transform`, `moduleNameMapper` and the alias map must be repeated through that shared object.
  - `main`: `testEnvironment: 'node'`. Covers `tests/unit/**`, `tests/integration/**`, `src/main/**`, `src/shared/**` and `tests/scripts/**`.
  - `renderer`: `testEnvironment: 'jsdom'`. Covers `src/renderer/**` and `tests/renderer/**`.
  - `collectCoverageFrom`, `coverageThreshold` and `coverageReporters` stay global. **The thresholds stay exactly 9/17/16/16.**
- **Setup files.** Replace `src/setupTests.ts` with:
  - `tests/setup/main.ts`: `setupFiles`; sets `process.env.LOG_LEVEL ??= 'warn'` before any module loads.
  - `tests/setup/renderer.ts`: loads `@testing-library/jest-dom` and installs `window.api` from `createMockWindowApi()`.
- **`createMockWindowApi()`** lives in `tests/utils/window-api.ts`. It is a `Proxy` typed as `Window['api']`. Any `ns.method` returns a `jest.fn()` that rejects with `window.api.<ns>.<method> is not mocked in this test` until a test overrides it. A Proxy keeps working when P3 reshapes the API.
- **No global console silencing.** Tests that expect an error spy locally, as `tests/unit/services/queue.test.ts:51-53` already does.
- **Delete dead files:**
  - `tests/setup.ts`
  - `src/shared/schemas/watch.schema.test-debug.ts`, plus its `**/*test-debug.ts` exclude in `tsconfig.main.json`
  - `tests/TEST_SUMMARY.md`, which documents the dead `tests/setup.ts` and 70% coverage goals.
- **Pin clocks:**
  - `src/shared/schemas/watch.schema.test.ts:6-9,44-47,66-69` and `tests/fixtures/watches.ts:107-122` use `jest.useFakeTimers({ now: <fixed date> })` or a fixed reference date.
  - `tests/unit/services/booking.test.ts:168-176,202-210,307-315,336-339` use fixed far-future and far-past dates. `BookingRepository.findUpcoming` uses SQLite `date('now')` (`BookingRepository.ts:283-294`), which Jest fake timers do not affect.
- **Native-ABI guard.** `scripts/check-native-abi.js` (plain Node, cross-platform), wired as `pretest`, `pretest:coverage` and `pretest:watch`:
  - It loads `better-sqlite3` and opens `:memory:`.
  - On a `NODE_MODULE_VERSION` mismatch it prints both ABI numbers, explains that Electron's build is installed, and gives the fix `npm rebuild better-sqlite3`. It then exits 1.
  - With `AUTO_REBUILD_NATIVE=1` it runs the rebuild itself and re-checks.
  - The parsing logic lives in `scripts/lib/native-abi.js`, so it can be unit tested.
- `format` and `format:check` also cover `tests/**/*.{ts,tsx}` and `scripts/**/*.{js,mjs}`.
- Update `tests/README.md`: the two projects, the setup files, the window.api mock and the ABI guard.

## Non-goals
- New coverage for main-process modules. Later tasks add tests for what they touch.
- Changes to queue-service behaviour or its fake-timer tests beyond timer cleanup (V3, tech-review #10).
- Calendar-date storage, which moves to `YYYY-MM-DD` in V2 (#14).
- Electron smoke or E2E suites (Q1). `playwright.config.ts` is not touched.
- Failing tests on unexpected `console.error`. That could be added later; this task only stops hiding errors.
- Linting `tests/` with ESLint.

## Completion Criteria
- [ ] `npx jest --selectProjects renderer --listTests` lists exactly the `src/renderer/**/*.test.tsx` files.
- [ ] `npx jest --selectProjects main --listTests` lists no file under `src/renderer/`.
- [ ] `jest.config.js` `coverageThreshold.global` is still `{ branches: 9, functions: 17, lines: 16, statements: 16 }`, and `npm run test:coverage` passes.
- [ ] `src/setupTests.ts`, `tests/setup.ts`, `tests/TEST_SUMMARY.md` and `watch.schema.test-debug.ts` no longer exist.
- [ ] `grep -rn "window.electron" src tests` returns nothing.
- [ ] `grep -rnE "console\s*=|console\.(error|warn)\s*=" tests src` returns nothing.
- [ ] A renderer test calling an un-stubbed `window.api.x.y()` fails with a message naming `x.y` (unit test of `createMockWindowApi`).
- [ ] `TZ=UTC npx jest --selectProjects main` passes. So do the same command with `TZ=Australia/Perth` and `TZ=Pacific/Kiritimati` (UTC+14).
- [ ] Every test file calling `jest.useFakeTimers` also calls `jest.useRealTimers()` in an `afterEach`/`afterAll` (checked by grep).
- [ ] With the Electron-ABI `better_sqlite3.node` in place (see `ai-state/RUNBOOK.md`), `npm test` exits non-zero within 5 s. Its output names both ABI numbers and the text `npm rebuild better-sqlite3`.
- [ ] With the Node build in place, the guard adds less than 1 s.
- [ ] `AUTO_REBUILD_NATIVE=1 npm test` rebuilds and then runs the suite.
- [ ] `package.json` has `pretest`, `pretest:coverage` and `pretest:watch` running the guard.
- [ ] At least 16 suites and at least 191 tests pass, plus the new tests.
- [ ] `tests/README.md` describes the projects, the setup files and the guard.
- [ ] `npm run lint && npm run format:check && npm run type-check && npm test` pass.

## Edge Cases
- Main-project tests that import `electron` get the binary path string, not an API. Any test needing Electron APIs must `jest.mock('electron')` explicitly. Document this in `tests/README.md`.
- `npm test -- tests/unit/services/auth.test.ts` (a single path) still works and runs only the matching project.
- `npm run test:coverage` aggregates coverage across both projects. The threshold is evaluated once, globally.
- The guard must handle three other cases:
  - `better-sqlite3` is not installed (`npm ci --ignore-scripts`): print an install hint.
  - A non-ABI `dlopen` error, such as a missing libc symbol: print the original error unchanged.
  - Windows error text (`\\?\C:\...` paths): the regex must not depend on POSIX paths.
- The auto-rebuild path uses `spawnSync('npm', …, { shell: process.platform === 'win32' })` and propagates a failure exit code.
- Fixed dates must sit at mid-day UTC, so the local calendar day is the same from UTC−11 to UTC+11. The UTC+14 run still passes because the tests compare dates that are all built from the same pinned clock.
- jsdom-only globals such as `window` and `document` no longer exist in `main` tests. Fix any test that relied on them; do not move it to `renderer`.

## Test Strategy
- **Unit:** about 8 tests.
  - `native-abi` diagnosis (5): POSIX mismatch message, Windows mismatch message, module not found, other dlopen error, success.
  - `createMockWindowApi` (3): un-stubbed call rejects naming the method, override returns a value, nested namespaces.
- **Component:** the existing `ConfirmDialog`, `LoadingSpinner` and `Toast` tests run unchanged in the `renderer` project.
- **Integration:** none. Verify with the commands in Completion Criteria (`--listTests`, TZ runs, ABI swap).

## Context Files to Read First
- `ai-state/architecture-notes.md` (§1 layout, §11 git conventions), `ai-state/RUNBOOK.md` (native ABI), `CLAUDE.md` (Testing, Pre-Commit Checklist)
- `jest.config.js`, `src/setupTests.ts`, `tests/setup.ts`, `tests/README.md`, `tests/TEST_SUMMARY.md`
- `package.json` (scripts, `postinstall`), `.github/workflows/ci.yml:60-90`, `tsconfig.main.json`
- `src/shared/schemas/watch.schema.ts`, `src/shared/schemas/watch.schema.test.ts`, `tests/fixtures/watches.ts`
- `tests/unit/services/booking.test.ts`, `src/main/database/repositories/BookingRepository.ts:280-325`
- `tests/unit/services/queue.test.ts:45-80` (local console spies, timer cleanup)
- `src/renderer/components/*.test.tsx`, `src/preload/window.d.ts`

## Notes
- **ABI numbers.** Electron 28.3.3 uses 119, Node 18 uses 108, Node 20 (CI) uses 115 and Node 22 (sandbox) uses 127. Print `process.versions.modules` for the current runtime. Map 119 to "Electron 28" with a small lookup table, falling back to "another runtime".
- **Why not a global `jest.mock('electron')`?** It would hide accidental Electron coupling in code meant to be pure. Explicit per-test mocks keep that coupling visible.
- **Logger side effect.** `src/main/utils/logger.ts` still writes files to `os.tmpdir()/parkstay-bookings/logs` at import. P4 fixes this. P1 only lowers the log level noise.
- No new dependencies are needed: `jest-environment-jsdom` and `ts-jest` are already installed.
