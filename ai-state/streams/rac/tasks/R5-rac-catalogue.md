# R5: RAC catalogue on Explore

## Description
As a person planning a WA trip, I can see the eight open RAC Parks & Resorts parks on Explore beside ParkStay's campgrounds, and open a park's page with its categories (powered site, two-bedroom cabin, dorm…).

This first RAC slice scaffolds the provider and its manifest and limits. It lists the parks from a seed of facts, with no request per sync (terms rule 2), and reads a park's categories from its book-now page. It also builds the RAC client every later RAC task uses: RAC's host only, the headers the site needs, and a 30-minute stop after a block.

## Size
M

## Depends on
R2 (pacing; R1's unit kinds come with it).

## Scope
1. **Scaffold:** `npm run provider:new -- rac --api --name "RAC Parks & Resorts"`, then resolve every `TODO`. It writes `src/main/providers/rac/`, `tests/integration/rac-provider.test.ts`, `tests/fixtures/providers/rac/`, `tests/e2e/fixtures/http/rac/` and the `BUILT_IN_PROVIDERS` entry.
2. **Manifest** (`rac/manifest.ts`):
   - Identity: id `rac`, name "RAC Parks & Resorts", shortName "RAC", website `https://parksandresorts.rac.com.au`, integration `api`.
   - Badge: monogram `RAC`, and an original dark colour from the scaffold's `BRAND_COLOURS`, not RAC's own blue or yellow.
   - `locationKinds: ['holiday-park']`, `Australia/Perth`, `AUD`.
   - Capabilities: `catalog` on with `catalogMode: 'full'`. Everything else off, and `account: 'none'`.
   - Limits: `minWatchIntervalMinutes: 15`, `maxConcurrentRequests: 1`, `catalogTtlHours: 24`, `minRequestIntervalMs: 10_000`.
3. **Seed** (`rac/parks.ts`, facts only), with each park's address and lat/lng:

   | slug | blog_id | book-now page | area (name · region) | unit kinds |
   | --- | --- | --- | --- | --- |
   | `busselton` | 6 | RAC widget | Busselton · South West | campsite, cabin |
   | `cable-beach` | 9 | RAC widget | Broome · Kimberley | campsite, cabin |
   | `cervantes` | 5 | RAC widget | Cervantes · Midwest | campsite, cabin |
   | `esperance` | 10 | RAC widget | Esperance · South Coast | campsite, cabin |
   | `margaret-river` | 8 | RAC widget | Margaret River · South West | campsite, cabin, dorm, glamping |
   | `exmouth` | 3 | NewBook native | Exmouth · Pilbara | see below |
   | `karri-valley` | 7 | NewBook native | Pemberton · Warren | see below |
   | `monkey-mia` | 2 | NewBook native | Shark Bay · Midwest | see below |

   - Also per park: its category-type id → `UnitKind` map, the school-holiday release hour (7, 8 or 9 am Perth), and its pre-sale role (Cable Beach out; Margaret River's dorms out). R14 uses these.
   - **The native parks' kinds** are found during development, by at most one anonymous availability POST per park, 10 s apart. They are kept as notes for R10's fixtures.
   - Sources: `ai-state/research/rac-samples/parks-catalogue-derived.json`, `catalog-book-now-pages-derived.json`, and `rac-booking-flow.md` §1 and §5. Ningaloo and Rose Gardens are left out (RO7).
   - **`listLocations`** maps the seed and sends nothing: key `rac:<slug>`, kind `holiday-park`, `bookingMode: 'online'` and `unitKinds`. No summary, photos or amenities. `infoUrl` is the park's home page and `bookingUrl` its book-now page.
4. **Detail** (`rac/catalog.ts`, `rac/book-now.ts`):
   - **RAC-widget parks:** one GET of `/<slug>/book-now/`. Each active `.accommodation-item` becomes the unit `cat:<data-cat-id>`:
     - `unitName` is the title, `unitType` the park's type label (`data-name` for its `data-cat-type-id`), and `unitKind` comes from the rule below;
     - `maxPeople` is `data-max-guests`, and `equipment` the names for `data-allowed-equipment`;
     - `amenities` are the feature words, plus "Pets allowed (up to N)" and "Wheelchair accessible" when they apply;
     - `description` is `.accommodation-item__description` as plain text.
   - **Photos:** the gallery's `data-src`/`src` URLs, https on `driveau.newbook.cloud` only, become the detail's `imageUrls`. They are fetched live and shown only in the app (rule 6).
   - **Notices and release info:** the page's dated notices become `info` notices. `releaseInfo`: "Bookings open 364 days ahead, at midnight Perth time. School-holiday dates open on set days."
   - **Native parks:** the seed's facts with `units: []`, and no request. R10 adds their units.
   - **Unit-kind rule** (`rac/unit-kinds.ts`), first match on the name: dorm or bunk → dorm; safari tent, glamping or bell tent → glamping; site or camp → campsite; cabin, chalet, villa, cottage, bungalow, lodge, studio or apartment → cabin; room, suite or motel → room. Then the park's type map, then `other` (logged once).
5. **Links** (`rac/links.ts`):
   - `location`: `/<slug>/`.
   - `booking`: `/<slug>/book-now/`. With a stay it adds `available_from` and `available_to` (YYYY-MM-DD), `adults`, `children`, `infants`, `pets=0` and `membership_type=non-member`.
   - Never `online_cart_url` or `/booking/?cart`. No `manageBooking`. An unknown id gives `null`.
6. **Client** (`rac/client.ts`). Every RAC request goes through it.
   - **Host.** Only `https://parksandresorts.rac.com.au`. Redirects are followed by hand, on that host only, at most 3. Anything else is a `ProviderHttpError` (`blocked`) and is never sent. NewBook's hosts are never requested, and the `api_key` is never used.
   - **Headers.** Page GETs send `Accept: text/html`. A helper for R10's POST sends `X-Requested-With: XMLHttpRequest`, `Origin`, and `Referer` (the park's book-now page). No User-Agent is ever set or changed (rule 5).
   - **Block:** a 403 or a 429; a `cf-mitigated: challenge` header; or a 403, 503 or 200 HTML page with "Just a moment" or `cf_chl_opt`. The JSD script normal pages load (`/cdn-cgi/challenge-platform/scripts/jsd/main.js`) is not one.
   - **After a block:**
     - A block is a non-retryable `ProviderHttpError` with a plain message: "RAC Parks & Resorts turned the request away (HTTP 429). WA Stay won't ask again until 3:45 pm."
     - Its status is 403 or 429, which R12's `isProviderBlock` reads: a 429 stays 429, and a 403 or any challenge becomes 403.
     - For 30 minutes every RAC request rejects at once with the same kind of error and sends nothing.
     - `blockedUntil` is kept in `ctx.state`, so a restart honours it.
     - One warning is logged per block, with the status only, never a query or body.
7. **Fixtures and guards:**
   - `tests/fixtures/providers/rac/` (routes in its `manifest.json`):
     - trimmed book-now pages for Busselton (cabins and sites) and Margaret River (dorms and a safari tent);
     - a 403, a 429 and a challenge page, synthetic and labelled so.
   - `tests/e2e/fixtures/http/rac/`: the same two pages.
   - **Trimming:** descriptions become "Placeholder description."; image URLs become `https://driveau.newbook.cloud/crop_800_450/instances_00000000000000000000000000000000_<n>.jpg`; scripts, menus, footers and marketing blocks are cut; a header comment names the page and date.
   - **Fixture guard** (`tests/unit/providers/rac-fixtures.test.ts`, rule 7), over every file in both folders: no image URL but the placeholder pattern; only placeholder descriptions; only `<redacted>` values for `api_key`, `rest_api_data_id` and `online_cart_url`; no email address, phone number or `<script`.
   - **Source guard** (rule 1): every URL literal in `src/main/providers/rac/` is on RAC's host, or is the image-host check. There is no `online_cart_url` or `/booking/?cart` literal.
8. **E2E:** `tests/e2e/rac-catalogue.spec.ts`, with `providers: ['parkstay', 'rac']`:
   - the Provider chip → "RAC Parks & Resorts" gives 8 places, each with the RAC badge;
   - RAC Margaret River Nature Park's page lists its dorm and safari-tent categories;
   - fixture mode refused no request.
9. **Docs:** CLAUDE.md gets an "RAC provider" row in Key Services (catalogue for now) and the new journey count, as does `tests/README.md`. In `docs/providers/README.md` the RAC row reads "In progress: Explore".

## Non-goals
- Availability, tariffs, codes, prices, the native parks' units, and turning watches on (R10). Bulk free counts and a passing `PREVIEW_PROVIDER=rac` (R11).
- Release policy and snipes (R14). The member number (R16). Auto-cart (R19).
- `docs/providers/rac/`, and the website's row and colour (R20).
- Contact-us and wp-json requests: the facts are in the seed.
- Dedupe with ParkStay's own "RAC Margaret River Nature Park" (RS6): both show, and ParkStay's is info only.
- A `bookings` module (rule 10).

## Completion Criteria
- [ ] `grep -rn "TODO" src/main/providers/rac tests/integration/rac-provider.test.ts` finds nothing.
- [ ] `npx jest tests/integration/rac-provider.test.ts` passes. It covers:
  - the contract suite;
  - `listLocations`: 8 parks, keys, coordinates, areas and kinds as seeded, and no request sent;
  - each widget park's seeded kinds equal the kinds of its fixture page's categories.
- [ ] Detail tests:
  - Busselton gives `cat:<id>` units with kind, guests, equipment, the pets amenity and the placeholder photos;
  - Margaret River gives `dorm` and `glamping` units;
  - a native park gives `units: []` and sends nothing.
- [ ] The unit-kind rule, `it.each` over at least 10 names, including "Dorm Room - Sleeps 26" → dorm, "Studio Room" → cabin, "Budget Room Shared Bathroom" → room, "Modern Safari Tent" → glamping, "4 Bedroom Eco Lodge" → cabin and "Powered Big Rig Site" → campsite.
- [ ] Terms tests (`ai-state/research/rac-terms.md`):
  - **Rule 1:** a request to another host, directly or by redirect, is refused and never sent. The source guard passes.
  - **Rules 2 and 4:** the manifest declares 10 000 ms and 1. A context from `createProviderContext` is paced: on a fake clock, two RAC requests are at least 10 s apart.
  - **Rule 3:** `minWatchIntervalMinutes` is 15.
  - **Rule 5:** a 403, a 429, and a challenge (as a 503 and as a 200 page) each give the typed error, with status 403 or 429. A second call within 30 min sends nothing and rejects the same way; after 30 min (fake clock) it sends again. A new client on the same state is still blocked. The logs carry no query.
  - **Rule 6:** the seed has no photo or description, and the links are RAC pages.
  - **Rule 7:** the fixture guard passes.
  - **Rule 10:** there is no `bookings` module, and `bookingImport` is false.
- [ ] Links: `links.booking('busselton', stay)` equals the expected URL and has no `cart`. An unknown id gives `null`.
- [ ] `tests/unit/app/container.test.ts` (now registering both), the ParkStay suites and `tests/scripts/new-provider.test.ts` pass unedited.
- [ ] The new e2e journey passes, and so do the other 22.
- [ ] Accessibility:
  - the RAC badge is `role="img"`, named "RAC Parks & Resorts";
  - white on its colour is at least 4.5:1 (`contrastRatio`, as `tests/unit/providers/parkstay-manifest.test.ts:95` does);
  - the journey uses role and name selectors only.
- [ ] CLAUDE.md, `tests/README.md` and `docs/providers/README.md` are updated.
- [ ] The full gate passes: `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`, then `npm run build:e2e && xvfb-run -a npm run test:e2e`.

## Edge Cases
- No `.accommodation-item` on the page (a redesign): a `ProviderParseError`, and the core serves the summary marked stale.
- `data-active="false"` is left out. Of duplicate category ids, the first is kept. A non-numeric `data-max-guests` gives no `maxPeople`.
- An image on another host or on http is dropped.
- A 5xx or 520: a retryable error, with no cool-down. The core never retries in a loop.
- The clock is set back during a cool-down: a `blockedUntil` more than 30 min ahead counts as now + 30 min.
- The time in the block message is Perth time, after midnight too.
- Ningaloo, or any unknown id, rejects, as the contract suite expects.

## Test Strategy
- **Unit:** the unit-kind rule (≈12), the book-now parser (≈8), the client's host, headers and block (≈10), links (≈5), guards (≈6).
- **Component:** none; the existing place page renders units.
- **Integration:** the contract suite, catalogue and detail (≈8); container registration (1).
- **E2E:** 1 journey.

## Context Files to Read First
- `ai-state/research/rac-booking-flow.md` (§1, §2, §10, §11), `rac-terms.md` (rules 1–7 and 10), `rac-samples/`
- `ai-state/streams/rac/master-plan.md` (decision 7, "Also decided", the terms table)
- CLAUDE.md "Adding a provider"; `.claude/commands/add-provider.md`; `docs/providers/adding-a-provider.md`
- `scripts/new-provider.mjs`, `scripts/templates/provider/`
- `src/main/providers/parkstay/` (`index.ts`, `catalog.ts`, `links.ts`, `client.ts`), for patterns
- `src/main/providers/sdk/` (`http.ts`, `errors.ts`, `html.ts`, `kv-store.ts`, and `pacing.ts` from R2); `src/shared/utils/unit-kinds.ts` (R1)
- `tests/utils/provider-contract.ts`, `fake-provider.ts`; `tests/unit/providers/no-loopback-addresses.test.ts`
- `src/main/testing/fixture-http-client.ts`, `tests/e2e/fixtures/http/README.md`, `tests/e2e/support/wa-stay.ts`

## Notes
- **No live holds** (§12.33). A live look is anonymous and read-only: a handful of requests, at least 10 s apart, never signed in, never adding to a cart.
- Raw captures from the research run may still be in that session's scratchpad. They are not in the repo and must not be committed.
- The client is shared: R10 sends its POST through it, so the block rule covers every later RAC request.

## Assumptions
- **Badge.** shortName "RAC" (it gives "Book on RAC", as in the master plan) and monogram `RAC` make a plain badge, not RAC's logo (rule 7). *Needs a stakeholder check.*
- **Regions.** `area.region` uses the DBCA region names Explore already has, so the Region chip works across providers; RAC's own labels ("Coral Coast") are not used. Cervantes → Midwest is the least certain. *Needs a stakeholder check.*
- **"Studio Room" → cabin,** following rac-sdk-gaps B.
- **Native parks** show no categories until R10 (the master plan's R10 row).
