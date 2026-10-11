# ParkStay WA provider

ParkStay WA is DBCA's booking system for campgrounds in Western Australia's national parks,
and WA Stay's first provider. Everything DBCA-specific lives in
`src/main/providers/parkstay/`; the rest of the app reaches it only through the provider SDK
and the registry ([provider guide](../adding-a-provider.md)).

- [Endpoints](endpoints.md): what the module requests, verification status, the availability
  tuple, the DBCA queue, holds and payment.
- [Sign-in](authentication.md): the in-app sign-in window and the signed-in check.

## Manifest

`parkstayManifest` in `src/main/providers/parkstay/index.ts`:

| Field | Value |
| --- | --- |
| `id`, `name`, `shortName` | `parkstay`, ParkStay WA, ParkStay |
| `integration` | `api` (JSON endpoints through `ctx.http`; no browser automation) |
| `brand` | `#2F5D50` with the monogram `PS` (no DBCA logo) |
| `locationKinds` | campground, holiday-park, caravan-park, cabin, hut, glamping, farm-stay, other |
| `timezone`, `currency` | `Australia/Perth`, `AUD` |
| `limits` | watches every 15 min at most, 4 requests in flight, catalogue fresh for 24 h |
| `stayFields` | `gearType` "Camping with" (Any, Tent, Campervan, Caravan; watches and snipes), `numVehicles` "Vehicles" 0–5 (snipes and holds), `postcode` (four digits; snipes and holds) |
| `bulkAvailabilityStayFields` | `arrival`, `departure`, `equipment`, `params.gearType`: the bulk view ignores the party, so changing guests reuses its answer |
| `releaseModes` | `daily_rollover` "When new dates open" and `scheduled` "At a scheduled time" (both through the DBCA queue), `cancellation` "When someone cancels" |

| Capability | | Module |
| --- | --- | --- |
| `catalog` (`catalogMode: 'full'`) | yes | `catalog.ts`: all 169 campgrounds from `campground_map`; a detail from the availability view |
| `availability` | yes | `availability.ts`: one campground's sites night by night, with prices |
| `bulkAvailability` | yes | `availability.ts`: every campground's free-site count for a stay, for Explore's pins |
| `watches` | yes | uses `availability` |
| `snipes` | yes (Site Sniper is marked "coming soon") | `release-policy.ts` + `holds.ts` + the queue |
| `holds` | yes | `holds.ts`: 30-minute `create_booking` holds and the payment page |
| `accessGate` | yes | `queue/`: the DBCA virtual queue |
| `bookingImport` | no | bookings are added by hand; "Manage on ParkStay" links to `/mybookings/` |
| `account` | `optional` | `auth.ts` ([sign-in](authentication.md)) |

## Releases

`ParkStayReleasePolicy` (`release-policy.ts`) tells Site Sniper when a stay becomes bookable:

- **Daily rollover.** Each campground takes bookings `max_advance_booking` days ahead (180).
  A new arrival date opens every day at the campground's own release time, Perth time
  (`api.py:1358-1372`): Bungarra's is 2:00 am. The time is read from the availability view and
  kept in the provider state (`release.time.<id>`); until it is known, midnight is assumed.
- **Scheduled.** Dates released in blocks, such as the Ningaloo coast's, at a time the person
  sets. The suggested default is the next first Tuesday of a month at 10:00 am AWST; DBCA can
  change it, so it is never hard-coded.
- **Cancellation.** No release: poll continuously, at a polite floor.

## Data and images

Campground data and photos are fetched live from ParkStay's public endpoints and image URLs
at runtime, and never redistributed. The catalogue is cached in the local database
(`locations`) and synced at most once a day; a location's detail is cached for 6 hours.
Provider HTML (`long_description`) is sanitised in the main process before it reaches the
window, and links in it open in the system browser. The sanitiser drops ParkStay's inline
style, which strikes through what a campground lacks (`<span class="disable">`), so the module
first adds "(not available)" to each such item ("Campfires permitted (not available)"). Each
site's `short_description` is plain text and is only ever shown as text.

A campground's About comes from its campground page, the detail ParkStay shows under "MORE
DETAILS", which no JSON endpoint serves (`campground-page.ts`,
[endpoints](endpoints.md#api-endpoints-wa-stay-calls)): its notices ("No campfires at any
time"), each with its level, and its sections (an intro, then Booking, Campsites, Facilities,
Campground Rules, Fees, Your safety and health and Location), sanitised in main like the
description. With sections, `long_description` is not shown: it is out of date. When the page
cannot be read (the DBCA queue, a redirect away, the "Oops!" page while a hold is in progress,
a closure or a new layout), the sections stored last are kept, or else the About shows
`long_description` as above; the place page never fails because of it.

"View on ParkStay" and "Book on ParkStay" open ParkStay's search page with the campground
(and the dates) chosen, not its campground page, which refuses a browser that sends no
`Referer` ([endpoints](endpoints.md#pages-wa-stay-opens-or-links-to)).

## DBCA's terms

WA Stay follows DBCA's booking terms, and so must its users:

- one account per person, and bookings in the name of someone who will stay;
- one booking per night (WA Stay's night guard refuses a second hold for a night already held
  by a snipe or a watch);
- genuine intent: hold only what you will use;
- no booking for others, no transfer or resale;
- payment is always completed by the person, on ParkStay's own pages.

WA Stay reads ParkStay's public campground page (`/search-availability/campground/`) for a
campground's About. It needs no account and WA Stay never signs in for it, but it is sent
with the app's ParkStay session, as every ParkStay request is: the DBCA queue needs that
session, and a signed-in person's cookies go with it (which is why a hold in progress shows
ParkStay's "Oops!" page instead, and the stored copy is kept). It is read at most once per campground per 6 hours (the detail cache), and only when
someone opens that place. It is shown in the app beside a link to ParkStay, and never
redistributed.

## Tests

- `tests/unit/providers/parkstay/`: each module against the loopback fixture server
  (`tests/utils/parkstay-fixture-server.ts`), which serves the trimmed live samples in
  `tests/fixtures/parkstay/` and behaves as the DBCA backend does where tests depend on it
  (HTTP 500 without the Referer or with `YYYY-MM-DD` dates, the queue's redirect page, the
  campground page and its redirect away without the Referer).
- `tests/unit/providers/parkstay/campground-page.test.ts`: the campground page's sections and
  notices from the trimmed live page (`campground_page_20.html`), and each page that comes back
  instead: the queue's, a redirect away (`campground_page_redirected.html`), the "Oops!" page
  (`campground_page_oops.html`, built from DBCA's template, not recorded), a closure and a
  changed layout.
- `tests/integration/parkstay-provider-contract.test.ts`: the provider contract suite.
- `tests/unit/providers/parkstay-manifest.test.ts`: the manifest.
- `npm run test:electron`: the module on the production transport (`ElectronSessionHttpClient`),
  still against the loopback server.
- The Electron smoke tests (`tests/e2e`) use recorded responses in `tests/e2e/fixtures/http/parkstay/`.

No test or agent run ever places a real hold, booking or payment on ParkStay; live checks
are anonymous, read-only and a handful of requests.
