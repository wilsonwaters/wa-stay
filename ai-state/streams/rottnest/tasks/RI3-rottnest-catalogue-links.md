# RI3: Rottnest catalogue and links

## Description

Scaffold the Rottnest provider as a links-only provider (RI1) and give it:

- a catalogue of the island's precincts, with their unit types as units, built by hand from RIA's public maps, guides and FAQ;
- links to Stay Rottnest's own pages.

Explore and the place page then show Rottnest beside ParkStay and RAC, with "Check on Stay Rottnest" where availability would be. Nothing is fetched (terms rules 1 and 6).

## Size

M. A provider folder, a seed, links, guards and an e2e journey. No core change.

## Depends on

- RI1.

## Scope

1. **Scaffold:** `npm run provider:new -- rottnest --links --name "Stay Rottnest"`. The id `rottnest` never changes (brief T5).
2. **Manifest** (`src/main/providers/rottnest/manifest.ts`):
   - `integration: 'links'`;
   - `website: 'https://www.stayrottnest.com'`;
   - `shortName: 'Stay Rottnest'`;
   - `brand`: the monogram "SR" and a colour from the app's tokens, distinct from ParkStay's green and RAC's slate (checked against `--ws-*` tokens and WCAG AA for white);
   - `locationKinds: ['cabin', 'campground', 'hut']`;
   - `timezone: 'Australia/Perth'`, `currency: 'AUD'`;
   - capabilities: `catalog` on (full); everything else off until RI4, RI6 and RI8 turn on `snipes` and `watches`;
   - `limits.catalogTtlHours: 24` (the seed costs nothing).
3. **Precinct seed** (`precincts.ts`), facts only. Each entry has:
   - `externalId` (stable slug, e.g. `geordie-bay`) and the name RIA uses;
   - lat/lng, taken by hand from RIA's accommodation maps against a base map (the comment says how);
   - `unitKinds`;
   - unit types as units (`type:<slug>`, e.g. `type:premium-view-2br`), each with:
     - its name;
     - its kind: villas, units, cottages, bungalows, the chalet and cabins → `cabin`; dormitory rooms and hostel bunks → `dorm`; hostel family rooms → `room`; campsites → `campsite`;
     - bedrooms, beds and maximum occupancy, from T&Cs 12 (campsite 6 people and 2 tents; 1 per bed for Governor Circle, the cabins, the dorms and the hostel; fixed beds + 50% for select self-contained units, where the guides list them);
     - accessibility where RIA states it (8 accessible units);
   - check-in and check-out times (self-contained 2 pm / 9 am; campground 10 am);
   - the precinct's peak-block group (RI4 uses it: Thomson Bay North; Thomson Bay South with Kingstown Heritage and Superior View; Bathurst with the Caroline Thomson Cabins; Longreach and Fay's; Geordie).

   **Precincts:** Thomson Bay North, Thomson Bay South, Bathurst, Caroline Thomson Cabins, Longreach Bay, Fay's Bay, Geordie Bay, Kingstown (Governor Circle, Commanders Cottages, dormitories, hostel), Campground.

   **Sources** (header comment): RIA's accommodation map PDFs, the booking guides' accommodation lists, the FAQ (RIA4644), read by a person in a browser on the date given. No descriptions beyond one plain sentence in WA Stay's own words. No photos: the place page shows the app's placeholder. No unit numbers (RIA assigns them about three weeks before arrival).
4. **Catalogue module:** `listLocations` and `getLocation` from the seed, with no request. Facilities are a short list from the seed.
5. **Links** (`links.ts`, the only file that names a Stay Rottnest host):
   - **`location(externalId)`:** the accommodation-maps page (`https://www.stayrottnest.com/accommodation-maps`). There is no per-precinct page.
   - **`booking(externalId, stay?, unitId?)`:** the search page, `https://bookings.stayrottnest.com/search-rates`, with the stay's dates, guests and location **only once TQ1 has confirmed the parameters**; until then, the bare page. It must be a public page that never adds to a cart (the `ProviderLinks` rule). Never `/login`, a basket, checkout or any other path robots.txt disallows.
   - **`manageBooking()`:** `https://bookings.stayrottnest.com/login` (RIA's "My Booking").
   - **Open Days page and booking guide** (helpers RI4 and RI10 use): `https://www.stayrottnest.com/open-days`, and the month's guide PDF by its published pattern (`open_day_booking_guide_<month>_<yyyy>.pdf`), which falls back to the Open Days page when a guide is not yet published (RI4 knows which are).
6. **Guards:**
   - `tests/unit/providers/rottnest/no-requests.test.ts`: no file in `src/main/providers/rottnest/` except `links.ts` contains `stayrottnest`, `rottnestisland` or `ria.wa.gov.au`; no file imports an HTTP module or uses `ctx.http` or `ctx.browser`.
   - `tests/unit/providers/rottnest/seed.test.ts`: every precinct has coordinates on the island (a bounding box), at least one unit, valid kinds and occupancies; no URL other than the links module's; no description over one sentence.
7. **Tests:** `tests/integration/rottnest-provider.test.ts` (contract suite, links-only zero calls), links tests (https, on the site, never a disallowed path), and a manifest test.
8. **e2e:** a journey (`tests/e2e/rottnest.spec.ts`), launched with `providers: ['parkstay', 'rottnest']`:
   - Explore lists the Rottnest precincts, and a card reads "Check on Stay Rottnest" with dates set;
   - the Geordie Bay place page shows its unit types and "WA Stay can't check availability here…";
   - **the run's request log has no request to any `stayrottnest.com` or `rottnestisland.com` host.**

## Non-goals

- Rules, the calendar and release status (RI4, RI5).
- Watches and snipes (RI6–RI10).
- The website row (RI11).

## Completion criteria

- [ ] The provider registers and passes the contract suite (links-only) with zero calls.
- [ ] Both guards pass; a deliberate `ctx.http.get` added in a test copy fails them (mutation check).
- [ ] The e2e journey passes, and its request log assertion holds.
- [ ] The preview (`PREVIEW_PROVIDER=rottnest`) lists the places. Its availability step is skipped for a provider without availability; adjust the spec to skip, not fail.
- [ ] The full gate passes.

## Edge cases

- Kingstown is one precinct with four very different unit types (cottages for up to 18, dorm rooms, hostel bunks, family rooms). Explore's stay-type facets must show it under Cabins, Dorms and Rooms; R9's noun for it is "spot".
- Works closures (Bathurst from 27 Apr 2027 through June 2027) are RI4's rules, not catalogue flags.
