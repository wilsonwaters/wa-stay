# E1 — Explore screen: search, filters, results list and Mapbox map

**Stream:** explore · **Depends on:** D3, V5

## Description

Explore replaces the retired Dashboard as the home screen at `/`. Users search the location catalogue (169 ParkStay campgrounds today) through an Airbnb-style centred search pill and filter chips. They browse a photo-first result list beside a Mapbox GL map of Western Australia, styled in the WA palette, with clustered pins and pill labels. Hovering, focusing or clicking keeps the map and the list in sync, and "Search as I move the map" narrows the list to the visible area.

The map needs a public Mapbox token that is injected at build time. Without one, or without WebGL, Explore becomes a list-only screen with a calm notice. This task wires the token, `.env.example` and CI.

As a traveller, I can search and filter places across WA and see them on a map, so I can find somewhere to stay in the area I want.

## Size

L. This is complex UI plus build wiring. Deliver it in two commits: (a) list-only Explore with search, filters, cards and states, which is also the degraded mode; (b) the map (EQ8).

## Scope

**In scope:**
- **`features/explore/ExplorePage.tsx` at `ROUTES.explore` (`/`)**
  - Replaces the D3 placeholder and has a visually hidden `h1` "Explore places to stay".
  - A sticky sub-header holds the search pill (centred, max 860 px) and the filter row.
  - At 1024 px and wider, the body is split: list on the left (`minmax(0,1fr)`), map on the right (`minmax(0,0.85fr)`), with the map filling the height below the sub-header.
  - Below 1024 px, one pane shows at a time, with a floating ink pill toggle "Show map" / "Show list".
- **URL state** (`features/explore/state/exploreParams.ts`, pure `parse`/`serialise`, plus `useExploreParams`):
  - Parameters: `q`; `providers`, `kinds`, `regions`, `amenities` (comma lists); `online=1`; `arrival`, `departure` (`YYYY-MM-DD`); `adults`, `children`, `infants`; `map=lng,lat,zoom`; `follow=0`; `view=map|list`; `sel=<location key>`.
  - Invalid values are dropped, and the URL is rewritten with `replace`.
  - Camera changes write `map` with `replace`, debounced 500 ms. The other state changes push history entries.
- **Search pill** (`features/explore/search/SearchPill.tsx`): a `role="search"` form named "Search places".
  - **Where** is a D2 `Combobox` (`appearance="segment"`) with up to 8 grouped suggestions (Regions, Areas, Places) from the cached unfiltered catalogue. A region sets the `regions` filter and fits the map to it. An area sets `q` to the area name. A place sets `sel` and flies to it. Free text with Enter sets `q`, and typing is debounced 250 ms.
  - **When** is a `DateRangeField` (`minDate` = today in Australia/Perth, `maxNights` 30). **Who** is a `GuestsField`.
  - A coral round `IconButton` "Search" applies `q` immediately.
  - Dates and guests go into the URL for E2 and E3. E1 does not use them otherwise.
- **Filter row** (`features/explore/filters/`):
  - `FilterChip`s each open a `Popover` of `Checkbox`es with per-option counts:
    - **Provider**: catalogue-capable providers. Always shown, even when only one provider exists (§12.9).
    - **Type**: location kinds. Hidden when the unfiltered set has only one kind.
    - **Region**.
    - **Facilities**: amenities. A place must have all selected facilities.
  - A **Book online** toggle chip (`aria-pressed`) sets `bookingModes: ['online']`.
  - **Clear all** (ghost) appears when any filter is active.
  - Options within a chip are OR-ed. Chips are AND-ed together.
- **Data** (`src/renderer/api/catalog.ts`):
  - `useCatalogSearch(query)` calls `catalog.search({ …filters, limit: 5000 })` with `placeholderData: keepPreviousData` and a 5 min `staleTime`.
  - `useCatalogAll()` is the unfiltered query used for facets and suggestions.
  - Also `useCatalogStatus()`, `useCatalogRefresh()` (mutation) and `useInvalidateOn('catalog:updated', qk.catalog.all)`.
  - The bbox filter is applied **client-side** with `withinBbox`, so panning never calls IPC.
- **Results** (`features/explore/results/ResultsList.tsx`):
  - An `h2` reads "{n} places", or "{n} places in map area" when following the map.
  - The grid has 1 column, or 2 at 1280 px and wider. It renders the first 40 cards, and "Show more places" adds 40 at a time.
  - Shared `components/LocationCard.tsx` is a single link to `ROUTES.placeDetail(providerId, externalId)`, named by the location name. It shows a `LocationPhoto` (4:3, lazy, skeleton, falling back to the D1 `PhotoPlaceholder`), the name (2-line clamp), "Area · Region", a compact `ProviderBadge` and the kind label, up to 3 amenity icons plus "+n" (each with a `VisuallyHidden` name), a "Book online" or "Info only" tag, and "{unitCount} sites" (the noun comes from the kind).
  - `components/amenityIcons.ts`: Dogs permitted → `Dog`, Toilet → `Toilet`, Road access for 2WD/SUV → `CarFront`, anything else → `MapPin`.
- **Map** (`features/explore/map/`):
  - **Structure.** `MapView.tsx` is lazy-loaded. `mapboxController.ts` dynamically imports `mapbox-gl` and its CSS. Tests inject a fake through the `MapController` interface (`setData`, `setHovered`, `setSelected`, `fitBounds`, `flyTo`, `onMoveEnd`, `onFeatureHover`, `onFeatureClick`, `resize`, `destroy`).
  - **Style and options.** `mapbox://styles/mapbox/outdoors-v12` with `projection: 'mercator'`, `dragRotate: false`, `pitchWithRotate: false`, `renderWorldCopies: false` and `minZoom: 3`. Initial `bounds [[112.5,-35.6],[129.2,-13.5]]` with 32 px padding, unless `map` is in the URL. `NavigationControl({ showCompass: false })` sits top-right. `logoPosition: 'bottom-left'` and a compact attribution bottom-left keep them clear of D3's bottom-right tray.
  - **`applyWaPalette(map, tokens)`** (`waPalette.ts`) runs on `style.load`, with token RGB values read from CSS variables: `land` → sand-50, `water`/`waterway` → ocean-100/200, `national-park` and park `landuse` → eucalypt-50, `hillshade` exaggeration 0.25, `contour-*` opacity 0.3. Each call is guarded by `map.getLayer(id)`, so a missing layer is skipped and logged once in DEV.
  - **Source `locations`.** GeoJSON with `promoteId: 'key'`, `cluster: true`, `clusterRadius: 48`, `clusterMaxZoom: 10`, built by the pure `toFeatureCollection(items)`. `setData` runs only when the filtered key set changes.
  - **Layers**, from the pure `buildLayers(tokens)`:
    - `clusters`: white circle, ink 1.5 px stroke, radius stepped by `point_count`, with an ink `cluster-count`.
    - `location-dot`: white circle, ink 2 px stroke. Feature-state `hover`/`selected` turns it ink at radius 8.
    - `location-pill`: symbol layer at zoom 8 and above. Name truncated to 22 characters plus "…", `text-font ['DIN Pro Medium','Arial Unicode MS Regular']` size 12, on an SDF stretchable pill (`icon-text-fit: 'both'`). Colours swap to ink/white on hover or selection. Collisions hide pills, but dots always stay.
    - One DOM `Marker` pill shows the hovered or selected location, even when it is clustered.
  - **Interactions.**
    - Hover or focus on a card highlights its pin. Hover on a pin highlights its card, without scrolling.
    - Clicking a pin sets `sel`, scrolls the card into view (`block: 'nearest'`) and opens a preview with a thumbnail, name, area, compact ProviderBadge and a "View details" link. Esc or a click on empty map clears it.
    - Clicking a cluster eases to `getClusterExpansionZoom`. At max zoom it opens a list of the cluster's places instead.
    - A `Switch` "Search as I move the map" (on by default) sits top-left. When it is off, panning shows a "Search this area" pill.
    - Changing `q` or a filter (not bbox) fits the map to the results, up to zoom 11. With zero results the camera stays put.
    - Below 1024 px the map stays mounted while hidden and calls `resize()` when shown, so it is never reloaded.
- **Token wiring:**
  - `vite.config.ts` uses `loadEnv(mode, __dirname, '')`, because root is `src/renderer`, so the repo-root `.env` must be loaded explicitly.
  - The token is `process.env.MAPBOX_ACCESS_TOKEN ?? env.MAPBOX_ACCESS_TOKEN ?? ''`, exposed only via `define: { __MAPBOX_ACCESS_TOKEN__ }` and never via `envPrefix`. The build fails if the token starts with `sk.`.
  - `src/renderer/env.d.ts` declares the global. `map/mapboxToken.ts` `getMapboxToken()` returns `null` unless the token starts with `pk.`, with a `typeof` guard so jest works.
  - Add `.env.example` at the repo root containing `MAPBOX_ACCESS_TOKEN=` and a comment.
  - In `.github/workflows/build.yml`, the `build-windows` "Build application" step gets `env: MAPBOX_ACCESS_TOKEN: ${{ secrets.MAPBOX_ACCESS_TOKEN }}`.
- **List-only mode:**
  - Triggered by: no token, no WebGL (a `canvas.getContext('webgl2'||'webgl')` probe), a map init failure, or a 401 or style error.
  - The list goes full width, and the toggle and switch are hidden.
  - An info `Notice` reads "The map isn't available in this build, so places are shown as a list." DEV builds add "Set MAPBOX_ACCESS_TOKEN in .env to enable it."
  - On a load failure the notice reads "The map couldn't load, so places are shown as a list." with "Try again".

**Out of scope:** the detail page (E2), date-based availability (E3), sorting options, prices.

## Non-goals

- No Mapbox Search or Geocoding. "Where" searches only the local catalogue.
- No account-owned Studio style, globe, 3D, terrain or rotation.
- No server-side bbox or pagination yet (EQ2), and no list virtualisation library.
- No main-process changes, apart from the CSP allowances listed in Notes, which go to P4.

## Completion Criteria

- [ ] With the dev token, `/` shows the search pill, chips, "169 places" and a map of WA with clusters and dots. Name pills appear at zoom 8 and above.
- [ ] Without a token (`npm run dev`, no `.env`), `/` shows the full-width list and the info notice. There is no map region and no request to `api.mapbox.com`.
- [ ] Typing "Cape" (250 ms debounce) calls `catalog.search` with `text: 'Cape'` and adds `q=Cape` to the URL. A reload restores both.
- [ ] Choosing "Pilbara" in the Region chip shows 39 places and the chip reads "Region · 1". "Clear all" restores 169.
- [ ] "Dogs permitted" plus "Toilet" shows only places with both.
- [ ] "Book online" shows only the 106 `online` places.
- [ ] The Where suggestion "Pilbara (region)" sets the filter and fits the map. A place suggestion selects its card and flies to its pin.
- [ ] Hovering a card highlights its pin (feature-state plus overlay marker), and hovering a pin highlights its card. A render-count test shows only the previously and newly hovered cards re-render.
- [ ] Clicking a pin selects its card, scrolls to it and opens the preview. "View details" navigates to `/places/parkstay/<id>`.
- [ ] With "Search as I move the map" on, panning to the Kimberley narrows the list. With it off, "Search this area" appears, and applying it narrows the list.
- [ ] At 960–1023 px wide, the "Show map"/"Show list" toggle switches panes and the map keeps its camera.
- [ ] The Mapbox logo and attribution stay visible bottom-left while a toast and the queue status are in the tray.
- [ ] Loading shows 8 skeletons with the results region `aria-busy`. Syncing shows "Getting places ready". A failed sync shows "We couldn't load places" and "Try again", which calls `catalog.refresh`.
- [ ] No matches shows "No places match your search" and "Clear filters". An empty map area shows "No places in this part of the map" and "Show all of WA".
- [ ] A search error with previous data shows a danger Notice with "Retry". Offline shows "You're offline. Showing saved places; photos and map tiles may not load."
- [ ] A broken image URL falls back to `PhotoPlaceholder`, named "No photo available for {name}".
- [ ] `vite build` with `MAPBOX_ACCESS_TOKEN=sk.x` fails with the message. `.env.example` exists. `build.yml` passes the secret to the build step.
- [ ] The token guard and API-boundary guard pass for `features/explore/**`, `components/LocationCard*` and `api/catalog.ts`.
- [ ] **Accessibility:**
  - [ ] After a search or filter change, a polite live region announces "{n} places" (debounced 500 ms).
  - [ ] Filter chips expose `aria-expanded` and a selected count in their name ("Region, 1 selected"). "Book online" exposes `aria-pressed`. Closing a popover returns focus to its chip.
  - [ ] Tab order is search pill → chips → results → map controls. Focusing a card highlights its pin. The map region is named "Map of places". Esc closes the preview.
  - [ ] The map/list toggle moves focus to the heading of the pane it reveals.
  - [ ] Pill and cluster colours pass the D1 pairs (ink on white and white on ink are both 17.8:1). axe on `/` reports 0 critical/serious issues in both list-only and map modes.
- [ ] The 4-check gate passes: `npm run lint` (0 errors), `npm run format:check`, `npm run type-check`, `npm test`.

## Edge Cases

- A missing or invalid `lat`/`lng` (NaN, or 0,0) keeps the place out of the map. It stays in the list with "No map location".
- Places with identical coordinates can't be split by zooming, so at max zoom the cluster opens a list of them.
- A 51-character name is clamped on the card and truncated in the pill. The preview and the accessible name show it in full.
- Search text containing FTS syntax (`"`, `*`, `-`, `AND`) is passed through for main to sanitise. The UI never crashes, and errors show the error state.
- An unknown `regions=` or `providers=` URL value is dropped silently. An arrival on or after the departure removes both dates.
- Resizing across 1024 px keeps `sel`, the camera and the scroll position, and never re-creates the map.
- In DEV, React StrictMode double-mounts: the effect cleanup calls `destroy()`. Production creates exactly one map.
- If `catalog:updated` arrives mid-search, results refresh in place without flicker (`keepPreviousData`). The selection survives if its key still exists.
- If no provider has `catalog`, the empty state reads "No providers with places are installed".
- With 5,000 synthetic places (DEV-only `?devFixture=5000`), typing stays responsive, only 40 cards are in the DOM, and panning is smooth (manual check).

## Test Strategy

- **Unit** (about 22 tests): the `exploreParams` round trip and invalid-value cleanup; facets and counts; suggestion ranking and grouping; `withinBbox`; `toFeatureCollection` (drops invalid coordinates, promotes the key); `buildLayers` (layer ids, cluster filter, pill minzoom); `applyWaPalette` with a fake map (missing layers skipped, no throw); `getMapboxToken` (accepts `pk.`, rejects `sk.` and empty); the vite token resolver (throws on `sk.`); the WebGL probe; and the amenity icon fallback.
- **Component** (about 20 tests, using `renderWithApp` + `createMockApi` + `FakeMapController`): the list-only notice; search debounce and URL updates; each chip, Clear all and the Book online toggle; Where suggestions; every listed state; LocationCard name, tags and image fallback; the hover re-render count; pin click selecting and scrolling; follow on/off and "Search this area"; the narrow toggle and its focus; announcements.
- **Integration:** `tests/integration/renderer/explore.test.tsx` runs shell → `/` → search → region chip → open a card → `/places/...`. A seeded 5k fixture lives in `tests/fixtures/catalog/synthetic-locations.ts`.
- **Runtime verification:** map mode with the token, list-only mode without it, axe, and screenshots at 1440 and 1000 px.

## Context Files to Read First

- `ai-state/streams/explore/master-plan.md`, `ai-state/streams/design-system/master-plan.md`, `docs/design/{design-language,components,shell}.md`.
- `ai-state/architecture-notes.md`: §3 (`LocationSummary`, `BookingMode`), §4 `catalog.*` and events, §8, §9, §10.
- `ai-state/research/parkstay-api-review.md` (map data facts), `ai-state/research/ui-review.md` (CSP).
- `src/shared/contracts/catalog*`, `src/shared/types/catalog.types.ts` (V5), `src/renderer/api/*`, `src/renderer/app/routes.ts`, `src/renderer/components/ui/index.ts`.
- `vite.config.ts`, `.github/workflows/build.yml`, `.gitignore`, `ai-state/RUNBOOK.md` (Mapbox).
- `node_modules/mapbox-gl/dist/mapbox-gl.d.ts`: Map options, `GeoJSONSource.getClusterExpansionZoom`, and `addImage` with `sdf`/`stretchX`/`content`.

## Notes

- **Why outdoors-v12:**
  - Most places sit inside national parks. Outdoors shows park boundaries, hillshade and unsealed tracks, which matter for 2WD/4WD trips.
  - Recolouring land, water and parks gives the calm WA palette without an account-owned Studio style.
  - Mapbox Standard was rejected: its basemap is an imported style that `setPaintProperty` can't reach (it only has config properties), and it defaults to 3D/globe.
  - `light-v11` lacks terrain and tracks.
  - Record the verified layer list in `docs/design/map.md`.
- **CSP for P4** (prod and dev): `connect-src https://api.mapbox.com https://*.tiles.mapbox.com https://events.mapbox.com`; `img-src 'self' data: blob: https://api.mapbox.com https://parkstay.dbca.wa.gov.au`; `worker-src blob:`; `child-src blob:`.
  - Never block `events.mapbox.com`, because Mapbox counts map loads there (terms).
  - Keep the logo and attribution visible.
- The token is public by design (`pk.`), so give it public scopes only. URL restrictions don't apply to `file://` (EQ5).
- Import lucide's `Map` as `MapIcon`.
- Provider images are hot-linked live (O8). `LocationPhoto` uses `referrerPolicy="no-referrer"`, `loading="lazy"` and `decoding="async"`.

## Orchestrator addendum (2026-10-04, from Q1 phase 1)
- [ ] Extend the Q1 Electron smoke suite (`tests/e2e/`, see tests/README.md "Adding a journey"): add a trimmed ParkStay catalogue fixture under `tests/e2e/fixtures/http/parkstay/` and launch assertions that Explore lists campgrounds (and shows the map or the list-only fallback). Filter guard log entries for remote images in the "unexpected requests empty" assertion.
- [ ] Mapbox attribution and logo bottom-left (the tray is bottom-right).
