# E3 — Date-aware discovery (availability on map and cards)

**Stream:** explore · **Depends on:** E1, V5

## Description

Once a traveller sets dates (and guests) in the search pill, Explore should answer "where can I actually stay?". Each location's pin and card shows its availability for that stay:
- the number of units available
- fully booked
- nothing open for these dates
- "Check dates" for providers that can't report in bulk
- not bookable online
- unknown

An "Available only" filter narrows the list and the map. Each catalogue-capable provider with `bulkAvailability` is queried separately, so one provider failing or being slow never breaks the map. Results are debounced and cached per stay, so changing the dates back and forth is instant.

As a traveller with fixed dates, I can see at a glance which places have room, so I don't open dozens of fully booked campgrounds.

## Size

M

## Scope

**In scope:**
- **Stay:** taken from the E1 URL params (`arrival`, `departure`, `adults`, `children`, `infants`) and debounced 400 ms by `useDebouncedValue`.
  - `stayKey = arrival_departure_adults_children_infants`.
  - The stay is "set" only when both dates are valid and `adults >= 1`.
- **Data** (`api/catalog.ts`): `useBulkAvailability(stay)` uses `useQueries`, with one query per provider from `useProvidersWith('bulkAvailability')` that also has `catalog`.
  - Each query calls `catalog.availability(stay, { providerIds: [id] })` with key `qk.catalog.availability(stayKey, id)`.
  - Cache: `staleTime` 2 minutes, `gcTime` 15 minutes.
  - Enabled only while the stay is set and `navigator.onLine` is true.
  - Returns `{ byKey: Map<string, BulkAvailabilityEntry>, statusByProvider: Record<id, 'loading'|'success'|'error'>, errors, refetch(providerId) }`.
- **Derivation:** the pure function `features/explore/availability/deriveAvailability.ts` produces `PlaceAvailability`.
  - The states, in order of precedence:

    | State | Condition |
    |---|---|
    | `no-dates` | no stay set |
    | `offline-booking` | `bookingMode !== 'online'` |
    | `check-dates` | provider has `availability` but not `bulkAvailability` |
    | `not-supported` | provider has neither |
    | `error` | the provider's query failed |
    | `loading` | |
    | `available` | `availableUnits > 0` |
    | `full` | `availableUnits === 0 && bookableUnits > 0` |
    | `none-open` | `bookableUnits === 0` |
    | `unknown` | the provider succeeded but returned no entry for this key |

  - `availabilityLabel(state, kind)` returns `{ pill, card, tone }`:

    | State | Pill | Card | Tone |
    |---|---|---|---|
    | available | "8 available" | "8 of 24 sites available" | available |
    | full | "Full" | "Fully booked" | neutral |
    | none-open | "Not open" | "No sites open for these dates" | neutral |
    | check-dates | "Check dates" | "Check dates on the place page" | neutral |
    | offline-booking | "Info only" | "Not bookable online" | neutral |
    | not-supported | "–" | "Availability not shared by {shortName}" | neutral |
    | unknown | "–" | "Availability unknown" | neutral |
    | error | "–" | "Couldn't check {shortName}" | danger |
    | loading | "···" | skeleton line | – |

  - Unit nouns come from the kind: "sites" for campground and caravan-park, "cabins", "rooms", "places".
- **Cards:** `LocationCard` gains an optional `availability` prop. It renders a `Badge` with the card text and tone under the area line, or a `Skeleton` line while loading. Without dates, nothing is rendered.
- **Map:**
  - `toFeatureCollection(items, availabilityByKey)` adds the `avail` and `availLabel` properties. `setData` runs once per availability change (not per hover).
  - When a stay is set, `location-pill` shows `availLabel` at every unclustered zoom instead of the name (the name stays in the preview and the overlay marker). Pill colours:
    - available: eucalypt-600 fill, white text
    - full or none-open: surface-subtle fill, fg-muted text
    - otherwise: white fill, ink text
    - hover and selected still go ink.
  - `location-dot` is coloured the same way.
  - The source gains `clusterProperties: { availableCount: ['+', ['case', ['==', ['get','avail'], 'available'], 1, 0]] }`. Clusters with `availableCount > 0` get a eucalypt-600 fill with white text.
  - **Loading shimmer:** pills show "···" and `icon-opacity` pulses between 0.55 and 1 every 700 ms (with `icon-opacity-transition`). The pulse stops when every provider has settled. Under reduced motion the pills stay static.
  - **Legend:** a small top-left legend under the "Search as I move" switch, shown only with dates: "● Available · ● Full or not open · ○ Not checked" (text plus swatch).
- **Filter and sort:**
  - A filter-row toggle chip **Available only** (`avail=1`, `aria-pressed`).
    - Disabled without dates, with the Tooltip "Add dates to filter by availability".
    - When on, the list and the map include only `available`.
  - **Sorting with dates set:** available first (by `availableUnits` descending), then full, none-open, check-dates, offline-booking, not-supported, unknown and error. The order within each group is stable (the E1 order). Without dates, the E1 order is unchanged.
- **Results heading:** "{n} places · {m} available for 6–8 Nov". While any provider is loading, it reads "{n} places · checking availability…".
- **Provider notices** above the list:
  - Error: danger `Notice` "Couldn't check availability on {shortName}." with a **Retry** button, which runs `refetch(providerId)` for that provider only.
  - Slow: if a provider has been loading for more than 10 s, an info `Notice` reads "Still checking {shortName}." When `capabilities.accessGate` is true (§12.2), it adds "It may have a waiting queue right now." (EQ7).
  - Offline: "Availability needs an internet connection." No queries fire.
- **Clearing dates:** removes the states, legend and `avail=1`, and restores the name pills and the E1 order.

**Out of scope:** per-location checks and the night grid (E2), prices, notifications when availability changes (Watches, U1).

## Non-goals

- No bbox-scoped availability requests. One call per provider covers the whole catalogue (ParkStay's bulk endpoint returns every campground). Revisit for providers with expensive bulk calls (EQ2).
- No automatic polling. Data refreshes only when it is stale and the stay is re-applied, or on Retry. Watches do the monitoring.
- No change to `catalog.availability`'s contract. Per-provider calls give error isolation without per-provider errors in the payload.

## Completion Criteria

- [ ] Setting 6–8 Nov for 2 adults fires exactly one `catalog.availability` per bulk-capable provider (one for ParkStay) about 400 ms after the last change. Rapidly stepping guests 1→4 fires one call, not four.
- [ ] Cards show "{n} of {total} sites available", "Fully booked", "No sites open for these dates" or "Not bookable online", matching mocked entries. Locations of a provider without `bulkAvailability` show "Check dates on the place page".
- [ ] Map pills show "8 available" (eucalypt), "Full" or "Not open" (muted), "Info only" or "–" (white). Clusters with any available location are eucalypt. The legend is visible with dates and hidden without.
- [ ] While loading, pills show "···" with an opacity pulse, and cards show skeleton lines. Everything settles once the response arrives.
- [ ] "Available only" is disabled without dates and shows its tooltip on focus. With dates, enabling it limits the list and map to available places and adds `avail=1` to the URL. Reloading restores it.
- [ ] With dates set, the list is ordered available-first by count. Clearing dates restores the E1 order and the name pills.
- [ ] Switching to dates A, then B, then back to A within 15 minutes shows A's states immediately from cache, with no loading shimmer. B's states are never shown while A is loading (no stale cross-stay display).
- [ ] With two providers mocked (one fails, one succeeds), the failing provider's locations show "Couldn't check {shortName}" and a provider Notice with Retry appears. The other provider's pins and cards show real states. Retry refetches only the failed provider.
- [ ] After 10 s of loading, the "Still checking ParkStay…" notice appears. Offline: the availability notice shows and no IPC call is made.
- [ ] The results heading reads "{n} places · {m} available for 6–8 Nov", using an en dash and en-AU dates.
- [ ] The token guard and API-boundary guard pass. The E1 list-only mode shows the card availability states and the "Available only" filter without a map.
- [ ] **Accessibility:**
  - [ ] When availability settles, a polite announcement reads "{m} of {n} places have sites available for 6–8 Nov". An error announces "Couldn't check availability on {shortName}".
  - [ ] Availability is conveyed in text on every card (Badge text), never by colour alone. Pill colours are backed by labels and the legend has text.
  - [ ] "Available only" exposes `aria-pressed` and `aria-disabled` together with its tooltip description when it has no dates. Retry buttons are named "Retry ParkStay availability".
  - [ ] The new colour pairs pass the D1 contrast test: white on eucalypt-600 (5.73) and fg-muted on surface-subtle (5.19). axe on `/` with dates set reports 0 critical/serious issues.
- [ ] The 4-check gate passes: `npm run lint` (0 errors), `npm run format:check`, `npm run type-check`, `npm test`.

## Edge Cases

- An arrival more than 180 days ahead: ParkStay returns `bookableUnits: 0`, so the state is "Not open" (not "Fully booked"), and the card text explains it.
- A stay set but every provider lacks `bulkAvailability`: no calls, all locations show "Check dates", and the "Available only" chip is disabled with the tooltip "Availability filtering isn't supported by these providers".
- An entry for a key not in the current catalogue result is ignored. A location is filtered out while its availability loads, then reappears with cached state.
- A response arriving after the stay changed is stored under its own `stayKey` and never applied to the current stay.
- `catalog:updated` mid-stay: new locations get `unknown` until the next availability fetch. Do not refetch on every catalogue update.
- "Available only" with 0 available: `EmptyState` "No places have sites for 6–8 Nov" with "Show all places" (turns the filter off) and "Try different dates" (opens DateRangeField).
- Combined with bbox "Search as I move" and the other filters: availability is applied after the filters and bbox. The count `m` refers to the visible filtered set.
- A provider that throws `ProviderCapabilityError`: treat it as `not-supported` and do not show the error Notice.
- Departure on or before arrival, or more than 30 nights (URL-edited): the stay is "not set" and no calls are made.

## Test Strategy

- **Unit:** about 18 tests.
  - `deriveAvailability`: every state and its precedence (a table-driven test).
  - `availabilityLabel`: pill, card and tone per state and the kind nouns.
  - The sort comparator: group order and stability.
  - `stayKey` and the stay-set rules.
  - `toFeatureCollection` with availability.
  - `clusterProperties` and the pill paint expressions, from `buildLayers({ withAvailability: true })`.
  - The cross-stay guard.
  - `useDebouncedValue` with fake timers.
- **Component:** about 12 tests with the mock API and `FakeMapController`:
  - the debounced single call
  - card states
  - controller receives `setData` with `avail` properties
  - loading skeleton and shimmer flag (and reduced motion)
  - "Available only" disabled, enabled and URL
  - sort order
  - cache hit on A→B→A
  - two-provider failure isolation and Retry scope
  - the slow notice after 10 s
  - offline
  - announcements
- **Integration:** extend `tests/integration/renderer/explore.test.tsx` to cover setting dates → availability states → "Available only" → open an available card → E2 side card prefilled with the same stay. Runtime verification: live ParkStay dates with the token (pins and legend screenshot), list-only mode without the token, and axe.

## Context Files to Read First

- `ai-state/streams/explore/master-plan.md` (EQ2, EQ6, EQ7), the E1 spec and `src/renderer/features/explore/**`, `src/renderer/components/LocationCard.tsx`, `src/renderer/api/catalog.ts`.
- `ai-state/architecture-notes.md`: §3 (`StayQuery`, `BulkAvailabilityEntry`, `ProviderCapabilities.bulkAvailability`), §4 `catalog.availability`.
- `ai-state/research/parkstay-api-review.md`: `campground_availabilty_view` (one call covers every campground, `total_available`/`total_bookable`, no prices).
- `docs/design/design-language.md` (available, muted and motion tokens) and `docs/design/map.md` (E1 layer list).
- TanStack Query v5 docs for `useQueries`, `gcTime` and `placeholderData` (do not use `keepPreviousData` across stays).

## Notes

- Per-provider queries are the error-isolation mechanism. Keep `providerIds: [id]` even while there is only one provider, so a second provider needs no UI change.
- ParkStay's bulk endpoint ignores party size. Guests still go into `stayKey` because other providers may use them.
- The pulse is driven by a single interval owned by `MapView`, which is cleared on settle and on unmount. Do not animate with React state.
