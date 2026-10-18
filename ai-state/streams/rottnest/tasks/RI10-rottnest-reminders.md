# RI10: Rottnest reminders

## Description

Rottnest's content for RI6 and RI8: **when** WA Stay reminds and **what** it says, for Open Day plans and for look reminders. This task turns on `snipes` and `watches` in the manifest.

Every instant comes from RIA's published rules (`rottnest-release-rules.md`, T&Cs §7 and §8). Every sentence is honest: it says why now, and never that anything is free (terms rule 5). The Open Day copy coaches fairly (terms rule 9).

## Size

M. Pure functions and copy, with fake-clock tests.

## Depends on

- RI4 (Open Days, rules), RI6 (`release.reminders`), RI8 (`reminders.next`).

## Scope

1. **Open Day steps** (`release.reminders`; all Perth time):

   | When | Title | Body (gist) |
   | --- | --- | --- |
   | 18:00 the evening before | "Open Day tomorrow: {stay month}" | The waiting room opens at 6 am and bookings at 8:30. Have your phone for the passcode and your card ready (a 25% deposit for units; the campground and hostel are paid in full). Your plan: {place}, {dates}, {party}. |
   | 06:00 on the day | "The waiting room is open" | Join any time before 8:30: everyone in by then gets a random place. You'll need your own mobile for the passcode. |
   | 08:15 on the day | "15 minutes to Open Day" | Join the waiting room now to be in the random draw. When it's your turn you have 30 minutes to enter. |

   Each step's click opens the booking link (RI6). There is no step at 08:30: it would do nothing a person in the queue needs. The person can switch each step off in the plan (RI7).
2. **The checklist** (`release.checklist`), RIA's own tips in WA Stay's words:
   - your choices in order;
   - flexible dates;
   - party size within the unit's limit;
   - a Stay Rottnest profile saved for faster booking;
   - your mobile;
   - Visa or Mastercard;
   - a keyholder for a second unit, named 7 days before arrival;
   - "only book what you need".
3. **Cancellation hotspots** (`reminders.next`). For a stay at a precinct, with `after` and `cadence`, the candidates are:

   | Hotspot | When (07:00 Perth) | Reason line | Applies when |
   | --- | --- | --- | --- |
   | **Cooling-off ends** | the stay's Open Day + 13 and + 14 days | "Bookings made on the {date} Open Day leave their 14-day cooling-off period about now." | that day is more than 30 days before arrival |
   | **Balance due** | arrival − 31, − 30 and − 29 days | "Balances for these dates are due about now, and unpaid bookings are cancelled." | always, for self-contained units; for the campground and hostel (paid in full) only arrival − 31, "the cancellation fee rises tomorrow" |
   | **Last cheap cancellations** | arrival − 4, − 3 and − 2 days | "The fee for cancelling becomes the whole stay 48 hours before check-in." | always |
   | **Cadence** | every 07:00 (daily) or 07:00 and 18:00 (twice daily) | "Your daily reminder." | from creation to arrival − 1, when the cadence isn't `hotspots` |

   - **Order:** `next` returns the earliest candidate after `after`, merging a cadence slot with a hotspot on the same day; the hotspot's reason wins.
   - **Limits:** at most two reminders a day.
   - **Last reminder:** none on the arrival day; online booking is closed the same day, so the last reminder adds "for same-day stays phone 1800 111 111".
   - **Labelling:** these are inferences from RIA's rules and are labelled so in the docs (RI11). They are never presented as RIA's statements.
4. **Manifest:** `watches: true` and `snipes: true`, with the `open_day` release mode (RI4).
5. **Copy guard:** the provider's tests run every step and hotspot through RI8's guard, which bars "free", "found", "available", "held" and "secured", plus "device", "devices", "number" in the sense of extra numbers, and "browser" in the sense of more browsers. Allowed: "your own mobile".
6. **Tests:**
   - fake-clock tests per hotspot, at each boundary;
   - cooling-off skipped when within 30 days;
   - campground versus unit;
   - two-a-day cap;
   - cadence merging;
   - no reminder on arrival day;
   - Open Day steps across a move;
   - a step at exactly 06:00 Perth;
   - the copy guard.

## Non-goals

- RIA's Open Day timing itself (RI4).
- The screens (RI7, RI9).

## Completion criteria

- [ ] Every test above passes. The contract suite (links-only) records zero calls with watches and snipes on.
- [ ] RI7's and RI9's e2e journeys run against the real Rottnest module.
- [ ] The full gate passes.
