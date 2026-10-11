# V3 — ParkStay provider module

**Stream:** providers · **Depends on:** V1, V2

## Description

Today's ParkStay integration has four problems:

- about 60% of `parkstay.service.ts` (1,086 lines) calls endpoints that do not exist;
- the code that does work is split across three services;
- Site Sniper fails on every poll, because it sends `YYYY-MM-DD` (HTTP 500) and parses the wrong availability shape;
- watches always report a price of 0.

V3 rebuilds ParkStay as the first provider module in `src/main/providers/parkstay/`, using only endpoints confirmed live (2 Oct 2026) and in the DBCA backend source (`dbca-wa/parkstay_bs_v2`). It also rewires the existing Watch and Site Sniper services onto the module and deletes the fabricated code.

Story: as a Site Sniper user, my snipe polls ParkStay successfully and places a hold the moment a site opens. As a watch user, I see real nightly prices.

## Size

L. It covers several ParkStay concerns (catalogue, availability, queue, release, holds), deletes a lot of legacy code, and rewires the services. Design approval is required.

## Scope

- **Module layout.** Per architecture-notes §1: `providers/parkstay/{index,constants,headers,client,types,catalog,availability,release-policy,holds,links}.ts` and `queue/{queue-api,access-gate}.ts`.
- **Manifest in `index.ts`.**
  - Capabilities: `catalog`, `availability`, `bulkAvailability`, `watches`, `snipes`, `holds` and `accessGate` are true. `bookingImport` is false. `account` stays `'none'` until V6 adds `auth`.
  - `locationKinds`: `['campground', 'holiday-park', 'caravan-park', 'cabin', 'hut', 'glamping', 'farm-stay', 'other']`.
  - `stayFields`:
    - `gearType`: select over `all`/`tent`/`campervan`/`caravan`, default `all`, used by watches and snipes;
    - `numVehicles`: number 0–5, default 1, used by snipes and holds;
    - `postcode`: text, pattern `^\d{4}$`, used by snipes and holds.
- **`constants.ts`.** Holds the base URLs, `QUEUE_API_BASE_URL`, `QUEUE_GROUP = 'parkstayv2'` and `HOLD_MINUTES = 30`. They move from `app-constants.ts:7-8,36,68-73` with **values unchanged**.
- **`headers.ts`.** Moves from `utils/browser-headers.ts`: the Chrome UA, `Referer: https://parkstay.dbca.wa.gov.au/` and the `Sec-Fetch-*` headers. `Origin` is added on POST.
- **`client.ts`.** Every call goes through `ctx.http`, with a `createLimiter(4)` cap.
  - `toParkStayDate('2026-11-10')` returns `'2026/11/10'`. It is a pure string transform with no `Date`.
  - `getJson` detects the DBCA queue interstitial: a 200 `text/html` response whose body contains `window.location.replace(` (`queue_middleware.py:99,116`). It then throws `AccessGateError('waiting')` and never a JSON parse error.
- **`types.ts`.** The raw shapes, kept local and never exported to `shared/`:
  - the `/api/campground_map/` feature;
  - `campground_availabilty_view`;
  - `campsite_availablity_view`;
  - `create_booking`;
  - `QueueApiResponse`, moved from `shared/types/queue.types.ts:120-153`.
- **`catalog.listLocations()`.** Calls `GET /api/campground_map/` and returns 169 `LocationSummary`, as follows.

  | Field | Source |
  |---|---|
  | `externalId` | `String(id)` |
  | `name` | `properties.name` |
  | `lat`/`lng` | `geometry.coordinates` [lng, lat], rounded to 6 dp |
  | `area` | `{ name: park.name, region: park.district.region.name }` |
  | `imageUrls` | `images[].image` prefixed with `https://parkstay.dbca.wa.gov.au`, de-duplicated |
  | `amenities` | `features[].name`, verbatim |
  | `unitCount` | `campsites.length`, or undefined when 0 |
  | `infoUrl` | `info_url`, or undefined when empty (12 of 169) |
  | `bookingUrl` | only when `campground_type === 0`: `…/search-availability/campground/?site_id={id}` |

  `bookingMode` comes from `campground_type`:
  - 0 → `online`;
  - 1 → `offline`;
  - 2 → `external`;
  - 4 → `application`;
  - unknown → `offline`, with a warning.

  `kind` is `campground` for types 0, 1 and 4. For type 2 it is a name heuristic:
  - `/holiday park|tourist park/` → `holiday-park`;
  - `/caravan park/` → `caravan-park`;
  - `/cottage|chalet|cabin/` → `cabin`;
  - `/\bhut\b/` → `hut`;
  - `/homestead|station/` → `farm-stay`;
  - `/eco retreat|sal salis/` → `glamping`;
  - anything else → `other`.

  `description` is empty for all 169, so `summary` is undefined.
- **`catalog.getLocation(id)`.** Calls `campsite_availablity_view/{id}` with a one-night probe stay (tomorrow in AWST, 1 adult) and merges in the summary.
  - `descriptionHtml` is `long_description` passed through a new shared SDK helper, `providers/sdk/html.ts` `sanitizeProviderHtml(html, baseUrl)`, built on `sanitize-html`. V5 re-applies it to every provider's detail. The helper must:
    - drop `<style>`, `<script>`, `<iframe>`, and `style`/`class`/`on*` attributes;
    - allow `p, br, hr, h3–h6, strong, em, ul, ol, li, a[href], img[src|alt], div, span`;
    - make relative `src`/`href` absolute against `baseUrl`;
    - allow https links only, with `rel="noopener noreferrer"`.
  - `units` come from `sites[]`:
    - `unitId = String(id)` and `unitName = name`;
    - `unitType` is the class name when `classes[class]` is non-null;
    - `maxPeople`/`maxVehicles` map from `max_people`/`max_vehicles`;
    - `equipment` is the `gearType` keys that are `true`;
    - `description` is `short_description`.
  - `releaseInfo` comes from `release.describe`.
- **`availability.check(id, stay, { unitIds, signal })`.**
  - Calls `GET /api/campsite_availablity_view/{id}/?arrival=YYYY/MM/DD&departure=…&num_adult&num_concession&num_child&num_infant&gear_type`, with `gear_type` taken from `stay.params.gearType ?? stay.equipment ?? 'all'`.
  - Each tuple `[bookable, label, price, _, _, date]` (`api.py:1550`) becomes `NightStatus { date: t[5], price: Number(t[2]) when finite, label: t[1] }`, with `state` set as follows:
    - `t[0] === true` → `available`;
    - `'Booked'` → `booked`;
    - `/^Closed/` or `'Closures/Bookings'` → `closed`;
    - `'Unavailable'` → `not-released` when the date is at or after the release horizon (below), else `booked`;
    - anything else → `unknown`.
  - `fullyAvailable` means every night in `eachNight(arrival, departure)` is present and available. `total` is the sum of prices when fully available.
  - The result filters by `unitIds`, and sets `release { open, opensAt? }`, and `bookingUrl` from `links.booking`.
  - The release horizon is `release_date` when it is set; otherwise it is today (AWST) plus `max_advance_booking` (defaulting to 180 when the catalogue is unknown). On the horizon day itself, it opens only when `booking_time_open` is true.
  - An unexpected body shape throws `ProviderParseError`. It never returns an empty result silently.
- **`availability.search(stay)`.**
  - Calls `GET /api/campground_availabilty_view/?format=json&arrival&departure&gear_type&features=[]&featurescs=[]`.
  - Returns `BulkAvailabilityEntry { key: 'parkstay:<id>', availableUnits: total_available, bookableUnits: total_bookable }`.
  - Entries without `total_*` are skipped: in the sample, 71 of 177 are not bookable online.
- **`queue/access-gate.ts` (`ParkStayAccessGate`).** Built from `queue.service.ts`. Its session key is the partition cookie `sitequeuesession` (Domain `dbca.wa.gov.au`).
  - If that cookie is absent, it generates the 52-character `[A-Z0-9]` key (`queue.service.ts:150-157`) and sets the cookie.
  - It polls `queue.dbca.wa.gov.au/api/check-create-session/?session_key&queue_group=parkstayv2` and persists to `ctx.state` `'queue.session'`, in the shape agreed with V2.
  - Fixes for tech-review #10:
    - there is no `EventEmitter` `'error'` emit, only `onStatus` listeners;
    - `ensure()` is single-flight and honours `signal` and `maxWaitMs`, clearing its timers on abort;
    - `holdOpen()` is ref-counted, with a 20 s keep-alive while the count is above 0;
    - it refreshes 120 s before expiry;
    - `dispose()` clears every timer.
- **`release-policy.ts`.** Absorbs `sitesniper/release-timing.ts`. It supports `daily_rollover`, `scheduled` and `cancellation`.
  - `daily_rollover` opens at (arrival − `max_advance_booking`) on the campground's release time (Australia/Perth). The release time is parsed from `release_time_friendly` (for example `'02:00 AM'`) and cached in `ctx.state` `release.time.<id>`. The fallback is 00:00 (PQ3).
  - `scheduled` requires `requestedAt`. `suggestScheduledAt` returns the next first Tuesday at 10:00 AWST.
  - `cancellation` returns `null`.
  - `describe()` returns "Bookings open 180 days ahead at 12:00 am AWST". When a release period is active, it returns "Bookable up to {release_date − 1 day}; later dates are released in blocks — use a scheduled snipe".
  - `pollFloorMs` is `{ window: 500, continuous: 3000 }` (`app-constants.ts:30,34`).
- **`holds.ts`.**
  - `create()` posts form-urlencoded data to `/api/create_booking` with the fields at `api.py:2986-3003`. Dates are `YYYY/MM/DD` (`serialisers.py:56-57`). Vehicles and postcode come from `stay.params`, and `campsite` comes from `unitId` (or `campsite_class`).
  - Results map as follows:
    - `{status:'success', pk}` → `ok`, with `reference: String(pk)` and `expiresAt` = now + 30 min;
    - `inprogress_booking` → `in-progress`;
    - a 400 with "closed for bookings" → `closed`;
    - any other 400 → `taken`;
    - an interstitial → `AccessGateError`.
  - `paymentUrl()` returns `https://parkstay.dbca.wa.gov.au/booking/`. The hold lives in the session (`api.py:3373-3376`).
  - `paymentOrigins` is `['https://parkstay.dbca.wa.gov.au']`.
- **`links.ts`.**
  - `location(id)` returns the campground search page.
  - `booking(id, stay)` returns `…?site_id={id}&arrival=YYYY/MM/DD&departure=YYYY/MM/DD&num_adult={adults}`.
  - `manageBooking()` returns `https://parkstay.dbca.wa.gov.au/mybookings/`.
- **Rewire the existing services in place.** V4 moves them later. The container injects `registry.get('parkstay')`.
  - `WatchService` uses `availability.check`, which gives real prices and names. Partial matching uses the nights of **one** call instead of the per-night loop (`watch.service.ts:249-312`).
  - `SiteSniperService` uses `availability.check` + `holds.create` + `release.computeReleaseAt`, which fixes `toYmd` at `:385-387`. It stores `holdUnitId`.
  - `JobScheduler` warm-up uses `access.ensure` and `holdOpen()`.
- **Legacy namespaces** (see the master plan table).
  - `parkstay.searchCampgrounds` and `parkstay.getAllCampgrounds` stay as a shim served from `catalog.listLocations`, with a 10-minute in-memory cache. They return **campgrounds only**, in the `CampgroundSearchResult` shape. V5 retires them.
  - `parkstay.checkAvailability` is deleted.
  - P3's transitional `queue` namespace and `queue:status` event are **deleted**. They are replaced by V1's `providers.accessStatus('parkstay')` and `provider:access-status`.
  - `src/renderer/components/QueueStatus.tsx` gets a minimal edit to read from the replacement API. U5 restyles it later.
- **Delete:**
  - `services/parkstay/parkstay.service.ts`, `services/queue/queue.service.ts`, `services/sitesniper/release-timing.ts` and `utils/browser-headers.ts`;
  - P2's `QueueSessionRepository`, which V2 repointed. The gate uses `ctx.state` instead;
  - the `queue` contract file and its handlers;
  - the ParkStay and queue constants in `app-constants.ts`;
  - in `shared/types/api.types.ts`: `ParkStaySessionToken`, `SearchParams`, `CampsiteAvailability`, `DateAvailability`, `BookingParams`, `CustomerInfo`, `BookingResult`, `AvailabilityCheckResult`, `RebookParams`, `RebookResult` and `QueueSessionInfo`;
  - `site-sniper.types.ts:93-114`;
  - `queue.types.ts:120-153`;
  - the tests that cover deleted code. Replace them; do not skip them.
- **Fixtures** go in `tests/fixtures/parkstay/`, trimmed from the planning samples:
  - `campground_map.json`: 6 features (ids 20, 18, 85, 5, 16, 182) with campsites cut to at most 3 each;
  - `campground_availabilty_view.json`: keys 20, 18, 85, 5, 16, 182, plus the unknown id `1`, and `available_cg`;
  - `campsite_availablity_view_20.json`: the full sample (5 sites, 2 nights);
  - `queue-waiting.json` and `queue-active.json`: synthetic, from the verified `QueueAPIResponse` fields;
  - `queue-interstitial.html`;
  - `create-booking-{success,inprogress,error}.json`: synthetic, from `api.py:3364-3380`.

## Non-goals

- `auth.ts`, sign-in, account status and the payment window (V6). `capabilities.account` stays `'none'`.
- Moving the services to `core/`, registry-driven resolution, the scheduler fixes and the auto-hold decision (V4).
- Catalogue persistence, TTL, search and `catalog.*` IPC (V5).
- Booking import or `/mybookings` scraping (out of scope). Rewriting `docs/parkstay-api/*` (Q2).

## Completion Criteria

- [ ] `describeProviderContract('parkstay', …)` (V1) passes, using `NodeHttpClient` against a local fixture server.
- [ ] The catalogue fixture maps to 6 summaries:
  - id 20 has `bookingMode 'online'`, `bookingUrl` set, and `imageUrls[0]` starting `https://parkstay.dbca.wa.gov.au/media/`;
  - id 5 is `external`/`holiday-park` with no `bookingUrl`;
  - id 182 is `hut` with `infoUrl` undefined;
  - id 16 is `application`;
  - id 20 has `area.region` `'Pilbara'`.
- [ ] `check('20', {arrival:'2026-11-10', departure:'2026-11-12', adults:1})` sends `arrival=2026/11/10&departure=2026/11/12` and the ParkStay `Referer`. It returns 5 units, each with 2 nights carrying `price: 30`. The 6 `$30.00` nights are `available` and the 4 `Unavailable` nights are `booked`. Only units 3, 4 and 5 are `fullyAvailable` (`total: 60`).
- [ ] An `'Unavailable'` night on or after the release horizon maps to `not-released`. A fixture variant with `release_date` set before the stay proves this.
- [ ] `search()` on the bulk fixture returns entries only for keys that have totals. It returns `parkstay:20` with available 5 and bookable 3, and skips `85`.
- [ ] A 200 `text/html` interstitial on any `/api/` call rejects with `AccessGateError` (`state: 'waiting'`).
- [ ] Sanitiser test on the id 20 `long_description`:
  - the output contains no `<style`, `style=` or `class=`;
  - the `<img>` `src` is `https://parkstay.dbca.wa.gov.au/media/parkstay/campground_images/25f050a7-6c3.jpg`.
- [ ] Access gate tests with fake timers pass:
  - Waiting → Active resolves `ensure()`;
  - an aborted `ensure()` rejects and leaves no timers (`jest.getTimerCount() === 0`);
  - two `holdOpen()` calls followed by one release keep the keep-alive running, and the second release stops it;
  - there is no `'error'` emit with zero listeners;
  - the key comes from an existing `sitequeuesession` cookie.
- [ ] `holds.create` posts `arrival=2026/11/10` with `campsite=3`, and maps the success, in-progress and error fixtures to the documented `HoldResult`s.
- [ ] Release policy tests:
  - `daily_rollover` with release time `'02:00 AM'` for arrival `2027-04-01`, max 180, gives `2026-10-02T18:00:00.000Z` (02:00 AWST on 3 Oct 2026);
  - with no known time it gives 00:00 AWST;
  - `scheduled` without `requestedAt` rejects;
  - `suggestScheduledAt` is ported with its tests from `release-timing.test.ts`.
- [ ] `grep -rn "auth/login\|/account/\|accounts/logout\|queue/status\|campsite_availability/" src/main` → 0 results. `grep -rn "/bookings/" src/main/providers` → 0 results. The renderer route `/bookings/:id` in `notification.service.ts:192` is legitimate and stays.
- [ ] `ls src/main/services/parkstay src/main/services/queue src/main/utils/browser-headers.ts` all fail (deleted).
- [ ] No code path issues more than 4 concurrent ParkStay requests (limiter unit test). `grep -rn "/campsites/" src/main` → 0 results, because names now come from `sites[].name`.
- [ ] `parkstay.getAllCampgrounds` returns only campgrounds (6 from the fixture; 169 live) and never parks or promo areas. `search_suggest` is no longer called.
- [ ] `grep -rn "queue:status\|window.api.queue" src` → 0 results. The QueueStatus chip in the running app shows the gate state from `providers.accessStatus('parkstay')`, which is `idle` when no snipe uses the queue.
- [ ] Runtime check against live ParkStay with the dev build:
  - a cancellation snipe on Bungarra for dates about 30 days out polls without HTTP 500 and logs per-unit night states;
  - running a watch shows non-zero prices;
  - the log excerpt is attached to the PR.
- [ ] `npm run lint && npm run format:check && npm run type-check && npm test` passes.

## Edge Cases

- **HTTP 500.** For example, the wrong date format: throw `ProviderHttpError` with `status 500` and a hint in the message. Snipes record an error, not "unavailable".
- **Classes.** A `classes` value of `{ "null": null }` means no classes, so `unitType` is undefined. A class-level booking falls back to `campsite_class` when a unit has no id.
- **Unknown campgrounds.** A campground id in the bulk response that is not in the map (8 in the sample) is returned anyway; V5 filters it. A campground with 0 campsites gets `unitCount` undefined.
- **Missing data.** Missing images give `imageUrls: []` (every live campground has at least one). A coordinate of `null` drops the location and logs a warning.
- **Prices and labels.** A price like `'30.00'`, `30` or `null` maps to a number or undefined. An unrecognised label maps to `unknown`, with the label kept.
- **Queue:**
  - the queue API is down: `ensure()` retries with backoff until `maxWaitMs`, then raises `AccessGateError('error')`;
  - `queue_full: true` gives the state `waiting`, with a message;
  - a persisted session that has expired is discarded on load.
- **Hold race.** `create_booking` returns 400 because the site was taken between the check and the hold: return `taken` and retry on the next tick, without a crash.
- **Blocked user agent.** If `User-Agent` were a library default, DBCA would return the interstitial (`queue_middleware.py:16-28`). The header test asserts the Chrome UA.

## Test Strategy

- **Unit (~45):**
  - catalogue mapping and the kind heuristic (~10);
  - tuple-to-state mapping (~8);
  - bulk mapping (~4);
  - sanitiser (~4);
  - access gate with fake timers (~8);
  - release policy (~6);
  - holds (~4);
  - links and dates (~3).
- **Component:** none.
- **Integration (~6):**
  - the provider against a local HTTP server serving the fixtures (contract suite);
  - rewired `SiteSniperService.execute()` against the fixture server, covering hold placed, taken and HTTP 500;
  - `WatchService.execute()` with prices and partial matches in one request.

## Context Files to Read First

- `ai-state/research/parkstay-api-review.md` (primary) and `ai-state/research/tech-review.md` findings #2, #3, #10, #15.
- `ai-state/architecture-notes.md` §1–§3. `ai-state/streams/providers/master-plan.md` (PQ3; the shims table).
- `ai-state/streams/explore/master-plan.md`: the V3 data-quality row.
- `src/main/services/parkstay/parkstay.service.ts`:
  - `:316-341` search (mixes parks and promo areas);
  - `:372-443` (price 0 at `:427`);
  - `:453-472` (unbounded lookups);
  - `:841-1033`.
- `src/main/services/queue/queue.service.ts` (all). `src/main/services/sitesniper/{sitesniper.service,release-timing}.ts`.
- `src/main/services/watch/watch.service.ts`, `src/main/scheduler/job-scheduler.ts:221-316`, `src/main/ipc/handlers/{parkstay,queue}.handlers.ts`, `src/renderer/components/QueueStatus.tsx`.
- `ai-state/streams/platform/tasks/P3-composition-root-typed-ipc.md`: the transitional `parkstay`/`queue` namespaces and `queue:status`.
- `src/shared/types/{api,queue,site-sniper}.types.ts`, `src/shared/constants/app-constants.ts`, `src/main/utils/browser-headers.ts`.
- The DBCA backend (github.com/dbca-wa/parkstay_bs_v2):
  - `parkstay/urls.py:58-90`;
  - `parkstay/api.py:1217-1590` and `:2938-3380`;
  - `parkstay/booking_availability.py:25-40` and `:574-600`;
  - `parkstay/serialisers.py:50-70`;
  - `parkstay/queue_middleware.py`.
- Tests: `tests/unit/services/{sitesniper.service,queue,release-timing,watch}.test.ts`.

## Notes

- **Fixture source.** The samples were captured on 2 Oct 2026 into the planning scratchpad: `cgmap.json`, `cav.json`, `sav.json`, `ss.json`. If they are not available, re-fetch the public endpoints with the Chrome UA and `Referer: https://parkstay.dbca.wa.gov.au/`. Use `arrival`/`departure` in `YYYY/MM/DD`, then trim the result. Keep fixtures small; the full map is 1.19 MB.
- **`'Unavailable'` maps to `booked`.** For public users the backend folds booked, closed and too-far into `'Unavailable'` (`api.py:1578-1588`, `show_all` false). Booked is the dominant cause, and the label is kept for display. Only the horizon rule can identify `not-released`.
- **`/api/campsites/{id}/` lookups.** These existed only to name sites from the bulk endpoint. `campsite_availablity_view` already returns `sites[].name`, so the lookups and their unbounded `Promise.allSettled` are removed rather than throttled.
- **Hold session.** The hold is bound to the session cookies of `persist:provider-parkstay` (`ses.fetch`). V6's payment window on the same partition therefore sees `ps_booking`, which fixes tech-review #3.
- **Commit.** `feat(providers): ParkStay provider module (#<issue>)`.

## Orchestrator addendum (2026-10-02, from the P4 and V1 reviews)
- [ ] The DBCA queue `sessionKey` never reaches the renderer. The transitional `queue.*` IPC namespace and the `queue:status` event are retired, replaced by `providers.accessStatus(id)` / `provider:access-status`, which expose position, ETA and state only.
- [ ] The ParkStay client uses the SDK `HttpClient` (architecture-notes §12.30 transport parity). Redirect detection for the queue interstitial uses the real 3xx/final-URL semantics, verified live under Electron (`npm run test:electron` style) as well as with fixtures.
- [ ] The queue error listener is added (tech-review #10), and nothing logs session keys or cookies.
