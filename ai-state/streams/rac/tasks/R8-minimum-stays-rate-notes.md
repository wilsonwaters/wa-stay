# R8: Minimum stays and rate notes

## Description
RAC refuses some stays: those shorter than a minimum, and those arriving or leaving on certain days (school holidays, Christmas, Cable Beach's Monday-and-Friday rule; `rac-terms.md` §3). It also has more than one rate per night: standard, member and promotions. Today the SDK can say neither:
- `NightReason` is only `split` (`provider.types.ts:257`);
- a partial match shorter than a minimum is still offered (`matching.ts:89-129`), so a watch could alert on a stay RAC refuses;
- a price never says which rate it is.

Default RO6 asks that a watch never alerts on a stay the provider would refuse (terms rule 16). This task models stay rules and rate notes in the SDK, applies them in matching, and explains them in the night grid and the stay steps (master plan decision 6).

## Size
M

## Depends on
R3, R7

## Scope
1. **SDK** (additive and optional; doc comments; the guide's Availability bullet, `docs/providers/adding-a-provider.md:715-718`):
   - `NightReason = 'split' | 'min-stay'`. `min-stay` means the provider has room that night but refuses this stay under its stay rules: too short, too long, or arriving or leaving on a refused day. The night's state is `unknown`, as with `split`, so matching never counts it.
   - `NightStatus`:
     - `minNights?: number`: the minimum for a stay arriving that night;
     - `noArrival?: true`: no arrivals on that date;
     - `noDeparture?: true`: no departures on that date.
   - `UnitAvailability`:
     - `minNights?: number`: the minimum for a stay arriving on the asked arrival;
     - `priceNote?: string`: which rate the prices are, as plain text, e.g. "RAC member rate".
   - `UnitSummary.minNights?: number`: the usual minimum, for the stay steps.
2. **Core** (`src/main/core/watches/matching.ts`):
   - One predicate, `meetsStayRules(unit, nights, departureNight?)`. A stay passes when:
     - its length is at least the first night's `minNights`, else the unit's `minNights`, else 1;
     - its first night is not `noArrival`;
     - the night starting on its departure date, when the provider reported it, is not `noDeparture`.
   - `partialMatches`:
     - after the price split, trim each run's start forward past `noArrival` nights;
     - trim its end back until the departure date is allowed;
     - then drop the run if it is shorter than its minimum.
   - `fullMatches` drops a unit that fails the predicate, even when `fullyAvailable`, so a provider's mistake never alerts.
   - The snipe's unit choice (`snipe.service.ts:447`, after R3's kind filter) also requires the predicate.
   - Contract suite (`tests/utils/provider-contract.ts`):
     - a unit whose `minNights` is above the stay's nights is never `fullyAvailable`;
     - a `min-stay` night is never `available`.
3. **Renderer:**
   - `components/nightGridModel.ts`:
     - `isMinStayNight`;
     - `UnitStanding` gains `'min-stay'`: nothing taken, some nights refused by stay rules;
     - `summariseAvailability` counts it as known and not free (a `minStay` count);
     - `summaryNotes` adds "2 {sites} need a stay of at least 3 nights." and "No arrivals on Sat 25 Sep." (from the flags), in the design-language voice.
   - `components/NightGrid.tsx`:
     - a `min-stay` cell kind (`CellKind`, `lookOf`, `LEGEND_ORDER`, `:56-77`) with its own look, built from tokens;
     - the legend entry "Free, stay rules apply";
     - cell labels such as "Available, 3-night minimum" and "Available, no arrivals this day".
   - `priceNote` under the unit's name, beside `UnitFacts` ("Rate: RAC member rate"). This shows on the place page and the watch page, which both use NightGrid.
   - **Stay steps** (watch `form/WatchStayFields.tsx`, also used by Edit; snipe `create/steps/StayStep.tsx`): a warning `Notice` when the stay has fewer nights than the `UnitSummary.minNights` of:
     - the chosen units, or every unit when none is chosen: "{Place}'s {cabins} need at least 3 nights. WA Stay only alerts on stays {shortName} accepts.";
     - only some of them: "Some {sites} need at least 3 nights."
4. **ParkStay:** none. It has no minimums, and its tests are unchanged.
5. **Docs:** the guide's Availability bullet ("`fullyAvailable` only when every night is `available` and the stay meets the unit's stay rules") and the new fields. CLAUDE.md's WatchService row gains "stay rules (minimum nights, arrival and departure days)".

## Non-goals
- RAC's mapping of its tariff and site codes onto these fields (R10).
- Member rates and the "RAC member rate" note (R16). The release instant `opensAt` (R14).
- Unit nouns: use today's `noun`. R9 replaces it.
- Explore's free counts: a provider counts only bookable stays (R11 for RAC).
- A maximum-nights field: a too-long stay is a `min-stay` refusal (see Assumptions).

## Completion Criteria
- [ ] `tests/unit/core/watch-matching.test.ts`, new cases (existing ones unedited):
  - a 2-night run with `minNights` 3 is dropped, and a 3-night run is kept;
  - a night's `minNights` beats the unit's;
  - a run starting on a `noArrival` night is trimmed to start the next night, then kept or dropped by length;
  - a run whose departure date is `noDeparture` is trimmed;
  - a departure night that was not reported is allowed;
  - a `fullyAvailable` unit with `minNights` above the stay is not a full match;
  - `min-stay` nights break runs.
- [ ] `tests/unit/core/watch.service.test.ts`: a 2-night stay answered with every night `min-stay` and `minNights: 3` gives NOT_FOUND and no notification.
- [ ] `tests/unit/core/snipe-execute.test.ts`: a `fullyAvailable` unit that fails the predicate is not held.
- [ ] The contract suite has both checks, with self-tests in `tests/integration/provider-contract.test.ts`.
- [ ] `nightGridModel.test.ts` and `NightGrid.test.tsx` cover standing, summary counts, notes, cell labels, the legend entry, and `priceNote` under the unit's name.
- [ ] Stay-step warnings show in watch create, Edit and snipe create. There is none when units have no `minNights`; ParkStay pages are unchanged.
- [ ] Old `lastAvailability` JSON without the new fields reads and renders as before.
- [ ] Accessibility:
  - [ ] a cell's accessible label names the rule, not only its icon or colour;
  - [ ] the legend entry is text;
  - [ ] the stay-step warning is a `Notice` (`role="status"`), announced when it appears;
  - [ ] the new cell look meets AA contrast with existing tokens, and `tests/unit/design/token-guard.test.ts` passes.
- [ ] The full gate passes: `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`, then `npm run build:e2e && xvfb-run -a npm run test:e2e`.
- [ ] CLAUDE.md and the guide are updated as in Scope 5. Read the website's "Every site, night by night" against the change: it stays true, so no site change.

## Edge Cases
- `minNights` of 0, 1, undefined, negative or not an integer: no rule.
- Nights in one run with different `minNights`: the run's first night decides, because the rule is about arrival.
- A `noArrival` night inside a run but not at its start: no effect on that run.
- A run longer than the price limit allows is split first; each piece is then trimmed and checked.
- Dates are calendar strings moved with `addDays`, never `Date` objects, so Perth's zone and midnight cannot shift them.
- An empty `priceNote` is not shown. A long one wraps within the unit column. It is text, never HTML.
- Stay steps before dates are chosen, or before units load: no warning.
- A stay longer than the provider allows: the provider marks it `min-stay`, and the cell label says "stay rules apply" without a number.
- A provider sends `reason: 'min-stay'` with `state: 'available'`: matching still drops the night (the reason wins), and the grid shows it as `min-stay`.

## Test Strategy
- **Unit (~16):** matching (10), WatchService (2), snipe choice (1), contract self-tests (3).
- **Component (~10):** night grid model (5), NightGrid (3), stay-step warnings (3).
- **Integration (~1):** `tests/integration/two-providers.test.ts` with a fake provider that answers `min-stay`: a watch over it stays NOT_FOUND, and ParkStay's watch is unaffected.
- **E2E:** existing journeys unchanged. R10's RAC journey renders real RAC nights.

## Context Files to Read First
- `ai-state/streams/rac/master-plan.md` (decision 6, terms rule 16), `ai-state/research/rac-sdk-gaps.md` §G
- `ai-state/research/rac-booking-flow.md` §3 (tariff codes, `minimum_periods`, `close_arrival`, `close_departure`)
- `ai-state/research/rac-samples/availability-busselton-schoolhol-min-stay-2027-09-25-2n.json`
- `src/shared/types/provider.types.ts`, `src/shared/types/catalog.types.ts`
- `src/main/core/watches/matching.ts`, `watch.service.ts`, `src/main/core/snipes/snipe.service.ts`
- `src/main/providers/parkstay/availability.ts` (how `split` nights are set, `:140-170`)
- `src/renderer/components/nightGridModel.ts`, `NightGrid.tsx` and their tests
- `src/renderer/features/watches/form/WatchStayFields.tsx`, `src/renderer/features/snipes/create/steps/StayStep.tsx`
- `tests/utils/provider-contract.ts`, `docs/providers/adding-a-provider.md` (Availability), `docs/design/design-language.md`

## Notes
- RAC's data supports per-night minimums: `tariffs_quoted[date].minimum_periods`, `close_arrival` and `close_departure` ("1" means refused). In the school-holiday sample, both nights have minimum 3 and are closed to arrival and departure.
- Trimming runs, rather than dropping them, keeps a useful alert when a run starts on a refused day but a shorter stay inside it is allowed.
- No live request, hold or booking (§12.33).

## Assumptions
- A per-night `minNights` is added beside the unit's, because RAC's minimum depends on the arrival night. The master plan names only "`minNights`".
- `min-stay` covers every stay rule (too short, too long, refused arrival or departure day), as the master plan has only that one new reason. A too-long stay carries no field of its own.
- `UnitSummary.minNights` is optional and may stay empty for RAC, because RAC's minimums vary by date. Then the stay steps do not warn, and the night grid explains the rule after the first check.
