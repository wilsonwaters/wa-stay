# PD1: "View on ParkStay" link, per-site details, and the misleading About

## Description
The stakeholder found three things while testing on Windows (2026-10-11). Research is in `ai-state/research/parkstay-details.md`. This task fixes two of them and a bug the research found:
- "View on ParkStay" opens an error page on ParkStay.
- Sites show only their names, where ParkStay shows a paragraph per site plus the people and vehicle limits.
- **The bug:** the About section lists amenities a campground lacks as if it had them. At Bungarra it shows "Pets permitted" and "Campfires permitted".

## Size
M

## Scope
1. **Links** (`src/main/providers/parkstay/links.ts`). ParkStay's campground page refuses requests without its own `Referer`, and the system browser sends none.
   - `location` and `booking` now open `https://parkstay.dbca.wa.gov.au/search-availability/information/?campground_id=<id>`, adding `&arrival=YYYY/MM/DD&departure=YYYY/MM/DD` when there is a stay.
   - That page has no `Referer` check. It preselects the campground and dates, and its "See availability" opens the campground page. It ignores guests, so don't send them.
   - Check every caller of these links (place page, watches, snipes, bookings, notifications) and its copy. If a label says it books, but the page only preselects the stay, adjust the label. Keep "Book on ParkStay" if it still reads true.
   - Update `docs/providers/parkstay/endpoints.md`:
     - the two page rows, with "Verified live 2026-10-11" and the research's notes;
     - the `/api/campgrounds/{id}/` and `/api/campsites/{id}/` rows.
2. **Per-site details.** In the ParkStay module, map each site's (or class's):
   - `short_description` into the unit's description, as plain text, null when empty, never the `"x"` placeholder in `description`;
   - `min_people` and `max_people`;
   - `max_vehicles`.

   Both `catalog.ts` `toUnitSummary` and `site-classes.ts` `toClassUnitSummary` need this. Add `minPeople` to the generic unit summary type if it is not there. Add only optional fields, so other providers are unaffected.
   - **On the place page,** "Check availability" shows these under each unit's name: the description and compact people and vehicle limits ("1–6 people", "3 vehicles"). Use lucide icons with text labels; the icons alone must not carry the meaning.
   - **Where the data comes from:** join the night grid's units to `detail.units` by `unitId` in the renderer (class listings use `class:<id>` on both sides). Don't add a request.
   - **Plain text only:** render the description as text, never as HTML.
   - **Units without details** look as they do today.
   - **Layout:** keep the grid readable at the minimum window (960×640). The details may sit in the unit's row heading or in a row under it; follow the design tokens and components (`docs/design/`).
3. **The About bug.** Before sanitising, the ParkStay module converts each `<span class="disable">…</span>` item in `long_description` so it reads as unavailable to sighted and screen-reader users alike.
   - For example: "Campfires permitted (not available)", or move such items to a "Not available" list. Choose the plainest faithful form.
   - Drop the inline `<style>`, as the sanitiser does.
   - The fix lives in the ParkStay module, not the shared sanitiser.
   - **Test:** use the real fixture `tests/fixtures/parkstay/campsite_availablity_view_20.json`. Nothing marked `disable` may appear without its unavailable marker.

## Non-goals
- The campground page's sections and notices (PD2) and the map PDF (PD3).
- Watch, snipe and booking pages showing unit details.

## Completion Criteria
- [ ] The links:
  - [ ] `links.ts` produces the information-page URLs, with and without a stay.
  - [ ] Every caller still reads correctly.
  - [ ] Unit tests cover both forms, and that nothing sends `site_id` to `/search-availability/campground/`.
- [ ] Per-site details:
  - [ ] Description, people and vehicle limits are mapped for sites and for class listings, from fixtures (add a trimmed fixture with `short_description`, `min_people` and `max_people` if the current ones lack them).
  - [ ] The place page shows them, asserted by role and text.
  - [ ] A unit without details renders as before.
- [ ] The About bug:
  - [ ] Unavailable amenities read as unavailable, tested on the Bungarra fixture.
  - [ ] No `disable`-marked item reads as available.
- [ ] Docs: `endpoints.md` updated.
- [ ] The gate passes on Node 24:
  - [ ] lint, format, type-check, `npm test` and `test:tz`;
  - [ ] `build:e2e` + e2e: update e2e fixtures only if needed, and check the place-page journeys.
- [ ] Runtime screenshots of the place page, in fixture mode, at 1440×900 and at 960×640.

## Context Files to Read First
- `ai-state/research/parkstay-details.md`
- `src/main/providers/parkstay/{links,catalog,site-classes,availability,types}.ts`
- `src/shared/types/catalog.types.ts` and `provider.types.ts` (the unit summary and `UnitAvailability`)
- `src/renderer/features/place/`, plus `NightGrid` and `UnitPicker` under `src/renderer/components/`
- The sanitiser (`grep -rn sanitizeProviderHtml src/main`)
- `docs/providers/parkstay/endpoints.md`
