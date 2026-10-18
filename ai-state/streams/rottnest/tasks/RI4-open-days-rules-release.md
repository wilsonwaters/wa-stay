# RI4: Open Day calendar, booking rules and release policy

## Description

Everything WA Stay can know about a Rottnest stay without asking Stay Rottnest: **when** it opens and **whether** RIA would accept it. It comes from RIA's published booking guides, by hand, as RAC's release calendar does (R14). It feeds the place page (RI5), Open Day plans (RI6, RI7) and look reminders (RI8, RI10).

Sources: `ai-state/research/rottnest-release-rules.md` (the Open Day rule checked against 54 dated Open Days, every rule with its guide), T&Cs RIA4555 §8 and §12.

## Size

L. Mostly data and pure functions, with heavy tests.

## Depends on

- RI2 (the `stayRules` module), RI3 (precincts and their peak-block groups).

## Scope

1. **The Open Day calendar** (`open-days.ts`):
   - **The rule:** the first Wednesday of month M, at 08:30 Australia/Perth, opens stays in month M+8. When that Wednesday is 1 January, the Open Day is the next Wednesday (8 Jan 2025 is the precedent; the next is 2031).
   - **`PUBLISHED_OPEN_DAYS`:** the dated table from RIA's booking-guide index and monthly guides (Nov 2026 → Jul 2027, …, 6 Oct 2027 → Jun 2028), each `{ openDay, stayMonth }`. Past rows from 2023 are kept for tests only.
   - **`CALENDAR_CONFIRMED_UNTIL`:** the last published Open Day. After it the rule's dates are marked `expected` (TQ5).
   - **Postponements** (e.g. 1 June 2022 → 8 June 2022, after an outage) are table overrides; the header says how to add one.
   - **The header comment** names the sources and the upkeep steps (RI11 writes `docs/providers/rottnest/open-days.md`).
2. **Per-month guide data** (`booking-guides.ts`), one entry per stay month whose guide is published, written by hand from that guide:
   - **`fiveThree`:** `'allowed'`, or `'suspended'` ("There will be no bookings into {next month} on this Open Day": Nov 2026, Dec 2026, Apr 2027, Jun 2027), with any explicit last arrival and departure the guide gives.
   - **`peakBlocks`:** fixed arrival and departure blocks per peak-block group (RI3's groups), e.g. Dec 2026, Thomson Bay North: 29 Nov–3 Dec, 3–9, 9–14, 14–21, 21–27 Dec.
   - **`peakMinNights`:** e.g. three nights for the Campground, Kingstown dorms, hostel family rooms and Governor Circle, by unit.
   - **`carryOver`:** e.g. "bookings after the fixed dates and into January 2027 (including New Year's Eve) are available from Wednesday 6 May 2026".
   - **`closures`:** by precinct and dates, e.g. Bathurst unavailable from 27 Apr 2027 and through June 2027.
   - **`events`:** event Saturdays that must include the Friday or Sunday (Channel Swim 20 Feb 2027, Port to Pub 20 Mar 2027).
   - **`guideUrl`:** the guide's PDF name, built by RI3's links helper.

   A stay month with no entry is `'unpublished'`. The rules then apply only their year-round parts, and the verdict adds a note: "RIA hasn't published the booking guide for {month} yet. Fixed dates may apply." (TQ2).
3. **Year-round rules** (`booking-rules.ts`, pure):
   - at most 14 nights (TQ4: year-round);
   - a stay with a Saturday night must also have the Friday or Sunday night;
   - no arrival or departure on a WA public holiday (`public-holidays.ts`: WA's gazetted public holidays to the end of 2028, by hand from the WA Government's public holidays page, with its own header and upkeep note);
   - no same-day arrival online (arrival today in Perth → refused, "Book same-day stays by phone on 1800 111 111");
   - party size within the chosen unit types' occupancy (only with `unitIds`), else a note;
   - at most two units per transaction: a note, not a refusal (watches and plans are per stay).
4. **Release status for a stay:**
   - **Each night is released** when its month's Open Day has passed (Perth time).
   - **A 5/3 stay** (at least 5 nights in a released month, at most 3 in the next unreleased month, not `suspended`) is released with the earlier month. A stay that crosses into the next month without meeting 5/3 opens with the later month's Open Day, and the verdict notes the 5/3 option ("Stay 5 nights in {month} to book up to 3 into {next}").
   - **`carryOver`** overrides apply.
   - The result is `{ open, opensAt?, text }`: "On sale since {date}", or "Opens Wed 4 Nov 2026 at 8:30 am (the waiting room opens at 6 am)", with "(expected)" past `CALENDAR_CONFIRMED_UNTIL`.
5. **`stayRules.check`** (RI2's module): the year-round rules, then the month's guide data (peak blocks for the precinct's group, minimum nights, closures, events), then the release status. It returns the first refusal (with its `field`) plus every note, and never sends a request.
   - **Refusal copy is RIA's rule in plain words**, e.g. "In December 2026, stays at Geordie Bay start and end on fixed days: 1, 8, 15, 22 or 29 Dec."
   - **Suggestions:** for a peak refusal, the nearest valid block (or two) by arrival date, as `StayQuery`s in the notes text; RI7 turns them into chips.
6. **Release policy** (`release-policy.ts`, no request):
   - **One mode, `open_day`:** label "Open Day", description "Stays open on RIA's monthly Open Day at 8:30 am, nine months ahead. WA Stay reminds you so you're in the waiting room before 8:30." No `usesAccessGate` and no `maxWindowMinutes`.
   - **`computeReleaseAt`:** the stay's Open Day at 08:30 Perth. It is `VALIDATION` on `releaseAt` when the stay is already on sale ("These dates are already on sale. Set a look reminder instead.") or refused by the rules (their reason).
   - **`describe()`:** "Stay Rottnest opens each month nine months ahead, on the first Wednesday at 8:30 am. Next: Wed 4 Nov 2026 (July 2027)."
   - **`pollFloorMs`:** required by the type, unused for links-only snipes (RI6). Set it high and comment why.
   - **Capability:** `snipes` stays off until RI6's core lands, then RI10 turns it on.
7. **Tests:**
   - **Open Day rule:** over every row of the 54 known Open Days (a test fixture table: facts only), plus 1 January years (2025, 2031) and a DST-free Perth check at 08:30.
   - **Each rule:** a test for each, from the guides' own examples:
     - the Nov 2025 Open Day's 5/3 ("arrive by Mon 27 Jul, depart by Tue 4 Aug 2026");
     - the Dec 2026 blocks per group;
     - June 2027's "no bookings into July";
     - Bathurst closed in June 2027;
     - the Channel Swim weekend;
     - a Saturday-only stay;
     - Australia Day and Christmas Day arrivals;
     - 15 nights;
     - same day.
   - **Release status:** fake-clock tests at 08:29:59 and 08:30:00 Perth on an Open Day, for a straddling 5/3 stay, and past `CALENDAR_CONFIRMED_UNTIL`.

## Non-goals

- Screens (RI5, RI7, RI9).
- Reminder timing (RI10).
- Fetching any guide (rule 6: by hand, in app updates).

## Completion criteria

- [ ] Every rule and Open Day test above passes. `check` is pure (the same input gives the same output; no `ctx` use but the clock).
- [ ] The contract suite (links-only) still records zero calls.
- [ ] The headers of `open-days.ts`, `booking-guides.ts` and `public-holidays.ts` name their sources and upkeep steps.
- [ ] The full gate passes.

## Edge cases

- **An Open Day moved** after publication (outage): a table override; armed plans re-arm at their next compute (RI6).
- **A stay inside a peak month whose guide is unpublished:** no refusal, a note, and a link to the Open Days page.
- **Peak blocks that span months** (29 Nov–3 Dec): the block belongs to the later month's guide. Check both months' entries when a stay crosses.
- **The campground** is in the peak three-night rule but has no fixed blocks in some guides; follow each guide literally.
