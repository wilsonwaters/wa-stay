# R14: RAC release policy and snipes

## Description
As an RAC guest, I can set a snipe that starts checking at the exact moment my dates open:
- midnight Perth time, when they come into RAC's rolling 364-day window;
- or the park's school-holiday release time, 48 hours earlier when I have saved an RAC member number.

It checks gently, once every 10 s for at most 30 minutes, and alerts me when the dates are free (brief R3, RO3; success criterion 3).

This task adds RAC's release policy and a dated release calendar, sets `release.opensAt` on RAC availability, and turns RAC's `snipes` on with holds still off. Snipes are alerts (R12). The member timing is built and tested here through an `isMember` input; R16 connects it to the saved number.

## Size
M

## Depends on
- R10: RAC availability and fixtures.
- R12: snipes without holds, `maxWindowMinutes`, `ReleaseComputeInput.unitIds` and `unitKinds`, and ending a snipe on a block.

It reads R5's park seed.

## Scope
1. **Calendar** (`src/main/providers/rac/release-calendar.ts`). Facts only, with no RAC copy.
   - **Periods:** the WA school-holiday periods from summer 2026–27 to the end of 2028, from the WA Department of Education's published term dates (cite the page and the date read). Each period's nights count from its first day to its last day, inclusive. Each period has one release state:
     - `{ memberPreSale, publicRelease }` (calendar dates) for the three announced releases (`rac-booking-flow.md` §5):
       - 24 Sep–9 Oct 2027: 14 and 16 Oct 2026;
       - 17 Dec 2027–31 Jan 2028: 3 and 5 Feb 2027;
       - 7–24 Apr 2028: 28 and 30 Apr 2027;
     - `'on-sale'` for periods released before the calendar was written (summer 2026–27, April and July 2027);
     - `'unannounced'` for the rest.
   - **`CALENDAR_COVERS_UNTIL`:** the last day the period list covers.
   - **Upkeep:** a header comment says how to update the file (RS7): the sources, the fields, and the test to extend.
2. **Park facts** (R5's `parks.ts`; add whatever is missing there):
   - each park's release time: 7 am for Esperance and Margaret River; 8 am for Busselton, Karri Valley and Monkey Mia; 9 am for Cervantes and Exmouth;
   - whether the park is in the school-holiday process and its member pre-sale. Cable Beach is in neither;
   - the category ids left out of the pre-sale: Margaret River's dorm categories (category type 4 on its book-now page).
3. **Membership is an input.** The policy's deps take `isMember(): Promise<boolean>`.
   - It is asked at every compute and never cached, so a change shows at the next arm.
   - The factory passes `async () => false` for now. R16 passes its `hasMemberNumber(ctx)`; R16 owns `membership.ts` and the secret's key.
   - So this task never reads a secret.
4. **`RacReleasePolicy`** (`src/main/providers/rac/release-policy.ts`, implementing `ReleasePolicy`, `sdk/provider.ts:188-198`):
   - **Modes:** it supports `daily_rollover` and `scheduled`, not `cancellation`.
   - **`daily_rollover`** returns the later of these two instants:
     - **Rolling:** `zonedInstant(addDays(departure, -365), 00:00, 'Australia/Perth')`. On that day the stay's last night, departure − 1, becomes today + 364 (research §4).
     - **School holiday:** applies when a night of the stay falls in an announced period and the park is in the process. It is `publicRelease` at the park's time. It is `memberPreSale` instead when all of these hold:
       - `isMember()` is true;
       - the park is in the pre-sale;
       - the snipe wants a category that is in it. `unitIds` and `unitKinds` come from R12; none given means any category, and only Margaret River dorms means the public time.

       If the result's 30-minute window has passed with the member instant, but would not have with the public one, the public instant is used instead.
   - **Refusals.** Each is a `ProviderError`, which the core turns into `VALIDATION` on `releaseAt` (`snipe.service.ts:728-731`):
     - a night in an `'unannounced'` period, at a park in the process: "RAC hasn't announced when these school holidays open at {park}. Set a watch, or choose a time you set.";
     - a night after `CALENDAR_COVERS_UNTIL`: "WA Stay doesn't know RAC's release dates for {year} yet. Set a watch, or choose a time you set.";
     - every applicable window has passed: "These dates are already open on RAC. Set a watch to hear about cancellations."
   - **`scheduled`:** the person's time (`requestedAt`), refused without one. It is for releases the calendar doesn't know, such as Cable Beach's seasonal dates.
   - **`describe(externalId)`:** one plain sentence. For a park in the process: "New dates open daily at midnight AWST, 364 days ahead. School holidays open on RAC's release days at {time} AWST, 48 hours earlier for members." For Cable Beach, the first sentence, then "Seasonal dates: choose a time you set."
   - **`pollFloorMs`:** `{ window: 10_000, continuous: 900_000 }`. No continuous mode is declared; 900 000 ms is the 15-minute watch floor in case one ever is.
   - It sends no request: it reads only the calendar, the park facts, the clock and `isMember()`.
5. **Manifest:**
   - `snipes: true`, with `holds` still `false`;
   - `releaseModes`: `daily_rollover` ("When these dates open") and `scheduled` ("At a time you set"). Both have `usesAccessGate: false` and `maxWindowMinutes: 30`, and descriptions in WA Stay's own words.
   - No `cancellation` mode: watches cover cancellations, at 15 minutes or more.
6. **Availability** (R10's `check`): nights not open yet are `not-released`, and the result carries `release: { open: false, opensAt }`, with `opensAt` the policy's `daily_rollover` instant for the stay (omitted when it would refuse). Not open yet means either:
   - nights RAC refuses as beyond the window (site code 9);
   - or nights inside a period whose release for this person is still to come.

   Nights RAC reports free stay free: its engine decides (terms rule 16).
7. **Wiring:** the factory builds the release module. Registration passes R12's rules.

## Non-goals
- Saving and reading the member number, the credentials form, members-only tariffs and member prices (R15, R16).
- Re-arming snipes when the number is saved or removed (R15's hook, wired by R16). This task only makes sure every arm asks again.
- Screens (R13); the core alert path (R12); auto-cart (R19).
- Repeat-booking and reception releases; Cable Beach's seasonal calendar (`scheduled` covers it).
- `docs/providers/rac/` and calendar upkeep docs (R20).

## Completion Criteria
- [ ] `tests/unit/providers/rac/release-policy.test.ts`, `describe('RAC release policy')`, on a fake clock. Each case asserts the exact UTC instant:
  - departure 2027-10-17 gives `2026-10-16T16:00:00.000Z`, the live boundary in research §4;
  - leap year: departure 2028-03-01 gives `2027-03-01T16:00:00.000Z`;
  - Busselton, 20–23 Dec 2027, no number (`isMember` false): `2027-02-05T00:00:00.000Z`. With a number: `2027-02-03T00:00:00.000Z` (`pre-sale only for members`, terms rule 14);
  - Esperance, the same stay: `2027-02-04T23:00:00.000Z`, or `2027-02-02T23:00:00.000Z` with a number. Exmouth: `2027-02-05T01:00:00.000Z`;
  - Margaret River with a number: dorms only gives `2027-02-04T23:00:00.000Z`; any category gives `2027-02-02T23:00:00.000Z`;
  - Cable Beach, the same stay, with or without a number: the rolling instant `2026-12-22T16:00:00.000Z` (RS10);
  - period edges: departure 2027-12-17 (last night the 16th) is rolling only, `2026-12-16T16:00:00.000Z`. A stay with the night of 17 Dec 2027 or of 31 Jan 2028 gets the holiday instant;
  - April 2028, Busselton: `2027-04-30T00:00:00.000Z`, or `2027-04-28T00:00:00.000Z` with a number;
  - for every announced release and every park in the pre-sale, the member instant is exactly 48 h before the public one, at the park's time (RS11);
  - member window passed, public window ahead: returns the public instant;
  - midnight: for departure 2027-10-17, with now at `2026-10-16T15:59:59Z` it returns the instant; at `2026-10-16T16:30:00Z` it refuses as already open;
  - an `'unannounced'` period, and a night after `CALENDAR_COVERS_UNTIL`, each refuse with their message;
  - `scheduled` returns `requestedAt`, and is refused without it;
  - `computeReleaseAt` sends no HTTP request.
- [ ] The same file passes with `npx cross-env TZ=Australia/Perth jest tests/unit/providers/rac` and with `TZ=UTC`.
- [ ] Through the IPC harness, `snipes.create` for RAC returns:
  - `VALIDATION` on `releaseAt` for each refusal above;
  - `VALIDATION` on `releaseMode` for `cancellation`;
  - `VALIDATION` on `action` for `hold` (R12).
- [ ] `tests/integration/rac-snipes.test.ts`: `JobScheduler` with jest fake timers, `FixtureHttpClient` and R2's paced client. It checks:
  - armed an hour early, the first RAC request is at the release instant, not before;
  - no two RAC requests are closer than 10 000 ms, even when the person asked for 1.5 s;
  - a snipe that asked for a 60-minute window and never finds a free unit ends EXPIRED at release + 30 minutes, after 180 checks or fewer;
  - a free unit on the n-th check gives ALERTED and one `snipe_alert`. Its link is the `online_booking_url` form and never contains `?cart`. No hold or night guard is used;
  - a 403 route, and a 429 route: FAILED with R12's message, and no later RAC request;
  - resume after the window: EXPIRED, with no request. Resume inside the window: a check at once;
  - `isMember` turned true, then `arm()` again: the release moves 48 hours earlier.
- [ ] Availability, with R10's window-edge fixture (nights 13–18 Oct 2027, checked at 23:36 AWST 16 Oct 2026): the nights of 16–18 Oct are `not-released`, `release.open` is false, and `opensAt` is `2026-10-18T16:00:00.000Z`.
- [ ] Manifest and registry tests: `snipes` is true and `holds` false; the two modes are declared, with `maxWindowMinutes` 30 and no cancellation mode; RAC registers.
- [ ] A spy shows that `isMember` is asked at every `computeReleaseAt`. R5's fixture and source guards pass.
- [ ] The full gate passes: `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`, then `npm run build:e2e && xvfb-run -a npm run test:e2e`, because RAC now shows in Site Sniper's provider step.
- [ ] No CLAUDE.md line goes stale (RAC docs are R20's). The website makes no RAC claim until R20.

## Edge Cases
- **Perth time.** Perth has no DST, but every instant is built with `zonedInstant` in `Australia/Perth`, never the host zone. Release dates, period nights and "today" are calendar dates in Perth.
- **Long stays:** a stay that spans a period and nights outside it takes the latest applicable instant. A 30-night stay may touch two periods.
- **Calendar gaps:** a period missing from the calendar, or one RAC hasn't announced, is refused. The person is offered a watch or a time they set.
- **Calendar changes:** RAC moves a release, and an app update ships the new calendar. The snipe asks again at its next arm: start, resume, a daily re-arm, or R16's re-arm through R15's hook.
- **Member number** saved during the pre-sale window: the member instant, and the snipe checks at once. Saved after that window: the public instant. Unreadable (vault key lost): R16's `hasMemberNumber` answers false, so the public instant.
- **Pre-sale times** (RS11, decided 2026-10-16): the member pre-sale opens at the park's own public release time (7, 8 or 9 am, Australia/Perth), 48 h before the public release. `describe` says AWST.
- **Rolling boundary:** the exact moment is not measured. Closed at 23:42 and open at 00:01:40, so polling from 00:00:00 for 30 minutes covers it.
- **Blocks:** a Cloudflare challenge, 403 or 429 at release ends the snipe FAILED (R12). R5's 30-minute cool-down means nothing more is sent.
- **Two RAC snipes on the same instant:** R2 serialises them, so each checks about every 20 s. That stays within the rules.
- **Sleep:** the computer sleeps through the release; `rescheduleAll` expires or polls as above.
- **A stay already open and sold out:** refused with the watch suggestion, not armed for a window that has passed.
- **Arrival passed:** EXPIRED (the existing rule).

## Test Strategy
- **Unit (~22):** policy instants and refusals (above); calendar lookups; park facts; the `isMember` input; `describe`; `pollFloorMs`; `opensAt` mapping.
- **Component:** none. The renderer reads the existing preview through `opensAt`.
- **Integration (~10):** IPC `snipes.create` refusals; the runner timings, alert, block, sleep and member re-arm on fake timers; contract suite registration with snipes.
- **E2E:** none new. The gate runs the suite because the provider step now lists RAC.

## Context Files to Read First
- `CLAUDE.md` ("Provider SDK", "Adding a provider")
- `ai-state/streams/rac/master-plan.md` (design decision 3; terms rules 3, 5, 14, 16; RS7, RS8)
- `ai-state/research/rac-booking-flow.md` §4, §5; `ai-state/research/rac-terms.md` §4, §5, ambiguity 8
- `ai-state/streams/rac/tasks/R12-alert-snipes-core.md`; `R16-rac-member-number.md` (what it wires into this policy)
- `src/main/providers/parkstay/release-policy.ts` (the reference policy); `src/main/providers/sdk/provider.ts`
- `src/main/core/snipes/snipe.service.ts` (`plan`, `refreshReleaseAt`, `prepare`); `src/main/scheduler/snipe-runner.ts` (`:291-330`)
- `src/shared/utils/calendar-date.ts` (`addDays`, `zonedInstant`, `todayIn`)
- `src/main/providers/rac/` (R5 seed and client; R10 availability); `tests/unit/scheduler/snipe-runner.test.ts`

## Notes
- **Why "departure − 365".** The last bookable night is today + 364. A stay can be booked when its last night, departure − 1, is open, so on day departure − 365.
- **Why the later instant.** Holiday nights come into the rolling window before their release. For example, 17 Dec 2027 is inside the window from 18 Dec 2026, but held back until 5 Feb 2027.
- **No live holds or carts** (§12.33). RAC holds stay off.
- **Decided 2026-10-16:** Cable Beach's school-holiday nights follow only the rolling 364-day window (RS10). The member pre-sale opens at the park's own public release time, Australia/Perth, 48 h before the public release (RS11).

## Assumptions
1. A period's first and last days are both nights in the period.
2. A member who missed the pre-sale window is better served by the public instant than by a refusal.
3. The WA school-holiday dates for 2027–2028 come from the Department of Education's published term dates. The implementer reads them once and cites them.
