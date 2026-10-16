# R10: RAC availability, prices and watches

## Description
The stakeholder's top priority is to watch an RAC park for a site or cabin that frees up, get an alert, and reach RAC's prefilled booking page in one click (brief R1, success criterion 2).

R5 put the eight parks on Explore, with categories as units. This task reads RAC's availability (one POST per park and stay) and maps its codes honestly, so a stay RAC would refuse is never free (terms rule 16). It gives each category a booking link that is never a cart URL, lists the native parks' categories, and turns `watches` on, with an e2e journey.

## Size
M

## Depends on
R5, R7, R8 (and R6, for the e2e journey's stay-type step)

## Scope
1. **`availability.check(externalId, stay, options)`**, in a new `src/main/providers/rac/availability.ts`:
   - **Request:** one POST to `availability-ajax.php` (`rac-booking-flow.md` §3) through R5's client and its POST helper (host allow-list, `X-Requested-With`, `Origin`, `Referer`, block cool-down).
     - R2's pacing and ambient priority apply; the module sets no priority itself.
     - An unknown park rejects with a `ProviderError` and sends nothing.
   - **Form:** `blog_id` from R5's seed; `available_from` and `available_to` as `D MMM YYYY`, built from the calendar strings without `Date` objects; `adults`, `children`, `infants`; `animals` from a new `pets` stay field (0–2, default 0); `equipment_type_ids=all`, `equipment_measurement_unit=m`, and empty `equipment_length` and `equipment_width`.
   - **Parsing:** a raw zod shape in `rac/mapping.ts`, with only the fields used. Unknown keys are stripped, so `online_cart_url` is never read (R5's source guard forbids the literal).
     - `success` other than `"true"`, an unexpected shape, or the text `No direct file access` → a `ProviderError` (parse), never an empty answer.
   - **Units:** one per category.
     - `unitId` `cat:<category_id>` and `unitName` `category_name`.
     - `unitType` and `unitKind` from R5's rule (`rac/unit-kinds.ts`), also for categories the book-now page leaves out (Busselton 30).
     - `options.unitIds` is honoured: only those categories are returned.
   - **Tariffs:**
     - Only public tariffs count: labels not matching `/\bRAC Member\b/i`. R16 adds member tariffs.
     - A tariff counts when `tariff_success === "true"`.
     - Prices come from the cheapest counting tariff: `tariffs_quoted[date].amount` per night, and `total` from `tariff_total`.
     - A refused tariff never gives a price (its total can be a placeholder `999`).
     - `priceNote` is the tariff's label when it is not "Standard Rate".
   - **Nights**, from `sites_code[date]` and `sites_available[date]`:

     | RAC | `NightStatus` |
     | --- | --- |
     | 0, with free sites | `available`, with its price |
     | 3 or 5, or 0 with no free sites | `booked` |
     | 2, 4, 6, 7 or 8 | `closed`, `label` from RAC's message |
     | 9 | `not-released` (R14 adds `opensAt`) |
     | 1, or no entry | `unknown` |

   - **The stay:** `fullyAvailable` only when every night is available, `stay_through_sites_available` is above 0 with code 0, and a tariff counts. When some nights are booked, closed or not released, the free nights stay `available`, so partial matches still work. Otherwise the free nights become:
     - `unknown` with `split`, when every night has free sites but `stay_through_sites_available` is 0 with code 3;
     - `unknown` with `min-stay` (R8), when every public tariff is refused with code 6, 7, 9 or 10 (the Standard Rate's code decides, else the first's):
       - `minNights` per night from `minimum_periods`, and the arrival night's on the unit;
       - `noArrival` and `noDeparture` from `close_arrival` and `close_departure` equal to `"1"`;
     - `closed`, labelled with RAC's message: tariff codes 2, 3, 4, 8 or 11, and stay-through code 4;
     - `not-released`: tariff code 5.
   - **Messages** become plain text: tags stripped, for example with `sanitizeProviderHtml` allowing none, or `textOf` as in `parkstay/campground-page.ts:150`. Parts joined by `; ` are kept.
   - **Booking links** (R7):
     - a unit's `bookingUrl` is `online_booking_url` when it is https on `parksandresorts.rac.com.au`, under `/<the park's slug>/booking/`, with no `cart` key and no `rest_api_data_id`;
     - otherwise it is `links.booking(externalId, stay, unitId)`;
     - `LocationAvailability.bookingUrl` is `links.booking(externalId, stay)`.
   - **`links.booking`** (`rac/links.ts`, R5):
     - with R7's `unitId`, it builds `/<slug>/booking/?available_from=…&available_to=…&force_category_id=<id>&adults=…&children=…&infants=…&animals=…`, the shape of `online_booking_url`;
     - without it, R5's book-now page;
     - both take `pets` from the stay instead of R5's fixed `pets=0`.
2. **Native parks' units** (Exmouth, Karri Valley, Monkey Mia; R5 left `units: []`):
   - `getLocation` lists their categories from one availability POST for a near stay: 1 night, arriving 14 days after today in Perth, 2 adults.
   - The core caches the detail for 6 h. No prices or availability are shown from this POST.
3. **Manifest** (`rac/manifest.ts`):
   - `availability: true` and `watches: true`;
   - the `pets` stay field: `number`, min 0, max 2 (terms rule 16), `appliesTo: ['availability', 'watch', 'snipe']`;
   - `minWatchIntervalMinutes` stays 15 (R5). `bulkAvailability` stays off (R11).
4. **Fixtures:**
   - `tests/fixtures/providers/rac/`: trimmed copies of the six availability samples in `ai-state/research/rac-samples/`, plus R5's native-park responses, routed by R2's `form` matcher on `blog_id` and `available_from`.
   - `tests/e2e/fixtures/http/rac/`: Busselton's 2-night answer.
   - Keep codes, counts, amounts, labels, `minimum_periods`, the close flags and `online_booking_url`.
   - Drop `tariff_inclusions`, `membership_description`, `membership_icon` (an image URL), deposits and fees.
   - `api_key`, `rest_api_data_id` and `online_cart_url` values are `<redacted>`, as R5's fixture guard requires.
5. **E2E** (`tests/e2e/rac-watch.spec.ts`), launched with `providers: ['parkstay', 'rac']`:
   - **Dated fixtures:** add `tests/e2e/support/dated-fixtures.ts`, which R11 reuses. It writes a temp copy of `tests/e2e/fixtures/http/` with RAC's night keys and the dates in `online_booking_url` moved to the journey's stay (7 and 8 nights after today, Perth). The launch passes `env: { WA_STAY_E2E_FIXTURES_DIR: <copy> }` (`support/wa-stay.ts`, `launchEnv`).
   - **Journey:**
     1. Open `#/watches/new?provider=rac&location=busselton&arrival=…&departure=…&adults=2`.
     2. Continue through the steps, pressing "Camping" in the "Stay type" group (R6).
     3. Create the watch, then press "Check now".
     4. Expect the night grid, and the link "Book on RAC (opens in your browser)". Its `href` has `force_category_id=` and no `cart`. The link is never clicked.
     5. Fixture mode refused no request, and the window logged no errors.
6. **Docs:**
   - CLAUDE.md: the RAC provider row (R5) names availability and watches; the journey count ("Electron smoke E2E").
   - `tests/README.md`: the journey count.
   - `docs/providers/README.md`'s RAC row: "In progress: Explore, watches".

## Non-goals
- Bulk free counts on Explore and the preview spec (R11).
- The release policy and `opensAt` for code 9 (R14). Snipes (R12–R14).
- The member number, member rates and their note, and members-only pre-sale (R16). Holds and carts (R19).
- The generic stay-rule matching (R8) and alert links (R7).
- `docs/providers/rac/`, and the website row and copy (R20).

## Completion Criteria
- [ ] `tests/integration/rac-availability.test.ts`, one case per sample:
  - Busselton, 6–8 Nov 2026:
    - the powered site is fully available at 75 and 75, total 150, with `force_category_id=4`; the refused "Stay & Save" tariff is ignored;
    - the ensuite site's nights are `split`, and it is not `fullyAvailable`;
  - school holidays, 25 Sep 2027: `min-stay`, `minNights` 3, `noArrival` on the 25th, not `fullyAvailable`;
  - Exmouth: the closed category (site code 2) and stop-sold tariffs (code 11) give `closed` with RAC's words;
  - Leavers, 20 Nov 2027: `not-released`, with no price despite the 999;
  - the window edge, 13–18 Oct 2027: 13–15 available, 16–18 `not-released`; likewise the after-midnight sample;
  - the guard text gives a `ProviderError`.
- [ ] Never a cart URL:
  - no result over any fixture contains `?cart`, `rest_api_data_id` or `<redacted>` (`JSON.stringify`);
  - a test that rewrites a unit's `online_booking_url` to `/busselton/booking/?cart&rest_api_data_id=x` gets `links.booking` instead.
- [ ] The contract suite in `tests/integration/rac-provider.test.ts` passes with availability and watches on, including R7's link check and R8's stay-rule checks.
- [ ] `tests/integration/rac-watch.test.ts` (core harness, Busselton fixture):
  - create, then execute, gives FOUND and one alert whose link (R7) is the powered site's `online_booking_url`;
  - a watch over the school-holiday fixture is NOT_FOUND, with no notification (rule 16).
- [ ] Terms rule 3: `effectiveIntervalMinutes(5, racManifest)` is 15, and the watch form offers RAC no interval under 15 (renderer test).
- [ ] Terms rule 5, with a fake clock and a blocked client (403, 429, challenge):
  - the watch run records ERROR with R5's message;
  - nothing is sent until the cool-down ends;
  - the watch is not re-run before its interval.
- [ ] Terms rule 16: `pets: 3` is refused with VALIDATION (`resolveStayParams`).
- [ ] A native park's detail lists its categories from one POST, and a second open within 6 h sends none.
- [ ] R5's fixture and source guards pass on the new files.
- [ ] The e2e journey passes under `xvfb-run -a`, with role and name selectors only: the "RAC Parks & Resorts" provider, the "Camping" chip, the "Book on RAC" link.
- [ ] No test makes a live request; nothing creates a cart, hold, booking or payment (architecture-notes §12.33).
- [ ] The full gate passes: `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`, then `npm run build:e2e && xvfb-run -a npm run test:e2e`.
- [ ] CLAUDE.md and `tests/README.md` updated as in Scope 6. The website lists no RAC row until R20, and no existing claim changes.

## Edge Cases
- A night key missing from the answer: `unknown`. Keys outside the stay are ignored.
- Every public tariff refused while a member tariff succeeds: not free (the RS8 default until R16).
- The whole-stay count is lower than every night's (51 against 53 and 55): still bookable while it is above 0.
- Messages with `<strong>` or several reasons joined by `; `: plain text, all parts kept.
- 520 or another 5xx: a retryable typed error. The watch shows it and is not re-run before its interval (no loop).
- A challenge, 403 or 429: R5's 30-minute cool-down. The error is shown, and nothing is sent until it ends.
- An aborted `signal`: the `AbortError` propagates, and nothing more is sent.
- A stay that crosses the 364-day edge at midnight in Perth: those nights are code 9, so `not-released`, never `booked`.
- An arrival today in Perth is allowed; an arrival in the past is refused by the core.
- `unitIds` naming categories that no longer exist: no units, and the watch page says none of the chosen ones were in the check.
- Pets at a category that takes none: RAC refuses the party (code 2 or 3), so the nights are `closed`.
- A category with `tariffs_available` empty: no tariff counts, so not free.

## Test Strategy
- **Unit (~12):** date format, the code table, the booking-link check, tariff choice, `links.booking` with and without `unitId`.
- **Integration (~16):** the samples, the cart guard, the contract suite, the watch flows, the cool-down, the native-park detail.
- **Component (~1):** RAC's interval options.
- **E2E (1):** `rac-watch.spec.ts`.

## Context Files to Read First
- `ai-state/research/rac-booking-flow.md` §2–§4 and §11, `ai-state/research/rac-terms.md` (rules 1–7 and 16), `ai-state/research/rac-samples/`
- `ai-state/streams/rac/master-plan.md` (decisions 2 and 7, the terms table, RS8)
- `ai-state/streams/rac/tasks/R5-rac-catalogue.md`, `R2-polite-request-pacing.md`, `R7-alerts-open-booking-page.md`, `R8-minimum-stays-rate-notes.md`
- `src/main/providers/rac/` (R5's client, seed, links, unit-kind rule and guards)
- `src/main/providers/parkstay/availability.ts` (how `split` and `unknown` nights are set)
- `src/main/providers/sdk/provider.ts` (`AvailabilityModule`), `sdk/html.ts`
- `src/main/core/watches/next-check.ts`, `src/main/core/stay-params.ts`
- `tests/utils/provider-contract.ts`, `tests/utils/core-harness.ts`
- `tests/e2e/create-watch.spec.ts`, `tests/e2e/support/wa-stay.ts`, `tests/e2e/fixtures/http/README.md`
- `docs/providers/adding-a-provider.md` (Availability)

## Notes
- RAC's page treats a category as bookable for a tariff only when the tariff succeeds, every night has sites, and the whole-stay count is above 0 (`rac-booking-flow.md` §3). This mapping follows the page.
- Inventory is per category: one unit stands for many sites. The "split" case is the per-category version of ParkStay's class nights.
- R5 already records the native parks' responses. Any further live look is anonymous, read-only, at least 10 s apart, and a handful of requests at most.

## Assumptions
- **Needs a stakeholder check:** whether `online_booking_url` opens RAC's engine with the stay and category, no cart, on a phone with no session. It was never opened (`rac-booking-flow.md` §11). Brief R1 says it never touches a cart. The stakeholder should open one on a phone before RAC watches ship; the implementer may make one anonymous GET to confirm the page renders without a cart. If it fails, `links.booking` without `unitId` (R5's verified book-now page) is the fallback.
- Members' tariffs are recognised by their label ("RAC Member"). RAC sends no flag for them.
- The code table's choices: site codes 4, 6, 7 and 8 and tariff codes 2, 3, 4, 8 and 11 → `closed`; tariff code 5 → `not-released`. When unsure, the stay is not free (rule 16).
- The native-park near stay (today + 14, 1 night) is arbitrary. RAC lists every category whatever their availability.
