# E2 — Location detail view

**Stream:** explore · **Depends on:** E1

## Description

Each location needs a page people can deep-link to (brief success criterion 4). It shows:
- photos, the name in the display face and the provider badge;
- area and region, a sanitised description, facilities, a units summary and release info;
- links out to the provider (opened in the system browser);
- a per-night availability check for the chosen stay;
- hand-offs that prefill a Watch or a Site Snipe.

Going back returns to Explore exactly as the user left it: query, filters, map camera, selection and list scroll.

**Decision: a full route `/places/:providerId/:externalId`, not a sheet over Explore.**
- It can be deep-linked from notifications, watches and bookings (U5, U1, U3), and back/forward works natively.
- Focus management is simpler (D3 `useRouteFocus`), and it works the same in list-only mode.
- It has room for a gallery and the night grid.
- Explore's state survives because it already lives in the URL (E1).
- The cost is one map re-creation on return, with the camera restored from `map=`. A sheet would keep the map alive but complicate deep links, focus trapping and back-button behaviour.

As a traveller, I can open a place to see what it is like, check whether my dates are free, and either book on the provider's site or set a watch, so I can decide quickly.

## Size

M

## Scope

**In scope:**
- **Page and data:**
  - `features/place/PlaceDetailPage.tsx` is registered at `ROUTES.placeDetail` (replacing D3's NotFound reservation). The key is `${providerId}:${decodeURIComponent(externalId)}`.
  - `api/catalog.ts` gains:
    - `useLocationDetail(key)` → `catalog.get(key)`, `staleTime` 10 minutes.
    - `useLocationCheck(key, stay)` → `catalog.checkLocation(key, stay)`, enabled only after the user presses Check, keyed by stay.
- **Layout.** Content is centred at a maximum width of 1120 px.
  - "Back to Explore" link (`ChevronLeft`).
  - Title block:
    - an `h1` with the name in Fraunces display-md
    - a meta row: full `ProviderBadge`, kind label, "Area · Region", and a "Book online" or "Info only" tag
  - Gallery (`features/place/Gallery.tsx`):
    - At 1024 px and wider: one large image plus up to 4 tiles (3:2), with a "Show all {n} photos" button.
    - A single image: one 16:9 hero.
    - No image: the D1 `PhotoPlaceholder` at hero size.
    - The full gallery is a D2 `Dialog` (size `full`) with ←/→ navigation, a "3 of 12" counter, an alt text of "{name}, photo {i} of {n}" on each image, and Esc to close.
  - Two columns at 1024 px and wider; one column below.
- **Main column:**
  - **About:** `descriptionHtml` rendered through `components/RichText.tsx`, scoped styles for p, ul, ol, a, strong and em, with links opening externally. If it is absent, show `summary`, or "{shortName} hasn't published a description." plus the info link.
  - **Facilities:** the amenity list using the E1 `amenityIcons` (icon plus text).
  - **Sites summary:**
    - "{unitCount} sites"
    - a breakdown by `unit.type` ("Tent site × 12")
    - the range of maximum guests
    - a D2 `Disclosure` "Show all {n} sites" listing the unit names
  - **Booking rules:** `releaseInfo` in a sun-tone `Notice` with a `Clock` icon.
- **Sticky side card ("Check your dates"):**
  - `DateRangeField` and `GuestsField` (field appearance), prefilled from Explore's `arrival`/`departure`/`adults`/`children`/`infants` params. Changes write back to this page's own search params, so they are shareable and survive reload.
  - A **Check availability** button (accent) appears only when `capabilities.availability` is true.
  - Results use `components/NightGrid.tsx`, which is shared and will be reused by U1 WatchDetail:
    - A summary line: "8 of 24 sites free for all 2 nights".
    - A "Fully available only" `Switch`, on by default.
    - A `<table>` with a `<caption>`, unit rows (`th scope="row"`) and night columns ("Fri 3").
    - Each cell shows an icon and text, plus visually hidden "Available, $30" / "Booked" / "Closed" / "Not released yet" / "Unknown".
    - The first 10 rows show, with "Show all {n} sites" for the rest.
    - The grid scrolls horizontally with a sticky first column when there are more than 7 nights.
- **Actions:**
  - **Book on {shortName}** (accent, `ExternalLink` icon) appears only when `bookingMode === 'online'`. After a successful check, the link is `availability.bookingUrl` (EQ1). Otherwise it is `detail.bookingUrl`.
  - **View on {shortName}** → `bookingUrl` for the provider's page for this place. **More information** shows the hostname (for example exploreparks.dbca.wa.gov.au) and links to `infoUrl`. If neither exists, **Visit {shortName}** links to `manifest.website`.
  - All external links use a shared `components/ExternalLink.tsx`: `<a target="_blank" rel="noreferrer">`, opened by P4's `setWindowOpenHandler` → `shell.openExternal`. It shows a trailing icon and visually hidden "(opens in your browser)".
  - **Watch for availability** (secondary, `BellRing`) appears when `capabilities.watches` is true. It navigates to `ROUTES.watchNew` with the architecture-notes §12.10 prefill contract: `?provider=<id>&location=<externalId>&arrival=YYYY-MM-DD&departure=YYYY-MM-DD&adults=N&children=N`. Infants are not part of the contract.
  - **Snipe a site** (secondary plus "Soon" badge) appears when `capabilities.snipes` is true. It navigates to `ROUTES.snipeNew` with the same parameters.
- **Legacy bridge**, minimal and deleted by U1 and U2: the legacy `CreateWatch` and `CreateSiteSnipe` read those parameters into `initialData` (`campgroundId` = `location`, `campgroundName` looked up through `useLocationDetail`, dates, and guests = adults + children). Parameters for a provider other than `parkstay` are ignored.
- **Back to Explore:**
  - Explore links (`LocationCard` and the map preview's "View details") append the current stay params (`arrival`, `departure`, `adults`, `children`, `infants`) to the detail URL, so the side card prefills. They also pass `state: { from: 'explore', search }`.
  - On the detail page, Back calls `navigate(-1)` when `state.from === 'explore'`. Otherwise it navigates to `{ pathname: '/', search: state?.search ?? stayParams }`.
  - Explore saves the list's `scrollTop` in `sessionStorage['ws:explore:scroll:'+search]` and restores it on mount.

**Out of scope:** pins and cards showing availability (E3), creating holds or bookings in-app, rebuilding the watch and snipe forms (U1, U2).

## Non-goals

- No HTML sanitising in the renderer: main sanitises with `sanitize-html` (V5/V3, architecture-notes §3). Add `target=_blank rel=noreferrer` to description links in main's transform; E2 records this as a V5 request if it is missing.
- No reviews, maps on the detail page, weather, prices outside the grid, or a share button.
- No new IPC except EQ1's additive `bookingUrl`, which V5 owns.
- No provider stay fields (§12.1 `stayFields`) on the side card. ParkStay declares none for availability. Add U1's shared `components/stay/ProviderStayFields.tsx` later and pass its values as `StayQuery.params`.

## Completion Criteria

- [ ] Opening `#/places/parkstay/<id>` cold (deep link) renders the name `h1`, ProviderBadge "ParkStay", the region, the photos and the facilities for that campground.
- [ ] A location with 12 images shows the hero grid and "Show all 12 photos". The gallery dialog navigates with arrow keys, shows "3 of 12", closes on Esc and returns focus to the button.
- [ ] A location with no images shows the placeholder named "No photo available for {name}".
- [ ] Description HTML renders formatted. A link inside it opens in the system browser, not an Electron window (runtime check). With no description, the fallback sentence and the info link appear.
- [ ] The sites summary shows the unit count and the type breakdown. The disclosure lists every unit name.
- [ ] Prefill: arriving from Explore with `arrival=2026-11-06&departure=2026-11-08&adults=2` pre-fills the side card.
- [ ] Pressing "Check availability" calls `catalog.checkLocation('parkstay:<id>', stay)` once and renders NightGrid with the summary line.
- [ ] Toggling "Fully available only" off shows partially available units.
- [ ] "Book on ParkStay" appears only for `bookingMode 'online'` and opens externally. "View on ParkStay" and "More information" show the correct URLs, and the info link shows its hostname.
- [ ] "Watch for availability" navigates to `/watches/new?provider=parkstay&location=<id>&arrival=2026-11-06&departure=2026-11-08&adults=2`, and the legacy watch form opens with the campground, dates and guests filled.
- [ ] "Snipe a site" carries the same parameters and shows the "Soon" badge.
- [ ] Back to Explore restores `q`, the filters, the `map=` camera, `sel` (card highlighted) and the list scroll position.
- [ ] Unknown provider, or `catalog.get` rejecting with NOT_FOUND: the page shows `EmptyState` "This place isn't available" with "Back to Explore", and no crash.
- [ ] A provider without `capabilities.availability` shows "{shortName} doesn't share availability with WA Stay. Check dates on their website." instead of the Check button.
- [ ] **Accessibility:**
  - [ ] On navigation, focus lands on the place `h1`. After a check completes, focus moves to the NightGrid summary line, and a polite announcement reads it ("8 of 24 sites free for all 2 nights").
  - [ ] NightGrid is a real table: it has a caption, its row and column headers have scope, and each cell's state is in text, not only colour or icon.
  - [ ] External links announce "(opens in your browser)". Gallery images have meaningful alt text, and the dialog is named "Photos of {name}".
  - [ ] The "Soon" badge on "Snipe a site" is part of the accessible name ("Snipe a site, coming soon"). axe on the page (with and without results) reports 0 critical/serious issues.
- [ ] The 4-check gate passes: `npm run lint` (0 errors), `npm run format:check`, `npm run type-check`, `npm test`.

## Edge Cases

- `externalId` containing `/`, `:` or spaces: it round-trips through `buildPath` encoding and the key is correct.
- The check rejects with:
  - an access-gate or queue error, and only when `capabilities.accessGate` is true: "{shortName} has a waiting queue right now. Try again in a few minutes."
  - a rate limit: "Too many checks in a short time. Try again in a minute."
  - anything else: "Couldn't check availability" with Retry.
  The page stays usable in every case.
- The check takes more than 10 s: an inline "Still checking {shortName}…" message appears with a Spinner (EQ7).
- `release.open === false`: "Bookings for these dates open {opensAt as 'Wed 1 Apr 2027, 12:00 am AWST'}". Not-released nights are labelled as such, not as booked.
- The stay changes after a check: the old result is marked "Results for 6–8 Nov". Check is enabled again, and the old grid is never shown against new dates silently.
- Zero units, or a units array missing from the detail: hide the sites section and Check, and show the info link.
- More than 30 nights is prevented by DateRangeField `maxNights`. A departure on or before arrival in the URL is dropped.
- Images that fail to load inside the gallery show the placeholder tile, and the gallery count excludes them.
- `catalog:updated` fires while the page is open: the detail refetches in place, keeping the scroll position and gallery state.

## Test Strategy

- **Unit:** about 8 tests. Cover the key ↔ route parameter encoding, the external link resolver (`bookingUrl`, `infoUrl`, website fallbacks and hostname), the NightGrid summary maths (fully or partially available, not-released), unit type breakdown grouping, the hand-off query builder and the legacy bridge parser.
- **Component:** about 14 tests:
  - deep-link render
  - gallery (single, 12 photos, none) and dialog keyboard
  - description fallback
  - Check flow, loading, success with focus and announcement, and each error copy
  - capability gating (no availability, no watches)
  - Book link visibility by `bookingMode`
  - Back behaviour with and without `state`
  - NotFound
  - NightGrid table semantics
- **Integration:** extend `tests/integration/renderer/explore.test.tsx` to cover Explore with filters → card → detail → Check → "Watch for availability" → legacy form prefilled → back → Explore state restored.

## Context Files to Read First

- `ai-state/streams/explore/master-plan.md` (EQ1, EQ4, EQ7) and the E1 spec plus its implementation in `src/renderer/features/explore/`.
- `ai-state/architecture-notes.md`: §3 (`LocationDetail`, `UnitAvailability`, `NightStatus`, `links`), §4 `catalog.get`/`checkLocation`, §7 external links, §8.
- `ai-state/research/parkstay-api-review.md` (images, `info_url`, booking deep link, `long_description`, availability tuple).
- `src/renderer/components/AvailabilityGrid.tsx` (legacy; do not extend it), `src/renderer/features/watches/legacy/CreateWatch.tsx`, `src/renderer/features/snipes/legacy/CreateSiteSnipe.tsx`, `src/renderer/components/forms/{WatchForm,SiteSniperForm}.tsx`.
- `src/renderer/app/routes.ts`, `src/renderer/api/catalog.ts`, `docs/design/components.md`.

## Notes

- NightGrid cell glyphs: available → `Check` (eucalypt-600 on eucalypt-50), booked → `X` (fg-muted on surface-subtle), closed → `Minus`, not-released → `Clock` (sun-700 on sun-50), unknown → `CircleQuestionMark`. If any of these pairs is missing from D1's `CONTRAST_PAIRS`, add it so the contrast test covers it.
- Dates display in en-AU ("Fri 3"). Times display in the provider timezone from the manifest (`Australia/Perth` → AWST).
- Hand-off parameters are the U1/U2 contract recorded in the master plan. Changing them requires updating U1 and U2.
