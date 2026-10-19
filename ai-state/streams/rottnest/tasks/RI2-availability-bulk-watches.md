# RI2: Rottnest availability, Explore counts and watches

## Description

Read the results page (`rottnest-booking-flow.md` §11) and turn on what the stakeholder decided (T1, T5): the place page's check, Explore's free counts and 30-minute watches, all from one shared search per stay and party.

## Size

M.

## Depends on

- RI1.

## Scope

1. **The parser** (`results-page.ts`):
   - each `room-and-rates` card: its `room-calendar-root`, `data-group`, `data-location-type`, `data-sleeps`, `data-bedrooms`, whether it is `unavailable`, its name, its "from $X" price and its rate codes;
   - a page with no card, or a card it can't read, is a `ProviderParseError`, never "nothing free".
2. **`availability.check(externalId, stay)`:** the shared search, filtered to the precinct's group.
   - A type is free when its card is not `unavailable` and the party fits `data-sleeps`. Its nights are `available` and its `total` is the price.
   - An unfree type's nights are `unknown`, with "Unavailable for these dates" or "Sleeps N at most".
   - `freeCount` is 1 or 0.
   - `priceNote` is "25% deposit when booked" (`RIA25`) or "Paid in full when booked" (`CAMPING`, `HOSTS`).
   - `bookingUrl` is RI1's search link for the precinct; the location's `bookingUrl` is the same.
3. **Bulk `availability.search`:** the same search, one entry per precinct (free types, `byKind`), with no `bookableUnits` unless none can be booked.
4. **Watches** on, at 30 minutes at least; the watch flow hides partial matches for Rottnest (whole-stay answers).
5. **Fixtures:**
   - `tests/fixtures/providers/rottnest/`: the capture trimmed to the cards' attributes, names, prices and rate codes (no images, descriptions, scripts or analytics), labelled as the stakeholder's capture of 18 Oct 2026, with a guard test;
   - `tests/e2e/fixtures/http/rottnest/`: the routes the app answers from.
6. **e2e:** Explore lists Rottnest; with dates (and the notice accepted, RI3) Geordie Bay shows its free count; its place page checks and lists the types. The request log shows only `GET /rates-room1`.

## Completion criteria

- [ ] Parser tests on the fixture (33 free, 35 unavailable, groups, prices, rates); malformed pages are rejected.
- [ ] The contract suite with recorded responses passes.
- [ ] Bulk and check agree; one request serves both (memo).
- [ ] The e2e journey and the preview (`PREVIEW_PROVIDER=rottnest`) pass.
- [ ] The full gate passes.
