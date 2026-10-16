# R9: Unit nouns from stay types

## Description
The app calls every bookable thing a "site". The renderer takes the noun from the place's kind, `unitNoun(kind)` (`components/locationFormat.ts:25-48`), or from the provider's first location kind, `unitNounFor(manifest)` (`watches/shared/watchState.ts:49-55`, `snipes/shared/snipeState.ts:175-181`). The core hard-codes it:
- "Found N sites", "Sites available at …", "Site held at …" (`notification.service.ts:162,172,228,250,257`);
- "{shortName} cannot hold sites automatically" (`watch.service.ts:435`);
- "This snipe already holds a site" (`snipe.service.ts:241`).

An RAC park has sites, cabins, rooms and dorms, so "Sites available at RAC Busselton" for a chalet is wrong. This task adds one noun helper over unit kinds (R1) and uses it everywhere (master plan decision 8; rac-sdk-gaps I.1 and I.2). ParkStay's copy stays exactly as it is.

## Size
M

## Depends on
R6, R7, R8 (their new copy is converted too)

## Scope
1. **One helper, shared by main and renderer:** `src/shared/utils/unit-noun.ts`, with no Node imports.
   - `UnitNoun` moves here from `components/nightGridModel.ts:11-17`, which re-exports it, as `UnitPicker.tsx:6` does.
   - `nounForKinds(kinds)`:

     | Kinds | Noun |
     | --- | --- |
     | only `campsite` | site / sites |
     | only `cabin` | cabin / cabins |
     | only `room` | room / rooms |
     | only `dorm` | bunk / bunks |
     | only `glamping` | tent / tents |
     | `other`, mixed, or none | place / places |

   - Where the kinds come from, the first that is not empty:
     1. the units the copy is about (matched, held or chosen), by their `unitKind`;
     2. the watch's or snipe's `unitKinds` (R3);
     3. the place's `unitKinds` (`unitKindsOf`, R1);
     4. the provider's default: `deriveUnitKinds(manifest.locationKinds[0])` (R1, `src/shared/utils/unit-kinds.ts`).
2. **Renderer:**
   - Replace every call of `unitNoun(`, `unitNounFor(` and `unitCountLabel(`: 31 lines in 23 files (`grep -rn "unitNoun(\|unitNounFor(\|unitCountLabel(" src --include=*.ts --include=*.tsx`).
   - Delete `UNIT_NOUNS`, `unitNoun`, both `unitNounFor` and `unitCountLabel`'s kind parameter.
   - `unitLabel` (`snipeState.ts:183-197`) and `unitNameOf` (`watchState.ts:57-62`) ("Site 12", "A site") take the new noun.
3. **Core copy:**
   - `WatchMatch` gains `unitKind?`, copied by `toMatch` (`matching.ts:52-68`).
   - `notifySnipeHeld` and `notifySnipeBooked` receive the held unit's kind from `snipe.service.ts`.
   - NotificationService gains an option `providerUnitKinds?: (providerId) => UnitKind[]` for step 4 of the chain; the container builds it from the registry.
   - The copy becomes:
     - "{Nouns} available at X" and "Found 1 {noun} available at …";
     - "{Noun} held at X";
     - for a mixed match: "Places available at X", "Found 3 places available at …".
   - `watch.service.ts:435` → "{shortName} cannot hold automatically".
   - `snipe.service.ts:241` → "This snipe already has a hold".
   - "Site snipe not found" (`snipe.service.ts:404,650,657`, `hold-payment.service.ts:139`, `database/repositories/site-sniper.repository.ts:144`) → "Snipe not found". It names the record, not a unit.
4. **Renderer flow copy that hard-codes "site":**
   - `snipes/create/steps/ReleaseStep.tsx:55`, "When are the {sites} released?", with the place's noun;
   - `snipes/create/steps/ProviderStep.tsx:17`, "Whose sites to snipe" → "Which provider";
   - `snipes/create/snipeForm.ts:140`;
   - `snipes/shared/ConnectToArmDialog.tsx:34`;
   - the copy R6, R7 and R8 added.

   "Site Sniper" is a feature name and stays. The Site Sniper page intros (`SnipesPage.tsx:66,119-120`, `NewSnipePage.tsx:38`) are R13's to rewrite.
5. **Guard:** `tests/unit/copy/unit-noun-guard.test.ts`.
   - It scans string literals and JSX text, with comments removed by `tests/utils/strip-comments.ts`, in:
     - `src/main/core/**` and `src/main/scheduler/**`;
     - `src/renderer/features/{watches,snipes,place,explore,bookings,notifications}/**`;
     - `src/renderer/components/**`.
   - It skips test files (`*.test.ts`, `*.test.tsx`), whose mocks may quote old messages.
   - It fails on `\bsites?\b` in any case, except "Site Sniper", the `site-sniper` route, and lines marked `unit-noun-ok` with a reason.
   - Provider folders are outside its scope: ParkStay's sites are sites.
6. **ParkStay copy is unchanged** wherever every unit is a campsite, which is every ParkStay test place. Existing expectations ("Sites available at Osprey Bay", "Hold a site automatically when found", "8 of 20 sites free for all 2 nights") keep their strings. A test fixture without kinds gets ParkStay's `campsite` kind; an expected string is never changed to make room.

## Non-goals
- Explore's counts by stay type (R11). Snipe alert notifications (R12, which uses this helper). Site Sniper screens and copy for alerts (R13).
- The website: ParkStay's copy and the screenshots do not change. RAC copy is R20's.
- `LocationKind` labels ("Holiday park") and `KIND_LABELS` stay.

## Completion Criteria
- [ ] `tests/unit/shared/unit-noun.test.ts`: each kind, mixed, `other`, empty, and the fallback order (≈10 cases).
- [ ] `grep -rn "UNIT_NOUNS\|unitNounFor(\|unitNoun(" src` finds nothing but the new helper's own name, if any. Type-check passes.
- [ ] Notification tests:
  - ParkStay strings are unchanged;
  - a cabin-only fake gives "Cabins available at …", "Found 1 cabin available …" and "Cabin held at …";
  - a mixed fake gives "Places available at …".
- [ ] The guard passes on `src`, and a self-test proves it fails on a planted literal and accepts a `unit-noun-ok` line.
- [ ] Renderer tests for a cabin-only and a mixed place: the watch page, snipe pages, UnitPicker ("Preferred cabins", "Any cabin"), the NightGrid summary ("2 of 5 cabins free…") and AutoHoldField ("Hold a cabin automatically when found").
- [ ] Accessibility:
  - [ ] accessible names built from nouns change consistently (the checkbox, legends, the disclosure "Choose cabins");
  - [ ] e2e role and name selectors for ParkStay need no edit.
- [ ] The full gate passes: `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`, then `npm run build:e2e && xvfb-run -a npm run test:e2e`.
- [ ] CLAUDE.md has no stale line about nouns (none expected). Read the website: no claim changes, `tests/unit/site/site.test.ts` passes, and the screenshots stay valid because ParkStay's copy is unchanged.

## Edge Cases
- No kinds anywhere (an unknown provider, an old row, a provider without kinds): "place".
- One kind plus `other` units is mixed: "place".
- Matched units of several kinds: plural "places".
- A count of 1 against many, and a capital at the start of a sentence ("Cabin held at …").
- The held unit is missing from the last availability: fall back along the chain.
- The provider is not registered when the notification is built: no default, so "place".
- Stored notifications keep their stored titles; nothing is rewritten.
- Bookings carry no unit kinds: the provider's default, so "site" for ParkStay.
- ParkStay huts (`dorm`, R1) read "bunk", as `unitNoun('hut')` does today.

## Test Strategy
- **Unit (~25):** the helper (10), notification copy (8), service messages (3), the guard and its self-test (4).
- **Component (~10):** watch and snipe pages, UnitPicker, NightGrid, AutoHoldField, the snipe Release step.
- **Integration (~2):**
  - `tests/integration/watch-parkstay.test.ts` keeps ParkStay's titles;
  - `two-providers.test.ts` with a fake mixed provider gets "Places available at …".
- **E2E:** existing journeys unchanged.

## Context Files to Read First
- `ai-state/streams/rac/master-plan.md` (decision 8), `ai-state/research/rac-sdk-gaps.md` §B ("Unit noun"), §I.1, §I.2
- `ai-state/streams/rac/tasks/R1-stay-type-foundation.md` (`src/shared/utils/unit-kinds.ts`)
- `src/renderer/components/locationFormat.ts`, `nightGridModel.ts`, `stay/UnitPicker.tsx`
- `src/renderer/features/watches/shared/watchState.ts`, `src/renderer/features/snipes/shared/snipeState.ts`
- `src/main/core/notifications/notification.service.ts`, `src/main/core/watches/matching.ts`, `watch.service.ts`, `src/main/core/snipes/snipe.service.ts`, `src/main/core/holds/hold-payment.service.ts`
- `src/main/app/container.ts`
- `tests/unit/brand/branding-guard.test.ts` (the guard pattern), `tests/utils/strip-comments.ts`
- `docs/design/design-language.md` ("Voice and tone")

## Notes
- The helper lives in `src/shared/` because main (notifications) and the renderer must say the same thing.
- Defaulting from the provider's location kinds keeps ParkStay at "site" even where a row carries no kinds.

## Assumptions
- Mixed places read "place" (master plan decision 8). Beside Explore's location count ("169 places"), a card's "120 places" may read oddly. *Stakeholder decision:* keep "place", or use "unit", or "sites and cabins" for exactly two kinds.
- `dorm` reads "bunk", keeping ParkStay's hut copy, rather than "bed".
- "Whose sites to snipe" becomes "Which provider", a noun-free label, because the noun is unknown before a place is chosen.
