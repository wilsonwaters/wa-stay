# RI5: Open Day calendar, booking rules and release policy

## Description

What WA Stay can know about a Rottnest stay without asking: **when** it opens, and **whether** RIA would accept it. Sources: `rottnest-release-rules.md` and T&Cs §8 and §12, read by hand.

## Size

L.

## Depends on

- RI1 (`open-days.ts`, extended here), RI4.

## Scope

1. **`open-days.ts`:**
   - the rule: the first Wednesday of month M at 08:30 Perth opens month M+8, and 1 January moves to the next Wednesday;
   - `PUBLISHED_OPEN_DAYS` to 6 Oct 2027;
   - `CALENDAR_CONFIRMED_UNTIL`, after which dates are "expected";
   - overrides for postponements.
2. **`booking-guides.ts`**, per stay month with a published guide:
   - 5/3 `allowed` or `suspended`;
   - peak blocks per block group (Thomson Bay North; South Thomson with Kingstown Heritage; Bathurst with the cabins; Longreach and Fay's; Geordie);
   - peak three-night minimums (Campground, dorms, hostel family rooms, Governor Circle);
   - carry-overs, closures (Bathurst from 27 Apr 2027 and through June 2027) and event Saturdays.
3. **`public-holidays.ts`:** WA public holidays to the end of 2028.
4. **`stayRules.check`:**
   - at most 14 nights;
   - a Saturday night needs the Friday or Sunday night too;
   - no arrival or departure on a public holiday;
   - not the same day;
   - the party within the types' `sleeps`;
   - the month's guide data;
   - the release status: open, or the Open Day, with the 5/3 straddle.
5. **Release policy:**
   - the `open_day` mode (`remindOnly`, RI7): `computeReleaseAt` gives the stay's Open Day at 08:30, and a stay already on sale or refused is `VALIDATION`;
   - `describe()`.
6. **Availability:** a stay not yet released is `release: { open: false, opensAt }`, and its nights are `not-released`.

## Completion criteria

- [ ] The rule is tested over the 54 known Open Days and the 1 January years.
- [ ] Each rule is tested with the guides' own examples.
- [ ] Release status is tested at 08:29:59 and 08:30:00 on an Open Day.
- [ ] The full gate passes.
