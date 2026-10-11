# PD2: Campground sections and notices, in an accordion

## Description
The place page's About is thin compared with ParkStay's own "MORE DETAILS". ParkStay renders the detail into its campground page and serves it from no JSON endpoint (`ai-state/research/parkstay-details.md` §3). The stakeholder asked for this detail as an accordion, so it doesn't take up too much room.

## Size
M–L

## Scope
1. **Generic model** (`src/shared/types/catalog.types.ts`), optional fields on `LocationDetail`:
   - `sections?: { title: string; html: string }[]`: sanitised HTML, in the provider's order. The intro has no heading, so give it a title such as "About".
   - `notices?: { level: 'warning' | 'caution' | 'info'; text: string }[]`: plain text.

   Other providers are unaffected.
2. **The ParkStay module** gets this detail in `getLocation`:
   - **The request:** one GET to `https://parkstay.dbca.wa.gov.au/search-availability/campground/?site_id=<id>`, with the ParkStay `Referer` (`headers.ts`), through `ctx.http` and the provider's limiter.
   - **Cost:** it shares the 6 h detail cache and adds no request when the detail is cached. It is queue-gated like `/api/`, so go through the access gate as the other ParkStay calls do.
   - **Parse** with the HTML tools the provider already uses (`htmlparser2` or `sanitize-html`; check first; no new dependency without asking):
     - **Sections:** from `#campground-details`, an `h1`, the intro paragraphs, then one section per `h5` with its content. Sanitise each with the shared sanitiser.
     - **Notices:** `.round-box`. The level comes from the icon: `bi-exclamation-diamond-fill` is warning, `bi-exclamation-triangle-fill` caution, `bi-info-circle-fill` info. The text is in the `span`.
   - **Must recognise, and then fall back:**
     - the queue's waiting-room page, a 200 `text/html` holding `window.location.replace('…waiting-room…')`;
     - a redirect away from the campground page (no `Referer` accepted): check the final URL and that `#campground-details` is present;
     - the "Oops!" page shown while a hold is in the session, or for a site closure;
     - a missing or changed layout.

     **The fallback:** use the cached sections if there are any. Otherwise give no sections, and the About shows `long_description` as PD1 left it. Never fail the place page because of this request, and log the reason without the URL's query or any cookie.
   - **With sections present,** don't also show `long_description`: it is legacy and out of date.
   - **Fixtures:** trimmed real HTML in `tests/fixtures/parkstay/`, sanitised of anything personal; DBCA office contact details are public. Recreate it with one anonymous GET if the research's snippets aren't enough. Tests cover the four fallback cases.
3. **The place page:**
   - **The About section** becomes an accordion of the sections, built on `components/ui/Disclosure`. The intro is open; the rest are closed, with the heading button showing the section title.
     - Keyboard and screen-reader behaviour follow the WAI-ARIA disclosure pattern.
     - It keeps the place page's existing order, with the stay card still on the first screen at 1440×900.
   - **Notices** show above the accordion as compact items, built on `components/ui/Notice` or a Chip-like row. Icon plus text, and the level must not be shown by colour alone.
4. **Terms of use:** add a line to `docs/providers/parkstay/README.md` saying this reads ParkStay's public campground page, once per campground per 6 h, anonymously. Update `endpoints.md`'s page row: the page is now used, with the parse notes.

## Non-goals
The map PDF (PD3); park alerts; photos from the page.

## Completion Criteria
- [ ] `LocationDetail.sections` and `notices` exist, typed and documented, and other providers compile unchanged.
- [ ] ParkStay parses sections and notices from the fixture page, handles the queue page, redirect, Oops page and changed layout with the stated fallback, and caches with the detail. All are tested.
- [ ] The place page shows the notices and the accordion.
  - [ ] Renderer tests assert roles, names and the open/closed state.
  - [ ] A provider without sections looks as before.
- [ ] Runtime screenshots in fixture mode:
  - [ ] the accordion collapsed and expanded;
  - [ ] the notices;
  - [ ] at 1440×900 and at 960×640.
- [ ] The gate passes on Node 24: lint, format, type-check, `npm test`, `test:tz`, and `build:e2e` + e2e. The e2e fixtures gain the campground page for the place journey.
- [ ] Docs updated (`endpoints.md`, the ParkStay README, and the provider guide if `LocationDetail` is documented there).

## Context Files to Read First
- `ai-state/research/parkstay-details.md`
- `src/main/providers/parkstay/{catalog,client,headers}.ts` and `queue/`
- The sanitiser
- `src/shared/types/catalog.types.ts`
- `src/renderer/features/place/` (`PlaceSections.tsx`)
- `src/renderer/components/ui/{Disclosure,Notice}.tsx`
- `docs/design/components.md`
