# V5 — Location catalogue service

**Stream:** providers · **Depends on:** V2, V3

## Description

Explore (E1–E3) and the location pickers in Watches and Site Sniper (U1, U2) need one fast, offline-capable catalogue of every location from every provider.

V5 adds `src/main/core/catalog/LocationCatalogService` and the `catalog.*` IPC namespace (architecture-notes §4). The service:

- syncs each provider's catalogue into the `locations` table (V2);
- searches it with FTS5, filters and facets;
- serves cached location detail, with sanitised HTML;
- fans out date-aware bulk availability across providers, isolating each provider's failures.

Story: as a WA traveller I open the app and immediately see every ParkStay campground. I can search and filter them, open one for details, and see which have sites free for my dates, even when I am offline or ParkStay is slow.

## Size

M. One service, its handlers and the repository search: a single concern across a few files.

## Scope

- **`src/main/core/catalog/location-catalog.service.ts`.** Constructed by the container with the registry, `LocationRepository`, `ProviderStateRepository`, the events bus, a logger and the clock.
  - **`sync(providerId?, { force? })`.** Runs for each provider with `capabilities.catalog`.
    - It skips a provider when its last success is under 24 h old, unless `force`.
    - It calls `catalog.listLocations(signal)` with a 60 s timeout, then `LocationRepository.upsertMany` in one transaction.
    - It records `('<providerId>', 'core.catalog.sync')` in `provider_state` as `{ syncedAt, count, lastError? }`.
    - Sync is single-flight per provider; a second caller awaits the same promise.
    - Providers sync in parallel through `Promise.allSettled`, so one failure never blocks another.
    - Afterwards it emits `catalog:updated { providerId, count, syncedAt }`.
  - **Empty result protection.** A result with 0 locations while the cache holds more than 0 is an error, and the cache is kept.
  - **`start()`.**
    - Runs a background sync of stale providers 5 s after the main window is ready, then re-checks hourly.
    - Skips **automatic** sync for a provider while any of its snipes is `QUEUEING` or `SNIPING`, because a 1.2 MB fetch should not compete with a release (parkstay-api-review Risks). Manual refresh is always allowed.
  - **`search(query: CatalogQuery)`** is implemented in `LocationRepository.search`.
    - `text` is split on whitespace. FTS syntax characters (`" * ^ ( ) : - + NEAR AND OR NOT`) are stripped, and each token becomes `"token"*`, joined with AND.
    - Results are ordered by `bm25(locations_fts)` when there is text, and by `name COLLATE NOCASE` otherwise. `sort` can override.
    - `providerIds` only includes providers registered with `catalog`. Unknown ids are ignored, not an error.
    - `kinds`, `regions` and `bookingModes` are `IN` filters.
    - `amenities` match **all** of the selected values, via `EXISTS (SELECT 1 FROM json_each(amenities) …)`.
    - `bbox` filters `lng BETWEEN west AND east AND lat BETWEEN south AND north`.
    - `limit` (default 50, maximum 5000) and `offset` apply. `total` is the full match count.
    - `facets.{regions, amenities, kinds, providers}` give counts over the set matched by every *other* filter, so chips can show counts.
  - **`get(key)`:**
    1. Parse the key (V1).
    2. Return the stored `detail` if it is under 6 h old.
    3. Otherwise call `catalog.getLocation` with a 20 s timeout, run `sanitizeProviderHtml` again (V3 SDK helper, defence in depth for every provider), and store it via `setDetail`.
    4. If the stored `summary` is empty, fill it with the first 200 characters of the description's text, which improves FTS.
    5. When the provider fails, return the stale cached detail with `stale: true`. With no cache at all, return the summary as a detail with `units: []` and `stale: true`.
    6. An unknown key gives `NOT_FOUND`.
  - **`availability(stay, { providerIds?, bbox? })`.** Returns `CatalogAvailabilityResult`.
    - For each provider with `bulkAvailability`, it calls `availability.search(stay)` with a 20 s timeout.
    - Results are cached for 5 min per `(providerId, stay)`, and concurrent identical calls are single-flight.
    - Entries are filtered to keys that exist in `locations`, and to the bbox when one is given.
    - Errors become `{ providerId, code: 'access-gate'|'timeout'|'http'|'parse'|'unknown', message }`.
    - It **never waits in a provider queue** (answers explore EQ7).
  - **`checkLocation(key, stay)`.** Runs `registry.require(id, 'availability')`, then `availability.check` with a 20 s timeout and a 60 s cache per `(key, stay)`.
  - **`refresh(providerId?)`** is `sync(…, { force: true })` and returns `status()`.
  - **`status()`** returns `CatalogStatus` for each catalogue provider: `count`, `syncedAt`, `stale` (over 24 h or never), `syncing` and `lastError`.
- **`src/main/ipc/handlers/catalog.handlers.ts`.**
  - Implements `catalog.search`, `get`, `availability`, `checkLocation`, `refresh` and `status` with V1's zod schemas through `handle.ts`.
  - Errors map through `toApiError`.
  - The preload exposes the `catalog` namespace.
  - `catalog:updated` is forwarded through the events bus.
- **Retire the transitional `parkstay` namespace** (V3 left it as a shim).
  - `WatchForm.tsx:103` and `SiteSniperForm.tsx:155` get a minimal edit: they call `window.api.catalog.search({ providerIds: ['parkstay'], text, limit: 5000 })` and map `items` to the fields they already render. There is no redesign; U1 and U2 rebuild these forms.
  - Then delete the `parkstay` contract file, `parkstay.handlers.ts` and the `CampgroundSearchResult` type.
- **Container wiring.** The container builds the service and calls `start()` after the window is created. `stop()` runs on `before-quit` and aborts in-flight syncs.

## Non-goals

- The Explore UI, map pins, filter chips and detail screen (E1–E3).
- Provider-specific parsing and the content of `releaseInfo` or `descriptionHtml` (V3).
- Cross-provider de-duplication of the same physical place (RAC project).
- Geocoding or "near me" search. Image caching or proxying: images load live from provider hosts (brief O8).

## Completion Criteria

- [ ] With FakeProvider (3 locations) plus `fake2` (2 locations) and a real DB:
  - `sync()` stores 5 rows;
  - `status()` reports both providers, each with `count` and `syncedAt`;
  - `catalog:updated` fires twice.
- [ ] `fake2.listLocations` rejects: `fake` still syncs, and `status()` shows `lastError` for `fake2`. Its previously cached rows are still returned by `search`.
- [ ] `listLocations` returning `[]` over a cache of 3 keeps the 3 rows and records `lastError`.
- [ ] A second `sync()` within 24 h makes 0 provider calls (call log). `refresh('fake')` makes 1. Two concurrent `refresh('fake')` calls make 1.
- [ ] Search cases against the V3 ParkStay fixture catalogue:
  - `search({ text: 'bung' })` returns Bungarra first;
  - `search({ text: 'kurrajong cape' })` returns ids 18 and 16;
  - `search({ text: '"; DROP TABLE' })` returns `{ items: [], total: 0 }` without throwing;
  - `search({ amenities: ['Toilet', 'Road access for 2WD/SUV'] })` excludes id 182;
  - `search({ bookingModes: ['online'] })` returns only `campground_type` 0;
  - `search({ bbox: [113, -23, 114, -22] })` returns only the Cape Range ids;
  - `search({ limit: 5000 })` returns every row, with `total` matching the row count.
- [ ] Facets: `search({ regions: ['Pilbara'] })` returns `facets.regions` that still list every region with its count, and `facets.amenities` counted within Pilbara.
- [ ] `get('parkstay:20')`:
  - it calls the provider once, then serves from cache within 6 h (call log);
  - `descriptionHtml` has no `<style`;
  - with the provider failing after the TTL, it returns the cached detail with `stale: true`;
  - `get('parkstay:999')` returns code `NOT_FOUND`.
- [ ] `availability(stay)` against the bulk fixture:
  - it returns `parkstay:20` (5/3) and omits the unknown id `1`;
  - with FakeProvider throwing `AccessGateError`, `errors` contains `{ providerId: 'fake', code: 'access-gate' }` while the ParkStay entries are still returned;
  - a second identical call within 5 min makes 0 provider calls.
- [ ] Performance: `search({ text: 'bay' })` over 5,000 synthetic rows completes in under 200 ms in the Jest node environment.
- [ ] IPC: all 6 `catalog.*` handlers reject invalid payloads, such as `limit: 0` or an invalid stay, with code `VALIDATION`. They return `APIResponse` shapes that match the contract types.
- [ ] `grep -rn "api.parkstay\|parkstay:search\|CampgroundSearchResult" src` → 0 results. The existing Create Watch and Create Snipe forms still list ParkStay campgrounds, now from `catalog.search`.
- [ ] Runtime, dev build with live ParkStay:
  - first launch syncs 169 locations;
  - `await window.api.catalog.search({ limit: 5000 })` returns `total: 169`;
  - after going offline (network disabled) and relaunching, the same call still returns 169.
- [ ] `npm run lint && npm run format:check && npm run type-check && npm test` passes.

## Edge Cases

- **Sync timing:**
  - a provider that is registered but has never synced shows `stale: true` and `count: 0`, and `syncing: true` while the first sync runs;
  - the app quits mid-sync: the transaction rolls back, and the next start retries.
- **Catalogue changes.** A location removed by the provider disappears on the next sync, along with its detail cache. Watches and snipes that reference it keep their own `location_name`.
- **Search input:**
  - `text` that is only whitespace or punctuation is treated as no text;
  - non-ASCII input (`Dirk Hartog`, macrons) is handled with `remove_diacritics`;
  - a `bbox` with `west > east` gives `VALIDATION`, since antimeridian wrapping does not apply in WA;
  - `offset` beyond `total` returns empty `items` with the correct `total`.
- **Stay changes.** A stay changing while an availability request is in flight: the result is keyed by stay, so a stale response never fills the new stay's cache entry.
- **Provider registration.** A provider unregistered (removed module) with rows still in `locations`: its rows are excluded from search results and `status`.

## Test Strategy

- **Unit (~25):**
  - the FTS query builder and sanitising (~6);
  - TTL and freshness logic (~4);
  - empty-result protection (~2);
  - single-flight (~3);
  - error-code mapping (~4);
  - bbox and key filtering (~3);
  - summary derivation (~3).
- **Component:** none.
- **Integration (~12)** (`tests/integration/catalog.test.ts`): a real DB (V2) plus FakeProvider, `fake2` and the ParkStay provider on `NodeHttpClient` against the V3 fixture server. It covers:
  - sync isolation;
  - search filters and facets;
  - detail cache and stale fallback;
  - availability fan-out;
  - the IPC handlers through P3's harness;
  - the retired `parkstay` namespace (`grep -rn "api.parkstay" src` → 0).

## Context Files to Read First

- `ai-state/architecture-notes.md` §3–§5. `ai-state/streams/explore/master-plan.md` (Integration points; EQ1, EQ2, EQ3, EQ7). `ai-state/streams/providers/master-plan.md`.
- `src/shared/types/catalog.types.ts` and `src/shared/contracts/catalog.ts` (V1). `src/main/database/repositories/location.repository.ts` (V2).
- `src/main/providers/parkstay/{catalog,availability}.ts`, `src/main/providers/sdk/html.ts` and `tests/fixtures/parkstay/*` (V3).
- `src/main/ipc/handlers/parkstay.handlers.ts` (the shim, as left by V3), `src/renderer/components/forms/{WatchForm,SiteSniperForm}.tsx` and `src/main/app/container.ts` (P3).
- `ai-state/research/parkstay-api-review.md`: the "Map data" and "Risks" sections.

## Notes

- **TTL choices.** The catalogue is 24 h, matching DBCA's pre-generated, daily-cacheable map. Detail is 6 h, because `releaseInfo` and periods change. Bulk availability is 5 min, short enough for map panning without hammering DBCA. `checkLocation` is 60 s.
- **Amenities.** Raw provider strings, per explore EQ3. The renderer maps them to icons.
- **Commit.** `feat(catalog): location catalogue service and catalog IPC (#<issue>)`.

## Orchestrator addendum (2026-10-03, from the V1 merge)
- [ ] Move `catalog:get` (and any other implemented read channel in this namespace) from `PENDING_READS` into `READS` in `tests/integration/secret-sweep.test.ts`. The sweep must pass with real data seeded.
- [ ] Use V1's merged SDK as-is: `HttpClient` with real redirect semantics, the frozen registry manifests, and `ProviderContext.manifest` / `limits` (architecture-notes §12.30).
