# Stay Rottnest provider

Stay Rottnest is the Rottnest Island Authority's (RIA's) booking service for the island's
villas, cottages, cabins, hostel and campground, and WA Stay's third provider. Everything
specific to it lives in `src/main/providers/rottnest/`; the rest of the app reaches it only
through the provider SDK and the registry ([provider guide](../adding-a-provider.md)). It is an
API provider in the SDK's terms: one public results page answers a stay for the whole island,
and no browser is driven.

Stay Rottnest's booking terms don't allow bookings "made or assisted by the use of automated
software", so this module is built around what that means for the person
([The notice and the risk](#the-notice-and-the-risk)): it only looks, slowly, after the person
has accepted a notice, and never holds, books or signs in.

- [Endpoints](endpoints.md): the one request the module sends, the pages it links to, and what
  it never uses.
- [Open Days and booking guides](open-days.md): keeping the Open Day calendar, the booking
  guides and the public holidays current.

## Contents

- [Manifest](#manifest)
- [The precincts](#the-precincts)
- [Availability](#availability)
- [Explore's counts and watches](#explores-counts-and-watches)
- [Booking rules](#booking-rules)
- [Open Days](#open-days)
- [Site Sniper: Open Day plans](#site-sniper-open-day-plans)
- [The notice and the risk](#the-notice-and-the-risk)
- [What the module never does](#what-the-module-never-does)
- [Data and images](#data-and-images)
- [Tests](#tests)

## Manifest

`rottnestManifest` in `src/main/providers/rottnest/manifest.ts`:

| Field                     | Value                                                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `name`, `shortName` | `rottnest`, Stay Rottnest, Stay Rottnest                                                                                                                  |
| `integration`             | `api` (one HTML results page through `ctx.http`; no browser automation)                                                                                   |
| `brand`                   | `#9E3819` (the app's deep coral) with the monogram `SR`: plain text, never RIA's logo or colours                                                          |
| `locationKinds`           | cabin (the self-contained precincts), campground, other (Kingstown)                                                                                       |
| `timezone`, `currency`    | `Australia/Perth`, `AUD`                                                                                                                                  |
| `limits`                  | watches every 30 minutes at most, 1 request in flight, 60 s between background requests (`minRequestIntervalMs`), catalogue fresh for 24 h (it is a seed) |
| `releaseModes`            | `open_day` "On its Open Day", reminder-only, with three reminders and a checklist ([below](#site-sniper-open-day-plans))                                  |
| `notice`                  | "Before WA Stay checks Stay Rottnest", version 1 ([below](#the-notice-and-the-risk))                                                                      |

| Capability                        |                                           | Module                                                                                                                                                     |
| --------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalog` (`catalogMode: 'full'`) | yes                                       | `precincts.ts` (the nine precincts and their 68 room types, a seed of facts) and `catalog.ts`: nothing is requested for the catalogue or a precinct's page |
| `availability`                    | yes                                       | `availability.ts` and `results-page.ts`: one search for the whole island, shared                                                                           |
| `bulkAvailability`                | yes                                       | `availability.ts`: Explore's free counts, from the same search                                                                                             |
| `watches`                         | yes                                       | uses `availability`, every 30 minutes at most                                                                                                              |
| `snipes`                          | yes (Site Sniper is marked "coming soon") | `release-policy.ts`: Open Day plans, which only remind                                                                                                     |
| `holds`                           | no                                        | WA Stay never holds, carts or books on Stay Rottnest                                                                                                       |
| `accessGate`                      | no                                        | the Open Day waiting room is the person's, in their own browser                                                                                            |
| `bookingImport`                   | no                                        |                                                                                                                                                            |
| `account`                         | `none`                                    | every check is anonymous                                                                                                                                   |

The module also has booking rules (`stayRules`: `rules.ts`, with `booking-guides.ts` and
`public-holidays.ts`) and the release status (`release.ts`, with `open-days.ts`). `links.ts`
gives every link, and `client.ts` sends every request ([endpoints](endpoints.md)).

## The precincts

Nine precincts, in Explore's area "Rottnest Island": Thomson Bay North, Thomson Bay South,
Kingstown, the Campground, the Caroline Thomson Cabins, Bathurst, Longreach Bay, Fay's Bay and
Geordie Bay. Each is `rottnest:<slug>` (`rottnest:geordie-bay`), with its kind, an approximate
pin (Stay Rottnest assigns the unit about three weeks before arrival), its stay types and a
sentence in WA Stay's own words.

A precinct's units are its **room types** (`unitId` the room type's code, `GPV04`), each with
its stay type, its kind's group as its type, and the most people it sleeps. Each stands for
several units of that type, so the place page lists them as types, "Bookable as …"
(`unitsAreTypes`), never as single units. The room types, their codes, groups, sleeps and bedrooms come from one
search captured in a person's own browser; their names are RIA's.

A precinct's own link opens Stay Rottnest's accommodation maps: there is no page per
precinct.

## Availability

Stay Rottnest's results page (`GET /rates-room1`) answers one stay for **every** room type on
the island at once, whatever its filters, and only for the whole stay: a room type is free
(with "from $…" for the stay) or "Unavailable on your dates". So:

- **One search, shared.** The place page's check, Explore's counts and every watch of the same
  stay and party share one search: one in flight, and its answer kept for 2 minutes. Ten
  watches of one stay cost one request.
- **A room type is free** when its card is not marked unavailable, shows a price, and sleeps
  the whole party (adults, children and infants; Stay Rottnest counts children 0–17, so
  infants are sent as children). All its nights are then available, and its price is the
  stay's total, never a nightly rate. `freeCount` is 1: the page says whether at least one
  unit of the type is free, never how many.
- **Not free** reads as nights `unknown`, labelled "Unavailable for these dates" (the page's
  whole-stay "no" can't say which night) or "Sleeps N at most". So a watch's partial match
  never fires on Stay Rottnest.
- **Rates.** `RIA25` reads "25% deposit when booked"; `CAMPING` and `HOSTS` "Paid in full when
  booked".
- **Links.** "Book on Stay Rottnest" is Stay Rottnest's own search for the stay, showing the
  precinct, never its booking step.
- **A page it can't read** (no room type at all) is an error, never "nothing free". A room type
  the seed doesn't know is logged once and left out.
- **Nothing is asked** for a stay the booking rules refuse (every night `unknown`, labelled
  with why) or one not on sale yet (every night not released, with when it opens). When every
  precinct is in that state, Explore's search sends nothing.

## Explore's counts and watches

Explore's free counts come from the same search: per precinct, the number of room types free
for the whole stay (a lower bound on the units free), by stay type. A precinct the rules refuse
reads "Not bookable for these dates"; one whose stay isn't on sale reads "Opens Wed 4 Nov".

A watch checks every 30 minutes at most, and its alert links to Stay Rottnest's search for the
stay. Watches of the same stay share searches, and the core spaces background requests 60 s
apart.

## Booking rules

`rules.ts` works out Stay Rottnest's published booking rules for a stay without asking it, from
its terms and the monthly booking guides (`booking-guides.ts`, October 2026 to June 2027, read
by hand). In the order they are checked:

- **Arrival:** not past, and not today (online bookings can't be for the same day).
- **Length:** 14 nights at most.
- **Closures:** Bathurst from the night of 27 April 2027 to the end of June 2027.
- **Fixed peak stays:** in a guide's peak periods each block group (Geordie Bay; Longreach Bay
  and Fay's Bay; Thomson Bay North; Thomson Bay South with Kingstown's heritage and superior
  view cottages; Bathurst with the Caroline Thomson Cabins) arrives and leaves only on its own dates. The refusal suggests the nearest blocks, which the place page and the new-snipe flow
  offer as buttons.
- **Minimum stays:** 3 nights in the peak for the Campground, Kingstown's dorms, the hostel's
  family rooms and Governor Circle.
- **Event Saturdays** (the Channel Swim, Port to Pub): not that Saturday night alone.
- **The party:** everyone within what a room type sleeps.

A public-holiday arrival or departure is a note, not a refusal: the guides no longer forbid it,
and the terms say only that restrictions may apply. Neither is there a general two-night
Saturday minimum: the guides from September 2026 don't set one. A rule that covers only some
of the room types a stay could take is a note, unless the person chose types it covers.

A watch or snipe the rules refuse is not created, and says which part of the stay to change.

## Open Days

`open-days.ts` and `release.ts`, with no request:

- **A month opens on its Open Day,** the first Wednesday of the month eight months before, at
  8:30 am Perth time (a week later when that Wednesday is New Year's Day). Published Open Days
  win over the rule; after the last published one the dates are "expected".
- **A stay is on sale** once every month it has a night in is open, or sooner by the **5/3
  rule** (clause 8(d) of the terms): with at least 5 nights in an open month, a stay may take
  up to 3 nights of the next month. A booking guide can suspend that ("There will be no
  bookings into January 2027 on this Open Day"), and then the stay waits for the later month's
  Open Day.
- **Quiet on Open Day mornings.** From 5:30 am to noon Perth time on an Open Day the client
  sends nothing: watches wait, and a check says why ("It's Stay Rottnest's Open Day, so WA
  Stay doesn't check this morning.").

Each precinct's page describes the Open Days and the next one.

## Site Sniper: Open Day plans

Before 8:30 on an Open Day, Stay Rottnest's waiting room gives everyone in it a random place,
so checking faster at the release gains nothing, and the release is where its defences are
strongest. Site Sniper's one mode here, **On its Open Day**, makes a **plan**, which never
checks:

- `release-policy.ts` gives the stay's Open Day at 8:30 am from its release status. A stay
  already on sale, or one the rules refuse, is refused in a sentence.
- The plan reminds the person at 6 pm the day before ("Open Day tomorrow"), at 6 am ("The
  waiting room is open") and at 8:15 am ("15 minutes to Open Day"), and lists what to have
  ready: their choices in order, dates that can move, the party within what a type sleeps,
  their Stay Rottnest profile, their own mobile for the waiting room's passcode (temporary or
  virtual numbers aren't accepted), a Visa or Mastercard, a keyholder for a second unit, and
  only what they need.
- Nothing in the plan's words suggests it finds, holds or secures anything, or that more
  devices, numbers or browsers help (`tests/unit/providers/rottnest/manifest.test.ts`).

The person joins the waiting room and books in their own browser. Once the Open Day has come,
the plan offers a watch for the same stay.

## The notice and the risk

Clause 4 of Stay Rottnest's booking terms (Use of Automated Software) says bookings may not be
made or assisted by automated software, including programs for web scraping or rate shopping.
If RIA reasonably suspects a booking was, it may cancel it without a refund and block the
internet connection it came from.

WA Stay's checks are automated, so a booking made after one of its alerts could count as
assisted. The risk is the person's, and they take it knowingly: before WA Stay sends Stay
Rottnest anything, they read the provider's **notice** (`manifest.notice`) and tick "I
understand, and I want WA Stay to check Stay Rottnest for me". Until then the core asks Stay
Rottnest nothing: Explore offers the notice, the place page asks it before a check, and watches
are paused. It can be withdrawn in Settings → Accounts, and checking stops at once. A new
version of the notice asks again. Open Day plans need no notice, as they send nothing.

To keep the risk small, the module keeps to these limits:

1. **Only looks:** one search page, never a hold, cart, form, sign-in or the booking step.
2. **Slowly:** one request at a time, 60 s apart in the background, one shared search per
   stay, and watches every 30 minutes at most.
3. **Quiet on Open Day mornings.**
4. **No evasion:** the app's one browser identity, no redirect followed, and a block,
   challenge or waiting room stops every request for 12 hours, doubling up to 7 days.
5. **Anonymous:** no account, and no cookie of the person's.
6. **Facts only:** no RIA photos, descriptions, maps or logos.

## What the module never does

- Request anything but `GET /rates-room1` on `bookings.stayrottnest.com`.
- Open, request or link to the booking step (`/details/…`), or post any form.
- Enter the waiting room, answer a challenge, or retry a request that was turned away.
- Sign in, or use the person's Stay Rottnest account or cookies.
- Hold, cart, book or pay. The person books on Stay Rottnest's own site.
- Show RIA's photos, descriptions or maps, or its logo.

## Data and images

The seed holds facts only: each room type's code, group, stay type, sleeps, bedrooms and RIA's
name for it, and each precinct's name and an approximate pin (from OpenStreetMap's place names,
© OpenStreetMap contributors, ODbL). A precinct has no photos; its card shows WA Stay's
placeholder. The test fixtures are trimmed to the room types' cards (their attributes, names,
prices and rate names), from one capture made in a person's own browser, and one page made up
from it with every room type unavailable (`tests/fixtures/providers/rottnest/README.md`).

## Tests

- `tests/integration/rottnest-provider.test.ts`: the contract suite on the recorded page, the
  shared search, the mapping and Explore's counts.
- `tests/unit/providers/rottnest/`: the manifest (its limits, the notice's words and the plan's
  copy guard), the client's rules (one path, the block cool-down, the Open Day pause), the
  results page, the precincts, the Open Days, the release status, the booking rules on the
  guides' own examples, and the booking guides' and public holidays' data.
- `tests/unit/scheduler/plan-reminders.test.ts`: Open Day plans on fake timers, with the real
  provider.
- `tests/e2e/rottnest-notice.spec.ts` and `tests/e2e/rottnest-plan.spec.ts`: the built app with
  no Stay Rottnest routes until the notice is accepted, so any request before then would be
  refused and logged.
