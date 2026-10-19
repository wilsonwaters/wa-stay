# Stay Rottnest's Open Days and booking guides

The Stay Rottnest module times its releases, explains its booking rules and plans for Open Days
from facts kept in its code, read by hand from what the Rottnest Island Authority (RIA)
publishes. Nothing in WA Stay fetches them, so they are kept current by hand, about once a
month. Read every source in a browser.

## Contents

- [What is kept](#what-is-kept)
- [Each month: the next booking guide](#each-month-the-next-booking-guide)
- [When the Open Day dates are published](#when-the-open-day-dates-are-published)
- [Each year: public holidays](#each-year-public-holidays)
- [When Stay Rottnest's room types change](#when-stay-rottnests-room-types-change)
- [When it is out of date](#when-it-is-out-of-date)

## What is kept

| File                                             | What                                                                                                                                                                                      | Source                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `src/main/providers/rottnest/open-days.ts`       | The published Open Days (`PUBLISHED_OPEN_DAYS`, each with the month of stays it opens) and the last one confirmed (`CALENDAR_CONFIRMED_UNTIL`); after it, the rule's dates are "expected" | RIA's booking guide index, linked from Stay Rottnest's Open Days page |
| `src/main/providers/rottnest/booking-guides.ts`  | One `BookingGuide` per month of stays: whether the 5/3 carry-over is allowed into the next month, the fixed peak blocks per block group, minimum stays, closures and event Saturdays      | That month's Open Day booking guide (a PDF)                           |
| `src/main/providers/rottnest/public-holidays.ts` | WA's public holidays, a year or two ahead                                                                                                                                                 | WA.gov.au's public holidays list                                      |
| `src/main/providers/rottnest/precincts.ts`       | The precincts and their room types                                                                                                                                                        | What Stay Rottnest's results page shows                               |

The rule behind the Open Days: on the first Wednesday of a month, at 8:30 am Perth time, the
month eight months on opens (a week later when that Wednesday is New Year's Day). A published
date wins over the rule, so a postponed Open Day is a row in `PUBLISHED_OPEN_DAYS`.

## Each month: the next booking guide

RIA publishes the guide for the month its next Open Day opens, a few weeks before that Open Day.

1. Open Stay Rottnest's Open Days page and its booking guide for the new month.
2. Add a `BookingGuide` for the month to `BOOKING_GUIDES` in `booking-guides.ts`, in order:
   - `openDay`: the Open Day that opens it;
   - `carryOver`: `suspended` when the guide says "There will be no bookings into …", else
     `allowed`;
   - `fixedBlocks`: every block group in its fixed-dates tables, with its precincts (and room
     types when the group covers only some), its period (first arrival, last departure) and
     every block as `[arrival, departure]`;
   - `minimumStays`, `closures` and `eventSaturdays`, as the guide gives them. A minimum stay
     with no end date ends with the month.
3. Extend `tests/unit/providers/rottnest/booking-guides.test.ts` (it checks every block group
   fills its period back to back, 14 nights at most a block) and add a case for the month's
   rules to `rules.test.ts`.
4. Run `npx jest tests/unit/providers/rottnest`.

A rule a guide states that the module doesn't model yet (a new kind of restriction) needs a
change to `rules.ts`, with its tests. A rule a guide stops stating is dropped from that month
on: the guides from September 2026 no longer set a two-night Saturday minimum or ban
public-holiday arrivals, so neither is checked.

## When the Open Day dates are published

When RIA publishes a new set of Open Day dates (its booking guide index), add each to
`PUBLISHED_OPEN_DAYS` with the month of stays it opens, move `CALENDAR_CONFIRMED_UNTIL` to the
last one, and extend `tests/unit/providers/rottnest/open-days.test.ts`. A postponed Open Day is
a row with its new date.

## Each year: public holidays

When WA.gov.au publishes the next year's public holidays (and the King's Birthday proclamation),
add them to `WA_PUBLIC_HOLIDAYS` and drop `expected` from the ones confirmed. They are notes
only: the booking rules don't refuse a public-holiday arrival or departure.

## When Stay Rottnest's room types change

A room type the seed doesn't know is logged once ("not in the seed") and left out of every
check, never guessed at. Add it to its precinct in `precincts.ts` with its group, stay type,
sleeps and bedrooms, and extend `tests/unit/providers/rottnest/precincts.test.ts`.

## When it is out of date

- **No guide for a month yet:** its stays are allowed by the rules, with no fixed blocks, and
  the 5/3 carry-over into it is taken as allowed, as the terms say, with its release marked
  expected.
- **Past `CALENDAR_CONFIRMED_UNTIL`:** releases follow the rule and read "Expected to open".
- **A changed Open Day not yet in the code:** watches and plans keep the old date until the
  next app update; a plan re-reads its Open Day each time it is armed.

An app update brings the new facts, and every plan and watch picks them up.
