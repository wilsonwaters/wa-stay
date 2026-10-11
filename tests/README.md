# WA Stay test suite

## Quick Start

```bash
# Install dependencies (better-sqlite3's one prebuilt binary serves Jest and the app alike)
npm ci

# Run all Jest tests (both projects)
npm test

# Run one project
npx jest --selectProjects main
npx jest --selectProjects renderer

# Run specific test file (only the project that owns it runs)
npm test -- tests/unit/core/watch.service.test.ts

# Run with coverage report
npm run test:coverage

# Run tests in watch mode
npm run test:watch

# Run the Electron smoke tests (Playwright; built app, needs the Electron ABI; see "Electron smoke tests")
npm run build:e2e && npm run test:e2e

# Run live Electron tests (real Chromium networking; not part of npm test)
npm run test:electron
```

## Jest projects

`jest.config.js` defines two [projects](https://jestjs.io/docs/configuration#projects-arraystring--projectconfig) built from one shared base (roots, transform, module aliases). Jest projects do not inherit root options, so anything both need goes in that base.

| Project | `testEnvironment` | Test files | Setup file |
| --- | --- | --- | --- |
| `main` | `node` | `tests/unit/**`, `tests/integration/**`, `tests/scripts/**`, `src/main/**`, `src/shared/**` | `tests/setup/main.ts` (`setupFiles`) |
| `renderer` | `jsdom` | `src/renderer/**`, `tests/renderer/**` | `tests/setup/renderer.ts` (`setupFilesAfterEnv`) |

- Test files are named `*.test.ts` / `*.test.tsx`.
- `npm test -- <path>` runs only the project whose files match the path.
- Dependencies that ship only ES modules (`ESM_ONLY_DEPENDENCIES`: htmlparser2 and its packages for sanitize-html, React Router 8 and its dependencies) are compiled to CommonJS by esbuild (`tests/utils/esm-to-cjs-transform.js`): Jest 30 loads ES modules from `require` only under `--experimental-vm-modules`. The patterns accept `/` and `\`, so they match on Windows too (`tests/unit/build/jest-config.test.ts`). Both projects add the `development` export condition, so React Router loads its development build, with its warnings, as `npm run dev` does.
- ESLint 10 loads `eslint.config.js` with `import()`, which Jest does not allow: a test that runs ESLint passes the config object itself (`tests/unit/lint/no-console.test.ts`).
- Coverage (`collectCoverageFrom`, `coverageThreshold`, `coverageReporters`) is configured once at the root. It is aggregated across both projects and the threshold (branches 85, functions 90, lines 93, statements 92: a ratchet a few points below the measured coverage, raised as it grows) is evaluated once, globally.

### Writing tests for the `main` project

- **There is no DOM.** `window`, `document` and other jsdom globals do not exist. A main-process or shared test that needs them is relying on something it should not; fix the test rather than moving it to `renderer`.
- **`electron` is not mocked.** Outside Electron, `require('electron')` returns the path to the Electron binary (a string), not the API, so `app`, `BrowserWindow`, `Notification` and friends are `undefined`. A test that needs Electron APIs mocks the module itself:

  ```typescript
  jest.mock('electron', () => ({
    app: { getPath: jest.fn(() => '/tmp/wa-stay-test'), isReady: jest.fn(() => true) },
  }));
  ```

  There is deliberately no global `jest.mock('electron')`: it would hide accidental Electron coupling in code that is meant to be pure.

## Setup files

- **`tests/setup/main.ts`** (`setupFiles`, runs before any module loads) sets `process.env.LOG_LEVEL ??= 'warn'`, so the Winston logger skips info/debug output but still prints warnings and errors. An explicit level wins: `LOG_LEVEL=debug npm test`.
- **`tests/setup/renderer.ts`** (`setupFilesAfterEnv`) loads the `@testing-library/jest-dom` matchers and installs a mock `window.api` (see below).

Neither file silences the console. A test that expects an error to be logged spies on the console locally and restores it:

```typescript
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});
```

## Mocking `window.api` (renderer)

The renderer setup installs `createMockWindowApi()` from `tests/utils/window-api.ts` on `window.api`: once when the test file loads and again, fresh, before every test. It is a `Proxy` typed as `Window['api']`, so it needs no list of namespaces and keeps working when the preload API changes shape.

Every member, at any depth, is a `jest.fn()` that rejects with `window.api.<namespace>.<method> is not mocked in this test` until the test stubs it:

```typescript
jest.mocked(window.api.watches.list).mockResolvedValue({ success: true, data: [] });
// or
window.api.settings.get = jest.fn().mockResolvedValue({ success: true, data: null });

expect(window.api.watches.list).toHaveBeenCalledWith();
```

- Stub in the test or in a `beforeEach`. Stubs made at module scope or in `beforeAll` are replaced before each test.
- `jest.resetAllMocks()` / `mockReset()` clear the default rejection (the method then returns `undefined`); prefer `jest.clearAllMocks()`.
- An un-stubbed call that nobody awaits becomes an unhandled rejection, and Node 22 crashes the Jest process for that file. In-band the run exits 1 with only Node's stack; with workers it is reported as "Jest worker encountered child process exceptions". stderr still names the method. Always `await` (or stub) every `window.api` call a component makes.

## Clocks and dates

Tests must not depend on the real date or the machine's time zone.

- Pin the clock with `jest.useFakeTimers({ now: new Date('2026-06-15T12:00:00.000Z') })`. Every file that calls `jest.useFakeTimers` also calls `jest.useRealTimers()` in an `afterEach` (or `afterAll`), so a failing test cannot leak fake timers.
- Use mid-day UTC for fixed dates, so the local calendar day is the same from UTC−11 to UTC+11. Build every date in a test from the same pinned instant, so UTC+14 passes too.
- SQLite's `date('now')` (used by `BookingRepository.findUpcoming` / `findPast`) ignores Jest fake timers. Use fixed dates far in the future or past instead.
- Fixtures do not read the clock either: `tests/fixtures/watches.ts` builds dates from a fixed reference date.

Check the main project in several time zones:

```bash
TZ=UTC npx jest --selectProjects main
TZ=Australia/Perth npx jest --selectProjects main
TZ=Pacific/Kiritimati npx jest --selectProjects main   # UTC+14
```

## Native module ABI guard

`better-sqlite3` is a native module. Since version 13 it ships prebuilt **Node-API** binaries inside the package (Windows, macOS and Linux, x64 and arm64), and Node-API binaries do not depend on the runtime's NODE_MODULE_VERSION: the same file loads in Jest (Node 24) and in the app (Electron 44). Nothing is compiled, and nothing needs rebuilding between running the tests and running the app. (Before 2.0, better-sqlite3 9 was compiled per runtime, and `npm ci` built it for Electron, NODE_MODULE_VERSION 119.)

`scripts/check-native-abi.js` runs as `pretest`, `pretest:coverage` and `pretest:watch`. It loads `better-sqlite3`, opens a `:memory:` database and exits silently if that works (it adds well under a second). Otherwise it stops the run with one message instead of a `dlopen` error in every database test:

- **ABI mismatch** (only an install from before better-sqlite3 13 can have one): prints both NODE_MODULE_VERSION numbers, explains which build is installed, and gives the fix, `npm rebuild better-sqlite3`, or `npm ci` for an install that predates better-sqlite3 13.
- **Not installed** (missing package, or `npm ci --ignore-scripts` left no binary): prints an install hint.
- **Any other load error** (for example a missing libc symbol): prints the original error unchanged.

Set `AUTO_REBUILD_NATIVE=1` to have the guard run `npm rebuild better-sqlite3` itself on a mismatch, re-check, and continue:

```bash
AUTO_REBUILD_NATIVE=1 npm test
```

Calling `npx jest` directly skips the guard. The diagnosis logic lives in `scripts/lib/native-abi.js` and is unit tested in `tests/scripts/native-abi.test.ts`.

## Directory Structure

```
tests/
├── unit/                    # Unit tests (main project)
│   ├── core/                # Provider-agnostic services (watches, snipes, accounts, holds)
│   ├── database/
│   ├── providers/           # The provider SDK, registry and ParkStay module
│   ├── docs/                # The docs: links, the provider guide's examples, ParkStay endpoints
│   └── …                    # app, ipc, security, scheduler, renderer guards, brand, design
├── integration/             # Integration tests (main project)
├── scripts/                 # Tests for Node scripts in scripts/ (main project), new-provider.test.ts
│                            # generates each kind of provider into a temp copy of the project
├── e2e/                     # Electron smoke tests on the built app (Playwright _electron, not Jest)
├── docs/                    # The documentation screenshots (npm run docs:screenshots, not Jest)
├── electron/                # Live tests that run inside Electron (npm run test:electron, not Jest)
├── manual/                  # Scripts run by hand against live services (not Jest)
├── fixtures/                # Test data (users, bookings, watches, site-sniper), parkstay/ (trimmed
│                            # live samples), providers/ (the provider guide's examples, and each provider's
│                            # recorded responses or made-up site), db/ (schema dumps)
├── setup/
│   ├── main.ts              # setupFiles for the main project
│   └── renderer.ts          # setupFilesAfterEnv for the renderer project
├── utils/
│   ├── database-helper.ts   # Database setup/teardown
│   ├── test-helpers.ts      # Common test utilities
│   ├── http-transport-cases.ts # HttpClient cases shared by Jest (Node) and Electron runs
│   └── window-api.ts        # createMockWindowApi() for renderer tests
└── README.md                # This file
```

Renderer component tests are co-located with the components (`src/renderer/**/*.test.tsx`). `tests/renderer/` is also part of the renderer project, for renderer tests that do not belong next to one component.

## Test Types

### Unit Tests (`tests/unit/`)
Tests individual services in isolation with mocked dependencies.

**Example** (the core services run on a real in-memory database and a FakeProvider, through
`tests/utils/core-harness.ts`):
```typescript
describe('watch auto-hold', () => {
  let h: CoreHarness;

  beforeEach(() => {
    h = createCoreHarness({ providers: [createFakeProvider()] });
  });

  afterEach(() => h.close());

  it('persists the hold it placed', async () => {
    const watch = await h.watches.create(h.userId, h.watchInput({ autoHold: true }));
    await h.watches.execute(watch.id);
    expect(h.watchRepo.findById(watch.id)?.hold).toMatchObject({ reference: 'FAKE-1' });
  });
});
```

### Integration Tests (`tests/integration/`)
Tests multiple components working together, including database operations. IPC tests build
the real container and call handlers through `tests/utils/ipc-harness.ts`, with `electron`
mocked (`tests/utils/electron-mocks.ts`).

**Example:**
```typescript
it('a lapsed hold cannot be paid for', async () => {
  const snipe = heldSnipe('2072968', new Date(Date.now() - 60_000));
  await expect(call('snipes:open-payment', { id: snipe.id })).resolves.toMatchObject({
    success: false,
    code: 'HOLD_EXPIRED',
  });
});
```

### Electron smoke tests (`tests/e2e/`)
Journeys through the built app (main, preload and renderer together), driven by Playwright's
`_electron` launcher. See [Electron smoke tests](#electron-smoke-tests-e2e) below.

### Live Electron Tests (`tests/electron/`)
Some behaviour only exists in Electron's real network stack, so mocks cannot prove it: the
production `ElectronSessionHttpClient` sends requests through Chromium on a session
partition (redirect handling, session cookies on every hop, Referer policy, `net::ERR_*`
failures). These tests run inside Electron, not Jest:

```bash
npm run test:electron                  # every tests/electron/*.electron.ts
npm run test:electron -- http-transport
```

- `tests/electron/run.js` bundles each `*.electron.ts` with esbuild (`electron` stays
  external) and launches it as Electron's main script with `--no-sandbox`. The test prints
  TAP and exits non-zero on any failure.
- **Linux needs a display:** without `DISPLAY` the runner wraps Electron in `xvfb-run -a`
  (`apt-get install xvfb`). Windows and macOS need nothing extra.
- Everything is local: the HTTP transport test starts two loopback servers on 127.0.0.1 (two
  origins) and uses a throwaway `userData` folder, so no network or proxy is needed.
- `http-transport.electron.ts` runs the same cases as
  `tests/unit/providers/http-transport-parity.test.ts`, which Jest runs against
  `NodeHttpClient` (from `tests/utils/http-transport-cases.ts`), plus Electron-only checks.
  A behaviour change in either client must keep both runs green.
- Not part of `npm test`: it needs the Electron binary and a display. Run it when you change
  `src/main/providers/sdk/http*.ts`.

## Electron smoke tests (E2E)

`tests/e2e/` holds the Electron smoke suite: a handful of journeys through the **built** app
(main, preload and renderer together), driven by Playwright's `_electron` launcher. It
catches what Jest cannot: startup crashes, preload or sandbox breakage, CSP violations,
broken routing and focus, and a quit that hangs.

```bash
npm run build:e2e                 # the normal build, with no Mapbox token (scripts/build-e2e.js)
xvfb-run -a npm run test:e2e      # Linux without a display; elsewhere: npm run test:e2e
npx playwright show-report        # the HTML report of the last run
```

- **Build first.** The tests launch `dist/`, never the dev server. `build:e2e` runs `npm run
  build` with `MAPBOX_ACCESS_TOKEN` set to an empty string, so a token in your `.env` never
  reaches the e2e build and Explore is deterministically list-only. The suite stops at once
  with "run `npm run build:e2e` first" when `dist/` is missing.
- **Native module.** better-sqlite3's one Node-API binary loads in Electron as it does in Jest
  (see [Native module ABI guard](#native-module-abi-guard)): there is nothing to rebuild. A
  launch that fails with "WA Stay did not start" and a `NODE_MODULE_VERSION` error means
  `node_modules` predates better-sqlite3 13: run `npm ci`.
- **The Electron binary.** Since Electron 42, `npm ci` no longer downloads it: it is fetched
  the first time something runs Electron (`npx electron`, or Playwright's launcher), or ahead of
  time with `npx install-electron`.
- **Display.** Electron needs one: on Linux without a desktop use `xvfb-run -a`. Windows and
  macOS need nothing extra.
- **Linux sandbox.** On CI (`CI` set) the harness passes `--no-sandbox`, because Ubuntu 24.04
  runners restrict the user namespaces Electron's sandbox needs. Playwright adds it itself when
  running as root. If Electron aborts with a sandbox error on your machine, run with `CI=1`.
- **One app at a time.** `workers: 1`, no parallelism; each test launches its own app, so the
  suite takes about a minute. On CI a failed test is retried once.
- **The map (opt-in).** `explore-resize.spec.ts` has a second check that needs the map: a build
  with a Mapbox token (`npm run build`, not `build:e2e`) and Mapbox reachable. Run it with
  `E2E_MAP=1`: it lets `api.mapbox.com` through the network guard (`WA_STAY_E2E_ALLOW_HOSTS`),
  launches with SwiftShader on Linux (the harness's `args`), and adds `E2E_ELECTRON_ARGS`
  (space-separated switches, e.g. `--proxy-server=host:port`). It checks that resizing the
  window leaves the results and `map=` alone, and that a zoom button still counts as a move.
  Without `E2E_MAP` it is skipped.
- **A provider preview (opt-in).** `preview-provider.spec.ts` launches the app with only the
  provider `PREVIEW_PROVIDER` names (`npx cross-env PREVIEW_PROVIDER=<id> playwright test
  preview-provider`), checks that Explore lists its places; with dates (two nights from
  `PREVIEW_ARRIVAL=YYYY-MM-DD`, by default tomorrow in the provider's time zone, through
  Explore's address), that Explore shows its free counts when it has bulk availability, and that
  the first place's "Check availability" answers with the night grid or "No … were listed", not
  an error (with a warning annotation, not a failure, when every night reads Unknown); and
  visits Settings → Accounts. It
  fails on a request fixture mode refused (such as a signed-in check with no route) or a window
  error, and attaches a screenshot of each step; a failed step quotes what the app logged about
  the provider ([preview in the app](../docs/providers/adding-a-provider.md#12-preview-in-the-app)).
  Without `PREVIEW_PROVIDER` it is skipped. A browser provider is previewed by hand
  ([browser providers](../docs/providers/browser-providers.md#preview-in-the-app)).

### What every launch gets (`support/wa-stay.ts`)

The `launchWaStay()` fixture starts the app with:

- **Its own userData**, a fresh temp folder (`WA_STAY_USER_DATA_DIR`). Before anything else it
  checks that the app really uses it (`app.getPath('userData')`), so a test can never touch a
  real profile. Pass `{ userDataDir }` to relaunch on an existing one, and `{ prepare }` to seed
  the profile before the app starts (see "Seeding data" below).
- **Fixture mode** (`WA_STAY_E2E_FIXTURES_DIR=tests/e2e/fixtures/http`): every provider's
  `HttpClient` is a `FixtureHttpClient` that answers from recorded responses, and a network
  guard cancels every other http(s)/ws(s) request any Electron session makes. A document
  window's partition (the campground map) answers from the same provider routes, a PDF
  included, and refuses everything else. Each refusal is written to
  `<userData>/e2e-unexpected-requests.log`; the lifecycle spec requires it to be empty. `WA_STAY_E2E_ALLOW_HOSTS` (comma-separated hosts, subdomains included) lets some
  through, for documentation screenshots.
- **Only the providers the journey was written for** (`WA_STAY_PROVIDERS`, comma-separated
  provider ids): `parkstay` (`DEFAULT_PROVIDERS`) unless the launch passes `{ providers }`. The
  other built-in providers are not registered, so the journeys' counts and pre-selections
  (ParkStay's 11 places, ParkStay chosen for you) hold however many providers are built in. A
  journey that counts or expects a pre-selection passes its list explicitly. An id that is not
  a built-in provider stops the app at start-up, with the reason in the main process's output.
- **A production renderer**: `NODE_ENV=production`, no `ELECTRON_RENDERER_URL`, no Mapbox
  token, `TZ=Australia/Perth`, `LANG=en_AU.UTF-8`.
- **An online window, whatever the host.** Chromium reads `navigator.onLine` from the host's
  network interfaces, so a machine with loopback only (a sandbox, `unshare -n`) looks offline
  and Explore turns its availability off. The harness overrides it through DevTools network
  emulation (`forceOnline`), so the suite passes with no network at all.

These test-only hooks live in `src/main/testing/` and are honoured only when the app runs from
source: unpackaged, and not loaded from an asar archive (`src/main/app/app-source.ts`), so a
packaged executable renamed to `electron` (which Electron then reports as unpackaged) ignores
them too (architecture-notes §12.14). Unit tests in `tests/unit/testing/` and
`tests/unit/app/` prove it, and CI's packaged smoke check (below) runs the real package both
ways.

The fixture returns `{ app, window, userDataDir, consoleErrors(), mainLog(),
unexpectedRequests(), close() }`. After the test it closes every app it started (killing one
that hangs), then deletes the temp folders. A test that needs a folder of its own (a v1.x data
folder) takes the `tempDir` fixture: `tempDir('legacy')` makes one, removed after the apps
have closed. When a test fails, the report gets the Electron window's trace (`trace-N`) and
screenshot, the main process's output and log file, the renderer console errors and the
unexpected requests.

### Seeding data

`support/seed.ts` writes data before a launch with the app's own built code
(`support/seed-db.js`, run with the Electron binary as Node, `ELECTRON_RUN_AS_NODE=1`, so
better-sqlite3's Electron build loads and `dist/main` opens and migrates the database):

- `seedHeldSnipe(userDataDir, …)`, from `launchWaStay({ prepare })`: a HELD snipe with its hold
  and its `snipe_held` notification. No hold is ever placed (architecture-notes §12.33).
- `writeLegacyV1Data(dir)`: a v1.2.0 data folder from `tests/fixtures/db/v5-release-1.2.0.sql`,
  for `WA_STAY_LEGACY_DATA_DIR` (the upgrade journey).

Data a page can create through the preload is written that way instead
(`window.api.bookings.create`, `window.api.watches.create`), from the test.

### Fixtures

Recorded provider responses live in `tests/e2e/fixtures/http/<providerId>/`, with a
`manifest.json` of routes. The format, where the data comes from and how to refresh it are in
[`fixtures/http/README.md`](e2e/fixtures/http/README.md).

### Adding a journey

1. Create `tests/e2e/<journey>.spec.ts`. Import `test` and `expect` from `./support/wa-stay`
   and the shell helpers (`navLink`, `pageHeading`, `chooseAccountMenuItem`, …) from
   `./support/shell`.
2. Start with `const { window } = await launchWaStay();`. Isolation, fixture mode and the
   report attachments come with it. Seed what the journey needs (see "Seeding data").
3. Find elements only by role, label or text (`getByRole`, `getByLabel`, `getByText`), using the
   accessible names in `docs/design/shell.md` and the feature's spec. No CSS classes, XPath or
   test ids: `grep -rnE "locator\(['\"][.#\[]|xpath=|data-testid" tests/e2e` must print nothing.
4. Use web-first assertions (`toBeVisible`, `toHaveCount`, `toBeFocused`, `expect.poll`), never
   `waitForTimeout`. After a page change, assert where focus is (`expectHeadingFocused`).
5. If the journey makes provider requests, run it once: each request with no fixture fails with
   "no fixture for GET …; add a route to …/manifest.json", and the failed test's
   `unexpected-requests` attachment lists them. Add the routes and response files.
6. Add the journey's pages to the lifecycle spec's journey, so its console errors and requests
   are checked too.

To mark a known gap an assertion is waiting for, use `test.fail(condition, reason)` with a
condition that turns false once the gap is closed; then remove the line. The suite has none.

### Debugging

- `npm run test:e2e:debug` (or `PWDEBUG=1 npm run test:e2e`) opens the Playwright Inspector and
  pauses at each step. It needs a real display: run it outside `xvfb-run`.
- `--headed` changes nothing here: Electron windows are always shown. Under `xvfb-run` they are
  on the virtual display; run without it on a desktop to watch.
- `npx playwright show-trace test-results/<test>/trace-1.zip` replays a failed launch: DOM
  snapshots, screenshots, console and network.
- `npx playwright test navigation -g "keyboard"` runs one spec or test.
- With no network at all: run the suite in a network namespace whose only interface is
  loopback, brought up first because Playwright talks to Electron over 127.0.0.1, e.g.
  `unshare -rn sh -c 'ip link set lo up && xvfb-run -a npm run test:e2e'`. It must pass.

### CI

The `e2e` job in `.github/workflows/ci.yml` runs on `ubuntu-latest` (20 minutes at most):
`npm ci`, `npx install-electron` (the Electron binary, which `npm ci` no longer downloads),
`npm run build:e2e`, then `xvfb-run -a npm run test:e2e`. It always uploads
`playwright-report/` and `test-results/` (7 days), so a test that failed and passed on its
retry leaves its first attempt's trace and logs. It is not in `build.yml`, so it never blocks a
release tag.

The `packaged-smoke` job checks what electron-builder ships: `npm run build:e2e`,
`npx electron-builder --linux dir --publish never`, then `xvfb-run -a npm run smoke:packaged`
(`scripts/packaged-smoke.js`). It first reads `app.asar`'s index: the main, preload and
renderer builds are there, no `.d.ts` or `.map` file under `dist/`, every packed file has an
integrity hash, and exactly one better-sqlite3 binary ships (`linux-x64.node` on CI), the only
file of it outside the archive, with none of its C sources. It reads the executable's Electron fuses back with `@electron/fuses`
(`getCurrentFuseWire`) and checks each one `electron-builder.json` sets
([security](../docs/security.md#the-packaged-app-electron-fuses)). Every start gets a temp
`XDG_CONFIG_HOME` and every test-only hook set (`WA_STAY_PROVIDERS` names a provider that is
not built in, which would stop an app that read it). The executable as shipped is started with
`--inspect=0` and `--remote-debugging-port=0`: Node's inspector must stay off, the window
(seen through Chromium's DevTools endpoint) must show the page from `app.asar`, and closing it
must quit with code 0 within 10 s. Playwright's launcher needs Node's inspector, so the other
two starts use copies with only `EnableNodeCliInspectArguments` turned back on: the
executable, then a copy named `electron`, which Electron reports as unpackaged. Each waits for
the window's `h1` and requires that userData is the temp `WA Stay` folder, the page comes from
`app.asar`, `window.api.providers.list()` has the built-in providers, and `app.quit()` exits
with code 0 within 10 s.

The release build (`build.yml`, job "Build Windows") checks the Windows package with the same
helpers (`scripts/lib/packaged-app.js`): `node scripts/check-windows-package.js
release/win-unpacked` reads `WA Stay.exe`'s fuses, compares its asar integrity record with the
SHA-256 of `app.asar`'s header, and checks for exactly one better-sqlite3 binary, `win32-x64`.

## Test Utilities

### TestDatabaseHelper
Manages test database lifecycle.

```typescript
import { TestDatabaseHelper } from '@tests/utils/database-helper';

const dbHelper = new TestDatabaseHelper('my-test');
await dbHelper.setup();            // Create & initialize test DB
const db = dbHelper.getDb();       // Get database instance
await dbHelper.reset();            // Clear all data
await dbHelper.teardown();         // Delete test DB
```

### Test Helpers
Common utilities for tests.

```typescript
import { waitFor, sleep, randomEmail } from '@tests/utils/test-helpers';

// Wait for condition
await waitFor(() => element.isVisible(), 5000);

// Generate random data
const email = randomEmail();
const date = randomFutureDate();

// Handle async errors
await expectAsyncThrow(
  () => service.doSomething(),
  'Expected error message'
);
```

## Test Fixtures

### Using Fixtures
```typescript
import { mockUserInput, createMockUser } from '@tests/fixtures/users';
import { mockBooking, createMockBooking } from '@tests/fixtures/bookings';

// Use predefined fixture
const user = mockUserInput;

// Create custom fixture
const customUser = createMockUser({ email: 'custom@example.com' });

// Create multiple fixtures
const bookings = createMultipleMockBookings(10, userId);
```

## Writing Tests

### Test Structure
Follow the AAA pattern (Arrange, Act, Assert):

```typescript
it('should do something', async () => {
  // Arrange: Set up test data and environment
  const input = createMockBookingInput();

  // Act: Execute the code being tested
  const result = await bookingService.createBooking(userId, input);

  // Assert: Verify the results
  expect(result).toBeDefined();
  expect(result.bookingReference).toBe(input.bookingReference);
});
```

### Best Practices

1. **Isolated Tests**: Each test should be independent
2. **Clear Names**: Test names should describe what they test
3. **Single Responsibility**: One test should test one thing
4. **Cleanup**: Always clean up resources (databases, files, etc.)
5. **Mock External Dependencies**: Don't make real API calls
6. **Test Edge Cases**: Test both success and failure scenarios
7. **Use Fixtures**: Reuse test data through fixtures
8. **Async/Await**: Properly handle async operations

### Example Test

```typescript
describe('BookingService', () => {
  describe('createBooking', () => {
    it('should create a valid booking', async () => {
      // Arrange
      const input = createMockBookingInput();

      // Act
      const booking = await bookingService.createBooking(userId, input);

      // Assert
      expect(booking.id).toBeDefined();
      expect(booking.userId).toBe(userId);
      expect(booking.status).toBe(BookingStatus.CONFIRMED);
    });

    it('should reject invalid dates', async () => {
      // Arrange
      const input = createMockBookingInput({
        arrivalDate: new Date('2024-06-05'),
        departureDate: new Date('2024-06-01'), // Before arrival!
      });

      // Act & Assert
      await expectAsyncThrow(
        () => bookingService.createBooking(userId, input),
        'Departure date must be after arrival date'
      );
    });
  });
});
```

## Debugging Tests

### Run Single Test
```bash
npm test -- tests/unit/core/watch.service.test.ts
```

### Run Tests Matching Pattern
```bash
npm test -- --testNamePattern="should encrypt"
```

### Debug in VS Code
Add to `.vscode/launch.json`:
```json
{
  "type": "node",
  "request": "launch",
  "name": "Jest Debug",
  "program": "${workspaceFolder}/node_modules/.bin/jest",
  "args": ["--runInBand", "--no-cache"],
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen"
}
```

### View Coverage
```bash
npm run test:coverage
open coverage/index.html
```

## CI/CD Integration

The workflows are `.github/workflows/ci.yml` (lint and format, type-check, Jest with coverage
on Ubuntu, Windows and macOS plus `npm run test:tz`, a build check, the Electron smoke tests and
the packaged smoke check) and `.github/workflows/build.yml` (the release build, which runs the
Jest suite and `test:tz` first). Every job runs on Node 24 (`.nvmrc`), and none rebuilds
better-sqlite3: its prebuilt binary serves Node and Electron alike.

The Electron smoke tests need a display and the Electron binary, so they run in their own job
(see [Electron smoke tests → CI](#ci)).

## Troubleshooting

### "Module not found" errors
```bash
# Clear Jest cache
npx jest --clearCache

# Rebuild native modules
npm rebuild better-sqlite3
```

### Database errors
```bash
# Clean up test databases
rm -rf tests/.test-dbs

# Rebuild SQLite
npm rebuild better-sqlite3
```

### E2E tests not starting
- "run `npm run build:e2e` first": the suite drives the built app; build it.
- "WA Stay did not start" with `NODE_MODULE_VERSION` in the log: `node_modules` predates
  better-sqlite3 13, whose one binary serves Node and Electron. Run `npm ci`, then the suite
  again.
- "Unable to open X display" on Linux: run it under `xvfb-run -a`.

### TypeScript errors
```bash
# Check TypeScript configuration
npm run type-check

# Update path mappings in jest.config.js
```

## Coverage Thresholds

`jest.config.js` enforces a global floor across both projects: branches 85%, functions 90%, lines 93%, statements 92%, a few points below the measured coverage. Raise it as coverage grows; do not lower it to make a run pass.

## Contributing

When adding new features:
1. Write tests first (TDD approach)
2. Ensure all tests pass
3. Maintain coverage above thresholds
4. Add fixtures for new entities
5. Update this documentation

## Resources

- [Jest Documentation](https://jestjs.io/)
- [Playwright Documentation](https://playwright.dev/)
- [Testing Best Practices](https://testingjavascript.com/)
