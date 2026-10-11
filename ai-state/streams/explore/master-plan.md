# Explore — master plan

**Label:** `stream:explore` · **Lane:** R (renderer) · **Owner:** renderer agent + stakeholder review of screenshots

## Goal

Explore is WA Stay's home screen (`/`) and the brief's success criteria 3 and 4. It has three parts:

1. An Airbnb-style **search pill** (where, when, who), filter chips, and a split view. The split view pairs a scrollable result list with a **Mapbox GL** map of every location from every catalogue-capable provider: 169 ParkStay campgrounds today, and thousands later.
2. A deep-linkable **location detail** page with photos, description, facilities, units, release info, links out to the provider, a per-night availability check, and hand-offs into Watches and Site Sniper.
3. **Date-aware discovery.** Once dates are set, pins and cards show availability state per location, with an "Available only" filter.

Without a Mapbox token, or without WebGL, Explore degrades to a full list with a calm notice. Search, filters, detail and availability keep working.

## Task list

| ID | Task | Size | Depends | Status |
|---|---|---|---|---|
| E1 | [Explore screen](tasks/E1-explore-screen.md): search pill, filter chips, LocationCard list, Mapbox map (clusters, pills, hover sync, preview, "search as I move the map"), WA palette restyle, token wiring (vite, `.env.example`, CI), list-only mode, URL state, empty, loading, error and offline states | L | D3, V5 | ⬜ |
| E2 | [Location detail](tasks/E2-location-detail.md): `/places/:providerId/:externalId`, gallery, description, facilities, units, release info, external links, `catalog.checkLocation` NightGrid, Watch and Snipe hand-offs, back to Explore with its state preserved | M | E1 | ⬜ |
| E3 | [Date-aware discovery](tasks/E3-date-aware-discovery.md): `catalog.availability` per provider, availability states on pins and cards, "Available only", debounce and cache per stay, per-provider error isolation | M | E1, V5 | ⬜ |

Order: E1, then E2 and E3. E2 and E3 touch different files (the detail feature versus the explore map and cards), so they can run in parallel worktrees once E1 merges.

## Integration points

| With | What crosses the boundary |
|---|---|
| **V5** catalogue service | `catalog.search(CatalogQuery)`, `catalog.get(key)`, `catalog.availability(stay, { providerIds })`, `catalog.checkLocation(key, stay)`, `catalog.refresh(providerId?)`, `catalog.status()` and the `catalog:updated` event. E1 expects `CatalogQuery = { text?, providerIds?, kinds?, regions?, amenities?, bookingModes?, bbox?, limit?, offset? }` and that `limit: 5000` with no bbox returns the whole filtered set (see EQ2). |
| **V3** ParkStay module | Data quality the UI relies on:<br>• absolute `imageUrls` (`https://parkstay.dbca.wa.gov.au/media/…`)<br>• `area.region` (10 regions)<br>• amenity strings (`Toilet`, `Road access for 2WD/SUV`, `Dogs permitted`)<br>• `bookingMode` from `campground_type` (0 → `online`)<br>• `bookingUrl` only for online<br>• `infoUrl` (157 of 169)<br>• `descriptionHtml` (from `long_description`)<br>• `releaseInfo` |
| **V1** contract | `ProviderManifest.capabilities` (`catalog`, `availability`, `bulkAvailability`, `watches`, `snipes`, `accessGate` §12.2), `brand` and `shortName`. `StayQuery.params?` for provider stay fields. `UnitSummary` fields (EQ4). |
| **P4** hardening | CSP allowances, which E1 lists exactly in its Notes:<br>• `img-src` for Mapbox and the provider image hosts<br>• `connect-src` for `api.mapbox.com`, `*.tiles.mapbox.com` and `events.mapbox.com`<br>• `worker-src blob:` and `child-src blob:`<br>External `<a target="_blank">` links are routed to `shell.openExternal`. |
| **D3** shell | `ROUTES`/`buildPath`, `api/` patterns, the tray (bottom-right, so map logo and attribution go bottom-left), `useRouteFocus`, `ProviderManifestsProvider`. |
| **D2** primitives | `Combobox`, `DateRangeField` and `GuestsField` (`appearance="segment"`), `Popover`, `Checkbox`, `Switch`, `Notice`, `Skeleton`, `EmptyState`, `Dialog` (gallery), `ProviderBadge`, `useAnnounce`. |
| **U1 / U2** | Hand-off URL contract, binding per architecture-notes §12.10: `/watches/new?provider=<id>&location=<externalId>&arrival=YYYY-MM-DD&departure=YYYY-MM-DD&adults=N&children=N`, and the same shape for `/site-sniper/new`. E2 adds a minimal bridge in the legacy create pages. U1 and U2 must keep honouring these parameters.<br>**Note:** provider-ux `master-plan.md` and U1 still say `/watches/create?location=<key>`. D3's redirect keeps the query string, but U1 should align with §12.10. |
| **U5** notifications | Notifications about a location deep-link to `ROUTES.placeDetail`. |
| **Q1 / Q2** | Q1 smoke-tests Explore in list-only mode (CI has no token for PRs). Q2 documents token setup, token scopes and Mapbox terms (attribution, `events.mapbox.com`). |
| **CI** | `.github/workflows/build.yml` gains `MAPBOX_ACCESS_TOKEN: ${{ secrets.MAPBOX_ACCESS_TOKEN }}` on the build step (E1). |

## Out of scope

- Booking inside the app (holds and payment belong to the Site Sniper and V6 flows), plus prices and price sorting. ParkStay's bulk availability has no prices.
- Reviews, ratings, saved places and favourites, sharing, and recently viewed.
- Offline map tiles, directions and routing, 3D terrain, pitch and rotate, and satellite imagery.
- Deduplicating the same physical place across providers, and other providers' data (RAC and Airbnb are future projects).
- A custom Mapbox Studio style owned by an account, and Mapbox Search or Geocoding APIs. "Where" searches the local catalogue only.
- Rebuilding Watches and Site Sniper forms (U1 and U2). E2 only hands off.

## Open questions

| # | Question | Blocks | Proposed default |
|---|---|---|---|
| EQ1 | The stay-specific booking deep link must be built in main (`links.booking(externalId, stay)`). Add `bookingUrl?: string` to `LocationAvailability`, or add `catalog.links(key, stay?)`. | E2 "Book these dates" | Add `bookingUrl?` to `LocationAvailability` (V5). Until then, fall back to the stay-less `LocationDetail.bookingUrl`. |
| EQ2 | Final `CatalogQuery` shape and limit semantics. Is `limit: 5000` acceptable as "everything"? | E1 | As above. Move bbox and pagination server-side past 10k locations. |
| EQ3 | Amenity vocabulary: raw provider strings, or normalised slugs with labels? | E1 chips, E2 facilities | Raw strings, with an icon map and a fallback icon. Revisit when a second provider lands. |
| EQ4 | `UnitSummary` fields (`type`, `maxPeople`, `equipment[]`) are not defined in §3. | E2 units summary | `{ id, name, type?, maxPeople?, equipment?: string[] }` |
| EQ5 | Mapbox token scopes and quota. Use a dedicated public `pk.` token with only public scopes (URL restrictions don't apply to `file://`). There are 50k free web map loads a month. | E1 docs, release | Stakeholder creates the token, and Q2 documents it. |
| EQ6 | Maximum nights and advance window per provider: should the manifest expose them? | E3 / DateRangeField limits | 30 nights in the UI, with no maximum date. |
| EQ7 | Does an active DBCA queue delay `catalog.availability` or `checkLocation`? | E3/E2 copy | Show a "Still checking ParkStay" notice after 10 s. |
| EQ8 | Should E1 split into E1a (list-only Explore, shippable alone, which is also the degraded mode) and E1b (map)? | E1 plan approval | One issue with two commits in that order. Split if the plan estimates more than 2 days. |

## Changelog

- **2026-10-02:** Stream master plan created with E1–E3 specs. The decision for E2 is a full route rather than a sheet. Open questions EQ1–EQ8 are recorded.
- **2026-10-02:** Aligned with architecture-notes §12:
  - E2 hand-offs use the §12.10 prefill contract (`location=<externalId>`, adults and children).
  - The E1 Provider chip is always shown (§12.9).
  - The E2 and E3 queue copy depends on `capabilities.accessGate` (§12.2).
  - Stay fields on E2 are deferred (§12.1).
