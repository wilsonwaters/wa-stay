# RAC Parks & Resorts provider

RAC Parks & Resorts runs holiday parks and resorts across Western Australia, and is WA Stay's
second provider. Everything RAC-specific lives in `src/main/providers/rac/`; the rest of the app
reaches it only through the provider SDK and the registry
([provider guide](../adding-a-provider.md)). It is an API provider: the parks' booking pages
answer an availability request with JSON, so no browser is driven.

- [Endpoints](endpoints.md): what the module requests, the pages it links to, what it never
  uses, and RAC's codes as the module reads them.
- [Release calendar](release-calendar.md): keeping the school-holiday release days current.

## Contents

- [Manifest](#manifest)
- [The parks](#the-parks)
- [Stay types](#stay-types)
- [Availability](#availability)
- [Pacing](#pacing)
- [Releases](#releases)
- [The member number](#the-member-number)
- [The auto-cart experiment](#the-auto-cart-experiment)
- [RAC's terms](#racs-terms)
- [Data and images](#data-and-images)
- [Tests](#tests)

## Manifest

`racManifest` in `src/main/providers/rac/manifest.ts`:

| Field | Value |
| --- | --- |
| `id`, `name`, `shortName` | `rac`, RAC Parks & Resorts, RAC |
| `integration` | `api` (one JSON endpoint and one HTML page, through `ctx.http`; no browser automation) |
| `brand` | `#3A3F47` (the app's dark slate) with the monogram `RAC`: plain text, never RAC's logo or its own colours |
| `locationKinds` | holiday-park |
| `timezone`, `currency` | `Australia/Perth`, `AUD` |
| `limits` | watches every 15 min at most, 1 request in flight, 10 s between background requests (`minRequestIntervalMs`), catalogue fresh for 24 h |
| `stayFields` | `pets` "Pets", 0–2, default 0 ("Up to 2, where pets are allowed."; availability, watches and snipes), sent to RAC as `animals`; and for a hold only (the auto-cart, [below](#the-auto-cart-experiment)), a site's `equipmentType` "Equipment" (none, or one of NewBook's 15 types), `equipmentLength` and `equipmentWidth` in metres ("6.5") |
| `bulkAvailabilityStayFields` | `arrival`, `departure`, `adults`, `children`, `infants`, `params.pets`: RAC's request carries the party and the pets, so a change to any asks again |
| `releaseModes` | `daily_rollover` "When these dates open" and `scheduled` "At a time you set", each `maxWindowMinutes: 30` |
| `experiments` | `autoCart` "Put stays in my RAC cart automatically", off by default; it turns on `holds` ([below](#the-auto-cart-experiment)) |
| `holdRelease` | `true`: with the experiment on, "Let it go" takes the stay out of the cart |

| Capability | | Module |
| --- | --- | --- |
| `catalog` (`catalogMode: 'full'`) | yes | `parks.ts` (the eight parks, a seed of facts: nothing is requested when the catalogue syncs) and `catalog.ts`; a park's categories from its book-now page (`book-now.ts`) or, at a park on NewBook's own engine, from one availability request |
| `availability` | yes | `availability.ts` and `mapping.ts`: one request per park and stay, every category night by night, with prices and RAC's stay rules |
| `bulkAvailability` | yes | `bulk.ts`: Explore's free counts, one request per park |
| `watches` | yes | uses `availability` |
| `snipes` | yes (Site Sniper is marked "coming soon") | `release-policy.ts` and `release-calendar.ts`; RAC snipes alert (with the auto-cart experiment on, they can hold) |
| `holds` | off by default: the `autoCart` experiment turns it on | `holds.ts` (the cart), `cart-page.ts` (reading the cart page), and `cart-guard.ts` (what any request may be) |
| `accessGate` | no | RAC has no queue |
| `bookingImport` | no | WA Stay never cancels or changes an RAC booking |
| `account` | `optional` | `auth.ts` and `membership.ts`: the person's own RAC member number ([below](#the-member-number)) |

`links.ts` gives every link: a park's home page ("View on RAC"), and its booking pages ("Book on
RAC", [below](#availability)). There is no link to manage a booking: that needs the park's own
sign-in on RAC's site. `client.ts` sends every request, and asks the cart guard
(`cart-guard.ts`) about each one first ([endpoints](endpoints.md#rules-every-request-follows)).

## The parks

The eight parks RAC books online, from `parks.ts`. The region is Explore's region name, so the
Region filter works across providers.

| Park | Town, region | Stay types | School holidays open at |
| --- | --- | --- | --- |
| RAC Busselton Holiday Park | Busselton, South West | Camping, cabins | 8 am |
| RAC Cable Beach Holiday Park | Broome, Kimberley | Camping, cabins | Not in RAC's school-holiday releases |
| RAC Cervantes Holiday Park | Cervantes, Midwest | Camping, cabins | 9 am |
| RAC Esperance Holiday Park | Esperance, South Coast | Camping, cabins | 7 am |
| RAC Margaret River Nature Park | Margaret River, South West | Camping, cabins, dorms, glamping | 7 am |
| RAC Exmouth Cape Holiday Park | Exmouth, Pilbara | Camping, cabins, rooms | 9 am |
| RAC Karri Valley Resort | Pemberton, Warren | Camping, cabins, rooms | 8 am |
| RAC Monkey Mia Dolphin Resort | Shark Bay, Midwest | Camping, cabins, rooms, dorms | 8 am |

Two RAC parks are left out: **Ningaloo Reef Resort**, closed for redevelopment, and **Rose
Gardens Holiday Park**, which RAC books on a site of its own, while WA Stay asks only RAC Parks &
Resorts' own host.

A park is `rac:<slug>`, its slug being its path on RAC's site (`/busselton/`). The slug is stored
in watches and snipes, so it never changes. Each park's facts (its WordPress site id, address,
coordinates, stay types and release hour) were read from RAC's pages by hand; the catalogue sync
sends nothing.

## Stay types

RAC books by **category** ("Powered Site", "Two Bedroom Cabin", "Dorm Room - Sleeps 14"), not by
site: each category is one unit, `cat:<category id>`, with a count of how many of it are free. A
category's stay type comes from its name first (`unit-kinds.ts`), checking these words in order:

1. dorm or bunk: **Dorms**;
2. safari tent, glamping or bell tent: **Glamping**;
3. site, camp or camping: **Camping**;
4. cabin, chalet, villa, cottage, bungalow, lodge, studio or apartment: **Cabins & villas**;
5. room, suite or motel: **Rooms**.

A name with none of these words takes the stay type of its NewBook category type, which differs
by park (type 2 is cabins at Cable Beach but sites at Busselton), and a category neither gives is
"other" (logged once). A unit's group on the place page ("Sites", "Cabins") follows its stay
type, so it reads the same on the place page, in a check and in a watch.

The five parks on RAC's own booking widget list their categories on their book-now page, with
guests, pets, equipment, features and photos. Exmouth, Karri Valley and Monkey Mia use NewBook's
own engine, whose page lists nothing until it is searched, so their categories come from one
availability request for a near stay (one night, two weeks ahead, two adults); nothing of that
stay's availability or prices is kept.

## Availability

`availability.check` sends one request for a park and stay and maps every category in RAC's
answer to a unit, night by night (the codes are in [endpoints](endpoints.md#racs-codes)):

- **Free nights** have a price, from the cheapest rate RAC accepts for the stay that counts for
  the person: a public rate, or a members' rate with a member number saved
  ([below](#the-member-number)). A night with no price yet (NewBook's placeholder amount) shows
  none.
- **A stay is free** only when every night is free, one site is free for the whole stay, a rate
  counts, and RAC's stay rules allow it.
- **Stay rules.** A minimum stay (from the rate's minimum for the arrival night), and days with
  no arrivals or no departures. A stay that breaks them is never free: its free nights read
  "stay rules apply", and a watch never alerts on it.
- **Split stays.** When every night has a free site but no one site is free for all of them, the
  nights are not counted as free.
- **Pets.** Up to two, sent with the stay; a category that takes none refuses a stay with pets.
  A stay with more than two (or a fraction) is refused before anything is sent.
- **364 days.** RAC takes bookings 364 days ahead. A night beyond that, or one held back for a
  school-holiday release still to come, is "not released yet", and the check says when the stay
  opens ([below](#releases)).
- **Closed** nights carry RAC's own reason ("This Site is closed as of …"), as plain text.

"Book on RAC" opens the category's own booking page with the stay filled in
(`/<slug>/booking/`), or the park's book-now page with the dates, the party, the pets and whether
the person is a member. It is never a cart address: opening one would add the stay to a cart.

**Explore's free counts** (`bulk.ts`). RAC has no all-parks request, so Explore sends one request
per park, one after another, at the pace of something the person asked for (below). Each park
reads the number of units free for the whole stay ("27 spots free", "1 cabin free"), by stay type
for the Stay type filter, and never "N of M": RAC gives no total of its sites. A park that fails
reads as unknown; a park with nothing free reads "None free", and one where nothing can be booked
for those dates at all (not released yet, or closed) reads "Not open". The counts use the same
mapping as the place page, so the two agree.

## Pacing

RAC's site asks for 10 seconds between automated requests, so the core paces the module
(`limits.minRequestIntervalMs`): one RAC request at a time, and

- **in the background** (a watch's check, a snipe's checks), each request starts at least 10 s
  after the one before ended;
- **what the person starts** (a place page, Explore's dates, "Check now", and with the
  auto-cart on, putting a stay in the cart or letting it go) goes first, 1 s after the request
  before. Explore's eight requests then take about 40 to 60 seconds together, and
  Explore says "Still checking RAC…" meanwhile. A place page opened during them waits for one
  request at most.

The catalogue sync sends nothing, and saving a member number sends nothing either.

**A block stops everything.** A 403, a 429 or Cloudflare's challenge page stops every RAC request
for 30 minutes ("RAC Parks & Resorts turned the request away (HTTP 429). WA Stay won't ask again
until 3:45 pm."). Blocks in a row double the pause each time (1 hour, 2 hours…), a `Retry-After`
asking for longer is honoured, and no pause is longer than a day. The pause is kept across a
restart. Nothing is retried, and no challenge is ever answered: a watch reads the error, and a
snipe that meets a block ends **Failed** at once.

## Releases

`RacReleasePolicy` (`release-policy.ts`) tells Site Sniper when a stay opens, and tells a check
which nights are still held back. It sends no request.

- **Rolling, at midnight Perth time.** RAC takes bookings 364 days ahead, and one more night
  opens each midnight. A stay can be booked once its last night is open: at 00:00 on its
  departure date less 365 days.
- **School holidays, at each park's hour.** WA school holidays are held back and opened on RAC's
  own release days ([release calendar](release-calendar.md)), at 7, 8 or 9 am by park
  ([above](#the-parks)). A stay touching them opens at the later of the two instants.
- **Members, 48 hours earlier.** With a member number saved, a stay opens at the members'
  pre-sale instead: the same hour, two days before the public release. Every park in the
  school-holiday releases has a pre-sale; Margaret River's dorms are not in it. A member whose
  snipe would start after the pre-sale has passed is timed to the public release.
- **Cable Beach** is in no school-holiday release. Outside its dry season the rolling window
  applies; its dry-season nights (15 May to 15 October) open on RAC's own monthly release days,
  which WA Stay does not know, so a snipe for them takes **At a time you set** (`scheduled`).

Both modes start at the release and check every 10 s at the fastest, for at most 30 minutes.
There is no "When someone cancels" mode: a watch covers cancellations, every 15 minutes at most.
A stay the policy cannot time is refused with the reason: one in Cable Beach's dry season, in
school holidays RAC has not announced, past the dates the calendar knows, or already open. A
place page's release note is the policy's own sentence ("New dates open daily at midnight AWST,
364 days ahead. School holidays open on RAC's release days at 8 am AWST, 48 hours earlier for
members.").

## The member number

The person's own RAC member number is the RAC account, saved in **Settings → Accounts**
(`auth.ts`, a `credentials` sign-in). It is optional: without it WA Stay shows public prices and
public release times.

- **What it changes.** With a number saved, members' rates count (their prices are marked
  "RAC member rate" on the place page), a stay that only members can book (in the pre-sale) can
  read as free, snipes are timed to the members' pre-sale, and "Book on RAC" opens the book-now
  page as a member. Saving, replacing or removing it asks RAC's availability again and re-times
  RAC's snipes.
- **Saving it.** The person types it and ticks three statements: it is their own number, they
  will stay at the park, and they will book in the name on their RAC card. WA Stay checks only
  its form, on the computer (4 to 16 digits once spaces and hyphens are removed; anything else
  is refused with "That doesn't look like an RAC member number"), and keeps the digits.
- **Where it is kept.** Encrypted on the computer, in RAC's own secret store
  ([security](../../security.md#secret-storage)). It is write-only: the app never shows it
  again, and only `membership.ts` reads it, as a yes or no.
- **WA Stay never sends it.** Not to RAC, not anywhere: RAC offers no way to check a number
  without a booking, and WA Stay never tries one. The person types or pastes it at RAC's own
  checkout; **Copy RAC member number** (in Settings, beside "Book on RAC" on a place page, a
  watch and an alerted snipe, and beside "Pay now" for a stay in the cart) puts it on the
  clipboard for that. WA Stay never fills it in on RAC's pages, the cart's included.

## The auto-cart experiment

RAC's only hold is its cart: opening a rate's cart address adds the stay to a NewBook cart on the
session that opened it. WA Stay can do that for the person, and it ships **off**: the
`autoCart` experiment, which no one has yet checked with a real booking. Until then everything
above holds, and every RAC snipe alerts.

**Turning it on.** Settings → Accounts → RAC → **Experimental**: "Put stays in my RAC cart
automatically", confirmed first ("Experimental: not yet checked with a real booking. A cart is
not a booking: only a paid booking secures your stay."). It takes effect when WA Stay restarts,
and so does turning it off. Only then is `holds` on in RAC's manifest, and only then does the
factory build the holds module and let the client send a cart request: with the experiment off,
no code path can reach a cart.

**What it does** (`holds.ts`), when a watch set to hold, or a snipe set to "Hold it for me",
finds the stay free:

1. **One cart at a time.** While the stay it put in the cart last has not run out, or while
   another hold or a release is under way, it adds nothing ("Your RAC cart already holds a stay.
   Pay for it or let it go first."), and sends nothing.
2. **A site needs your equipment.** A site's cart needs the equipment type, its length and its
   width: the hold-only stay fields, asked for under "Hold a site automatically when found" on a
   watch and on a snipe's stay step. Without them it adds nothing and says so. A cabin or a room
   needs none.
3. It reads the park's cart page: a cart that already holds nights is left alone.
4. It asks RAC's availability once more for the one category, with the equipment, and takes the
   cart address of the rate the check prices the stay with (a members' rate only with a member
   number saved).
5. **One GET of that cart address**, and nothing else, only when it is RAC's own booking page for
   the park. The page it ends on must show the stay's nights and an amount, else the stay is
   reported taken.
6. The hold runs until the cart's own countdown ends, when the page gives one; otherwise WA Stay
   guesses 10 minutes, and says "about" ("Held until about 10:42 am", "within about 10
   minutes").

The cart address and its token are never stored, logged or shown: an abort after it was sent
clears RAC's cookies in the app, so a half-made cart is no longer this session's.

**Paying.** "Pay now" opens the park's cart page in a payment window on RAC's session, never the
cart address (that would add the stay twice). The window shows RAC's own pages only. The person
checks out, agrees to RAC's terms and pays there; "Copy RAC member number" sits beside "Pay now"
for RAC's membership prompt. WA Stay never marks an RAC stay booked: it has not seen RAC's
confirmation page yet, so the person looks for RAC's confirmation email.

**Letting it go.** "Let it go" on the watch's or snipe's page, closing the payment window without
paying, and deleting the watch or snipe all ask RAC to take the stay out of the cart. WA Stay reads
the cart page first, and removes the stay (RAC's own "Remove booking" request) only while the
cart still holds it, by its dates and category. A cart that no longer holds it (paid, run out,
removed in the window) is left as it is: "RAC no longer holds it. If you paid, look for RAC's
confirmation email." A cart it cannot read for certain is left alone too, and the hold runs out
on its own.

**What it never does**: open checkout, tick RAC's terms, type or send card details, extend a
hold, check or fill in a member number, hold two stays at once, or hold two for the same nights
(the night guard). The cart guard (`cart-guard.ts`) refuses all of these on every request and
redirect, whatever is on, and refuses the cart address and the removal while the experiment is
off.

### Verifying it

For the maintainer, with a genuine booking of their own that they mean to pay for, the
experiment turned on, and the log open (Settings → About → Open logs folder). It checks what
the module was written from RAC's page code to expect:

- **The cart timer.** The page the cart address ends on, and the cart page, carry NewBook's hold
  fields as hidden inputs: `hold_ids[]` (one per held item), `earliest_hold_expires_when`
  (seconds left) and `default_hold_duration` (minutes). Note their values against the countdown
  RAC shows and WA Stay's "Held until": no "about" means WA Stay read them.
- **The cart page.** `cart_breakdown` is a script variable assigned on its own line, as JSON, its
  entries carrying `totalBookingNights` and `amount`. The sidebar's item names
  (`.sidebar_category_name`) match the availability answer's `category_name` for the category,
  and its arrival and departure read as dates.
- **The removal.** `newbook_api_path` is an absolute https address on RAC's host,
  `https://parksandresorts.rac.com.au/<slug>/wp-content/themes/parks-and-resorts/inc/newbook/api/<file>.php`,
  with nothing after `.php` but a `?`. Let a stay go once ("Let it go") and see it leave RAC's
  cart.
- **Checkout's top-level origins.** Pay in the payment window. The window shows RAC's origin
  only, so a step that moves the whole page elsewhere (a card check, a payment provider) is
  refused, and the log says "The payment window blocked … to <origin>". Note any such origin:
  it would need adding to the module's payment origins before the experiment can ship on.
- **After paying.** The cart page is empty, so closing the payment window answers `gone` (the
  log says "hold gone", not "hold let go"), and nothing is removed. Note the
  confirmation page's address and how it shows the booking number, which a booked check
  (`bookedReference`) would need.

Nothing here is ever done by a test or an agent: every cart in the tests is synthetic, written
from RAC's scripts, and no live cart has been opened.

## RAC's terms

RAC's terms say nothing about automated access, and RAC's site allows every page to crawlers
with a 10-second delay; the site's terms limit its use to personal, non-commercial use. So WA
Stay:

- asks only RAC Parks & Resorts' own host, for the person's own trip, from their own computer;
- sends one request at a time, at most one every 10 seconds in the background, and nothing when
  the catalogue syncs;
- checks watches every 15 minutes at most, and a snipe's release every 10 seconds for at most 30
  minutes;
- never answers or works around a bot check: a block stops every request for a while;
- shows facts (park names, categories, availability, prices) and links to RAC's own pages;
- never cancels or changes a booking, and a release takes out only a stay the cart still holds;
- with the auto-cart experiment on only, puts at most one stay in the cart at a time, lets it go
  when the person declines or closes the payment window, and never checks out, agrees to RAC's
  terms or sends card details: payment is the person's step;
- keeps only the person's own member number, saved with their three statements, and never
  sends it;
- treats members' rates and the members' pre-sale as bookable only with a member number;
- respects RAC's stay rules: a stay RAC refuses (a minimum stay, an arrival day, a closed or
  unreleased date, too many pets) is never shown as free.

The people who use it book on RAC's own pages, under RAC's terms:

- a booking is personal: for the person and the guests named on it, never transferred or resold;
- members' rates need the member to stay, and the booking to be in the name on their card;
- a member may make at most two bookings for the same period: their own and one for their
  guests, with the same arrival date and length (the auto-cart holds one stay at a time, well
  inside that);
- at most two pets per site, booked in advance;
- payment, and agreeing to RAC's terms, are the person's own steps on RAC's pages.

## Data and images

The park facts are a seed in the code; nothing of RAC's copy is kept in it. A park's categories,
features, notices and photos are fetched live from RAC's book-now page when someone opens the
park, cached for 6 hours like any detail, and shown only in the app. Photos come from NewBook's
image host (RAC's booking engine), hot-linked and never stored or redistributed. Notices are
RAC's dated booking notes (minimum stays over a holiday), kept only until their last day.

Nothing of RAC's is in the repository or on the website: the test fixtures are trimmed to facts,
with placeholder photo addresses and descriptions, and the documentation and website screenshots
show ParkStay only. RAC's monogram is plain text on the app's own colour; there is no RAC logo.

## Tests

- `tests/unit/providers/rac/`: the manifest, the client (one host, redirects by hand, blocks and
  their pause), book-now pages, stay types, the member number's form, members' tariffs, the
  release calendar and the release policy (on a fake clock).
- `tests/integration/rac-provider.test.ts`: the provider contract suite and the catalogue;
  `rac-availability.test.ts` (every code and refusal), `rac-watch.test.ts`, `rac-snipes.test.ts`,
  `rac-member-rates.test.ts` and `rac-member-number.test.ts` (the number is in no request, log
  line, IPC answer, alert or email); `rac-explore-ipc.test.ts` and `rac-snipes-ipc.test.ts`
  through IPC.
- `tests/unit/providers/rac-fixtures.test.ts`: the fixtures hold facts only, and the module's
  code asks only RAC's host and names no cart address outside the auto-cart.
- The auto-cart: `tests/unit/providers/rac/holds.test.ts`, `cart-page.test.ts` and
  `cart-guard.test.ts`; `tests/unit/providers/rac/no-checkout.test.ts` (no module names
  checkout's or the card store's words, but the guard's deny list) and `no-live-cart.test.ts`
  (every cart fixture is synthetic, no real cart token is kept, the e2e fixtures are cart-free);
  `tests/integration/rac-auto-cart.test.ts` (held, let go, the night guard and one cart, through
  the core) and `tests/integration/credentials-leak.test.ts` (no cart address or member number
  leaks); and `rac-auto-cart.spec.ts` (the experiment turned on, taking effect after a restart,
  and "Pay now" reaching only the guarded cart page).
- `tests/unit/docs/rac-endpoints-doc.test.ts`: every row in [endpoints](endpoints.md) has a
  status, and every path the module requests is documented.
- The Electron smoke tests: RAC's parks on Explore and a park's categories
  (`rac-catalogue.spec.ts`), its free counts (`rac-explore.spec.ts`), a watch
  (`rac-watch.spec.ts`) and the member number (`rac-member-number.spec.ts`), from the recorded
  answers in `tests/e2e/fixtures/http/rac/` (every park's, for 6–8 Nov 2026).
- The preview: `npm run build:e2e`, then
  `npx cross-env PREVIEW_PROVIDER=rac PREVIEW_ARRIVAL=2026-11-06 playwright test preview-provider`
  (`xvfb-run -a` on Linux).

The recorded answers were trimmed from anonymous, read-only requests; the cart's fixtures
(`tests/fixtures/providers/rac/cart/`) are synthetic, written from RAC's scripts. No test or
agent run ever places a cart, hold, booking or payment with RAC, or sends a member number.
