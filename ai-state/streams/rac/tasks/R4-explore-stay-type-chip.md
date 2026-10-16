# R4: Explore "Stay type" chip

## Description
As a person planning a trip, I can tell Explore "cabins" or "camping", so I see only places with what I want to sleep in, and the free counts mean what I chose. Brief R4: one "Stay type" filter with five groups replaces Explore's location "Type" chip. This task builds it on R1: the chip, its URL param, facet counts, free counts that follow the chosen types, and the choice passed on into the create flows' prefill.

## Size
M

## Depends on
R1 (`UnitKind`, `STAY_TYPES`, `unitKindsOf`, `CatalogQuery.unitKinds`, `byKind`).

## Scope
1. **Filters** (`src/renderer/features/explore/filters/facets.ts`):
   - `ExploreFilters.stayTypes: UnitKind[]` replaces `kinds`.
   - `matchesFilters` passes a place when any of `unitKindsOf(place)` is chosen. `facetCounts('stayTypes')` counts each place once for each of its kinds.
   - `ExploreFacets.stayTypes` lists the `STAY_TYPES` the catalogue has, in group order (not A to Z), with R1's labels. `other` is never an option.
2. **Chip** (`FilterRow.tsx:46-53`):
   - "Stay type" takes the place of "Type", on the same `FilterChip`, with the hint "Places with any of these".
   - It is shown when the catalogue has at least two of the five groups (`ExplorePage.tsx:768`).
3. **URL** (`state/exploreParams.ts`):
   - `stay` is a comma list of `campsite`, `cabin`, `room`, `dorm` and `glamping`. Unknown values and `other` are dropped.
   - `kinds` is no longer read, and is dropped from the canonical address.
   - Update `EXPLORE_KEYS`, `hasActiveFilters`, and `NO_FILTERS` in `ExplorePage.tsx:483`.
4. **Query:**
   - Explore's `CatalogQuery` sends `unitKinds` (R1's filter in main) in place of `kinds`.
   - `normaliseCatalogQuery` (`src/renderer/api/catalog.ts:46`) sorts it.
   - The DEV `devFixture` and `syntheticLocations` filter by it too.
5. **Free counts** (`availability/deriveAvailability.ts:75`):
   - The input gains `stayTypes` (S), and the location gains `unitKinds`. K is `unitKindsOf(place)`.
   - S empty, or every kind in K chosen: the totals, as today.
   - Otherwise, when `entry.byKind` has an entry for a kind in S ∩ K: sum `availableUnits` and `bookableUnits` over S ∩ K (a kind with no entry counts 0), then derive the same states.
   - Otherwise: `check-dates` ("Check dates on the place page").
   - Map pills, cards, "Available only" and `sortByAvailability` all use the result.
6. **Prefill:**
   - `CreatePrefill.stay?: UnitKind[]` (`src/renderer/app/routes.ts:72`), written as `stay=cabin,room` and read by `parseCreatePrefill` (`:107`), which drops unknown values.
   - Explore's link to a place carries `stay`, and the place page passes it to `handoffPrefill` (`features/place/placeModel.ts:110`).
   - The create flows ignore it until R6.
7. **Docs and site:**
   - `docs/design/shell.md:160`: "Type" → "Stay type".
   - `npm run docs:screenshots` when `docs/images/explore.png` shows the filter row.
   - `site/index.html:152`: "by the kind of place" → "by the kind of stay (camping, cabins, rooms and more)" (CLAUDE.md "Website").
   - CLAUDE.md "UI Status" routes: the prefill query gains `&stay=`.

## Non-goals
- Stay-type chips in the create flows, reading `stay=` there, and UnitPicker grouping (R6).
- Unit nouns in labels ("2 of 5 sites available") (R9).
- RAC's `byKind` and "Still checking RAC…" (R11).
- `CatalogQuery.kinds` stays in the contract, unused by Explore.
- The website screenshots, which need a Mapbox token (R20).

## Completion Criteria
- [ ] `ExplorePage.test.tsx`:
  - the "Filters" group's buttons read `['Provider', 'Stay type', 'Region', 'Facilities', 'Book online', 'Available only']`;
  - choosing "Cabins & villas" gives the route `/?stay=cabin`, `catalog.search` called with `unitKinds: ['cabin']`, and the matching results count;
  - the chip is hidden for a catalogue of campgrounds only. This replaces the "filters by type" test (`:212-223`).
- [ ] The options are checkboxes in group order, named "<label>, N places" (for example "Camping, N places"), where N is what `facetCounts` gives for the renderer fixture.
- [ ] `/?kinds=holiday-park&stay=cabin,castle,other` is rewritten in place to `/?stay=cabin` (`exploreParams.test.ts` and the page test at `:288`).
- [ ] `deriveAvailability.test.ts` has at least 8 new cases:
  - totals when nothing is chosen, or when every kind of the place is chosen;
  - `byKind` sums;
  - a chosen kind missing from `byKind`;
  - no usable `byKind` → `check-dates`;
  - NaN counts clamp to 0;
  - "Available only" hides a `check-dates` place.
- [ ] `routes.test.ts`: `parseCreatePrefill('?stay=cabin,castle')` gives `{ stay: ['cabin'] }`, and `ROUTES.watchNew({ stay: ['cabin', 'room'] })` round-trips.
- [ ] `placeModel.test.ts`: `handoffPrefill` keeps `stay`. `PlaceDetailPage.test.tsx`: the watch link carries `stay=cabin` when the page was opened with it.
- [ ] E2E: one step added to an existing Explore journey: "Stay type → Dorms" lists Yeagarup Hut and none of the campgrounds (fixture `campground_map.json`). Still 22 journeys.
- [ ] Accessibility:
  - the chip is named "Stay type", and "Stay type, 1 selected" with one chosen;
  - each option is a checkbox named "<label>, N places";
  - Escape and Done return focus to the chip (asserted for this chip);
  - a `check-dates` place says so in words on its card and its pill, not by colour alone.
- [ ] `shell.md`, the site sentence and CLAUDE.md updated. Docs screenshots retaken if they show the row.
- [ ] The full gate passes: `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`, then `npm run build:e2e && xvfb-run -a npm run test:e2e`.

## Edge Cases
- The catalogue is still loading (no items): the chip is hidden until its options are known.
- `stay` names a valid kind no place has: kept and shown checked with a count of 0 (`FilterChip` keeps chosen options enabled).
- A place whose provider has no bulk availability: the existing order still applies (`check-dates` or `not-supported` first).
- `byKind` present but with no entry for any chosen kind: `check-dates`, never "Not open".
- "Clear all" clears stay types. The search text with a stay type: counts are taken over the text's matches, as today.
- The ParkStay e2e catalogue has a holiday park, a hut and a homestead, so the chip shows Camping, Cabins & villas and Dorms.
- An address with `kinds=` (old history or a pasted link): dropped silently, with no error.
- A place with every kind chosen but no `byKind`: the totals, not `check-dates`.

## Test Strategy
- **Unit:** facets (≈6), exploreParams (≈5), deriveAvailability (≈8), routes and placeModel (≈4).
- **Component:** ExplorePage (≈4), FilterRow (≈2), PlaceDetailPage (≈1).
- **Integration:** none beyond R1's catalogue filter.
- **E2E:** one step in an existing Explore journey; the other journeys unchanged.

## Context Files to Read First
- `ai-state/brief.md` Project 2 (R4); `ai-state/streams/rac/master-plan.md` (decision 4, Integration point 3)
- `src/shared/utils/unit-kinds.ts` and the R1 types
- `src/renderer/features/explore/ExplorePage.tsx`, `filters/` (facets, FilterRow, FilterChip), `state/exploreParams.ts`, `availability/deriveAvailability.ts`, `dev/`
- `src/renderer/api/catalog.ts`
- `src/renderer/app/routes.ts`, `stayParams.ts`; `src/renderer/features/place/placeModel.ts`, `PlaceDetailPage.tsx`
- `src/renderer/features/explore/ExplorePage.test.tsx`, `filters/facets.test.ts`
- `docs/design/shell.md`, `docs/design/components.md`, `site/index.html`
- `tests/e2e/support/wa-stay.ts`, `tests/e2e/fixtures/http/parkstay/campground_map.json`

## Notes
- Explore's results come from main (`useCatalogSearch` → `catalog.search`, SQL). Its chip counts come from the renderer (`buildFacets` over `useCatalogAll`). The master plan says "client-side". Both layers apply the filter, so main and the renderer must agree on `unitKindsOf`.
- The free-count rule keeps counts honest: a figure about cabins is never shown when it may include sites.

## Assumptions
- Shown when two or more of the five groups exist. ParkStay alone (with its type-2 places) shows the chip, while "Type" showed too.
- The `stay` key name and its values are the `UnitKind` ids (the master plan names the key, not the values).
- The site sentence is updated here, not in R20, because CLAUDE.md asks for the website in the same change.
