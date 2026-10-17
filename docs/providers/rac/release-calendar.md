# RAC's school-holiday release calendar

RAC holds back each WA school-holiday period and opens it on a day it announces, at each park's
own hour, after a 48-hour members' pre-sale. WA Stay cannot ask RAC for those days (the release
policy sends no request), so they are kept by hand in
`src/main/providers/rac/release-calendar.ts` and reach people with an app update. This page is
how to keep it current. How the release policy uses it: [Releases](README.md#releases).

## Contents

- [Where RAC announces releases](#where-rac-announces-releases)
- [What the calendar holds](#what-the-calendar-holds)
- [Updating it](#updating-it)
- [The tests to run](#the-tests-to-run)
- [Holidays RAC has not announced](#holidays-rac-has-not-announced)
- [When the calendar runs out](#when-the-calendar-runs-out)

## Where RAC announces releases

- **RAC's school-holiday page**, `https://parksandresorts.rac.com.au/school-holiday-bookings/`:
  each holiday period's nights, its members' pre-sale day and its public release day, and the
  hour each park opens (7, 8 or 9 am, Perth time). It also says which parks are not in the
  pre-sale. RAC lists the next three periods or so, roughly a year ahead of their nights.
- **The WA Department of Education's "Future term dates"**
  (`https://www.education.wa.edu.au/future-term-dates`), for the holidays RAC has not announced
  yet: the breaks between public-school terms, published years ahead.

Read them by hand, in a browser. Nothing in WA Stay requests either page.

## What the calendar holds

`SCHOOL_HOLIDAY_PERIODS`, in date order, one entry per WA school-holiday period:

| Field | What it is |
| --- | --- |
| `name` | The holidays, for logs and tests: "Summer 2027–28". |
| `first`, `last` | The period's first and last nights, both included (`YYYY-MM-DD`). A stay touches the period when any of its nights is in it. |
| `release` | One of three states, below. |

| `release` | Meaning |
| --- | --- |
| `{ memberPreSale, publicRelease }` | The days RAC announced (`YYYY-MM-DD`, Perth time): the members' pre-sale opens on the first and everyone else on the second, each at the park's hour. `first` and `last` are RAC's own nights, which can differ from the Department's break by a day at either end. |
| `'on-sale'` | Released before the calendar was written (or since): only RAC's rolling 364-day window applies. `first` and `last` are the Department's break. |
| `'unannounced'` | RAC has not said when it opens. `first` is the last school day (a Friday, or the Thursday that ends term 4), a night before the Department's break, and `last` the break's last day. |

`CALENDAR_COVERS_UNTIL` is the last night the list knows about: the last night of its last period.

Each park's part in the releases is in `src/main/providers/rac/parks.ts`, as its
`schoolHolidays`:

- `hour`: when its releases open, 7, 8 or 9 am Perth time (the pre-sale opens at the same hour,
  two days earlier);
- `memberPreSale`: whether it is in the members' pre-sale;
- `presaleExcludes` and `presaleExcludedCategoryIds`: what is left out of the pre-sale, as stay
  types and as the same categories' ids (Margaret River's dorms);
- `null` for a park in no school-holiday release (Cable Beach). Its dry season is
  `seasonalRelease`, released on RAC's own monthly days, which the calendar does not hold.

## Updating it

When RAC announces a release, or once a year in any case:

1. **Announced periods.** For each period on RAC's school-holiday page, set `first` and `last` to
   RAC's nights and `release` to `{ memberPreSale, publicRelease }`. A period whose public
   release has passed may become `'on-sale'`.
2. **The holidays after them.** From the Department's term dates, add the next breaks as
   `'unannounced'` periods, in date order, each from the last day of term to the last day of the
   break, and move `CALENDAR_COVERS_UNTIL` to the last night they cover.
3. **The parks.** A park whose hour, or part in the pre-sale, changes is updated in `parks.ts`.
4. **The tests** ([below](#the-tests-to-run)): each period's nights and state, and an instant for
   each new release, for a member and for everyone else.
5. **Ship it** in an app update. An armed snipe asks for its release again each time it is armed
   (when WA Stay starts, after the computer wakes, each day while its release is weeks away, and
   when a member number is saved or removed), so a snipe made before the update picks up the new
   days without being remade.

RAC also publishes each release's minimum stays and arrival days about a week before it. Those
need no update: RAC's own availability answer carries them, and WA Stay reads them from there.

## The tests to run

```bash
npx jest tests/unit/providers/rac/release-calendar.test.ts tests/unit/providers/rac/release-policy.test.ts
```

- `release-calendar.test.ts` lists every period with its nights and state, and checks that the
  dates are real, in order and do not overlap, that each announced pre-sale is two days before its
  public release and both come before the period starts, and that `CALENDAR_COVERS_UNTIL` is the
  last period's last night.
- `release-policy.test.ts` checks the instants on a fake clock: the rolling window, a release at
  each park's hour, the members' pre-sale, what is left out of it, and the refusals.

Then run the full gate, as for any change.

## Holidays RAC has not announced

A stay with a night in an `'unannounced'` period, at a park in the school-holiday releases:

- **Site Sniper refuses to time it**, with "RAC hasn't announced when these school holidays open
  at {park}. Set a watch, or choose a time you set." The snipe is not created, and the release
  step says why. With **At a time you set** the person can still snipe it at a time they know.
- **Availability reads it as RAC answers.** Nothing is held back: nights RAC has not released
  read "not released yet" from RAC's own codes, and none is counted free that RAC does not
  report free.
- **Watches work as usual.** A watch alerts when RAC shows the stay free, whenever that is.

An unannounced period starts a night early, on the last school day, because RAC's nights can
differ from the Department's break at either end. A stay on that uncertain first night is then
refused, rather than timed by the rolling window alone and missing a school-holiday release.

## When the calendar runs out

At a park in the school-holiday releases, a stay with a night after `CALENDAR_COVERS_UNTIL` is
refused the same way: "WA Stay doesn't know RAC's release dates for {year} yet. Set a watch, or
choose a time you set." Cable Beach, in no school-holiday release, is timed by the rolling window
whatever the date.

The calendar now covers WA school holidays to the end of summer 2028–29
(`CALENDAR_COVERS_UNTIL` is 30 Jan 2029). Add the Department's later breaks as soon as it
publishes them, and at the latest before **2 Feb 2028**: from then RAC's 364-day window reaches
nights the calendar does not cover, so people could book those nights at RAC while Site Sniper
refuses to time them.
