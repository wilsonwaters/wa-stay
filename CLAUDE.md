# Claude Code Context

This file provides important context for Claude Code sessions working on this codebase.

## Project Overview

WA Stay is an Electron + React + TypeScript desktop app (Windows first) for finding and booking places to stay across Western Australia. Accommodation comes from **providers**, modules behind a provider SDK: **ParkStay WA** (DBCA's national-park campgrounds) is the first; RAC Parks & Resorts is the next project. It shows every location on a Mapbox map with search, filters and date-aware availability (Explore), runs availability **watches** with desktop and email notifications, handles the DBCA queue, holds hard-to-get sites the moment they are released (**Site Sniper**, marked "Soon"), keeps **bookings** (marked "Soon") and hands payment to the provider's own pages in an in-app window. It grew out of the 1.x ParkStay booking app, whose installs upgrade in place (same `appId`, data copied on first run); the old name appears in code only on lines marked `legacy-name-ok`.

- **Version:** 1.2.0 in `package.json`; the next release is 2.0.0 (the version is bumped by the release process; `CHANGELOG.md` has it as `[Unreleased]`)
- **Entry point:** `src/main/index.ts`
- **Repo:** `https://github.com/wilsonwaters/wa-stay.git` (renamed from `parkstay-bookings`; GitHub redirects the old name)
- **Binding decisions:** `ai-state/architecture-notes.md` (§12 amendments override earlier sections)

## Tech Stack

| Component | Technology |
| --- | --- |
| Desktop Framework | Electron 44 (its own Node 24); development and CI on Node 24 (`.nvmrc`) |
| UI Framework | React 19, React Router 8 (`react-router`, ES modules only, HashRouter), React Query, react-hook-form |
| Language | TypeScript 6 (the latest 6.x, not 7: `typescript-eslint` supports `<6.1.0`, `ts-jest` `<7`, and `tests/unit/shared/type-equality.test.ts` uses the compiler API) |
| Database | SQLite via better-sqlite3 (`<userData>/wa-stay.db`) |
| Map | Mapbox GL JS 3 (token at build time; Explore is list-only without one) |
| Scheduling | Chained `setTimeout` timers (`src/main/scheduler/`) |
| HTTP | The provider SDK's `HttpClient`: Electron `net.request` on each provider's session partition in the app, Node `fetch` in tests (axios is only used by `tests/manual/test-queue-live.ts`) |
| Browser automation | playwright-core 1.64.0 (pinned, the same version as `@playwright/test`), driving the installed Edge or Chrome (lazy-loaded) |
| HTML sanitising | sanitize-html (provider HTML, in main) |
| Email | nodemailer (SMTP) |
| Validation | Zod 4 |
| Styling | Tailwind CSS 4 (CSS-first config in `src/renderer/styles/index.css`, via `@tailwindcss/postcss`) with design tokens, lucide-react icons, Figtree and Fraunces (`@fontsource-variable`) |
| Build | Vite 8 (renderer), tsc + tsc-alias (main), esbuild (preload), Electron Builder 26 (with Electron fuses) |
| Lint and format | ESLint 10 (flat config, `eslint.config.js`: typescript-eslint, React, React Hooks), Prettier 3 |
| Testing | Jest 30 + Playwright (`_electron`) |
| Logging | Winston |

## Build & Run Commands

```bash
npm run dev          # Start dev (main + preload + renderer concurrently); then `npm start` for Electron
npm run build        # Production build
npm run build:e2e    # Production build with no Mapbox token (for the e2e suite)
npm run test         # Run Jest unit/integration tests
npm run test:coverage # Test with coverage report
npm run test:tz      # Timestamp tests with TZ=Australia/Perth (CI runs it after the unit tests)
npm run test:e2e     # Electron smoke tests on the built app (tests/e2e/; xvfb-run -a on Linux)
npm run test:electron # Live Electron tests (tests/electron/; xvfb on Linux; not in npm test)
npm run smoke:packaged # Starts the packaged Linux app (after electron-builder --linux dir) and checks it quits cleanly
npm run docs:screenshots # Rebuilds and retakes docs/images/*.png (tests/docs/)
npm run provider:new -- <id> [--api|--browser] [--search] # Generates a working provider (see "Adding a provider")
npm run lint         # ESLint (src, tests, scripts and the root configs)
npm run type-check   # TypeScript type checking (main, renderer, tests/e2e, tests/docs)
npm run dist:win     # Package Windows installer
```

**Native module:** better-sqlite3 13 ships prebuilt Node-API binaries: the same binary loads in Jest (Node 24) and in the app (Electron 44), so nothing is rebuilt between them, and nothing rebuilds it for Electron (no `postinstall`, `npmRebuild: false`). `npm ci` still runs node-gyp over its `binding.gyp` (it builds nothing with a prebuilt binary), so Windows needs the Node.js "Tools for Native Modules" (Python, C++ build tools). The test scripts check that it loads (`scripts/check-native-abi.js`); a `NODE_MODULE_VERSION` error means `node_modules` predates better-sqlite3 13: run `npm ci`. Since Electron 42 `npm ci` does not download the Electron binary: the first `electron` run does, or `npx install-electron`.

**Mapbox token:** `.env` (gitignored, from `.env.example`) holds a public `pk.` `MAPBOX_ACCESS_TOKEN`, read at build time by `vite.config.ts`; a secret `sk.` token fails the build. CI uses `secrets.MAPBOX_ACCESS_TOKEN || vars.MAPBOX_ACCESS_TOKEN`. Never print or commit a token.

## Architecture Overview

```text
src/
├── main/           # Electron main process (Node.js)
│   ├── app/        # Composition root (container.ts), paths, main window, CSP, single instance, provider windows,
│   │               # launch at login, quit hold, local profile, renderer entry/origin, app-source (runsFromSource)
│   ├── core/       # Provider-agnostic domain services (catalog, watches, snipes, bookings, holds, accounts, notifications)
│   ├── providers/  # Provider SDK (sdk/), ProviderRegistry (registry.ts), built-ins (index.ts), parkstay/
│   ├── database/   # connection.ts (schema + every migration), repositories/
│   ├── ipc/        # handle.ts, sender guard, renderer events, handlers/ (one per namespace)
│   ├── scheduler/  # JobScheduler: watch due-loop, per-snipe timer chains, retention job
│   ├── security/   # SecretVault (safeStorage), legacy secret decryptors and migration
│   ├── migration/  # legacy-install.ts: first-run copy of a 1.x install
│   ├── services/   # updater/ (electron-updater)
│   ├── testing/    # Test-only hooks: fixture mode, network guard, request log (honoured only from source)
│   └── utils/      # Logger, AppError
├── preload/        # Secure context bridge (window.api), bundled by esbuild, sandboxed
├── renderer/       # React UI
│   ├── app/        # App shell, routes (routes.ts, AppRoutes.tsx), TopNav, AccountMenu, Tray, query client
│   ├── api/        # React Query hooks over window.api: the only place window.api is touched
│   ├── components/ # ui/ (design-system primitives), brand/, stay/, providers/, accounts/, shared blocks
│   ├── features/   # explore/, place/, watches/, snipes/, bookings/, settings/, notifications/, design-preview/ (dev only)
│   ├── hooks/
│   └── styles/     # Tailwind, tokens.css
└── shared/         # Cross-process code (no Node or Electron imports)
    ├── contracts/  # IPC contract: channels, zod request schemas, response types, events, settings keys
    ├── constants/  # App constants
    ├── types/      # Domain types (provider, catalog, watch, snipe, booking, notifier, …)
    └── utils/      # Calendar dates, location keys, stay fields
```

Docs: `docs/README.md` (index), `docs/architecture/overview.md` (the map, with a provider diagram).

**Composition root** (`src/main/app/container.ts`): `createContainer({ db, logsDir, userDataDir, safeStorage, isReady, … })` builds every repository, service, notifier, dispatcher, the provider registry and its providers, the scheduler and the updater once, by constructor injection; nothing else in `src/main` calls `new` on them, and there are no singletons. Its first act is the SecretVault's first use (`migrateLegacySecrets`, then `removeRetiredGmailStore`), so it runs after `ready` and after userData is final (architecture-notes §12.23). `src/main/index.ts` pins userData (`app/paths.ts`), applies the test hooks (only when `runsFromSource`), runs the legacy install migration, opens the database, builds the container, runs `profile.ensureLocalProfile()` and the legacy follow-ups, registers the IPC handlers, starts the scheduler, opens the window, then starts the catalogue sync and account refresh; `before-quit` goes through the quit hold (`app/quit-hold.ts`) to `container.dispose()` (renderer cut off, scheduler jobs aborted and awaited, providers with their queue gates and browsers, then the database).

**Local profile** (`src/main/app/profile.ts`): one `users` row is the local profile that owns every watch, snipe, booking and notification. Main resolves it (`requireUserId()`, or `NO_PROFILE`); the renderer never sends a `userId`. Since v9 the row is the profile only (email hint, names, phone). Nothing may delete it: a provider sign-out clears only that provider's session partition and `provider_accounts` row.

**Test hooks** (`src/main/testing/`, architecture-notes §12.14, §12.34): `WA_STAY_USER_DATA_DIR`, `WA_STAY_LEGACY_DATA_DIR`, `WA_STAY_E2E_FIXTURES_DIR` (network-free fixture mode: every provider gets a `FixtureHttpClient`, and a network guard cancels other requests), `WA_STAY_E2E_ALLOW_HOSTS` and `WA_STAY_PROVIDERS` (comma-separated provider ids: only those built-ins register; an id that is not built in fails start-up; the e2e harness sets `parkstay` unless a launch passes `providers`), plus `ELECTRON_RENDERER_URL`, `WA_STAY_BROWSER_PATH` and provider-window DevTools, are honoured only when `runsFromSource` (`src/main/app/app-source.ts`): unpackaged **and** `app.getAppPath()` not inside an asar archive.

**No live holds** (architecture-notes §12.33): no test, runtime check or agent run may create a real hold, booking or payment on any provider. Use fixture mode or seeded rows; live checks are anonymous, read-only and minimal.

## Database

**Single source of truth for database initialization and migrations:**

- `src/main/database/connection.ts`

The database file is `<userData>/wa-stay.db` (`app/paths.ts`); the caller passes the path, and `connection.ts` never names a file.

All migrations must be added to the `runMigrations()` function in `connection.ts`. Do NOT create separate migration files or a Database.ts file.

`connection.ts` exports `openDatabase(filePath)` (enables foreign keys and WAL, then migrates), `closeDatabase(db)` and `runMigrations(db)`. It has no module singleton: repositories receive the `Database` through their constructor (`repositories/base.repository.ts`), and services receive their repositories.

### Current migrations (version 10)

1. **v1** — Initial schema (users, bookings, watches, skip_the_queue_entries, notifications, job_logs, settings)
2. **v2** — Add `last_availability` JSON column to watches
3. **v3** — Add `notification_providers` and `notification_delivery_logs` tables
4. **v4** — Add `queue_session` table for DBCA queue persistence
5. **v5** — Add `allow_partial_match` column to watches (the released v1.2.0 schema)
6. **v6** — Add `site_snipes` table (Site Sniper) and widen `notifications` CHECK constraints (adds `snipe_held`/`snipe_booked` types and `snipe` related_type)
7. **v7** — Integrity: rebuild `notifications` without CHECK constraints (types are validated in `NotificationRepository`), rebuild `notification_delivery_logs` with a real FK to `notifications` (repairs v6) and `provider_channel` → `notifier_channel`, rename `notification_providers` → `notifiers`, drop `skip_the_queue_entries`
8. **v8** — Provider-aware data model (architecture-notes §5): rebuild `watches`, `site_snipes` and `bookings` with `provider_id`, generic location/stay/unit columns (`location_external_id`, `location_name`, `area_name`, `num_adults`…, `unit_ids` JSON, `stay_params` JSON for ParkStay's park id, gear type, vehicles and postcode) and calendar dates `YYYY-MM-DD`; bookings unique per `(provider_id, booking_reference)`; `watches.auto_book` (auto-hold) starts at 0, as 1.x never acted on it; `site_snipes` drops the `release_mode` CHECK and renames `queue_enabled` → `access_gate_enabled`, `held_*` → `hold_*`; `notifications.provider_id`; `users` credential columns nullable plus the seeded local profile row (id 1); new `provider_accounts`, `provider_state` (the queue session moves there as `('parkstay', 'queue.session')`, `queue_session` dropped) and `locations` with the FTS5 index `locations_fts`
9. **v9** — Retire the legacy ParkStay credentials (architecture-notes §12.32): rebuild `users` without `encrypted_password` and the `encryption_*` columns (the email moved to the ParkStay account in v8); add `hold_reference`, `hold_expires_at`, `hold_unit_id`, `payment_url` and `last_error` to `watches` (§12.31) and `last_checked_at` to `provider_accounts`; create `maintenance` with a `vacuum-freed-pages` task. The runner sets `secure_delete` on around all steps, then VACUUMs the file (and truncates the WAL) and clears the task, so the dropped ciphertext is not left in free pages; a failed VACUUM is retried at each start while the task stays and the file has free pages
10. **v10** — Drop the never-written `job_logs` table and its indexes (P7, architecture-notes §12.26); any rows it held are counted in the log

### Adding a new migration

1. Open `src/main/database/connection.ts`
2. Bump `LATEST_SCHEMA_VERSION` to the new version N (currently 10)
3. Find the `runMigrations()` function
4. Add a new `if (pending(N))` block at the bottom (`runMigrations(db, target)` stops at `target`; tests use it to build an older schema)
5. Wrap its body in `applyMigration(db, N, [tables it creates or rebuilds], () => { ... })`. It runs the body, `PRAGMA foreign_key_check` and the `INSERT INTO migrations` in one transaction, and throws `MigrationError(N)` on failure. The listed tables must be completely free of foreign-key violations when the step commits, and the step may not introduce a violation in any other table; violations that were already there only log a warning (rule in `assertForeignKeys`). Do not insert the version yourself, and do not set `PRAGMA foreign_keys` inside the body (it is a no-op in a transaction; the runner turns it off around all steps)
6. Rebuild a table as: create it under a temp name → copy → drop the old table → rename the new one → create its indexes. Never rename the old table aside: SQLite then rewrites other tables' foreign keys to the aside name
7. Add an upgrade test that starts from the v5 and v6 fixtures in `tests/fixtures/db/` (see its README)

## Provider SDK

Full guide: `docs/providers/adding-a-provider.md` (a quick start, then the reference, with compiling API (holds and sign-in included) and browser examples in `tests/fixtures/providers/`); browser providers: `docs/providers/browser-providers.md`. ParkStay: `docs/providers/parkstay/README.md`. To add one, follow [Adding a provider](#adding-a-provider).

- **Manifest** (`ProviderManifest`, `src/shared/types/provider.types.ts`): id, names, brand colour and monogram (no third-party logos), `locationKinds`, `timezone`, `currency`, `capabilities` (`catalog`, `catalogMode: 'full' | 'search'`, `availability`, `bulkAvailability`, `watches`, `snipes`, `holds`, `bookingImport`, `accessGate`, `account: 'none' | 'optional' | 'required-for-holds' | 'required'`), `limits` (`minWatchIntervalMinutes`, `maxConcurrentRequests`, `catalogTtlHours`), `stayFields` (generic provider stay inputs, values in `stay_params`), `releaseModes` (Site Sniper), `bulkAvailabilityStayFields` (the bulk cache key). Validated by `ProviderManifestSchema` and frozen.
- **Modules** (`AccommodationProvider`, `src/main/providers/sdk/provider.ts`): `links` always; `catalog` (`listLocations` or `searchArea` per `catalogMode`, optional `searchText`), `availability`, `access` (access gate, `waitingRoomOrigins`), `release`, `holds` (`paymentUrl`, `paymentOrigins`, `bookedReference`), `bookings`, `auth` (`browser-session` implemented; `credentials` and `automation` declared and validated only, §12.30), `dispose`. Made with `defineProvider(manifest, create)`.
- **Context** (`ProviderContext`, `src/main/providers/sdk/context.ts`): `http` (`HttpClient`: `ElectronSessionHttpClient` on `persist:provider-<id>`, shared with the provider's sign-in and payment windows; `NodeHttpClient` in tests; https only, redirects, timeouts, typed errors), `browser` (`PlaywrightBrowserAutomation`: lazy playwright-core, installed `msedge` then `chrome` on Windows, `chromiumSandbox: true`, a persistent profile at `<userData>/providers/<id>/browser`), `state` (`provider_state`), `secrets` (`ScopedSecretVault`), `logger`, `clock`, `timezone`, `limits`. Providers never import `electron`, an HTTP library or the database.
- **Registry** (`src/main/providers/registry.ts`): `register` validates the manifest, the flag rules (`MANIFEST_RULES`) and a module behind every capability (`CONSISTENCY_RULES`); core services use only `get`, `withCapability` and `require` (a missing capability is `ProviderCapabilityError`). Adding a provider = a folder in `src/main/providers/` plus an import and an entry in `BUILT_IN_PROVIDERS` (`src/main/providers/index.ts`), all written by `npm run provider:new`; no change to core, IPC or renderer, and no existing test depends on which providers are built in.
- **Errors** (`src/main/providers/sdk/errors.ts`): `ProviderError` and kinds (capability, HTTP, timeout, parse, auth required, access gate, browser unavailable); `toApiError` maps them to IPC codes.
- **Contract suite:** `describeProviderContract` (`tests/utils/provider-contract.ts`, with search-mode checks); fakes in `tests/utils/fake-provider.ts` (`createFakeProvider`, `createTestProviderContext`, whose browser fails the test unless one is given) and a search-mode one in `tests/utils/fake-search-provider.ts`; recorded responses through `FixtureHttpClient` (`src/main/testing/fixture-http-client.ts`); the fake browser for browser providers (`tests/utils/fake-browser.ts`, jsdom, page scripts run).

## Adding a provider

The checklist for adding an accommodation provider. `.claude/commands/add-provider.md` (`/add-provider`) walks through it, and `AGENTS.md` points other agents here. The reference is `docs/providers/adding-a-provider.md`.

1. **Terms first.** Read the provider's terms of use. If they forbid automated access, the provider gets links only. Prefer its API (look at the site's network panel); use browser automation only when there is none (`docs/providers/browser-providers.md`).
2. **Scaffold:** `npm run provider:new -- <id> [--api|--browser] [--search] [--name "<name>"] [--no-register]` (`scripts/new-provider.mjs`; `--api` is the default, `--search` gives a `catalogMode: 'search'` catalogue with `catalog.searchArea` and an optional `catalog.searchText`). The id is 2–32 lower-case letters, digits or hyphens, starting with a letter, and never changes once shipped. It writes:
   - `src/main/providers/<id>/`: `manifest.ts` (every capability spelled out), `index.ts` (the factory and modules), and `mapping.ts` (API: raw zod shapes and mapping) or `pages.ts` (browser: selectors, page functions, mapping);
   - `tests/integration/<id>-provider.test.ts`: the contract suite and mapping tests;
   - `tests/fixtures/providers/<id>/`: recorded responses and their `manifest.json` routes (API), or `site.ts`, a made-up site for the fake browser (browser);
   - `tests/e2e/fixtures/http/<id>/` (API): the responses the app answers from in fixture mode;
   - the import and the entry in `BUILT_IN_PROVIDERS` (`--no-register` prints them instead).

   As generated it passes the whole gate. Its addresses start empty: until they are set, every call fails with a `ProviderError` naming the constant to set, and nothing is sent.
3. **Implement:** resolve every `TODO`: the addresses, the requests (or the site's paths, labels and attributes), the raw shapes and the provider's words. Record a few public responses, anonymously (never signed in), trimmed, with no personal data, into `tests/fixtures/providers/<id>/` (routes in its `manifest.json`), the ones the app needs into `tests/e2e/fixtures/http/<id>/` (with a provider account, also a signed-out answer for its signed-in check, or the app's check of it is refused and logged), and update the generated test's expectations. Add holds, sign-in (`browser-session` is the only kind implemented) or bulk availability only with their modules; the guide has compiling examples of each.
4. **Test:** `npx jest tests/integration/<id>-provider.test.ts` (the contract suite and the mapping).
5. **Preview in the app** (API providers): `npm run build:e2e`, then `npx cross-env PREVIEW_PROVIDER=<id> playwright test preview-provider` (`xvfb-run -a` on Linux): `tests/e2e/preview-provider.spec.ts` launches the built app in fixture mode with only that provider, checks that Explore lists its places, sets dates (two nights from `PREVIEW_ARRIVAL=YYYY-MM-DD`, by default tomorrow; it warns, without failing, when the responses cover none of the nights, so set it to dates they cover) and checks Explore's free counts (with `bulkAvailability`) and the first place's "Check availability", visits Settings → Accounts, fails on any request fixture mode refused, and attaches screenshots (`npx playwright show-report`). Fixture mode does not serve `ctx.browser`, so a browser provider is previewed by hand against its made-up site on loopback (`scripts/serve-provider-site.mjs`; `docs/providers/browser-providers.md`, "Preview in the app").
6. **Gate:** `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`, then `npm run build:e2e && npm run test:e2e` (`xvfb-run -a` on Linux). All of it, not just the provider's test.

Rules:

- **No live holds, bookings or payments**, in any test, runtime check or trial run (**No live holds** above, architecture-notes §12.33). Tests run on recorded responses (`FixtureHttpClient`) or the fake browser, never the live site; a live look is anonymous, read-only and a handful of requests.
- Everything provider-specific stays in `src/main/providers/<id>/` and its tests and fixtures: no change to core, IPC, renderer or `shared/`. A provider never imports `electron`, an HTTP library or the database.
- Never weaken the contract suite, another test, a lint rule or a coverage threshold to make room. Existing tests do not depend on which providers are built in (the e2e harness registers only ParkStay unless a launch passes `providers`), so a test that fails after registering found a real problem.
- `availability.check` and bulk `availability.search` must work without stay fields (the place page and Explore send none); refusals of a hold are results, not rejections; `isSignedIn` answers `unknown`, never `signed-out`, when it cannot tell; nothing retries in a loop (the core only logs `retryable`).
- No `Co-Authored-By` or AI attribution in commits, code, fixtures or docs.

**Done** means: no `TODO` or placeholder address left; the terms allow what it does; its tests, the full `npm test`, `test:tz` and the e2e suite pass; the preview shows it on Explore (API providers); lint, format and type-check are clean; and no real hold, booking, payment or live-site request happened along the way.

## Key Services

| Service | File | Purpose |
| --- | --- | --- |
| BookingService | `src/main/core/bookings/booking.service.ts` | Booking CRUD on any provider (`CONFLICT` for a reference already stored), `manageUrl`, import through `bookingImport` |
| WatchService | `src/main/core/watches/watch.service.ts` | Availability monitoring through the provider registry (matching in `matching.ts`, partial runs, price rule, `notifyOnly` pause, auto-hold) |
| SiteSniperService | `src/main/core/snipes/snipe.service.ts` | Site Sniper — auto-holds a high-demand site the instant it is released; release and queue rules come from the provider; a scheduled release must be before check-in |
| NightGuard | `src/main/core/holds/night-guard.ts` | One booking per night across snipes and auto-hold watches (DBCA terms) |
| ProviderRegistry | `src/main/providers/registry.ts` | Accommodation providers behind the SDK in `providers/sdk/` (manifests, capability checks); built-ins listed in `providers/index.ts` |
| LocationCatalogService | `src/main/core/catalog/location-catalog.service.ts` | Every provider's locations (`catalog.*`): 24 h catalogue sync of `full` catalogues into `locations` (single-flight, per-provider failure isolation, `catalog:updated`); `search` catalogues are searched instead, by the map area a `catalog.search` carries (`searchArea`, snapped by `src/shared/utils/catalog-area.ts`, at most 5 pages, once per area per `catalogTtlHours`) and by its text (`searchText`, optional), in the background, with what they find stored and never removed; FTS5 search with filters and facets, 6 h detail cache with stale fallback, bulk and per-location availability caches |
| ProviderAccountService | `src/main/core/accounts/provider-account.service.ts` | The person's account with each provider (`accounts.*`): status from the provider's signed-in check (single flight, 60 s cache (5 s for an answer that was not definite), definite answers only), in-app sign-in, pasted sign-in links, sign-out (`ACCOUNT_BUSY` while a snipe or hold needs the session), `ensureForHolds` for providers that require an account |
| HoldPaymentService | `src/main/core/holds/hold-payment.service.ts` | Pays for a snipe's or watch's hold in a payment window on the provider's partition (`snipes.openPayment`, `watches.openPayment`; `HOLD_EXPIRED`): passes the provider's queue first (60 s bound); a page the provider's `holds.bookedReference` takes as this hold's confirmation (ParkStay: `/success/` with the hold's `checkouthash`, showing its `PB` number, read with find-in-page) marks it booked and records the confirmed booking in one transaction |
| DocumentWindows | `src/main/app/document-windows.ts` | A location's document (ParkStay's campground map, a PDF) in Electron's PDF viewer (`catalog.openDocument`): sandboxed, no preload, `plugins` for this window only, an in-memory partition of its own (`documents-<providerId>`), the top level locked to the document's URL, downloads only the viewer's own, permissions/certificates/new windows refused; a non-PDF answer closes it with `PROVIDER_ERROR`; a second open focuses it. Fixture mode serves it from the provider's fixtures (`src/main/testing/fixture-documents.ts`) |
| ProviderWindows | `src/main/app/provider-windows.ts` | Provider sign-in and payment windows on the provider's session partition (`persist:provider-<id>`, shared with its HttpClient): sandboxed, no script of ours, top-level origin allow-list, permissions/certificates refused; shown when ready or after 1.5 s; a blocked or failed first page closes the window with `PROVIDER_ERROR`; back to the target page after the provider's waiting room (`access.waitingRoomOrigins`) |
| ParkStay provider | `src/main/providers/parkstay/` | The ParkStay (DBCA) module: catalogue (a campground's About sections and notices from its campground page, `campground-page.ts`, and its campground map document from the availability view's `map`), availability (YYYY/MM/DD dates, per-night prices, class-listed campgrounds), DBCA queue access gate (`queue/`), release policy, `create_booking` holds, links, and sign-in (`auth.ts`: `/ssologin`, checked with `/api/profile`; the account is optional, §12.32). Endpoints and their verification status: `docs/providers/parkstay/endpoints.md` |
| NotificationService | `src/main/core/notifications/notification.service.ts` | Desktop/in-app notifications (desktop title `{shortName} · {title}`; Settings → Notifications preferences) |
| NotificationDispatcher | `src/main/core/notifications/notification-dispatcher.ts` | External notifiers (email) and their delivery logs |
| SecretVault | `src/main/security/secret-vault.ts` | Every stored secret ([below](#secrets)) |
| Legacy install migration | `src/main/migration/legacy-install.ts` | First start after a 1.x upgrade: copies `<appData>/parkstay-bookings` (or the installer's `legacy-snapshot`) into `<appData>/WA Stay`, `migration.json`, welcome notice, launch at login re-registered |
| AutoUpdaterService | `src/main/services/updater/auto-updater.service.ts` | Auto-updates via GitHub Releases (`wilsonwaters/wa-stay`), checked 15 s after start, never downloaded without the user |
| JobScheduler | `src/main/scheduler/job-scheduler.ts` | Watch due-loop (`next_check_at`, 2 per provider) + per-snipe timer chains (generation token, abort) + the retention job (`retention-job.ts`: notifications and delivery logs older than the main-only `retention.*` settings, 30 days by default, deleted in batches 5 min after start and daily at 02:00 Perth); re-arms on resume; bounded `stop()` on quit |

## Secrets

- **SecretVault** (`src/main/security/secret-vault.ts`) encrypts every stored secret as a versioned envelope `vault:v1:<backend>:<base64>`: backend `os` is Electron `safeStorage` (DPAPI, Keychain, a Linux keyring); `local` is AES-256-GCM with a random key in `<userData>/secret-vault.key`, used only when OS encryption is unavailable (or Linux `basic_text`). Unreadable secrets throw `SecretUnreadableError`, never decrypt to `''`. The vault is lazy and refuses use before `ready`; its first use comes after userData is final (§12.23).
- **Notifier configs** (`notifiers.config`) are stored as vault envelopes by `NotifierRepository` (it takes the vault). The SMTP password is **write-only over IPC**: responses are `NotifierView`s with `hasPassword` instead (`core/notifications/notifier-view.ts`), and `configure` with an empty password keeps the stored one only for the same host, port and user.
- **Provider secrets** go through `ctx.secrets` (`ScopedSecretVault`, `providers/sdk/secrets.ts`): envelopes in the provider's `provider_state` under `secret:<key>`, sealed to that provider and key.
- **Legacy secrets:** `migrateLegacySecrets` (`security/legacy-migration.ts`) re-encrypts v1.x notifier configs once, verified before replacing. The v1.x ParkStay password is dropped by migration v9 (only the email is kept); `removeRetiredGmailStore` deletes any `gmail-oauth.json` in the WA Stay folder (Gmail OTP removed in P7).
- Secret crypto lives only in `src/main/security/` (`tests/unit/lint/secret-crypto-boundary.test.ts`). Logs never carry secrets, cookies, sign-in links or the DBCA queue key. Details: `docs/security.md`.

## Notification System

- `NotificationService` handles desktop/in-app notifications
- `NotificationDispatcher` sends to external **notifiers** (email, etc.). "Notifier" is the outbound channel; a "provider" is an accommodation source (architecture-notes §2)
- Notifiers are in `src/main/core/notifications/notifiers/` (`BaseNotifier`), built in `app/container.ts` and passed to the dispatcher
- Notifier configs (`notifiers` table, `NotifierRepository`) are SecretVault envelopes ([Secrets](#secrets)); the password never goes back to the renderer
- Email SMTP notifier: `notifiers/email-smtp.notifier.ts` (`SmtpEmailNotifier`; Gmail, Outlook and custom presets)
- Notifications carry `provider_id`; the stored title has no provider prefix (§12.31). Old notifications and delivery logs are deleted by the retention job

## IPC Pattern

- **Contract** in `src/shared/contracts/` is the single source of truth: one file per namespace, and `index.ts` exports `contract` and `type WindowApi`. Each method declares a `channel` (`<namespace>:<kebab-method>`), a zod `request` schema (one object payload, or `z.void()`), the preload's positional `args` and the `response` type
- Channel and event names live in the zod-free `contracts/channels.ts`, the only contract module the preload loads at runtime. Event payloads are in `contracts/events.ts`
- `src/main/ipc/handle.ts`: `handle(def, fn)` is the only caller of `ipcMain.handle`. It checks the sender (a trusted webContents, its top frame, on the app origin — `ipc/sender-guard.ts`, `app/renderer-entry.ts`), parses the payload with the method's schema, and returns `APIResponse`: `{ success: true, data }` or `{ success: false, code, error }`. Throw `AppError(code)` (`main/utils/app-error.ts`) for a specific code. Logs never include payload values
- **Error codes** (`ApiErrorCode`, `src/shared/types/api.types.ts`): `VALIDATION` (plus `issues` paths), `FORBIDDEN`, `NO_PROFILE`, `NOT_FOUND`, `CONFLICT` (it already exists, e.g. a booking reference), `INTERNAL`, `NOT_IMPLEMENTED`; for provider errors (`main/providers/sdk/errors.ts` `toApiError`) `CAPABILITY`, `UNKNOWN_PROVIDER`, `PROVIDER_ERROR`, `ACCESS_GATE`, `RATE_LIMITED` (the provider answered HTTP 429; never auto-retried) and `AUTH_REQUIRED`; plus `ACCOUNT_BUSY` (sign-out refused) and `HOLD_EXPIRED` (no hold left to pay for)
- Handlers in `src/main/ipc/handlers/`, one file per namespace (`watches.handlers.ts`, …), each `registerXHandlers(handle, container)`; `registerIpcHandlers(container, { isTrustedSender })` in `ipc/index.ts` registers them all
- Events: main emits through `container.rendererEvents.emit(name, payload)` (`ipc/events.ts`), which reaches only trusted webContents. The renderer subscribes with `window.api.events.on(name, cb)`, which returns an unsubscribe function for that subscription only
- Settings keys are typed in `contracts/settings.ts` (`SETTING_KEYS`): main owns each key's `valueType` and `category`; add new keys there
- Exposed to renderer via `src/preload/index.ts`, which implements `WindowApi`; `src/preload/window.d.ts` types `window.api`. `scripts/build-preload.js` bundles it into `dist/preload/index.js` for the `sandbox: true` window and fails the build if it imports anything but `electron`. In the renderer only `src/renderer/api/` touches `window.api` (`tests/unit/renderer/api-boundary.test.ts`)
- Adding a method: add the channel to `channels.ts`, the definition to the namespace file, a handler with `handle()`, and the payload mapper in the preload. The parity tests fail until all four agree

| Namespace | Methods | Notes |
| --- | --- | --- |
| `providers` | `list`, `accessStatus` | Manifests; the DBCA queue state reaches the renderer only here and as `provider:access-status` |
| `catalog` | `search`, `get`, `availability`, `checkLocation`, `refresh`, `status`, `openDocument` | `CatalogQuery` (`text`, filters, `bbox`); `availability` is bulk per provider, `checkLocation` one location and stay; `openDocument` opens a location's document (the campground map) in a document window, by key and document id: main takes the address from the cached detail |
| `accounts` | `list`, `status`, `signIn`, `signOut`, `openSignInLink` | Provider accounts and the in-app sign-in window |
| `watches` | `list`, `get`, `create`, `update`, `delete`, `activate`, `deactivate`, `runNow`, `openPayment` | |
| `snipes` | `list`, `get`, `create`, `update`, `delete`, `activate`, `deactivate`, `runNow`, `openPayment` | |
| `bookings` | `list`, `get`, `create`, `update`, `delete`, `import` | `import` needs `bookingImport` |
| `notifications` | `list`, `markRead`, `markAllRead`, `unreadCount`, `delete`, `clearAll` | |
| `notifiers` | `list`, `get`, `configure`, `enable`, `disable`, `test` | Email SMTP; the password is write-only |
| `settings` | `get`, `set`, `getAll` | Typed keys; some are main-only |
| `app` | `getInfo`, `openLogsFolder`, `setAutoLaunch`, `getAutoLaunch` | `getInfo` includes the secret-storage backend |
| `updater` | `checkForUpdates`, `downloadUpdate`, `installUpdate`, `getStatus` | |
| `events` | `on(name, cb)` → unsubscribe | `notification:created`, `watch:updated`, `snipe:updated`, `booking:updated`, `catalog:updated`, `provider:access-status`, `account:updated`, `app:navigate`, `updater:available`, `updater:not-available`, `updater:downloaded`, `updater:progress`, `updater:error` |

## UI Status

- **No login gate.** The app opens on **Explore** (`/`), the home screen: search pill (Where, When, Who), filter chips, results list and the Mapbox map (list-only without a token), with bulk availability for the chosen dates. A place's page is `/places/:providerId/:externalId`
- **Top navigation:** Explore, Watches, **Site Sniper** and **Bookings**; the last two carry a "Soon" pill (stakeholder decision) but are fully navigable and show a `ComingSoonBanner` on the page. **Settings** is in the account menu, with the notifications bell beside it
- **Routes** (`src/renderer/app/routes.ts`, §12.10): `/`, `/places/:providerId/:externalId`, `/watches`, `/watches/new`, `/watches/:id`, `/watches/:id/edit`, `/site-sniper`, `/site-sniper/new`, `/site-sniper/:id`, `/bookings`, `/bookings/:id`, `/settings/:section?`; create flows take the prefill query `?provider=&location=&arrival=&departure=&adults=&children=`; `/__design` (dev only)
- **Settings** (`features/settings/`, `/settings/:section`): Accounts (one row per provider: connect in the in-app sign-in window, sign out, pasted sign-in link; ParkStay's account is optional), Notifications (desktop and sound switches, the email notifier with a write-only password and "Send test email"), App (launch at login on Windows and macOS, start minimised to the taskbar) and About. Typed settings are `SETTING_KEYS`; `launchOnStartup` and `app.startMinimised` are main-only (written by `app.setAutoLaunch`)
- **Every watch, snipe, booking, notification and location shows its provider** (`ProviderBadge`); every create flow starts with a provider step, pre-selected when one provider qualifies (§12.9)
- **Key components:** `components/ui/` primitives (Button, Dialog, Combobox, Menu, Popover, Switch, RadioCard, Stepper, Chip, ProviderBadge, … — `docs/design/components.md`); shared blocks StepFlow, ProviderPicker, LocationCombobox, ProviderStayFields, UnitPicker, NightGrid, LocationCard, PlacePhoto, Countdown, ConnectAccountPrompt, ComingSoonBanner; shell and system surfaces TopNav, AccountMenu, Tray, NotificationBell, AccessStatusChip, UpdateCard, AboutPanel/AboutDialog, Logo (`components/brand/Logo.tsx`)
- Renderer rules (§8): data only through `renderer/api/` hooks; UI only from `components/ui` and design tokens (`tests/unit/design/token-guard.test.ts`); lucide icons, no emoji; tests assert roles and accessible names, never class names

## Testing

- **Framework:** Jest 30 (unit/integration), Playwright (Electron E2E)
- **Config:** `jest.config.js` — two projects: `main` (Node: `tests/unit`, `tests/integration`, `tests/scripts`, `src/main`, `src/shared`) and `renderer` (jsdom: `src/renderer`, `tests/integration/renderer`); coverage thresholds (a ratchet just below actual coverage): branches 85%, functions 90%, lines 93%, statements 92%; dependencies that ship only ES modules (htmlparser2 and its packages, React Router 8) are compiled to CommonJS by esbuild (`ESM_ONLY_DEPENDENCIES`, `tests/utils/esm-to-cjs-transform.js`), with patterns that accept `/` and `\` (`tests/unit/build/jest-config.test.ts`)
- **Test locations:** `tests/unit/`, `tests/integration/`, `tests/e2e/`, `tests/electron/`, `tests/docs/`, plus co-located `*.test.tsx` in `src/`
- **Fixtures:** `tests/fixtures/` (users, bookings, watches, site-sniper, `parkstay/` trimmed live samples, `providers/` the provider guide's example providers, and `db/` schema dumps for migration tests)
- **Helpers:** `tests/utils/` (database-helper, test-helpers, core-harness, fake-provider, provider-contract, ipc-harness, parkstay-fixture-server, fake-browser (a jsdom browser for provider tests), fake-site (how a made-up site answers, and `serveFakeSite` on loopback for a real browser), fake-playwright, fake-safe-storage, `tests/utils/tailwind.ts` (the real stylesheet compiled through Tailwind, for CSS tests), `renderer/` render helpers and a strict mock `window.api`)
- **`npm run test:tz`:** the timestamp tests with `TZ=Australia/Perth` (unzoned SQLite timestamps must read as UTC)
- **Electron smoke E2E** (`tests/e2e/`, `npm run build:e2e && npm run test:e2e`, `xvfb-run -a` on Linux): 22 journeys in 11 specs on the built app via Playwright's `_electron` (plus two opt-in checks: `explore-resize.spec.ts`'s map, `E2E_MAP=1` on a build with a Mapbox token, and `preview-provider.spec.ts`, which previews the provider `PREVIEW_PROVIDER` names, availability for dates included). The harness (`tests/e2e/support/wa-stay.ts`) gives each launch a temp userData (checked), fixture mode (`tests/e2e/fixtures/http/`), a production renderer with no Mapbox token, Perth time, a window forced online (`forceOnline`), seeding before launch (`support/seed.ts`) and temp folders (`tempDir`); failed tests get a trace, screenshot and logs. Role and name selectors only. CI's `e2e` job (report always uploaded). Details: `tests/README.md`
- **`npm run test:electron`:** live Electron tests of `ElectronSessionHttpClient`, the ParkStay module, the provider windows and the document windows, against loopback servers
- **`npm run smoke:packaged`:** CI's `packaged-smoke` job packages Linux (`electron-builder --linux dir`) and checks that `app.asar` ships no `.d.ts` or `.map` under `dist/`, an integrity hash for every packed file and exactly one better-sqlite3 binary (the build machine's `${platform}-${arch}`, so each OS packages its own target), reads the Electron fuses back (`@electron/fuses`), starts the executable as shipped (it must ignore `--inspect`), and checks that the package, and a copy renamed `electron` (both with only the inspector fuse turned back on, for Playwright), ignore the test hooks and quit cleanly. `build.yml` checks the Windows exe's fuses, asar integrity record and binary with the same helpers (`scripts/check-windows-package.js`)
- **Docs tests** (`tests/unit/docs/`): every relative link and image in the docs resolves with alt text, the backticked paths of CLAUDE.md, `AGENTS.md` and the agent commands exist, the provider guide's code blocks equal their source regions, the example providers compile, register and pass the contract suite, the guide's core timeouts match the code, provider docs carry no internal plan references, and every ParkStay endpoint has a verification status
- **Scaffold test** (`tests/scripts/new-provider.test.ts`): `npm run provider:new` generates an API provider, a browser provider and a search-mode catalogue of each into a temp copy of the project; each type-checks, lints, is formatted and passes its own generated tests
- **Guards:** `tests/unit/providers/no-loopback-addresses.test.ts` (no provider source names a loopback address, so a browser preview's address cannot ship), `tests/unit/renderer/api-boundary.test.ts`, `tests/unit/design/token-guard.test.ts`, `tests/unit/brand/branding-guard.test.ts` (the old app name only on lines marked `legacy-name-ok`), `tests/unit/lint/secret-crypto-boundary.test.ts`

## Release Process

Windows-only. Full details in `docs/release-process.md` (and the manual `docs/release-checklist-2.0.md` for 2.0.0).

```bash
# 1. Verify locally
npm run lint && npm run format:check && npm run type-check && npm run test && npm run test:tz

# 2. Bump the version (package.json and the lockfile only)
npm version minor --no-git-tag-version   # or patch / major (major for 2.0.0)

# 3. CHANGELOG.md: rename [Unreleased] to [x.y.z] - date (do not regenerate it), commit, tag, push
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: prepare release vX.X.X"
git tag vX.X.X
git push origin main --tags
```

Pushing a `v*` tag triggers `.github/workflows/build.yml`: **ci** (type-check, lint, test, test:tz) -> **build-windows** (electron-builder, with `MAPBOX_ACCESS_TOKEN`) -> **release** (draft GitHub release with artifacts). Go to GitHub Releases to publish the draft. Publishing target: `wilsonwaters/wa-stay` (`electron-builder.json`); the repository must be renamed before 2.0.0 is published, and `parkstay-bookings` never recreated (v1.x installs update through the redirect).

Key scripts: `npm run dist:win` (local test build), `npm run release:win` (build + publish).

## Pre-Commit Checklist

Before committing any changes, **always** run these checks and fix any failures:

1. `npm run lint` — ESLint must pass with 0 errors (warnings are acceptable)
2. `npm run format:check` — Prettier formatting must pass; run `npm run format` to fix
3. `npm run type-check` — TypeScript must compile without errors
4. `npm run test` — All unit/integration tests must pass

Do NOT commit code that fails any of these checks. CI enforces all four.

## Git & PR Conventions

- Do NOT add `Co-Authored-By` trailers to commit messages.
- Do NOT add AI attribution lines to pull request descriptions.

## Further Reading

- `docs/README.md` — the documentation index
- `docs/architecture/overview.md` — processes, layout, start-up, the provider diagram, the data model, security, the upgrade path
- `docs/providers/adding-a-provider.md` — the provider guide; `docs/providers/parkstay/` — the ParkStay module, endpoints and sign-in
- `docs/development.md` — setup, scripts and tests; `tests/README.md` — the test suites in detail
- `docs/watches-and-notifications.md`, `docs/site-sniper.md` — feature deep-dives
- `docs/security.md` — secret storage and provider windows
- `docs/release-process.md` — releasing; `docs/release-checklist-2.0.md` — the manual 2.0 checks
- `docs/design/` — design language, components, shell, map
