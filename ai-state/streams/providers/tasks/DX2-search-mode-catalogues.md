# DX2 — Search-mode catalogues work in the app

## Description
The registry accepts `capabilities.catalogMode: 'search'` with a `catalog.searchArea`, but nothing
in the app calls it: `LocationCatalogService.syncableMode` skips such providers. A search-mode
provider therefore shows 0 places on Explore, and the watch flow's location search says "No
locations match" (provider DX review). Search mode is the intended path for marketplaces too big
to list (Airbnb- and Hipcamp-like). Make it work end to end.

Stakeholder decision (2026-10-11): do the first group of DX fixes.

## Scope
1. **Core: area search** in `LocationCatalogService`.
   - When the Explore results are asked for a map area (a `CatalogQuery` with `bbox`), search-mode
     providers are asked for that area through `catalog.searchArea({ bbox, stay? })`.
   - Results are upserted into the stored catalogue (`locations` / `locations_fts`), with the
     provider's id, so these all work for them unchanged:
     - FTS search;
     - filters and facets;
     - the place page (`catalog.get`, with the detail cache);
     - availability;
     - watches.
   - Bounded and polite:
     - single-flight per provider and area key (round the bbox so small pans reuse a search);
     - a TTL per area key (default from `limits.catalogTtlHours`, or shorter if that is better
       reasoned);
     - a page cap per area, following `nextCursor` up to N pages, N small and stated;
     - `maxConcurrentRequests` honoured;
     - abortable on stop and dispose.
   - Non-blocking: `catalog.search` answers from the stored catalogue at once, then emits
     `catalog:updated` when an area search has stored new rows, so Explore refetches. This is the
     same event the full sync uses.
   - Rows found by area search do not get the full-sync "remove what disappeared" treatment.
     Define and document how stale search rows age out: never removed is acceptable if stated,
     because watches and bookings may refer to them.
   - `catalog.status` reports search-mode providers sensibly: last area search, error.
2. **Text search for the watch flow and Explore's "Where".**
   - Add an optional `catalog.searchText?(text, signal)` to `CatalogModule` (SDK, typed,
     documented). Search-mode providers may implement it; if they do, a text query also asks them,
     with the same caching, upsert and event.
   - Without it, the location step finds that provider's places seen so far (stored rows). It shows
     a short, plain hint ("Browse {provider} places on the Explore map to find more"), not "No
     locations match".
3. **Contract suite** (`tests/utils/provider-contract.ts`). For search-mode providers, check that
   `searchArea`:
   - returns items inside the bbox, give or take a small tolerance;
   - pages by cursor and terminates;
   - respects abort.

   If `searchText` exists, check it returns items. Add a fake search-mode provider to the fakes.
4. **UI.**
   - Explore: no visible change for ParkStay. Search-mode places appear as the area loads.
   - No spinner storm: reuse the existing "refreshing" affordance if there is one.
   - The place page and the watch prefill work for a search-mode place.
5. **Docs:**
   - `docs/providers/adding-a-provider.md`: the capability table no longer says "leaves a hook"; it
     describes the real behaviour.
   - `docs/providers/browser-providers.md`: the search-mode section.
   - CLAUDE.md: the LocationCatalogService row.

   DX4 rewrites the guide later, so keep these edits accurate and small.

## Non-goals
- No change to ParkStay (`full` mode) behaviour or its sync.
- No new real provider.

## Completion Criteria
- [ ] Integration tests through the IPC harness, with a fake search-mode provider (plus ParkStay
  where relevant):
  - Explore `catalog.search` with a bbox triggers an area search;
  - rows are stored;
  - `catalog:updated` fires;
  - a second search of the same area within the TTL does not call the provider again;
  - paging is capped;
  - abort on dispose works;
  - `catalog.get`, `catalog.checkLocation` and `watches.create` work for a search-mode place;
  - text search with and without `searchText`.
- [ ] Renderer tests:
  - Explore shows search-mode places after `catalog:updated`;
  - the location step shows the hint when a search-mode provider has no text search.
- [ ] The contract suite has the new search-mode checks, with tests of the suite itself.
- [ ] The gate passes on Node 24:
  - lint, format, type-check;
  - `npm test` and `test:tz`;
  - e2e (21 journeys unchanged).

## Context Files to Read First
- `CLAUDE.md`
- `ai-state/research/provider-dx-review.md`
- `src/main/providers/sdk/provider.ts`, `src/main/providers/registry.ts`
- `src/main/core/catalog/location-catalog.service.ts` and its repository
- `src/shared/contracts/catalog.ts`
- `src/renderer/features/explore/*`
- `src/renderer/components/stay/LocationCombobox*`
- `tests/utils/provider-contract.ts`, `tests/utils/fake-provider.ts`
