# R6: Stay type in watch and snipe flows

## Description
As a person watching a holiday park that has sites and cabins, I can say which stay types I want (Camping, Cabins & villas…) when I create a watch or a snipe, so I am only alerted, or held, for what I would sleep in (brief R4).

R1 gives units a `unitKind` and the shared groups (`STAY_TYPES` in `src/shared/utils/unit-kinds.ts`). R3 stores `unitKinds` on watches and snipes and applies them in core. R4 adds Explore's "Stay type" chip and its `stay` URL param. This task is the flows' side: chips on the stay steps, the UnitPicker grouped by kind, Explore's prefill, and the rule that a hold at a mixed place needs a kind or a unit (master plan decision 4).

## Size
M

## Depends on
R3, R4

## Scope
1. **Stay-type chips** on the stay steps: watch create and Edit (`watches/form/WatchStayFields.tsx`, shared by both) and snipe create (`snipes/create/steps/StayStep.tsx`).
   - The kinds offered are the distinct `unitKind`s of the place's units (`useLocationDetail(…).data.units`), without `other`, in `STAY_TYPES` order and with its labels. They show only when there are two or more.
   - A ParkStay campground whose units are all campsites shows none, so its flows look as today.
   - Markup: a `role="group"` named "Stay type", one `Chip` per kind with `pressed` (`components/ui/Chip.tsx`), and the hint "Leave all off for any stay type." It sits above the UnitPicker.
   - Form value `unitKinds: UnitKind[]`:
     - in `watchFormSchema.ts` (`shape`, `:28-47`) and `snipeForm.ts` (`:45`);
     - mapped to R3's inputs in `watchFormMapping.ts` (create `:98`, edit `:132`, update diff `:168`) and `snipeFormMapping.ts` (`:78`). Empty means any and is not sent on create, as `unitIds` is not;
     - reset with `unitIds` when the location changes (`watches/create/steps/LocationStep.tsx:31`, `WatchFlow.tsx:103`, `snipes/create/steps/LocationStep.tsx:36`).
2. **UnitPicker grouped by kind** (`components/stay/UnitPicker.tsx:36-47`):
   - With two or more kinds: a first level by stay type (`fieldset`, legend "Cabins & villas"), then `unitType` as today. Units without a kind go last, under "Other".
   - With one kind: exactly today's markup.
   - New prop `kinds?: readonly UnitKind[]`. When stay types are chosen, it lists only units of those kinds.
   - Ticked units of a kind that is turned off are removed from `unitIds`. A polite status line says so, e.g. "2 cabins unticked: not in the chosen stay types".
3. **Explore's prefill** (`stay`, written by R4: a comma-separated list of `UnitKind`s, e.g. `stay=campsite,cabin`):
   - Read in `parseWatchPrefill` (`watches/create/prefill.ts`) and `parseSnipePrefill` (`snipes/create/prefill.ts`) through `parseCreatePrefill` (`app/routes.ts:107-120`). Reuse R4's parsing if it added `CreatePrefill.stay`; otherwise add it here.
   - Unknown values, `other` and duplicates are dropped. If any were dropped, the notice reads "The link's stay type couldn't be used, so choose one."
   - Once the place's units load:
     - kinds the place has are kept;
     - if it has none of them, they are cleared, with "{Place} has no {Cabins & villas}, so choose a stay type.";
     - a single-kind place clears them silently, since there is nothing to filter.
4. **A kind or a unit to hold at a mixed place.** This mirrors R3's core rule. "Mixed" means the place's units have two or more kinds, counted as in 1.
   - **Watch:** with `autoHold` on, no `unitKinds` and no `unitIds`, the Alerts step refuses Continue. The error under "Hold a {noun} automatically when found" (`AutoHoldField.tsx`) reads "{Place} has more than one stay type. Choose a stay type or a {noun} on the Stay step to hold one automatically."
   - **Snipe:** snipes always hold until R12 and R13. The Stay step refuses Continue with "Choose a stay type or a {noun}. At a place with more than one stay type, Site Sniper holds only what you choose."
   - The schema context gains `placeKinds` (`WatchFormContext`, `watchFormSchema.ts:114-122`, and the snipe equivalent), passed by the flows and the Edit page. `stepFields` checks `autoHold` on the watch Alerts step and `unitKinds` on the snipe Stay step.
5. **Showing the choice:** a "Stay type" item ("Cabins & villas, Rooms", or "Any") when the place is mixed or kinds are stored, in:
   - the Review steps (`watches/create/steps/ReviewStep.tsx:158`, `snipes/create/steps/ReviewStep.tsx:123`);
   - the summaries (`watches/detail/WatchSummary.tsx:85`, `snipes/detail/SnipeSummary.tsx:64`).
6. **CLAUDE.md:** the create-flow prefill query in "UI Status" (and §12.10's line in the routes list) names `&stay=`, if R4 has not done so.

## Non-goals
- Explore's chip, the `stay` param on Explore and the create links that carry it (R4).
- Core filtering, contracts, repositories, and the runtime "alert instead of hold" rule (R3).
- Unit nouns: use today's `noun` prop. R9 replaces the helper.
- "Alert me" or "Hold it" for snipes, after which only a hold needs a kind (R13).
- RAC itself (R5, R10). There is no snipe Edit page, so none is added.

## Completion Criteria
- [ ] Places with one kind (every ParkStay test place): no "Stay type" group on any stay step. `UnitPicker.test.tsx`, `watches/create/steps/StayStep.test.tsx`, `NewWatchPage*.test.tsx`, `NewSnipePage*.test.tsx` and `EditWatchPage.test.tsx` pass unedited.
- [ ] A mixed place (a fake detail with campsite and cabin units):
  - the group "Stay type" has "Camping" and "Cabins & villas" buttons;
  - pressing "Cabins & villas" sets `aria-pressed="true"` and narrows the UnitPicker to cabins;
  - the `watches.create` payload has `unitKinds: ['cabin']` (strict mock `window.api`).
- [ ] The UnitPicker has `fieldset` legends "Camping" and "Cabins & villas" for a mixed place, and today's markup for one kind. Turning a kind off unticks its units and shows the status line.
- [ ] Prefill (`prefill.test.ts` and page tests, watch and snipe):
  - `stay=cabin` preselects "Cabins & villas";
  - `stay=bogus` shows the notice;
  - `stay=cabin` at a campsite-only place is cleared silently;
  - at a mixed place without cabins it is cleared with the notice.
- [ ] Hold rule (schema unit tests and page tests):
  - a watch with auto-hold at a mixed place with no kind and no unit cannot leave the Alerts step and shows the message;
  - with a kind or a unit it can;
  - the snipe Stay step behaves likewise.
- [ ] Edit: stored `unitKinds` show pressed. Changing them sends only `unitKinds` in the update (`watchFormMapping.test.ts`).
- [ ] The Review steps and summaries show "Stay type".
- [ ] Accessibility:
  - [ ] the group has `role="group"` and the accessible name "Stay type"; each chip is a button named by its label, with `aria-pressed`;
  - [ ] the hold error is tied to its control, and Continue moves focus to the first invalid field as the other step errors do;
  - [ ] the "unticked" status line is in a polite live region;
  - [ ] Tab reaches the chips before "Preferred {sites}".
- [ ] Tests use role and name selectors only.
- [ ] The full gate passes: `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`, then `npm run build:e2e && xvfb-run -a npm run test:e2e`, all journeys unchanged.
- [ ] CLAUDE.md prefill lines are current. The website does not describe the flows' fields: read "Booked out? Set a watch" and confirm nothing in it is now false.

## Edge Cases
- The detail is still loading (search placeholder) or failed: no chips and no UnitPicker, as today. The hold rule is not enforced in the form; R3's runtime rule alerts instead of holding.
- Units with no `unitKind` go under "Other"; `other` is never a chip.
- One real kind plus `other` units counts as one kind: no chips.
- A ParkStay campground with a hut (R1 maps it to `dorm`) and campsites is mixed: the chips show, and the hold rule applies there too.
- Edit, where a stored kind is no longer offered by the place: its chip still shows, pressed, so it can be turned off.
- Kinds chosen but no unit of them listed: the picker says "No {cabins} listed", and the watch is still valid.
- `stay=cabin,cabin`: deduplicated. `stay=` empty: ignored, with no notice.
- Going back to the Location step and choosing another place resets `unitKinds` and `unitIds`.

## Test Strategy
- **Unit (~12):** prefill parsing for watch and snipe (6); the hold rule in both schemas (4); `unitKinds` create and update mapping (2).
- **Component (~12):** UnitPicker grouping, narrowing and the status line (4); chips present or absent, `aria-pressed` (4); the Alerts-step error (2); Review and summary lines (2).
- **Integration (~2):** `tests/integration/renderer/create-watch-flow.test.tsx` and `create-snipe-flow.test.tsx`, each on a mixed place through to the create payload.
- **E2E:** existing journeys unchanged. R10's RAC watch journey presses "Camping" at a real mixed park.

## Context Files to Read First
- CLAUDE.md ("UI Status", renderer rules), `ai-state/streams/rac/master-plan.md` (decision 4), `ai-state/brief.md` (Project 2, R4)
- `ai-state/streams/rac/tasks/R1-stay-type-foundation.md`, `R3-stay-type-criteria-core.md`, `R4-explore-stay-type-chip.md`
- `src/shared/utils/unit-kinds.ts` (R1)
- `src/renderer/components/stay/UnitPicker.tsx` and its test, `src/renderer/components/ui/Chip.tsx`
- `src/renderer/features/watches/form/` (`watchFormSchema.ts`, `watchFormMapping.ts`, `WatchStayFields.tsx`, `AutoHoldField.tsx`)
- `src/renderer/features/watches/create/` (`WatchFlow.tsx`, `prefill.ts`, `steps/`), `edit/EditWatchPage.tsx`, `detail/WatchSummary.tsx`
- `src/renderer/features/snipes/create/` (`SnipeFlow.tsx`, `snipeForm.ts`, `snipeFormMapping.ts`, `prefill.ts`, `steps/`), `detail/SnipeSummary.tsx`
- `src/renderer/app/routes.ts` (`parseCreatePrefill`)
- `docs/design/components.md`, `docs/design/design-language.md` (voice)
- `tests/utils/renderer/` (render helpers, strict mock `window.api`)

## Notes
- The chips come from the units' kinds, not from `LocationSummary.unitKinds`. A provider that sets no unit kinds gets derived place kinds (R1), but its units all count as `other` in R3's matching. Offering "Cabins & villas" there would make a watch that never matches.
- The flows send no request for this: the units come from the detail the flow already loads.

## Assumptions
- "Mixed" ignores `other`, consistent with the chips. If R3 counts `other` as a kind for its runtime rule, follow R3 and say so in the hold message.
- R4 writes `stay` as a comma-separated list of `UnitKind` values. Whichever of R4 and R6 lands first adds `CreatePrefill.stay`.
- A chosen kind and chosen units combine as R3 defines. This spec assumes units of an unchosen kind can never match, which is why they are unticked.
