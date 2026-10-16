# R20: Docs, website and release notes for RAC

## Description
The stream's last task. It makes every document and the public website true to the app once RAC ships, and runs the full gate with the RAC preview (brief success criteria 8 and 9).

CLAUDE.md "Website" and "Adding a provider" step 7 apply:
- the providers row, the brand colour and the independence notice;
- provider-neutral copy elsewhere;
- nothing of RAC's (photos, marketing copy, logo) in the repo or on the site (terms rules 6–7, brief RO5).

The user docs describe the stakeholder decisions R6–R8 as behaviour, without their ids:
- clicking an alert opens the provider's booking page for every provider;
- alert emails carry a public, prefilled booking link, so the person can book from a phone;
- what the person starts is checked at interactive pace, while background work is spaced out.

## Size
M

## Depends on
R1–R19 (all)

## Scope
1. **`docs/providers/rac/`** (new). Provider docs carry no plan, brief or issue references (`tests/unit/docs/provider-guide.test.ts:38-49`).
   - **`README.md`**, shaped like `docs/providers/parkstay/README.md`:
     - the manifest table, with values from RAC's manifest, and the capability table with its modules;
     - the eight parks, and why Ningaloo and Rose Gardens are left out;
     - stay types per category; availability and its refusals in words (minimum stays, arrival days, pets, 364 days);
     - pacing: background requests 10 s apart, what the person starts at interactive pace, and a 30-minute stop after a challenge, 403 or 429;
     - releases: rolling at midnight Perth; school holidays at each park's time; members 48 h earlier; `scheduled` for Cable Beach;
     - the member number: what it changes, where it is kept, and that it is never sent;
     - the auto-cart experiment: off by default; what it does and never does; and a short "Verifying it" list for the maintainer's own genuine booking (the cart timer, the confirmation page, blocked payment origins in the log);
     - RAC's terms as plain rules; data and images (fetched live, shown only in the app, none in the repo); tests.
   - **`endpoints.md`:**
     - a status legend: "Verified live 2026-10-16", "From RAC's page code, not exercised", "Known, never used";
     - **requests WA Stay sends:** the availability POST; the book-now page; and, with the experiment on only, the cart page GET, the cart URL GET and the cart removal;
     - **pages it opens or links to:** the park home, book-now prefilled, `online_booking_url`, contact, the school-holiday page;
     - **known, never used:** `get-online-cart-url-ajax.php`, checkout (`?cart=Booking`), `cc_secure`, `extend_multiple_holds`, `?login`, `wp-json`;
     - the tariff and site codes as the module maps them.
   - **`release-calendar.md`:** keeping the school-holiday calendar current (RS7).
     - where RAC announces releases;
     - the fields per period in `src/main/providers/rac/release-calendar.ts` (holiday dates, pre-sale and public dates, park times, who takes part);
     - the test to run;
     - what happens to a stay in an unannounced period;
     - when to add WA school-holiday dates past 2028.
   - **Tests:**
     - `tests/unit/docs/rac-endpoints-doc.test.ts`, modelled on `endpoints-doc.test.ts`:
       - every row has a status from the legend;
       - every path RAC's module requests is in the first table;
       - the cart rows say "From RAC's page code, not exercised";
       - a "never used" path appears in the module's code only in `cart-guard.ts`;
     - in `provider-guide.test.ts`: add `/\bR[OSQ]?\d+\b/` to `INTERNAL` (no current provider doc trips it), and `docs/providers/rac/README.md` to the "cover" list.
2. **Other docs:**
   - **`docs/providers/README.md`:**
     - an RAC row: built in; 8 parks on Explore; availability per night with prices (member rates with a saved number) and bulk counts; watches every 15 minutes or more, whose alerts open RAC's booking page; Site Sniper release alerts (coming soon); holds: an experimental cart, off; no booking import; account optional (member number);
     - ParkStay's row: stay types, and Site Sniper "alert or hold".
   - **`README.md`:** the intro line (`:17`) and the providers table (`:70-73`).
   - **`docs/providers/adding-a-provider.md:4`** and **`browser-providers.md:3`:** RAC is built in, and it is an API provider.
   - **`docs/user-guide.md`:**
     - Explore's "Stay type" filter, and RAC's counts arriving over about a minute ("Still checking RAC…");
     - a place page's member price note;
     - watches: an alert click opens the provider's booking page in the browser and the watch in the app; the email's "Book on {provider}" link for phones;
     - Site Sniper (coming soon): "Alert me" or "Hold it", and RAC's release alerts;
     - Settings → Accounts: the RAC member number (save, replace, remove, copy) and Experimental (auto-cart, restart);
     - Good to know: what the app sends RAC and how often; booking responsibly with RAC (a member's own number, at most two bookings per period).
   - **`docs/watches-and-notifications.md`:** the alert click for every provider; the email link (never a cart page); the auto-hold email's wording; minimum stays; RAC's pacing.
   - **`docs/site-sniper.md`:** alerts vs holds; how RAC releases; the 30-minute window and 10 s polls; a block ends the snipe.
   - **`docs/security.md`:**
     - the member number: a credentials secret, write-only, copied by main, never logged or sent;
     - RAC's payment window and cart guard;
     - experiments: stored main-side, applied at restart.
   - **Smaller docs:** `docs/architecture/overview.md` (RAC in the provider diagram; v11 and v12 if R1 and R12 left them out); `docs/troubleshooting.md` ("RAC isn't answering": the 30-minute pause); `docs/README.md` (links to the new pages).
   - **`CHANGELOG.md` `[Unreleased]`,** merging any entries already there:
     - **Added:** the RAC provider; Stay type; the member number; release-alert snipes; booking links in alerts and emails; the experimental auto-cart (off);
     - **Changed:** "Type" became "Stay type"; alert clicks open the booking page for every provider; interactive pacing.
     - Each entry cites the stream's issue where it has one.
3. **Website** (`site/`, the rules in `docs/website.md`):
   - **The row:** `<li class="provider" data-provider="rac">` in "Different providers, one app" (`site/index.html:273-298`):
     - its badge is the manifest monogram and its `h3` the manifest `name`, with one line on what RAC offers;
     - a features list labelled "What WA Stay does with {name}": free sites and cabins on the map, watches, member rates;
     - nothing on holds (off) or snipes (coming).
   - **The colour:** `--provider-rac` in `site/styles.css` `:root`, plus `[data-provider='rac'] .provider__badge { background: var(--provider-rac); }` (`:601-603`).
   - **The independence notice** (`:511-516`) names RAC as it names DBCA.
   - **Provider-neutral copy:**
     - Explore (`:142-168`): "by the kind of stay";
     - watches (`:209-249`): one click to the provider's booking page, and the email link for a phone;
     - "Coming next" Site Sniper (`:302-341`): alerts at the release time, members' early access, holds where the provider allows;
     - questions: "Do I need an account?" (a member number some providers use, encrypted and never sent) and "Where does my information go?".
   - The "Soon" labels stay as they are.
   - **Screenshots show no RAC photos:**
     - the docs and site screenshot specs stay ParkStay-only, so they never load RAC's photo host;
     - retake where R4's chip shows: `npm run docs:screenshots`, and `npm run site:screenshots` (needs a Mapbox token);
     - then update the sizes and alt text.
4. **CLAUDE.md:**
   - Project Overview (`:7`): RAC is the second provider.
   - Key Services: an RAC provider row (catalogue seed, availability, release calendar, member number, cart experiment), next to ParkStay's.
   - Provider SDK: `credentials` is implemented, and `experiments`.
   - Testing: the journey and spec counts; the website table, if sections moved; Further Reading: `docs/providers/rac/`.
   - Sweep CLAUDE.md, `AGENTS.md` and `.claude/commands/` for anything that still calls RAC planned.
5. **Final gate:** the full gate, the RAC preview with the arrival date R11 recorded, and a PR note with each result.

## Non-goals
- Code changes beyond the docs tests, site markup and CSS. A bug found here becomes a new task for the orchestrator.
- Screenshots of RAC places, or a website section for RAC alone (rule 7).
- Removing a "Soon" label (the stakeholder's call, unchanged). Rottnest.

## Completion Criteria
- [ ] The three `docs/providers/rac/` pages exist; `markdown-links.test.ts` and `provider-guide.test.ts` (with the new pattern) pass.
- [ ] `npx jest tests/unit/docs/rac-endpoints-doc.test.ts` passes.
- [ ] `grep -rniE "rac.{0,40}(planned|next project)" README.md docs/ CLAUDE.md AGENTS.md` finds nothing.
- [ ] `npx jest tests/unit/site/site.test.ts` passes: two provider rows, RAC's name, monogram and colour equal to its manifest, and no colour outside `:root`.
- [ ] `grep -rnE "driveau\.newbook\.cloud|wp-content/uploads" site/ docs/ tests/fixtures/` finds nothing.
- [ ] The user docs answer each of these, found by heading:
  - What happens when I click an alert? (every provider)
  - Can I book from my phone? (the email link, never a cart page)
  - Why do RAC's counts take a minute? (interactive vs background pacing, about 40–60 s)
- [ ] `CHANGELOG.md` `[Unreleased]` has the Added and Changed entries above, with no duplicates.
- [ ] The PR has a site checklist: each section of `site/index.html`, with what changed or "still true" against R1–R19.
- [ ] Screenshots: `docs/images/*.png` are retaken; `site/assets/screens/*.webp` too when a Mapbox token is available, else the PR lists `npm run site:screenshots` as a stakeholder step. Sizes and alt text match (the site test's image check passes).
- [ ] A11y (site): the RAC badge is `aria-hidden`; the row has one `h3` and a labelled features list; the badge text meets AA contrast on `--provider-rac`.
- [ ] CLAUDE.md is updated, and the backticked-paths check in `tests/unit/docs/` passes.
- [ ] Full gate:
  - `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`;
  - `npm run build:e2e && xvfb-run -a npm run test:e2e`;
  - `xvfb-run -a npx cross-env PREVIEW_PROVIDER=rac PREVIEW_ARRIVAL=<R11's date> playwright test preview-provider`, with no warning about uncovered nights.

## Edge Cases
- **No Mapbox token** in the agent's environment (no `.env` today): the site screenshots cannot be retaken. Keep the alt text true to the current images, and hand the command to the stakeholder.
- **The hero shows the old "Type" chip** until the site screenshots are retaken: say so in the PR.
- **The site's hero says "169 places"** (ParkStay-only fixtures): still true of the example screenshot. Do not add RAC places without photos.
- **Naming RAC outside its row and the notice** on the site is not allowed. In docs, provider-neutral pages say "the provider" and link to RAC's page for specifics.
- **An earlier task already edited a doc or `[Unreleased]`:** merge, don't duplicate; fix any line it left stale.
- **The preview warns** that the responses cover none of the nights: set `PREVIEW_ARRIVAL` to R11's recorded date.
- **A gate failure caused by another task:** report it with the failing test, and don't weaken the test.

## Test Strategy
- **Unit (~6):** `rac-endpoints-doc.test.ts` (4 cases); the extended internal-reference guard and its cover list. The existing site test now checks two rows.
- **Component and integration:** none.
- **E2E:** the whole suite, the RAC preview, and the docs and site screenshot runs.

## Context Files to Read First
- `CLAUDE.md` ("Website", "Adding a provider" step 7, "Testing", "Release Process")
- `docs/website.md`, `docs/design/design-language.md` (voice)
- `ai-state/brief.md` (Project 2: R6–R8, RO5, success criteria 8–9); `ai-state/streams/rac/master-plan.md` (decision 10, RS7)
- `ai-state/research/rac-booking-flow.md` (endpoint table), `ai-state/research/rac-terms.md` (rules)
- `docs/providers/parkstay/README.md`, `docs/providers/parkstay/endpoints.md`, `docs/providers/README.md`
- `tests/unit/docs/endpoints-doc.test.ts`, `tests/unit/docs/provider-guide.test.ts`, `tests/unit/site/site.test.ts`
- `site/index.html`, `site/styles.css`; `tests/site/screenshots.spec.ts`, `tests/docs/screenshots.spec.ts`
- `src/main/providers/rac/` (the manifest, `release-calendar.ts`, `cart-guard.ts`) and every R1–R19 spec's docs items

## Notes
- `docs/providers/rac/` is public: it describes what the app does and links to RAC's pages, never quoting their copy. On the site, "member number" is neutral enough for the questions; "RAC member rates" belongs in RAC's row.

## Assumptions
- RAC's monogram and colour come from R5's manifest, and its colour already meets AA contrast in the app's `ProviderBadge`.
- The independence notice reads "…including DBCA, which runs ParkStay WA, and RAC, which runs RAC Parks & Resorts…". The stakeholder may prefer the club's full name.
- The site and docs screenshots stay ParkStay-only, because RAC's photos may not be shown outside the app (rule 7).
- R20 may fix stale lines that other tasks missed; anything beyond docs goes back to the orchestrator.
