# R19: RAC auto-cart, off by default

## Description
Brief R2: an automatic "put it in my cart" hold for RAC watches and snipes, built from RAC's page code only and shipped switched off. RAC's only hold is its cart: opening a tariff's `online_cart_url` adds the stay to a NewBook cart on the session that opened it.

With RAC's `autoCart` experiment on (R17), a match puts the stay in the cart on RAC's partition (`persist:provider-rac`). "Pay now" then opens RAC's cart page in the payment window on the same session, and the person checks out and pays there. Terms rules 8, 12, 13 and 15 apply.

**Nothing here may run against RAC's live site** (architecture-notes §12.33). No test, check, preview or agent run may:
- open a real `online_cart_url`;
- create a real cart, hold, booking or payment.

The fixtures are synthetic. They are written from RAC's NewBook scripts (`nb_common.min.js`, `process.min.js`, `availability-filters.js`, read during research), never recorded, and labelled so. The stakeholder verifies the flow with one genuine booking of their own before turning it on (RQ2).

## Size
M

## Depends on
R13 (alert or hold snipes), R16 (member number and tariff choice), R18 (release hooks; R17's switch comes through it)

## Scope
1. **The experiment** (RAC's manifest):
   - `experiments: [{ id: 'autoCart', label: 'Put stays in my RAC cart automatically', description, warning, turnsOn: ['holds'] }]`, with `holds: false` in the base manifest.
   - The description: when a watch or snipe finds your stay, WA Stay adds it to your RAC cart; you check out and pay on RAC's page.
   - The warning: experimental and not yet checked with a real booking; a cart is not a booking, and only a paid booking secures the stay.
   - The factory builds `holds`, and gives the RAC client cart access, only when `ctx.manifest.capabilities.holds` is on.
   - The manifest sets `holdRelease: true` (R18). The registry accepts it while `holds` is off.
2. **Cart guard** (`src/main/providers/rac/cart-guard.ts`, applied by R5's RAC client before anything is sent):
   - **Always refused** (rule 8), experiment or not:
     - any request to `apiau.newbook.cloud` (the `cc_secure` card store);
     - a POST to `/<slug>/booking/` (checkout, `?cart=Booking`);
     - `get-online-cart-url-ajax.php`;
     - NewBook proxy (`inc/newbook/api/`) queries other than `remove_item_from_cart`: `extend_multiple_holds`, `online_checkout_membership_fields`, `modify_booking_guests` and the rest.
   - **Refused unless the cart is enabled:** a GET whose query has `cart` and `rest_api_data_id` (an `online_cart_url`), and the proxy's `remove_item_from_cart`.
   - A refusal is a `ProviderError`, and nothing is sent. Logs name the path only, never the query (the cart id is a token).
3. **Holds module** (`providers/rac/holds.ts`, with `providers/rac/cart-page.ts`). Every hold request goes through R2's paced client, one at a time. The core runs `create` and `release` at R2's interactive priority (R18; the orchestrator's decision): a hold is one booking attempt the person opted into. The module sets no priority of its own.
   - **`create({ externalId, unitId, stay })`:**
     1. One cart at a time: while the module's record (`ctx.state` `cart.current`) is unexpired, refuse `in-progress` with "Your RAC cart already holds a stay. Pay for it or let it go first."
     2. A site category needs equipment. Add hold-only stay fields `equipmentType` (NewBook's 15 equipment types), `equipmentLength` and `equipmentWidth` (metres), with `appliesTo: ['hold']`. If any is missing, refuse `invalid` with "Add your equipment (type, length and width) to hold a site at RAC", before any request.
     3. GET the park's cart page `/<slug>/booking/`. If its `cart_breakdown` already shows booking nights, refuse `in-progress`.
     4. Send one availability POST (R10's request) with `category_id` and, for sites, `equipment_type_ids`, `equipment_length`, `equipment_width` and `equipment_measurement_unit=m`.
     5. Take R16's tariff (a member tariff only with a saved number). If it has no `online_cart_url` or is not bookable, the result is `taken`. A cart URL that is not RAC's host and `/<slug>/booking/` is a parse error, and nothing is sent.
     6. Send **one GET** of that `online_cart_url` on `ctx.http`, and nothing else. The page it ends on must show this stay: booking nights equal to the stay's nights, and an amount above 0. Otherwise `taken`.
     7. Expiry: `earliest_hold_expires_when` (seconds left) when the page has `hold_ids`; else `default_hold_duration` (minutes); else 10 minutes with `expiresAtEstimated: true` (R18). A value outside 1 s to 24 h counts as missing.
     8. Store `cart.current` (park, stay, category, expiry). Return `{ ok, reference, expiresAt, expiresAtEstimated?, unitId }`, with an opaque reference `rac-cart:<slug>:<arrival>:<random>`.
   - The cart URL and its `rest_api_data_id` live only in memory during `create`. They are never stored, returned, logged, or put in a notification or an email.
   - **`paymentUrl(hold)`** is `https://parksandresorts.rac.com.au/<slug>/booking/`, the cart page. It is never the `online_cart_url`: opening that again would add a second stay. `paymentOrigins` is RAC's origin only (RS4). There is no `bookedReference` (RS5), so an RAC hold is never marked booked or "secured".
   - **`release(hold)`** (R18; `releaseOnPaymentClose: true`). RAC decides, because the core never treats a closed window as unpaid:
     - GET the cart page. If it still holds this stay (found by dates and category), POST `remove_item_from_cart` with `item_offset` and `cart_type=booking` to the page's `newbook_api_path`, and answer `{ outcome: 'released' }`. That path is accepted only on RAC's host, under `/<slug>/wp-content/themes/parks-and-resorts/inc/newbook/api/`.
     - A cart that no longer holds the stay (paid, expired, removed in the window) is left alone, and the answer is `{ outcome: 'gone' }`. So a release never touches a booking (rule 10).
     - Both answers clear `cart.current`.
     - If RAC cannot be reached (an error, 403 or 429), reject with the typed error. The record and the cookies stay, so the hold stays payable until it lapses (R18). Log it without the token.
   - An abort after the cart GET was sent also clears the partition's cookies, then rejects with the abort.
4. **Synthetic fixtures** (`tests/fixtures/providers/rac/cart/`): an empty cart page; a cart page with one stay and hold fields; one with no hold fields; a refused cart (0 nights); an availability answer whose cart URL has `rest_api_data_id=00000000000000000000000000000000`; the proxy's removal answer. Each file starts with "Synthetic: written from RAC's NewBook scripts, not recorded". They hold only the variables and inputs the module reads, with no RAC copy, images or logo, and they pass R5's fixture guard.
5. **E2E fixtures stay cart-free:** `tests/e2e/fixtures/http/rac/manifest.json` has no route for a cart URL, the cart page, the NewBook proxy or `apiau.newbook.cloud`.

## Non-goals
- The switch, its stored state and its dialog (R17).
- The `hold_expires_estimated` column (R12, v12). The release triggers, "Let it go", the "about" wording and the interactive priority (R18).
- Snipe "Alert me" or "Hold it" screens (R13). The member number, tariff choice and copy button (R16).
- Marking an RAC cart booked, extending a hold, checkout, ticking RAC's terms box, payment, cancellation: never.
- Any live verification. The stakeholder's genuine booking (RQ2) is outside every task.

## Completion Criteria
- [ ] **Off by default:**
  - the manifest test shows `capabilities.holds === false` and `autoCart` with `turnsOn: ['holds']`;
  - with the experiment off, RAC has no `holds`, and the client refuses an `online_cart_url` GET: a `ProviderError`, and the fake transport sees no request;
  - with it on (`withExperiments`), RAC's contract suite passes with `holds`, including abort.
- [ ] `tests/unit/providers/rac/cart-guard.test.ts`:
  - every always-refused request is refused with the experiment on;
  - the cart URL and the removal are refused with it off;
  - the logged path carries no query.
- [ ] `tests/unit/providers/rac/no-checkout.test.ts`: no file under `src/main/providers/rac/` except `cart-guard.ts` names `cc_secure`, `card_number`, `card_cvv`, `newbook_online_main_form`, `cart=Booking`, `extend_multiple_holds` or `membership_number`; `cart-guard.ts` names them only in its deny list.
- [ ] **No live cart, ever:**
  - every `rest_api_data_id` under `tests/` is the synthetic zero id or `<redacted>`;
  - every file in `tests/fixtures/providers/rac/cart/` starts with the synthetic label;
  - the e2e RAC manifest has no cart, cart-page, proxy or card route (tested);
  - nothing under `tests/manual/` or `scripts/` names `online_cart_url` or `rest_api_data_id`.
- [ ] `tests/unit/providers/rac/holds.test.ts` (FixtureHttpClient on the synthetic fixtures, fake clock):
  - **success:** exactly three requests in order (cart page, availability POST, cart URL), and `expiresAt` from `earliest_hold_expires_when`;
  - **expiry:** the minutes fallback; with no hold fields, now + 10 min and `expiresAtEstimated: true`;
  - **refusals:**
    - a second `create` → `in-progress` with no request;
    - an occupied RAC cart → `in-progress` after one request;
    - a site without equipment → `invalid` with no request;
    - no bookable tariff, and a refused cart → `taken`;
  - **requests sent:** a site's form carries type, length, width and `m`; with no number, never a member tariff's URL;
  - **blocks and aborts:**
    - 403, 429 and a challenge are typed errors that start R5's cool-down, and nothing more is sent;
    - an abort before, between and after the cart GET; after it, the cookies are cleared;
  - **the token stays private:** the cart URL and its id are never in the result, `ctx.state`, the captured logs or error messages.
- [ ] `paymentUrl` is the cart page for every park slug, with no `cart` query and no `rest_api_data_id`.
- [ ] `release`:
  - while the cart holds the stay: one GET, then one POST with `item_offset` and `cart_type=booking` to the page's proxy path; it answers `released` and clears the record;
  - an emptied cart (the synthetic "paid" case): the GET only; it answers `gone` and clears the record;
  - a proxy path off RAC's host or path: refused and rejected, with the record kept;
  - RAC unreachable, or a 403 or 429: rejects with the typed error, keeps the record and the cookies, and logs without the token.
- [ ] Core integration (core harness, experiment on, synthetic fixtures):
  - an auto-hold RAC watch ends HELD, with RAC's cart page as its payment URL; its notification and email carry no cart URL;
  - a hold snipe (`action: 'hold'`) ends HELD at release;
  - **rule 13 and RO8:** a second overlapping RAC hold (a watch, then a snipe) is refused with `NIGHT_CONFLICT_MESSAGE`; a non-overlapping one is refused by the one-cart rule;
  - closing the payment window with no confirmation (fake windows) calls `release` once, and so does "Let it go" (R18's paths). A synthetic paid cart answers `gone`, and the row says to check RAC's confirmation email;
  - `holds.create` and `holds.release` run at the `interactive` priority, inside a background poll;
  - no page the window loads ever marks an RAC hold booked.
- [ ] E2E `tests/e2e/rac-auto-cart.spec.ts` (`providers: ['parkstay', 'rac']`):
  - in Settings → Accounts → RAC, turn on "Put stays in my RAC cart automatically", confirm, and relaunch on the same profile (as `lifecycle.spec.ts` does). The switch reads on, and the RAC watch form now offers the automatic hold;
  - in a launch seeded with a held RAC watch (a made-up reference; no cart is created), the hold panel shows "Pay now" and "Let it go". "Pay now" makes the network guard cancel RAC's `/<slug>/booking/` page, and the page says the window could not open, as in `held-snipe.spec.ts`. A first page that failed releases nothing (R18), so the hold stays;
  - no recorded request, guarded or refused by fixtures, has `cart&` or `rest_api_data_id` in its URL, and none went to `apiau.newbook.cloud`.
- [ ] A11y: the e2e reaches the switch, the dialog and "Pay now" by role and name only (R17 and `HoldPanel` own their a11y).
- [ ] CLAUDE.md: "No live holds" names RAC carts, and the Key Services line on hold payment says RAC has no `bookedReference`.
- [ ] Full gate: `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`, then `npm run build:e2e && xvfb-run -a npm run test:e2e`.

## Edge Cases
- **RAC's client is in its 30-minute cool-down** after a 403, 429 or challenge: `create` fails fast with the typed error and sends nothing. A snipe ends FAILED (R12); a watch alerts with the reason.
- **A Cloudflare challenge page instead of the cart page:** treated as a challenge, never solved (rule 5).
- **A cart redirect off RAC's host:** refused by R5's host allow-list.
- **Odd hold fields** (hold fields but no `hold_ids`, or a 0, negative or huge `earliest_hold_expires_when`): the 10-minute estimate.
- **Expiry unknown:** the estimate is flagged. NightGuard and `HOLD_EXPIRED` use it as is.
- **The person adds another stay in the payment window:** the release removes only this stay's item, found by dates and category. If it cannot tell which item is this stay's, it removes nothing and rejects, and the hold stays until it lapses (R18).
- **The local record expired but RAC still shows the stay:** step 3 refuses `in-progress` until RAC drops it.
- **The app quits with a cart:** the row stays HELD until `expiresAt`. The partition is persistent, so "Pay now" opens the same session's cart.
- **Turning the switch off while a cart is held:** refused (R17, `ACCOUNT_BUSY`).
- **The payment window goes to an unknown top-level origin** (3-D Secure, NewBook): blocked and logged by origin (existing behaviour), for the stakeholder to add after RQ2.
- **An auto-hold email** says the stay is in the cart on the computer, and carries the public booking link (R7): never the cart page or the cart URL.
- **RAC's checkout refuses the person's membership:** that is RAC's page. The app releases on close as usual.

## Test Strategy
- **Unit (~30):** cart guard, source guard, fixture guards, the cart-page parser (`cart_breakdown`, hold fields, `newbook_api_path`), the `create` and `release` matrices, `paymentUrl`.
- **Component:** none. The switch is R17's; `HoldPanel` is unchanged here.
- **Integration (~8):** the core harness with the experiment on (auto-hold, hold snipe, NightGuard, one cart, release on close and on decline, never booked); RAC's contract suite with the experiment on and off.
- **E2E (1 spec, 2 journeys):** turn on and relaunch; "Pay now" reaches only the guarded cart page.

## Context Files to Read First
- `CLAUDE.md` ("No live holds", "Adding a provider" rules, "Secrets")
- `ai-state/architecture-notes.md` §12.33; `ai-state/streams/rac/master-plan.md` (decision 1, terms rules 8, 12, 13, 15; RS4, RS5)
- `ai-state/research/rac-booking-flow.md` §3, §6, §11; `ai-state/research/rac-terms.md` §6 and rules 8–16
- `ai-state/research/rac-samples/booking-page-busselton-newbook-config-excerpt.txt` (an empty cart page: `cart_breakdown`, `newbook_api_path`)
- `ai-state/streams/rac/tasks/R5-rac-catalogue.md`, `R10-rac-availability-watches.md`, `R12-alert-snipes-core.md`, `R16-rac-member-number.md`, `R17-experimental-switches.md`, `R18-hold-release-hooks.md`
- `src/main/providers/sdk/provider.ts` (`HoldsModule`), `src/main/providers/sdk/http.ts` (`CookieStore`), `src/main/providers/sdk/context.ts`
- `src/main/core/holds/hold-payment.service.ts`, `src/main/core/holds/night-guard.ts`, `src/main/app/provider-windows.ts`
- `src/main/core/watches/watch.service.ts` (`autoHold`), `src/main/core/snipes/snipe.service.ts` (`execute`)
- `src/main/testing/fixture-http-client.ts`, `src/main/testing/network-guard.ts`; `tests/e2e/held-snipe.spec.ts`, `tests/e2e/lifecycle.spec.ts`, `tests/e2e/support/seed.ts`
- `tests/utils/provider-contract.ts`, `tests/unit/providers/no-loopback-addresses.test.ts` (guard pattern)

## Notes
- **From RAC's scripts** (not exercised):
  - removal is `POST newbook_api_path + 'newbook_api_action=data&query=remove_item_from_cart'` with `item_offset` and `cart_type` (`process.min.js`);
  - the hold timer reads the hidden inputs `earliest_hold_expires_when` (seconds left), `default_hold_duration` (minutes) and `hold_ids` (`nb_common.min.js`);
  - a site's cart URL comes from an availability POST with equipment type, length and width, all required (`availability-filters.js`, the equipment modal).
- The implementing agent may re-read those public script files anonymously: a handful of GETs, never a page with `?cart` and never a POST. It must not commit them (rule 7).
- The partition the cart lives on is the one the payment window uses (`hold-payment.service.ts:1-9`), so "Pay now" shows the same cart.

## Assumptions
- `/<slug>/booking/` with no query shows the session's cart (`page_action = 'cart'` in the excerpt), and a cart holding a stay carries `cart_breakdown` with its nights. Seen on an empty cart only.
- The 10-minute estimate stands until the stakeholder's genuine booking shows the real timer (RS5).
- Settled by the orchestrator, not assumed:
  - hold requests run at interactive pace (R18 sets the priority);
  - the core never treats a closed window as unpaid, so RAC's `release` checks the cart first and answers `gone` when the stay has left it;
  - the estimate is stored in R12's `hold_expires_estimated` column.
