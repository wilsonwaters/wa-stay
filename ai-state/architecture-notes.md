# Architecture Notes — WA Stay (binding for all streams)

These are front-loaded decisions. Planning and implementation agents must conform to them. To change one, raise it in OPEN-QUESTIONS.md. Do not drift.

## 1. Target source layout

```
src/
├── main/
│   ├── app/                 # composition root & Electron shell concerns
│   │   ├── container.ts     # builds every service once; the only place `new` is called for services
│   │   ├── main-window.ts   # BrowserWindow creation, CSP, window-open/navigation guards
│   │   ├── single-instance.ts
│   │   └── paths.ts         # userData / db path resolution (WA Stay), legacy paths
│   ├── core/                # provider-agnostic domain services (no provider-specific code)
│   │   ├── catalog/         # LocationCatalogService (sync, search, detail, bulk availability)
│   │   ├── watches/         # WatchService
│   │   ├── snipes/          # SiteSniperService (generic orchestration; release rules come from provider)
│   │   ├── bookings/        # BookingService
│   │   ├── accounts/        # ProviderAccountService (sign-in windows, status)
│   │   └── notifications/   # NotificationService, NotificationDispatcher, notifiers/ (email-smtp, …)
│   ├── providers/
│   │   ├── sdk/             # AccommodationProvider interface, ProviderContext, HttpClient, BrowserAutomation, errors
│   │   ├── registry.ts      # ProviderRegistry (register, get, list manifests, capability queries)
│   │   ├── index.ts         # registers built-in providers: [parkstay]
│   │   └── parkstay/        # ParkStay module — everything DBCA/ParkStay-specific lives here
│   │       ├── index.ts     # manifest + factory
│   │       ├── client.ts    # HTTP calls (dates YYYY/MM/DD, Referer, browser UA)
│   │       ├── catalog.ts   # /api/campground_map/ → ProviderLocation[]
│   │       ├── availability.ts  # bulk + per-campground availability → normalised NightStatus
│   │       ├── queue/       # DBCA virtual queue (access gate)
│   │       ├── release-policy.ts # daily rollover / scheduled / cancellation
│   │       ├── holds.ts     # /api/create_booking temporary hold + payment hand-off URL
│   │       ├── auth.ts      # browser-session sign-in definition
│   │       └── types.ts     # raw ParkStay response types (never exported to shared/)
│   ├── database/
│   │   ├── connection.ts    # ONLY place for schema + migrations (CLAUDE.md rule)
│   │   └── repositories/    # one BaseRepository style: injected `Database`, parameterised SQL only
│   ├── ipc/
│   │   ├── handle.ts        # typed handle(channel, zodSchema, fn) + sender validation + APIResponse mapping
│   │   └── handlers/        # one file per namespace
│   ├── scheduler/           # JobScheduler (watch cron + precise snipe timers)
│   ├── security/            # SecretVault (safeStorage), legacy decryptors
│   ├── migration/           # legacy-install.ts (ParkStay Bookings → WA Stay first-run migration)
│   └── utils/               # logger, dates (calendar-date helpers), etc.
├── preload/                 # bundled & sandboxed; exposes window.api (typed from shared contract)
├── renderer/
│   ├── app/                 # App shell, routes, top navigation, providers/query client
│   ├── api/                 # React Query hooks wrapping window.api (the only place window.api is touched)
│   ├── components/ui/       # design-system primitives (Button, Dialog, Field, ProviderBadge, …)
│   ├── components/          # shared domain components (LocationCard, AvailabilityGrid, …)
│   ├── features/            # explore/, watches/, snipes/, bookings/, settings/, notifications/
│   └── styles/
└── shared/
    ├── contracts/           # IPC contract: channel names + request/response types + zod schemas per namespace
    ├── types/               # domain types (provider.types.ts, catalog.types.ts, watch.types.ts, …)
    ├── constants/
    └── utils/               # pure helpers shared by both sides (calendar dates, formatting)
```

Existing files move into this layout as their stream touches them. Do not leave a duplicate behind: move, update imports, delete the old file.

## 2. Vocabulary (use these words in code, DB and UI)

| Term | Meaning | ParkStay mapping |
|---|---|---|
| **Provider** | An accommodation source module (`parkstay`, later `rac`, `airbnb`, …) | ParkStay (DBCA) |
| **Location** | A bookable place shown on the map: campground, holiday park, property | Campground |
| **Area** | The parent grouping of a location: park, town or region | Park (+ district/region) |
| **Unit** | An individually bookable thing at a location: site, cabin, room | Campsite |
| **Stay** | The dates and party: `arrival`, `departure` (calendar dates `YYYY-MM-DD`), guests | — |
| **Watch** | Recurring availability check with notifications | same |
| **Snipe** | Timed attempt to hold a unit the instant it is released ("Site Sniper" in UI) | same |
| **Hold** | Temporary reservation pending payment on the provider's site | 30-min ParkStay hold |
| **Notifier** | Outbound notification channel (email SMTP, …). Was "notification provider". | — |
| **Location key** | `${providerId}:${externalId}`, the globally unique location id | `parkstay:123` |

## 3. Provider SDK contract (V1 implements; everyone codes against it)

```ts
// shared/types/provider.types.ts  (serialisable — crosses IPC)
type ProviderId = string;                     // validated against the registry; never a hard-coded union
interface ProviderManifest {
  id: ProviderId;                             // 'parkstay'
  name: string;                               // 'ParkStay WA'
  shortName: string;                          // 'ParkStay'
  description: string;                        // one line, shown in provider pickers
  website: string;                            // https://parkstay.dbca.wa.gov.au
  integration: 'api' | 'browser' | 'hybrid';
  brand: { color: string; monogram: string }; // ProviderBadge: coloured monogram (no third-party logos)
  locationKinds: LocationKind[];              // e.g. ['campground']
  timezone: string;                           // 'Australia/Perth'
  capabilities: ProviderCapabilities;
}
interface ProviderCapabilities {
  catalog: boolean;            // listLocations → shows on Explore map
  availability: boolean;       // check availability for one location + stay
  bulkAvailability: boolean;   // availability for many locations in one call (map pins)
  watches: boolean;            // usable in Watches
  snipes: boolean;             // usable in Site Sniper (requires release policy + holds)
  holds: boolean;
  bookingImport: boolean;
  account: 'none' | 'optional' | 'required-for-holds' | 'required';
}
type LocationKind = 'campground' | 'caravan-park' | 'holiday-park' | 'cabin' | 'hut' | 'glamping' | 'farm-stay' | 'home' | 'other';
type BookingMode = 'online' | 'offline' | 'external' | 'application';
interface LocationSummary {
  key: string; providerId: ProviderId; externalId: string;
  name: string; kind: LocationKind; bookingMode: BookingMode;
  lat: number; lng: number;
  area?: { name: string; region?: string };
  summary?: string; imageUrls: string[]; amenities: string[];
  unitCount?: number; infoUrl?: string; bookingUrl?: string;
}
interface LocationDetail extends LocationSummary {
  descriptionHtml?: string;   // sanitised in main before crossing IPC
  units: UnitSummary[];
  releaseInfo?: string;       // human sentence, e.g. "Bookings open 180 days ahead at midnight AWST"
}
interface StayQuery { arrival: string; departure: string; adults: number; children?: number; infants?: number; concessions?: number; equipment?: string }
type NightState = 'available' | 'booked' | 'closed' | 'not-released' | 'unknown';
interface NightStatus { date: string; state: NightState; price?: number; label?: string }
interface UnitAvailability { unitId: string; unitName: string; unitType?: string; nights: NightStatus[]; fullyAvailable: boolean; total?: number }
interface LocationAvailability { key: string; checkedAt: string; units: UnitAvailability[]; release?: { opensAt?: string; open: boolean } }
interface BulkAvailabilityEntry { key: string; availableUnits: number; bookableUnits: number }
```

```ts
// main/providers/sdk/provider.ts  (main-process only)
interface AccommodationProvider {
  readonly manifest: ProviderManifest;
  catalog?: { listLocations(signal?): Promise<LocationSummary[]>; getLocation(externalId, signal?): Promise<LocationDetail> };
  availability?: { check(externalId, stay, opts?: { unitIds?: string[]; signal? }): Promise<LocationAvailability>;
                   search?(stay, signal?): Promise<BulkAvailabilityEntry[]> };
  access?: AccessGate;          // waiting room / virtual queue (ParkStay: DBCA queue)
  release?: ReleasePolicy;      // when units for a date become bookable (ParkStay: 180-day rollover, Ningaloo)
  holds?: { create(req: HoldRequest, signal?): Promise<HoldResult>; paymentUrl(hold: HoldResult): string };
  bookings?: { list?(): Promise<ExternalBooking[]>; get?(reference): Promise<ExternalBooking> };
  auth?: ProviderAuth;          // { kind: 'browser-session'; signInUrl; isSignedIn(session): Promise<AccountStatus>; accountLabel?(...) }
  links: { location(externalId): string | null; booking(externalId, stay?): string | null };
  dispose?(): Promise<void>;
}
type ProviderFactory = (ctx: ProviderContext) => AccommodationProvider;
interface ProviderContext {
  id: ProviderId;
  http: HttpClient;             // bound to Electron session partition `persist:provider-<id>`; cookies shared with sign-in + payment windows
  browser: BrowserAutomation;   // lazy playwright-core (installed Edge/Chrome), persistent profile at userData/providers/<id>/browser
  state: KeyValueStore;         // provider_state table, namespaced by provider
  secrets: ScopedSecretVault;   // safeStorage-backed, namespaced by provider
  logger: Logger;               // child logger { provider: id }
  clock: () => Date;
}
```

- `HttpClient` is an interface with two implementations. `ElectronSessionHttpClient` is used in production (`session.fromPartition('persist:provider-<id>').fetch`, verified available in Electron 28). `NodeHttpClient` is used in tests and has an in-memory cookie jar. Provider code never imports `electron` or `axios` directly.
- Core services only ever do `registry.get(providerId)` and check `manifest.capabilities` or the presence of the optional module. A missing capability is a typed `ProviderCapabilityError`, never a crash.
- Adding a provider = create `src/main/providers/<id>/`, export a factory, and add one line to `providers/index.ts`. No changes to core, IPC or renderer.

## 4. IPC / preload surface (renderer sees only this)

`window.api` namespaces. Each method returns `Promise<APIResponse<T>>` and request payloads are zod-validated in main.

| Namespace | Methods (indicative) |
|---|---|
| `providers` | `list()` → `ProviderManifest[]`; `accessStatus(id)` |
| `catalog` | `search(CatalogQuery)` → `{ items: LocationSummary[], total }`; `get(key)` → `LocationDetail`; `availability(stay, { providerIds?, bbox? })` → `BulkAvailabilityEntry[]`; `checkLocation(key, stay)` → `LocationAvailability`; `refresh(providerId?)`; `status()` |
| `accounts` | `list()` → `ProviderAccount[]`; `signIn(providerId)` (opens in-app window, resolves when signed in or closed); `signOut(providerId)`; `status(providerId)` |
| `watches` | `list(filter?: { providerId? })`, `get`, `create`, `update`, `delete`, `activate`, `deactivate`, `runNow` |
| `snipes` | `list(filter?)`, `get`, `create`, `update`, `delete`, `activate`, `deactivate`, `runNow`, `openPayment(id)` |
| `bookings` | `list(filter?)`, `get`, `create`, `update`, `delete`, `import(providerId, reference)` |
| `notifications` | `list`, `markRead`, `markAllRead`, `delete`, `clearAll`, `unreadCount` |
| `notifiers` | email/SMTP notifier config (was `notificationProvider`). Secrets are write-only and return `hasPassword: boolean`. |
| `gmail` | OAuth connect/disconnect/status (no inbox reads exposed) |
| `settings`, `app`, `updater` | as today, cleaned up |
| `events` | `on(event, cb)` → `unsubscribe()`. Events: `notification:created`, `watch:updated`, `snipe:updated`, `booking:updated`, `catalog:updated`, `provider:access-status`, `account:updated`, `updater:*` |

- `userId` is never passed from the renderer. Main resolves the single local profile.
- Secrets never cross to the renderer.
- Channel names live in `shared/contracts/`. The preload is generated or typed from the same contract, so the renderer and main cannot drift.

## 5. Data model (migrations in `connection.ts`)

- **v7 (P2): integrity.** Rebuild `notification_delivery_logs` with an FK to `notifications`. Drop the `notifications` CHECK constraints (validate in code). Drop the dead `skip_the_queue_entries` table and trigger. Wrap migrations in transactions. Add a `PRAGMA foreign_key_check` assertion in tests.
- **v8 (V2): provider-aware.**
  - `watches`, `site_snipes` and `bookings` gain `provider_id TEXT NOT NULL DEFAULT 'parkstay'` and generic location columns (`location_external_id`, `location_name`, `area_name`, `unit_ids` JSON, `stay_params` JSON for provider-specific extras such as gear type and postcode). Existing ParkStay columns map into these with no data loss.
  - `bookings` becomes unique on `(provider_id, booking_reference)`.
  - `notifications` gains nullable `provider_id`.
  - New `provider_accounts(provider_id PK, status, display_name, email, last_signed_in_at, created_at, updated_at)`. The existing `users` row migrates into the `parkstay` account; the profile (name, phone) is kept.
  - New `provider_state(provider_id, key, value JSON, updated_at, PK(provider_id,key))`. `queue_session` migrates into it.
  - New `locations(provider_id, external_id, name, kind, booking_mode, lat, lng, area_name, region, summary, description_html, image_urls JSON, amenities JSON, unit_count, info_url, booking_url, raw JSON, fetched_at, PK(provider_id, external_id))` plus an FTS5 `locations_fts(name, area_name, region, summary)`.
  - Calendar dates are stored as `YYYY-MM-DD` text.
- Migrations must be idempotent, transactional, and covered by a test that starts from a real v6 database fixture.

## 6. Upgrade path (B-stream)

- `appId` stays `com.parkstay.bookings`. `productName` becomes `WA Stay` and package `name` becomes `wa-stay`.
- `app.setPath('userData', <appData>/WA Stay)` is called before `ready`. On first run, if the new DB is absent and the legacy `<appData>/parkstay-bookings/parkstay.db` exists, it is copied with better-sqlite3 `backup()` to `<userData>/wa-stay.db`. (P7 amendment: `gmail-oauth.json` is no longer copied; WA Stay deletes any copy in its own folder, and the v1 folder keeps its file.) A `migration.json` marker is written. The legacy folder is left untouched.
- The installer removes legacy `WA ParkStay Bookings` shortcuts. Uninstall data cleanup targets `WA Stay`.
- Auto-launch is re-registered under the new name and the legacy entry is removed.
- Publish target is `wilsonwaters/wa-stay`. v1 clients reach it through GitHub's rename redirect.

## 7. Security baseline (P-stream)

- `sandbox: true` with a bundled preload, `contextIsolation: true`, a CSP (dev and prod variants), a `setWindowOpenHandler` that denies and opens http(s) links via `shell.openExternal`, `will-navigate` blocking, single-instance lock, and IPC sender-frame validation.
- Provider sign-in and payment windows use the provider partition, have no preload and no node integration, and are restricted to the provider's origins plus its identity provider.
- Secrets live in `SecretVault` (`safeStorage`, versioned envelope). Legacy PBKDF2 ciphertexts are decrypted once and re-encrypted.

## 8. Renderer conventions

- Data access goes only through `renderer/api/*` hooks (React Query). Components never call `window.api` directly.
- UI is built only from `components/ui` primitives and design tokens (no raw hex, no `bg-blue-600`).
- Icons come from `lucide-react` (stroke 1.75). No emoji as icons.
- Every list or detail item for a watch, snipe, booking, notification or location renders a `<ProviderBadge providerId>`.
- Create flows start with a **provider step** that lists `providers.list()` filtered by the capability the flow needs. If exactly one provider qualifies it is pre-selected but still shown.
- Navigation: **Explore** (home `/`), **Watches**, **Site Sniper** (Soon pill), **Bookings** (Soon pill), then **Settings** in the account menu. No login gate.
- Tests assert behaviour, roles and accessible names, never CSS class names.

## 9. Design direction (D1 elaborates in `docs/design/`)

- **Reference:** Airbnb's calm, photo-first layout, a centred search pill, and map plus list split. The WA mood comes from the stakeholder's tourism mark: **Indian Ocean blue** brushstroke, **sun gold**, **black-swan ink**, **coral** beak. Add warm **sand** neutrals and **eucalypt** green for "available".
- **Not AI-looking:** no purple/indigo gradients, no glassmorphism, no emoji, no rainbow buttons, no generic three-feature-card heroes. Use one accent CTA colour, generous whitespace, real photography, restrained motion, and a distinctive but sparing hand-drawn brushstroke motif (e.g. under the active nav item and in the logo).
- **Type:** **Figtree** for UI and **Fraunces** for display, used sparingly (page heroes, location names). Both are bundled locally with `@fontsource-variable` so the app works offline.
- **Contrast:** AA minimum. Coral for text or small UI must use a darkened shade.
- **Logo:** original. Never reproduce the WA Tourism Commission swan.

## 10. Dependencies (installed on the feature branch in commit `chore(deps)`; don't re-add)

- **Runtime (`dependencies`):**
  - `playwright-core@1.56.1`: browser automation runtime, no bundled browsers. It is pinned because Electron 28 runs Node 18 and newer releases need Node 20 or later.
  - `sanitize-html@^2.17`: the main process sanitises provider HTML before it crosses IPC. 2.18 and later need Node 22 or later.
- **Renderer, bundled by Vite (`devDependencies`, following the `@tanstack/react-query` precedent):** `mapbox-gl@^3` (ships its own types), `lucide-react`, `@fontsource-variable/figtree` (UI sans, the closest free analogue to Airbnb Cereal) and `@fontsource-variable/fraunces` (display face, used sparingly).
- **Native module ABI:** Electron 28 runs Node 18.18. Any new main-process dependency must support Node 18.
- Anything else needs a reason recorded in the task notes.

## 11. Git conventions for this project

- Author is the stakeholder (repo git config already set). **Never** add `Co-Authored-By` trailers, session links, "generated with" lines or any tool attribution to commits, files or GitHub text.
- Use conventional commits with the issue number: `feat(providers): add provider registry (#12)`. One commit (or a small series) per task.

## 12. Contract amendments (2026-10-02, from stream planning — binding)

1. **`ProviderManifest.stayFields?: StayFieldDescriptor[]`.** Provider-specific stay inputs such as gear type, vehicles, postcode and concessions, rendered generically by the renderer.
   ```ts
   interface StayFieldDescriptor {
     key: string; label: string; help?: string;
     type: 'select' | 'number' | 'text' | 'boolean';
     options?: { value: string; label: string }[]; min?: number; max?: number; default?: string | number | boolean;
     appliesTo: Array<'availability' | 'watch' | 'snipe' | 'hold'>;
     required?: boolean;
   }
   ```
   Values are stored in `stay_params` JSON and validated in main against the descriptor. The renderer never contains per-provider code.
2. **`capabilities.accessGate: boolean`.** True when the provider has a waiting room or queue (ParkStay: DBCA queue). It drives the queue toggle in Site Sniper and the access-status chip in the tray.
3. **Release modes are provider-described.**
   ```ts
   interface ReleaseModeDescriptor { id: string; label: string; description: string; usesAccessGate: boolean; fields?: StayFieldDescriptor[] }
   ```
   This is exposed via `ProviderManifest.releaseModes?` when `capabilities.snipes`. The core `SiteSniperService` calls `provider.release.computeReleaseAt(modeId, stay, params, now)`. ParkStay modes are `daily_rollover`, `scheduled` and `cancellation`.
4. **Watch auto-hold.** The no-op "auto-book" checkbox becomes **"Hold a site automatically when found"**. It is implemented in V4 via `provider.holds` (same path and safety guards as snipes: one hold per night, payment hand-off notification). It is shown only when `capabilities.holds`. *(Final review amendment:)* migration v8 writes `auto_book = 0` for every copied watch, so a 1.x watch that had the no-op box ticked never starts placing holds after an unattended update; the person turns it on per watch.
5. **Booking management link.** `provider.links.manageBooking?(reference): string | null` is surfaced as `Booking.manageUrl`. The UI shows "Manage on {shortName}" when present. The fake cancel is removed.
6. **Events:** add `app:navigate` with `{ path }`. Main emits it when an OS notification is clicked, and the renderer only follows allow-listed internal paths.
7. **Typed settings keys** live in `shared/contracts/settings.ts`, for example `notifications.desktop`, `notifications.sound`, `app.startMinimised`. Main owns `valueType` and `category`, not the renderer.
8. **D2 primitives must include** Combobox (ARIA 1.2 pattern), Menu, Popover, Switch, Disclosure, RadioCard, Stepper, in addition to the D2 list. A primitive found missing later is added to `components/ui/` with tests, never hand-rolled inside a feature.
9. **Provider choice is always visible.** The provider filter and the provider step show even when only one provider qualifies (it is pre-selected). This follows the stakeholder brief: provider is "the first level of each function".
10. **Routes (final):**
    - `/` Explore
    - `/places/:providerId/:externalId` location detail
    - `/watches`, `/watches/new`, `/watches/:id`, `/watches/:id/edit`
    - `/site-sniper`, `/site-sniper/new`, `/site-sniper/:id`
    - `/bookings`, `/bookings/:id`
    - `/settings/:section?`
    - **Prefill query contract** for create flows: `?provider=<id>&location=<externalId>&arrival=YYYY-MM-DD&departure=YYYY-MM-DD&adults=N&children=N`
11. **Small main-process changes inside UX tasks are allowed** when they only wire existing services to the UI (settings → NotificationService, notification-click navigation). They must still follow the IPC conventions in §4 and §1.
12. **Upgrade data safety (binding).**
    - The v1 uninstaller (`resources/installer.nsh:71-77` in v1.x) shows a "delete all application data?" MessageBox with no `/SD` and no `--updated` guard. A v1 → v2 upgrade runs that old uninstaller, so a user clicking "Yes" would wipe `%APPDATA%\parkstay-bookings`.
    - The v2 installer must therefore snapshot the legacy data folder (copy, never move) into `%APPDATA%\WA Stay\legacy-snapshot\` before the old uninstaller runs (`customInit`/`customCheckAppRunning`).
    - B3 migration reads from the legacy folder if present, otherwise from the snapshot.
    - The v2 `customUnInstall` guards with `${isUpdated}` and uses `/SD IDNO`.
13. **Released v1.2.0 is schema v5.** Migration tests start from both v5 (v1.2.0) and v6 (main) SQL-dump fixtures. `*.db` files are gitignored.
14. **Test-only env hooks** (`WA_STAY_USER_DATA_DIR`, `WA_STAY_LEGACY_DATA_DIR`, `WA_STAY_E2E_FIXTURES_DIR`, `WA_STAY_E2E_ALLOW_HOSTS`) are honoured only when `!app.isPackaged`. Test-support code lives in `src/main/testing/`.
15. **`CatalogQuery`**: `{ text?, providerIds?, kinds?, regions?, amenities?, bookingModes?, bbox?: [w,s,e,n], limit? (default 5000 = all), offset? }`. Map-area ("search as I move the map") filtering may be done in the renderer over the full result set while catalogues stay small.
16. **`UnitSummary`**: `{ unitId, unitName, unitType?, maxPeople?, equipment?: string[], amenities?: string[] }`. It matches `UnitAvailability` naming (V1 is canonical). `CatalogQuery` uses `text`, not `q`.
17. **`LocationAvailability.bookingUrl?`**: a stay-specific deep link, owned by V3 and V5. E2 prefers it over the date-less `LocationDetail.bookingUrl`.
18. **`StayFieldDescriptor.appliesTo` is canonical**. Any spec that says `usedBy` means `appliesTo`.
19. **Watch create route is `/watches/new`** with the §12.10 prefill query (`provider` + `location` = externalId, not the composite key). U1/U2 specs that say `/watches/create` or `?location=<key>` are superseded. D3 keeps a redirect from `/watches/create` → `/watches/new` that preserves the query string.
20. **Primary CTA colour is coral; brand colour is ocean** (orchestrator decision, Airbnb pattern; shown to the stakeholder at PR review).
21. **There is always a local profile row** (`users` id 1, the single local profile). Startup runs `ensureLocalProfile()`, introduced in P3 using the existing `users` table and kept by V2. A fresh install therefore never hits a `NO_PROFILE` state, and D3 is not blocked.
22. **Nothing may ever delete the local profile row.** Today `auth.deleteCredentials` (`AuthService.ts:135-146`, called by Logout at `App.tsx:51`) deletes it, and `ON DELETE CASCADE` then wipes every watch, booking, snipe and notification. That is a data-loss bug, fixed as follows:
    - P3 makes credential deletion clear only credential fields.
    - D3 removes Logout.
    - V6 provider sign-out touches only `provider_accounts` and the partition storage.
    - P2 or V2 adds a test proving that no code path deletes the profile row.
23. **`safeStorage` must not run before the final userData path is set.** On Windows the OSCrypt key lives in `Local State` inside userData. The required startup order is:
    1. `app.setPath('userData')` (B3)
    2. legacy migration
    3. SecretVault first use
    
    Never copy `Local State` from another profile.
24. **Notifier vocabulary reaches the DB in v7**: `notification_providers` → `notifiers`, `provider_channel` → `notifier_channel`. Agreed.
25. **Production CSP is a build-time meta tag** (Vite plugin using a pure builder in `src/main/app/csp.ts`); dev uses a header. `img-src https:` is allowed broadly.
26. **Migration numbering:** v7 = P2 (integrity), v8 = V2 (provider-aware), v9 = V6 (retire legacy credentials), v10 = P7 (drop `job_logs`, if it is dropped).
27. **ParkStay facts that change the design (V3):**
    - When the DBCA queue is active, `/api/` returns a 200 HTML redirect instead of JSON. Detect it and treat it as the access gate.
    - User agents containing axios, python, curl, java or httpclient are blocked, so always send a Chrome UA.
    - The `sitequeuesession` cookie lives on `dbca.wa.gov.au` (session cookie store).
    - Campsite names come in the availability response, so the per-site name lookups are removed.
28. **Brand.**
    - The stakeholder chose the **"Roofline sunset"** logo (B1): an ink roof chevron that doubles as the A of WA, over a gold sun setting into an ocean brushstroke, with a coral glint. Concepts are generated by `scripts/brand/logo.js` (switch with `CONCEPT`; run `npm run icons`).
    - The renderer Logo lives at `src/renderer/components/brand/Logo.tsx`; brand assets are not UI primitives. D3 and U5 import it from there.
29. **Line endings.** `.gitattributes` enforces LF for text (`* text=auto eol=lf`), and tests that split files must tolerate CRLF. The Windows CI runner checks out with autocrlf.
30. **Provider SDK hardening (from the V1 review).**
    - **Production transport parity:**
      - Electron `ses.fetch` cannot do `redirect:'manual'` and returns an empty `Response.url`, so `ElectronSessionHttpClient` uses `net.request({ session, redirect:'manual' })` (or equivalent) to give the same `HttpClient` semantics as `NodeHttpClient`: visible 3xx, final URL, hop limit.
      - Errors are classified by `net::ERR_*` (non-retryable for policy and loop errors).
      - A Referer header sets `referrerPolicy:'unsafe-url'`.
      - Only https URLs are allowed (http only for loopback in tests).
      - Live Electron tests are required, not mocks only.
    - **Registry checks the manifest flags as well as the modules:**
      - `snipes` ⇒ `holds` + `availability` + non-empty `releaseModes` that `release.supports()` accepts;
      - `usesAccessGate` ⇒ `capabilities.accessGate`.
      - It stores a frozen parsed manifest.
      - It keeps each provider's ctx so `disposeAll()` closes `ctx.browser` and calls `access.dispose()`.
    - **Zod request schemas** get a two-way type-equality assertion against their TS types.
    - **Extensibility additions (types, plus minimal wiring) for the next providers (RAC, Airbnb, Hipcamp, …):**
      - `ProviderManifest.currency` (ISO 4217, e.g. 'AUD');
      - `ProviderManifest.limits?` `{ minWatchIntervalMinutes, maxConcurrentRequests, catalogTtlHours }`;
      - `ProviderAuth.kind`: `'browser-session' | 'credentials' | 'automation'`. Credentials use `AccountFieldDescriptor { key, label, secret: boolean }` and secrets go to the ScopedSecretVault. V6 implements `browser-session` only; the other kinds are declared and validated but not yet implemented.
      - `capabilities.catalogMode: 'full' | 'search'`. `'search'` providers implement `catalog.searchArea({ bbox, stay?, cursor? }) → { items, nextCursor? }` instead of enumerating everything. V5 implements `full` and leaves a clear hook for `search`.
      - `ProviderContext` is built from the manifest, so timezone and limits are available.
    - **`UnavailableSecretVault`** is a placeholder in `container.ts`. **P5 owns** replacing it with the real vault-backed `ScopedSecretVault` factory.
31. **Core services and scheduler decisions (V4 design review, 2026-10-04).**
    - **Notification titles.** The stored and in-app title has no provider prefix; `notifications.provider_id` carries the provider. Only the OS desktop notification title is prefixed, as `${shortName} · ${title}` (U5's rule, adopted now by V4 in one helper in main). The dispatcher passes the unprefixed title plus `providerId` to notifiers; B2's email subject adds the provider itself. V4's "title starts with `Fake: `" criterion is replaced by: stored `providerId` set, stored title unprefixed, desktop title `Fake · <title>`.
    - **Watch holds.** V4 adds no migration. A watch auto-hold is recorded as `last_result 'held'` (the night guard uses it), with its details in the result and the notification. V6's v9 adds `hold_reference`, `hold_expires_at`, `hold_unit_id`, `payment_url` and `last_error` to `watches`, and the payment hand-off for watch holds.
    - **Hold expiry.** V4 arms a HELD → EXPIRED timer at `holdExpiresAt` for snipes, re-armed by `rescheduleAll()`. An expired hold no longer blocks nights in the night guard.
    - **Stay-param validation (§12.1).** V4 owns it in `core/stay-params.ts`: defaults plus validation of declared keys (type, options, min/max, pattern, required), with issues `stayParams.<key>`. Undeclared legacy keys pass through.
    - **Lifecycle rules.** Re-activating a HELD/BOOKED snipe or a held watch is refused (`VALIDATION`). A night-guard conflict ends the snipe as FAILED with a clear message; the user can re-activate it. A cancellation snipe expires once its arrival date has passed in the provider's timezone.
    - **Politeness of runtime checks.** Long scheduler runs (minutes at the poll floor) use fixture mode (`WA_STAY_E2E_FIXTURES_DIR`); live checks are short (about a dozen DBCA requests).
    - **node-cron** is removed once nothing uses it; CLAUDE.md's scheduling row becomes chained `setTimeout` timers.
    - **Access gate idle timer (V3 follow-up).** The ParkStay gate keeps one unref'd timer after its last release, to report `idle` when the session ends; `holdOpen`, `ensure` and `dispose` clear it. Timer-leak assertions in scheduler tests use FakeProvider or dispose the gate.
32. **Provider accounts and sign-in decisions (V6 design review, 2026-10-04).**
    - **ParkStay holds never wait on sign-in.** DBCA's `create_booking` needs no sign-in (`api.py:2938-2947`) and a ParkStay session lasts 1 h (`SESSION_COOKIE_AGE = 3600`). A sign-in requirement at arm or hold time would fail almost every overnight snipe. ParkStay's manifest therefore declares `account: 'optional'`: snipes and watch auto-holds run signed out, and the user signs in inside the payment window (it allows the B2C origins), or beforehand with "Connect ParkStay". `ensureForHolds`, the paused-on-create rule and the hold-time check stay as generic SDK behaviour for providers that declare `required-for-holds` or `required`, and are tested with FakeProvider. The V6 criterion "activating a ParkStay snipe while signed out returns AUTH_REQUIRED" becomes: the same with a FakeProvider that declares `required-for-holds`, plus "a ParkStay snipe activates and arms while signed out".
    - **UI copy (U2/U4).** Sign-in is a soft suggestion for optional providers ("Connect ParkStay before the release so checkout is quicker"), never a blocker. A hold is paid in the payment window, which shows ParkStay's own sign-in when needed.
    - **Payment success** needs `checkouthash = sha256(holdReference)` on ParkStay's own `/success/` (DBCA also serves an error page and other bookings there). After a payment window closes, the account status is re-probed once.
    - **Legacy ParkStay password.** v9 drops the four `encrypt*` columns from `users`; only the email carries over (into the ParkStay account and as a sign-in hint). The dropped ciphertext must not survive in the database file: run v9 with `PRAGMA secure_delete = ON` (or VACUUM once after it) and test that the legacy ciphertext bytes are gone. CHANGELOG: "Connect ParkStay once in Settings; the old saved password is no longer used."
    - **User agent.** For the Electron provider partition (HttpClient and windows), the Chrome UA's major version matches `process.versions.chrome`, so the UA and client hints agree. NodeHttpClient keeps its constant.
    - Accepted: one payment window per provider; the sign-in poll only on the provider's own origin; sign-out refused while a watch hold is unexpired; the window title shows the current host; `provider_accounts.last_checked_at`; `registry.httpOf()`; `HoldsModule.bookedReference?`; `WatchResult.BOOKED`; the `auth` namespace and `AuthService` removed.
33. **No live holds, ever (2026-10-04).** No runtime check, test or agent run may create a real hold, booking or checkout on ParkStay or any provider. That means no live `create_booking`, no live snipe or auto-hold that could succeed, and no live payment. Anything involving holds is verified in fixture mode or with seeded rows; live checks are read-only and minimal. (Incident: V4's live sanity run placed anonymous hold #2072968 on Bungarra site 02, 3–5 Nov 2026, which lapsed unpaid at 12:04 UTC on 4 Oct.) Real holds happen only in the stakeholder's own manual checklist, with genuine intent.
34. **Test hooks run only from source (Q1 phase 2, 2026-10-10).** Test env hooks, fixture mode and `ELECTRON_RENDERER_URL` are honoured only when `runsFromSource(app)` (`src/main/app/app-source.ts`): the app is unpackaged **and** `app.getAppPath()` is not inside an `.asar` archive. This supersedes the plain `!app.isPackaged` gate in §12.14 (a renamed packaged executable reports unpackaged). `WA_STAY_BROWSER_PATH` and provider-window devTools must use the same rule. CI runs a `packaged-smoke` job (`electron-builder --linux dir` + `npm run smoke:packaged`). *(DX1, 2026-10-11:)* `WA_STAY_PROVIDERS` (comma-separated built-in ids) joins these source-only hooks: only the listed built-ins register, an unknown or empty list stops start-up, and the e2e harness sets it to `parkstay` by default so journeys hold however many providers are built in; the packaged smoke test sets it to an unknown id and shows the package ignores it.
