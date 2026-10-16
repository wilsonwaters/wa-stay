# R1: Stay-type foundation

## Description
Explore, watches and snipes need to filter by what a person sleeps in (brief R4). Today a place has one `kind` (`src/shared/types/provider.types.ts:28-49`) and a unit has free-text `unitType` (`src/shared/types/catalog.types.ts:45`). Nothing says "this park has sites and cabins". This task adds a provider-neutral `UnitKind`, its five groups, the optional fields that carry it, migration v11, the catalogue filter and facet, and ParkStay's mapping. There is no UI change: R4 and R6 build on it.

## Size
M

## Depends on
None (first in Lane S).

## Scope
1. **Types** (all optional, so the scaffold, `tests/fixtures/providers/example-*` and the renderer fixtures compile unchanged):
   - `provider.types.ts`: `UnitKind = 'campsite' | 'cabin' | 'room' | 'dorm' | 'glamping' | 'other'`, `UNIT_KINDS`, `UnitKindSchema`; `UnitAvailability.unitKind?`; `BulkAvailabilityEntry.byKind?: Partial<Record<UnitKind, { availableUnits: number; bookableUnits: number }>>`.
   - `catalog.types.ts`: `UnitSummary.unitKind?`, `LocationSummary.unitKinds?: UnitKind[]`, `CatalogQuery.unitKinds?` (and `CatalogQuerySchema`, keeping `assertTypeEquals`), `CatalogSearchResult.facets.unitKinds`.
2. **Groups and derivation**, new `src/shared/utils/unit-kinds.ts` (no Node imports):
   - `STAY_TYPES`, in display order: `campsite` "Camping", `cabin` "Cabins & villas", `room` "Rooms", `dorm` "Dorms", `glamping` "Glamping". `other` is never a group.
   - `deriveUnitKinds(kind: LocationKind)`: `campground`, `caravan-park` → `['campsite']`; `holiday-park` → `['campsite', 'cabin']`; `cabin` → `['cabin']`; `hut` → `['dorm']`; `glamping` → `['glamping']`; `farm-stay`, `home`, `other` → `['other']`. Never empty.
   - `unitKindsOf(location)`: its `unitKinds` cleaned (unknown values and duplicates dropped), or `deriveUnitKinds(location.kind)` when that leaves none. `isUnitKind(value)`.
3. **Migration v11** (`src/main/database/connection.ts`):
   - `LATEST_SCHEMA_VERSION` 11 (`:24`).
   - One `if (pending(11))` block: `applyMigration(database, 11, ['locations', 'watches', 'site_snipes'], …)`. It adds `unit_kinds JSON NOT NULL DEFAULT '[]'` to the three tables with `addColumns` (`:930`), then backfills `locations.unit_kinds` from `kind` with `deriveUnitKinds`, so SQL filters see every cached row.
   - Watches and snipes keep `'[]'` ("any kind"). R3 reads and writes them.
4. **Catalogue** (`src/main/database/repositories/location.repository.ts`, `src/main/core/catalog/location-catalog.service.ts`):
   - `upsertRows` (`:164`) writes `unitKindsOf(summary)`. `mapRow` (`:414`) reads the column; an empty or unreadable value reads as `deriveUnitKinds(kind)`. Every `LocationSummary` main returns has a non-empty `unitKinds`.
   - `filters` (`:348`): `unitKinds` matches any value, as `kinds` does, over `json_each(l.unit_kinds)`. `facet('unitKinds')` counts like `amenities` (`facet`, `:325-344`).
   - `fetchDetail` (`:914`) gives the detail the provider's cleaned `unitKinds`, else the stored summary's. A unit whose `unitKind` is not a `UnitKind` loses it.
5. **ParkStay** (provider-only, new `src/main/providers/parkstay/unit-kinds.ts`):
   - Units: `toUnitSummary` (`catalog.ts:252`), `toClassUnitSummary` (`site-classes.ts:85`) and `check` (`availability.ts:264-293`). `campsite` when the gear allows tent, campervan or caravan. Otherwise by the site's or class's name: hut or bunk → `dorm`; cabin, cottage or chalet → `cabin`; eco tent, safari tent or eco retreat → `glamping`; anything else → `campsite`.
   - Places (`toLocationSummary`, `catalog.ts:204`): every `campground` (types 0, 1 and 4) → `['campsite']`. Type-2 places leave `unitKinds` out, so they derive from `kindFromName` (`catalog.ts:135`).
   - Bulk (`search`, `availability.ts:351-356`): each entry adds `byKind: { campsite: { availableUnits, bookableUnits } }` with the same counts.
6. **Docs:**
   - `docs/providers/adding-a-provider.md`, mapping rules (`:695-745`) and the bulk entry table: `unitKinds`, `unitKind` and `byKind`. Set `byKind` for a place with more than one kind.
   - CLAUDE.md: "Current migrations (version 11)", the v11 line, and "(currently 11)".

## Non-goals
- Explore's "Stay type" chip, its URL param and free counts (R4).
- `unitKinds` on watches and snipes, their contracts, repositories and matching (R3).
- Stay-type chips in the flows and UnitPicker grouping (R6). Unit nouns (R9). RAC (R5).
- A manifest-level `unitKinds` (rac-sdk-gaps B.3), and `resort` or `hotel` location kinds (the Rottnest project).

## Completion Criteria
- [ ] `UNIT_KINDS` has the six values and `STAY_TYPES` the five groups, in the order and with the labels above (unit test).
- [ ] `deriveUnitKinds` gives the table above for all nine `LOCATION_KINDS` and is never empty (`it.each`).
- [ ] `tests/integration/migration-v11.test.ts` passes:
  - from the v5 and v6 fixtures, the three columns exist with default `'[]'`;
  - every other table is unchanged from the same fixture at v10;
  - `foreign_key_check` and `integrity_check` are clean;
  - a v10 database with one `locations` row per kind is backfilled per the table;
  - re-running is a no-op;
  - a fresh database has the same normalised schema as the migrated ones.
- [ ] Repository tests (`tests/unit/database/location-search.test.ts`): `unitKinds: ['cabin']` returns cabin places, a derived holiday park included. `facets.unitKinds` counts each kind over the other filters.
- [ ] An IPC-harness test with a provider that sets no `unitKinds`: every `catalog.search` item and `catalog.get` detail has a non-empty `unitKinds`.
- [ ] ParkStay unit tests:
  - the unit rule: gear flags, a hut, a cabin, an eco tent, a class listing;
  - the place rule: types 0, 1 and 4 → `['campsite']`, type 2 derived;
  - `byKind` on bulk entries.
- [ ] Existing ParkStay suites pass unedited (`parkstay-provider-contract.test.ts`, `tests/unit/providers/parkstay/*`).
- [ ] `tests/unit/docs/example-providers.test.ts` and `tests/scripts/new-provider.test.ts` pass unedited.
- [ ] CLAUDE.md and the guide updated as in Scope 6.
- [ ] The full gate passes: `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`, then `npm run build:e2e && xvfb-run -a npm run test:e2e` (the catalogue contract changed). All 22 journeys pass unchanged.

## Edge Cases
- A provider sends `unitKinds: []`, duplicates or an unknown string: stored cleaned, or as the derived default. Never empty.
- A unit with `unitKind: 'castle'`: the kind is dropped and the unit kept.
- A cached row with corrupt JSON in `unit_kinds`: reads as the derived default, and the next sync rewrites it.
- A place whose `kind` changes between syncs: the upsert rewrites `unit_kinds`.
- A query for `unitKinds: ['other']` is valid. R4 never offers it.
- A `byKind` entry with negative or NaN counts is passed through. Explore clamps counts as it does today (`deriveAvailability.ts:63`).
- `addColumns` skips a column that is already there, for a partly migrated database.
- A ParkStay site named "Hut 3" with tent allowed: `campsite` (the gear wins).
- A ParkStay class listing (`class:<id>`): the class name decides, else `campsite`.

## Test Strategy
- **Unit:** unit-kind helpers (≈12), ParkStay mapping (≈10), repository filter and facet (≈6).
- **Component:** none.
- **Integration:** migration v11 (≈6), catalogue through the IPC harness (≈3).
- **E2E:** none new. The suite must pass unchanged.

## Context Files to Read First
- `ai-state/streams/rac/master-plan.md` (decision 4, Contract additions)
- `ai-state/research/rac-sdk-gaps.md` §B and §I.3–I.5
- CLAUDE.md "Adding a new migration"
- `src/shared/types/provider.types.ts`, `src/shared/types/catalog.types.ts`
- `src/main/database/connection.ts` (`runMigrations`, `applyMigration`, `addColumns`, v9 and v10 blocks)
- `tests/integration/migration-v10.test.ts`, `tests/fixtures/db/README.md`
- `src/main/database/repositories/location.repository.ts`
- `src/main/core/catalog/location-catalog.service.ts` (`fetchDetail`, `availability`)
- `src/main/providers/parkstay/catalog.ts`, `site-classes.ts`, `availability.ts`, `types.ts`
- `docs/providers/adding-a-provider.md` (mapping rules, bulk availability entries)

## Notes
- The backfill matters because Explore's results come from `catalog.search` in main, which filters in SQL. A read-time default alone would leave pre-v11 rows out of a `unitKinds` filter until the next sync.
- Watches and snipes need no backfill: `'[]'` means any kind, which is what they do today.
- ParkStay's rule follows the master plan: every bookable campground is camping, even one with a hut unit.

## Assumptions
- `farm-stay`, `home` and `other` derive to `['other']`, not `[]` (rac-sdk-gaps B says `[]`). Never empty means an empty column always means "not filled yet".
- ParkStay emits `byKind` although its places are single-kind (integration point 1). It costs one field per entry.
- The repository facet is added for the contract. Explore counts its chips client-side (R4).
