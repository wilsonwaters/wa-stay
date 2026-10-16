# R3: Stay-type criteria for watches and snipes

## Description
After R1 a unit can say what it is. A watch or snipe must be able to say "cabins only" (brief R4). An automatic hold must never take "any unit" at a park with sites, cabins and dorms (rac-sdk-gaps I.5): it could hold a dorm bed or a three-bedroom villa. This task adds `unitKinds` to watches and snipes in main: types, contracts, repositories, matching and the snipe's unit choice. There is no UI change (R6).

## Size
M (the master plan says S). It touches two types, two contracts, two repositories, matching and two services: several files, one concern.

## Depends on
R1 (the v11 `unit_kinds` columns and `UnitKind`).

## Scope
1. **Types:**
   - `src/shared/types/watch.types.ts`: `Watch.unitKinds: UnitKind[]` and `WatchInput.unitKinds?` (so `WatchUpdate` has it too).
   - `src/shared/types/site-sniper.types.ts`: the same for `SiteSnipe` and `SiteSnipeInput`.
   - Empty means any kind.
2. **Contracts:** `watchInputSchema` (`src/shared/contracts/watches.ts:37`) and `snipeInputSchema` (`src/shared/contracts/snipes.ts:33`) gain `unitKinds: z.array(UnitKindSchema).optional()`. Updates inherit it, and `assertTypeEquals` still holds. The services drop duplicates.
3. **Repositories:** `watch.repository.ts` (insert `:59-72`, update `:115`, map `:384`) and `site-sniper.repository.ts` (insert `:60-74`, update `:115`, map `:435`) write and read `unit_kinds`. Unknown or unreadable entries are dropped when read.
4. **Matching** (`src/main/core/watches/matching.ts:24-35`):
   - `wantedUnits({ unitIds, unitKinds }, units)`:
     - with `unitIds`, it matches by id, name or alias only (the person chose those units);
     - else, with `unitKinds`, it keeps units whose `unitKind` is listed (a unit with no kind counts as `other`);
     - else, every unit.
   - New `kindsAmbiguous(criteria, wanted)`: true when `unitIds` is empty and the wanted units span more than one kind. Every wanted unit counts, free or not.
5. **Watches** (`src/main/core/watches/watch.service.ts:282-311`):
   - Matching and `lastAvailability` use the kind-filtered units.
   - In `autoHold` (`:426`), an ambiguous watch places no hold. It returns the note "Not held automatically: this place has more than one stay type. Choose a stay type or units to let WA Stay hold one." The note reaches the found notification and `lastError` by the existing path (`:303-312`).
6. **Snipes** (`src/main/core/snipes/snipe.service.ts:441-448`):
   - Without `unitIds`, the candidates are `availability.units` filtered by `unitKinds`, and `matched` is the first fully available candidate.
   - An ambiguous snipe places no hold, before any NightGuard reservation. It ends `FAILED` with result `ERROR` and `lastError` "Free units of more than one stay type: choose a stay type or units for this snipe". It emits `snipe:updated` and a warning notification (`notifyWarning`; widen `SnipeNotifications`, `:93`).
7. **Docs:** a short paragraph each in `docs/watches-and-notifications.md` and `docs/site-sniper.md` on stay types and the "any unit" rule.

## Non-goals
- Stay-type chips, UnitPicker grouping, reading Explore's `stay=` prefill, and requiring a kind or unit to hold (R6).
- Unit nouns ("Sites available at …") (R9).
- Alert snipes and `ALERTED` (R12): an ambiguous snipe fails here, and R12 may turn that into an alert.
- No migration (v11 is R1's) and no ParkStay change.

## Completion Criteria
- [ ] IPC tests (`tests/integration/core-ipc.test.ts` or a sibling):
  - `watches.create` and `snipes.create` with `unitKinds: ['cabin']` round-trip through `get`;
  - `['castle']` is `VALIDATION` with the issue path `unitKinds.0`;
  - `update` sets and clears it.
- [ ] A watch and a snipe migrated from the v5 fixture read `unitKinds: []`.
- [ ] `tests/unit/core/watch-matching.test.ts`:
  - ids win over kinds;
  - kinds filter;
  - a unit with no kind is `other`;
  - no criteria means every unit;
  - `kindsAmbiguous` true and false cases.
- [ ] Watch (`watch.service.test.ts`): `unitKinds: ['cabin']` at a mixed place matches only cabins, and the found notification lists only cabins.
- [ ] Auto-hold (`tests/unit/core/auto-hold.test.ts`):
  - at a mixed place with no units and no kind, or two kinds: no `holds.create` call (spy), and the note is in the notification and `lastError`;
  - with one kind, or with units: it holds as today.
- [ ] Snipe (`tests/unit/core/snipe-execute.test.ts`):
  - with `unitKinds: ['cabin']`, it holds a cabin even when a free site is listed first;
  - an ambiguous snipe ends `FAILED`, with no `holds.create`, no NightGuard reservation, and one warning notification.
- [ ] ParkStay and scheduler suites pass unedited (`watch-parkstay.test.ts`, `sitesniper-parkstay.test.ts`, `scheduler*.test.ts`).
- [ ] The two docs paragraphs are written, and CLAUDE.md's WatchService and SiteSniperService rows are updated if they go stale.
- [ ] The full gate passes: `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`, then `npm run build:e2e && xvfb-run -a npm run test:e2e` (the IPC contract changed).

## Edge Cases
- A provider that sets no unit kinds (the example providers, a fresh scaffold): every unit is `other`, so nothing is ambiguous. `unitKinds: ['cabin']` then matches nothing, and the docs say so.
- `unitIds` name units that no longer exist: as today.
- `unitKinds: ['other']` is accepted over IPC, though R6 never offers it.
- A place listing one unit is never ambiguous.
- With `unitIds`, the provider filters by id (`snipe.service.ts:443`), and kinds are not applied.
- Partial matches (`allowPartialMatch`) use the same wanted units.
- An update to `unitKinds` takes effect at the next check. `lastAvailability` keeps the previous units until then.
- A ParkStay campground with campsites and a hut unit (R1 maps it to `dorm`): an "any site" auto-hold watch now notifies with the note instead of holding. This is intended.

## Test Strategy
- **Unit:** matching (≈8), auto-hold (≈3), snipe execute (≈3), repositories (≈2).
- **Component:** none.
- **Integration:** IPC create, get and update for both (≈4), migrated rows (≈1).
- **E2E:** none new. Existing journeys pass.

## Context Files to Read First
- `ai-state/streams/rac/master-plan.md` (decision 4, the R3 and R6 rows)
- `ai-state/research/rac-sdk-gaps.md` §B ("How each feature uses it") and §I.5
- `src/shared/types/watch.types.ts`, `site-sniper.types.ts`, `src/shared/utils/unit-kinds.ts` (R1)
- `src/shared/contracts/watches.ts`, `snipes.ts`
- `src/main/database/repositories/watch.repository.ts`, `site-sniper.repository.ts`
- `src/main/core/watches/matching.ts`, `watch.service.ts`; `src/main/core/snipes/snipe.service.ts`
- `src/main/core/notifications/notification.service.ts` (`notifyWatchFound`, `notifyWarning`)
- `tests/unit/core/watch-matching.test.ts`, `auto-hold.test.ts`, `snipe-execute.test.ts`; `tests/utils/fake-provider.ts`

## Notes
- **Why ids win.** Applying kinds to named units could create a watch that never matches, with nothing to tell the person why. R6's picker shows only units of the chosen kinds, so in practice the two agree.
- **Why ambiguity counts every wanted unit.** It depends on what the person asked for, not on what is free right now, so it gives the same answer every poll.

## Assumptions
- Size raised from S to M (see Size).
- An ambiguous snipe ends `FAILED`. There is no alert action before R12, and polling on would never hold.
- The note wording is provisional; R9 settles nouns.
