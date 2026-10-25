# RI1: Rottnest catalogue, links and client

## Description

Scaffold the Rottnest provider and give it the parts every later task stands on:

- a catalogue of the island's precincts and room types, as a seed of facts;
- links to Stay Rottnest's search;
- the client every request goes through, with the rules of `rottnest-terms.md` §9 built in.

No capability that sends a request is on yet: RI2 turns on availability, bulk and watches, and RI3 gates them behind the notice.

## Size

M.

## Scope

1. **Scaffold:** `npm run provider:new -- rottnest --api --name "Stay Rottnest"`. The id `rottnest` never changes.
2. **Manifest:**
   - `shortName` "Stay Rottnest", website `https://www.stayrottnest.com`;
   - brand: a monogram "SR" in a colour from the app's tokens;
   - `locationKinds` `holiday-park`, `campground`, `hut`; Perth; AUD;
   - `catalog` full;
   - everything else off (RI2 turns on `availability`, `bulkAvailability` and `watches`);
   - limits: `minWatchIntervalMinutes` 30, `maxConcurrentRequests` 1, `minRequestIntervalMs` 60 000, `catalogTtlHours` 24.
3. **The seed** (`precincts.ts`):
   - **Each precinct:** its slug id, name, P3 group (36–44), lat/lng from RIA's maps, area "Rottnest Island", kind and a one-line summary in WA Stay's words.
   - **Each room type:** its code, RIA's name, kind (self-contained → `cabin`; `KYB01` and `KDM*` → `dorm`; `KYF03` → `room`; `CG06` → `campsite`), sleeps and bedrooms, from the stakeholder's capture.
   - No photos, descriptions, maps or logos.
4. **Links** (`links.ts`, the only file naming a Stay Rottnest host):
   - **`booking(externalId, stay?)`:** `https://bookings.stayrottnest.com/rates-room1` with `hotel`, `arrival`, `departure`, `rooms=1`, `adults[1]`, `children[1]` and the precinct's `roomCategories[]` (with no stay, the bare search page);
   - **`location()`:** the accommodation maps page;
   - **`manageBooking()`:** the login page.
   - Never `/details/`.
5. **The client** (`client.ts`), modelled on RAC's:
   - **Allowed:** `GET` only, `https://bookings.stayrottnest.com` only, the path `/rates-room1` only, and only the query fields `hotel`, `arrival`, `departure`, `rooms`, `adults[1]`, `children[1]` (anything else is a `ProviderError`, never sent).
   - **Redirects are not followed.** A redirect to a waiting room (`queue-it`) or a challenge is a block; any other redirect is an error.
   - **A block** is a 403, a 429, `cf-mitigated: challenge`, Cloudflare's challenge page, or a waiting-room page or redirect. It starts a cool-down, 12 hours doubling to 7 days, kept in `ctx.state`, during which every request rejects at once with a plain message.
   - **The Open Day morning pause:** no request from 05:30 to 12:00 Perth on an Open Day, by the Open Day rule (`open-days.ts`: the first Wednesday, or the next one when that is 1 January, plus a table of published dates).
   - **The shared search:** one in-flight and two-minute memo per stay and party.
6. **Guards:**
   - no file but `links.ts` and `client.ts` names a Stay Rottnest host;
   - no file names `/details/`;
   - the seed has no image URL and no long text;
   - the client refuses every other method, host, path and field.

## Completion criteria

- [ ] The provider registers and passes the contract suite.
- [ ] Client tests (fake clock): each block kind, the cool-down's doubling and cap and its persistence across a restart, the Open Day pause on 4 Nov 2026, the refused requests, and the memo (two callers, one request).
- [ ] Seed, links and guard tests pass.
- [ ] The full gate passes.
