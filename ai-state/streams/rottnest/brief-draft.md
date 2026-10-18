# Project 3 — Rottnest Island provider (draft brief)

> **Draft, proposed 2026-10-17. Not yet agreed with the stakeholder.** It moves to the top of `ai-state/brief.md` once the decisions in [Decisions needed](#decisions-needed) are made and PR #68 (RAC) has merged. Until then it lives here, so it cannot conflict with PR #68's files.

## What we're building

WA Stay's third accommodation provider: **Rottnest Island**, booked through **Stay Rottnest** (`stayrottnest.com`, the Rottnest Island Authority's booking service).

**The inventory.** About 300 self-contained units, cabins, dorms, hostel beds and 43 campsites, in these precincts:

- Thomson Bay North and Thomson Bay South;
- Bathurst, with the Caroline Thomson Cabins;
- Longreach Bay, Fay's Bay and Geordie Bay;
- Kingstown: Governor Circle, the barracks dormitories, the Commanders Cottages and the hostel;
- the Campground.

Samphire, Hotel Rottnest, Discovery (Pinky's), Karma and The Lodge are private, book on their own sites, and are out of scope.

**Why it differs from ParkStay and RAC.** Stay Rottnest's booking terms (RIA4555, clause 4) forbid bookings "made or assisted by the use of automated software". They name "web scraping, data mining, rate shopping, booking", and RIA may cancel a suspect booking without refund and block IP addresses (`ai-state/research/rottnest-terms.md`). Rottnest is therefore WA Stay's first **links-only provider**: **WA Stay never sends a request to Stay Rottnest**, and the person does every search and booking on Stay Rottnest's own site.

The value WA Stay adds is everything around the booking:

- knowing **when** stays open (the monthly Open Day);
- knowing **which** stays RIA will accept (fixed peak blocks, minimum nights, the 5/3 rule);
- being **ready** on Open Day (the waiting room, the SMS passcode, a plan of choices);
- **looking at the right moments** for a cancellation.

## Who uses it

WA Stay users who want a Rottnest stay, which is WA's most contested public accommodation: about 15,000 people queue for about 1,500 peak places. They want to:

- see the island's accommodation on Explore beside ParkStay and RAC;
- know which Open Day releases their dates, and be reminded in time to join the waiting room;
- be told when to look for a cancellation (the stakeholder's priority), and get there in one click;
- never put a booking at risk of cancellation under clause 4.

## Research inputs

- `ai-state/research/rottnest-terms.md`: the contract review of clause 4 and the other terms, verdicts per feature, 13 rules the app must follow, and a draft request to RIA.
- `ai-state/research/rottnest-release-rules.md`: Open Days (the first Wednesday of month M releases month M+8 at 8:30 am AWST), the waiting room, peak fixed blocks, booking rules, cancellations, inventory.
- `ai-state/research/rottnest-prior-art.md`: the platform (P3 on Oracle OPERA, behind Cloudflare), the protection layers, and two paid notify-only watchers (RottoWatch, Quokka Watch).
- `ai-state/research/rottnest-booking-flow.md`: the site, its links and how search works, from a minimal anonymous look.

## Facts that shape the design (verified 2026-10-17)

- **Clause 4** (effective for bookings from 4 March 2026; in the guides since May 2025) covers polling and alerting as well as booking ("assisted"), and its remedy falls on the user's own booking and connection.
- **Open Days.**
  - The first Wednesday of each month at **8:30 am AWST** releases the whole of month M+8 (1 January moves to the next Wednesday).
  - The **Queue-it waiting room opens at 6 am**, and everyone in it before 8:30 gets a **random** place, so being first gains nothing.
  - Entry needs an **SMS passcode** to a real mobile.
  - When called, a person has 30 minutes to enter.
  - About 90% of bookings are made in the first 30 minutes.
- **Peak periods** (late November to January, Easter, the April school holidays) sell **fixed arrival and departure blocks per precinct**; there is no ballot.
- **Rules:**
  - the 5/3 rule (book up to 3 nights into the next, unreleased month with 5 nights in the open one, except on some Open Days);
  - Saturday stays need 2 nights;
  - no arrivals or departures on public holidays;
  - at most 14 nights;
  - peak three-night minimums for the campground, the dorms, the hostel family rooms and Governor Circle;
  - at most two units per transaction;
  - occupancy limits per unit type.
- **Money and cancellations:**
  - self-contained units pay a 25% deposit, with the balance due 30 days before arrival (unpaid means cancelled); the campground and hostel are paid in full when booked;
  - a 14-day cooling-off (full refund if more than 30 days out);
  - fee steps at 30 days and at 48 h before the 2 pm check-in;
  - cancelled stays go back on public sale, and no source says how fast.

## Proposed scope

| # | Feature | What the person gets | Requests to Stay Rottnest |
| --- | --- | --- | --- |
| P1 | **Links-only providers** (SDK) | `integration: 'links'`: the provider's `ctx.http` refuses every request, and the registry refuses capabilities that need requests | none, enforced |
| P2 | **Rottnest on Explore** | The island's precincts on the map and list, unit types with beds and occupancy, "Check on Stay Rottnest", and links | none |
| P3 | **Rottnest's rules and calendar** | A place page that says, for the chosen dates, which Open Day releases them (or that they are on sale), the fixed blocks and minimum stays that apply, and whether RIA would accept the stay; one click to search on Stay Rottnest | none |
| P4 | **Open Day plans** (Site Sniper, `remind` action) | Choose a stay; WA Stay checks it against the rules, names its Open Day, and reminds you the evening before, at 6 am (waiting room open) and at 8:15 (join before 8:30), with a checklist; one click opens Stay Rottnest | none |
| P5 | **Look reminders** (Watches, reminder mode) | Choose a stay; WA Stay reminds you to look when cancellations are likely (the end of the cooling-off after its Open Day, the days around the balance due 30 days out, the days before the 48-hour step) and at your own cadence, and stops when you have booked or the dates pass | none |
| P6 | **Docs, website, CLAUDE.md** | The provider docs, the calendar's upkeep, the website's Rottnest row and independence notice | — |
| P7 (later) | **Booking deadlines** (when Bookings ships) | For a Rottnest booking you record: cooling-off end, balance due, fee steps, the keyholder deadline | none |
| P8 (only with RIA's written consent) | **Checks** | (e) a check on your click, then (f) a notify-only background watch, within RIA's limits | per RIA's consent |

Nothing here holds, carts or books. Holds, auto-hold, the access gate, booking import, sign-in and experiments are off for Rottnest, and the registry refuses them for a links-only provider.

## Decisions needed

| # | Question | Proposed default |
| --- | --- | --- |
| T1 | Accept the terms review's recommendation: links-only now (option A), and **no automated watch without RIA's written consent**? | Yes |
| T2 | Send RIA the request in `rottnest-terms.md` Appendix A (option B), as the stakeholder, in parallel? | Yes, before building P8; nothing else waits on it |
| T3 | Look reminders (P5) instead of an automatic watch: is that worth building, given the stakeholder's priority? | Yes: it is the compliant form of the watch, and its timing model is reused by P8 |
| T4 | How the Open Day calendar and the peak blocks reach people: in app updates (as RAC's calendar does), or also a small data file on WA Stay's own website that the app reads? | App updates. The Open Day rule computes most of the calendar; the peak blocks change once a year |
| T5 | The provider's name and id. | id `rottnest` (never changes); name "Stay Rottnest", short name "Stay Rottnest" ("Search on Stay Rottnest"); monogram "SR"; brand colour chosen from the app's tokens |
| T6 | Should "Bookings" deadlines (P7) wait for Bookings to lose its "Soon" pill? | Yes, later |
| T7 | Open the Stay Rottnest page in the system browser (where the person's password manager, card autofill and signed-in session live), or in a WA Stay window? | The system browser |

## Success criteria (draft)

1. Explore lists Rottnest's precincts with their unit types. A place page shows the rules and the release status for chosen dates, and opens Stay Rottnest's search on a click.
2. An Open Day plan computes the right Open Day for any stay (fake-clock tests over the 54 known Open Days and the rule), refuses stays RIA would refuse (rule tests from the guides' own examples), and sends its reminders on time.
3. A look-reminder watch sends reminders at the cancellation hotspots and at the person's cadence, never claims anything is free, and stops when the person has booked or the dates pass.
4. **No request to any Stay Rottnest host** is sent in any test, journey or run: a refusing client, a fixture-mode e2e request log and a source guard prove it.
5. Every rule in `rottnest-terms.md` §6 that applies to what ships is enforced, with a test where testable.
6. The full gate passes: `lint`, `format:check`, `type-check`, `test`, `test:tz`, `build:e2e` and `test:e2e`.
7. The docs, CLAUDE.md and the website describe Rottnest truthfully: reminders and links, not availability.

## Out of scope

- Any request to Stay Rottnest, until RIA consents in writing (P8).
- Automated holds, carts, bookings, the waiting room or the SMS passcode, ever.
- Private island operators (Samphire, Hotel Rottnest, Discovery, Karma, The Lodge).
- Ferries, bikes and island activities.
- RottoWatch's or Quokka Watch's APIs (terms review §7, option D).
