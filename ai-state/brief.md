# Project Brief — WA Stay

This file holds one brief per project. The current project is first; earlier projects follow, unchanged.

---

# Project 2 — RAC Parks & Resorts provider

> Agreed with the stakeholder (Wilson Waters) on 2026-10-16. Re-edit only on a major scope change.

## What we're building

The second accommodation provider for WA Stay: **RAC Parks & Resorts**, eight holiday parks in WA (Busselton, Cable Beach, Cervantes, Esperance, Exmouth, Karri Valley, Margaret River, Monkey Mia; Ningaloo is closed for redevelopment). It offers powered and unpowered sites, caravan sites, cabins, chalets, villas, studios, rooms and dorms. Bookings run on NewBook, served through RAC's own site behind Cloudflare.

With it comes a provider-neutral **stay type** (camping vs cabins, rooms, dorms, glamping), so Explore, watches and snipes can filter by the kind of accommodation across ParkStay, RAC and the coming Rottnest provider.

## Who uses it

The same WA Stay users, who want to:

- see RAC parks on Explore beside ParkStay campgrounds, with availability and prices for their dates;
- **watch** for an RAC site or cabin that frees up through a cancellation, and be told at once (the stakeholder's top priority);
- be alerted the moment new dates open: RAC's rolling 364-day window, or a school-holiday release, 48 h earlier for RAC members;
- filter camping vs other accommodation.

## Research inputs

- `ai-state/research/rac-booking-flow.md`: the booking engine and its endpoints, probed live, anonymously and read-only (63 requests); trimmed samples in `ai-state/research/rac-samples/`.
- `ai-state/research/rac-terms.md`: RAC's terms, with verdicts and 16 rules the app must follow.
- `ai-state/research/rac-sdk-gaps.md`: what the SDK, core and renderer support today, and the changes proposed.

## Facts that shape the design (verified 2026-10-16)

- **Booking window:** a rolling **364 days**, rolling at **midnight Perth time** (tested either side of midnight). It is not unlimited. School-holiday periods are held back and released on fixed dates at each park's own time (7, 8 or 9 am), **48 h earlier for RAC members**. Members enter their member number at NewBook's checkout; there is no RAC sign-in for it.
- **Availability:** one plain-HTTP POST per park (`availability-ajax.php`, needs `X-Requested-With: XMLHttpRequest`) returns every category with free counts per night and every rate (standard and RAC member). Inventory is per **category**, not per numbered site. No queue or waiting room.
- **Cart:** opening the response's `online_cart_url` adds the stay to a cart. That is RAC's only "hold"; its expiry is unknown and cannot be learnt without a real cart.
- **Terms:** nothing forbids automated reading, so RAC is not links-only. Personal non-commercial use only; `robots.txt` asks for 10 s between requests; RAC asks people not to strain the site; a booking is secured only when paid; RAC may cancel "disruptive" bookings.

## Stakeholder decisions (2026-10-16)

| # | Decision |
|---|---|
| R1 | **Watches:** a free RAC site or cabin raises a desktop (and email) alert. One click opens RAC's booking page with the park, dates, guests and category already filled in (`online_booking_url`, which never touches a cart). The person adds it to the cart and pays. |
| R2 | **Auto-cart, shipped off.** Also build an automatic "put it in my cart" hold for RAC watches and snipes, from RAC's page code only. It ships **switched off**. The stakeholder turns it on only after verifying it with one genuine booking of their own. No test, check or agent run may ever create a real cart, hold or booking (architecture-notes §12.33). |
| R3 | **Site Sniper as release alerts.** An RAC snipe starts checking at the exact release instant: midnight Perth for the 364-day roll, or the park's school-holiday release time, 48 h earlier when the person has saved an RAC member number. The moment the wanted dates are free it alerts and opens the prefilled booking page (or, with R2 switched on, adds them to the cart). |
| R4 | **Stay type, 5 groups, replacing "Type".** One "Stay type" filter: Camping (tent, caravan and campervan sites), Cabins & villas, Rooms, Dorms, Glamping. It replaces Explore's location "Type" chip. The unit picker in watches and snipes groups units the same way. |
| R5 | **Member number, optional.** The person may save their own RAC member number. It is used to time member pre-sale alerts, and to show member rates. |

## Orchestrator defaults (stated to the stakeholder, can be overridden)

| # | Default |
|---|---|
| RO1 | **Process:** as project 1 (D1): the sandbox orchestration methodology; one PR from branch `ccr-573ddb1d-hir0sq` to `main`; each task a GitHub issue labelled `ai-planning` and `stream:rac`, closed by the PR; `ai-state/` committed in the PR; commits authored as the stakeholder with no tool attribution. |
| RO2 | **An API provider, not a browser one.** RAC is read over plain HTTP through the SDK's `HttpClient` on `persist:provider-rac`. |
| RO3 | **Gentle by design (terms rules 2–5):** background requests to RAC at least 10 s apart and one at a time; a minimum watch interval of 15 minutes; a release-alert snipe polls at most once every 10 s, and only for a bounded window after the release instant. A Cloudflare challenge, 403 or 429 is a typed error shown to the person and never retried in a loop or worked around. |
| RO4 | **The member number** is stored encrypted through the SecretVault (the SDK's declared `credentials` sign-in kind, write-only over IPC), only after the person confirms it is their own, they will stay, and they will book in the name on the card. The app never sends it anywhere: the person types it at RAC's checkout (a copy button helps). |
| RO5 | **Content:** park facts (names, categories, guests, prices, availability) are shown; photos and descriptions are fetched live and shown only inside the person's app. Fixtures, docs and the website carry no RAC photos, marketing copy or logo: an original monogram and brand colour only, plus the independence notice. |
| RO6 | **Minimum stays** are modelled, so a watch never alerts on a stay RAC would refuse. |
| RO7 | **Ningaloo** (closed, no online bookings) and **Rose Gardens Holiday Park** (a separate brand) are left out. |
| RO8 | **One booking per night** (NightGuard) stays on for RAC too; it is stricter than RAC's two-bookings-per-member rule. |

## Success criteria

1. Explore lists the eight open RAC parks beside ParkStay's campgrounds, with free counts and prices for chosen dates, and a place page with categories night by night.
2. A user can create an RAC watch for a park, dates, guests and one or more categories or stay types. When a matching stay frees up, they get a desktop (and email, if set up) alert, and one click opens RAC's prefilled booking page.
3. An RAC snipe schedules itself at the release instant (rolling or school-holiday, member-aware), checks gently for a bounded window, and alerts when the dates are free. This is covered by fake-clock tests.
4. The "Stay type" filter works across ParkStay and RAC in Explore, watches and snipes. ParkStay maps to it with no regressions.
5. The member number can be saved, replaced and removed in Settings → Accounts. It is never logged and never returned to the renderer.
6. Auto-cart exists behind an off-by-default switch, is covered by tests on fixtures and fakes only, and no live cart was ever created.
7. Every terms rule in `rac-terms.md` that applies to what ships is enforced, with a test where the rule is testable.
8. The full gate passes: `lint`, `format:check`, `type-check`, `test`, `test:tz`, and `build:e2e` with `test:e2e`; plus the RAC preview spec (`PREVIEW_PROVIDER=rac`).
9. Docs, the providers README, CLAUDE.md and the website describe RAC, with "Soon" labels unchanged.

## Out of scope

- Rottnest Island accommodation (the next project). The stay types must already suit it.
- Booking import, the NewBook guest account sign-in and "manage my booking" for RAC (links only).
- Any automated checkout, terms acceptance, payment, cancellation or change on RAC.
- Asking RAC for permission or an API. Suggested to the stakeholder; not blocking.

---

# Project 1 — WA Stay 2.0 (complete)

> Agreed with the stakeholder (Wilson Waters) on 2026-10-02. Re-edit only on a major scope change.

## What we're building

**WA Stay** is a desktop app (Electron, Windows first) for finding and booking places to stay across Western Australia — national-park campgrounds, caravan parks, holiday parks, farm stays and short-term rentals — from many accommodation providers in one place.

It grows out of **WA ParkStay Bookings**, which automated campground bookings on the DBCA ParkStay system. ParkStay becomes **one provider module** among many; its existing capabilities (availability watches, DBCA queue handling, Site Sniper, booking management) are kept and refactored into that module.

## Who uses it

WA locals and travellers who book popular WA accommodation and want to:

- discover places on a map and through search, the way they would on Airbnb or Tripadvisor;
- read about a place (description, photos, facilities) and jump to the provider's own website;
- get alerted, or have a site held automatically, when hard-to-get accommodation becomes available;
- keep track of their bookings across providers.

Existing WA ParkStay Bookings users must be carried over to WA Stay without doing anything: auto-update or a manual install keeps their data, watches, snipes, settings and credentials.

## Scope (this project)

1. **Rename and rebrand** to *WA Stay*: app name, every bit of in-app branding, installer, icons, emails, docs. The repo will be renamed `wilsonwaters/wa-stay` by the stakeholder; we update every reference and supply the new repo description.
2. **Provider architecture.** A provider module SDK so new providers plug in without touching the core. It supports API-based providers and browser-automation providers (Playwright). Each feature is described by a provider capability.
3. **Refactor ParkStay into the first provider module.** It keeps watches, Site Sniper, DBCA queue handling and bookings, and fixes the defects found in review.
4. **Provider-first UX.** Every function (watches, snipes, bookings, accounts) starts by choosing a provider. Every booking, watch, snipe and notification always shows which provider it belongs to.
5. **Explore (new primary screen).** A map of every accommodation location from all providers, plus search and filters, in an Airbnb/Tripadvisor style. Each location gets a detail view with a description, photos, facilities and a link to the provider's website.
6. **Seamless upgrade.** Existing installs are migrated automatically on auto-update or manual update.
7. **Full design refresh.** Modern, clean and interesting, with a WA slant, modelled on Airbnb. The palette is inspired by the WA tourism mark the stakeholder supplied: Indian Ocean blue, sun gold, black-swan ink and coral. It must not look AI-built.
8. **Full technical review and fixes** as part of the refactor: architecture, security, data integrity, scheduler correctness, tests and dead code.
9. **Documentation.** README and docs present WA Stay as a WA accommodation booking app, with ParkStay as one capability.

## Out of scope (this project)

- The **RAC Parks & Resorts** provider module. It is the next project and the architecture must make it straightforward.
- Airbnb, Hipcamp, Tasman Holiday Parks, BIG4 and other providers. The architecture must support them, including providers with no API.
- macOS and Linux release builds. Windows remains the shipped target, but nothing should be done that blocks the others.
- Upgrading Electron 28. This is logged as a follow-up (see OPEN-QUESTIONS).
- A dark theme.

## Stakeholder decisions (2026-10-02)

| # | Decision |
|---|---|
| D1 | **Process:** sandbox orchestration methodology. One PR from branch `ccr-da6e94c0-litpr7`. Each task is a GitHub issue labelled **`ai-planning`** (plus a `stream:*` label) and is closed by the PR. `ai-state/` is committed in the PR. All git and GitHub activity is authored as the stakeholder, with **no tool attribution** anywhere. |
| D2 | **Sign-in:** no app-level login gate. The app opens on Explore. Accounts are per provider (Settings → Accounts), and the user is prompted to connect only when a feature needs it. Existing ParkStay credentials migrate to the ParkStay account. |
| D3 | **Map:** Mapbox GL JS. The token comes from `MAPBOX_ACCESS_TOKEN`: a GitHub Actions secret at build time, and a gitignored `.env` for local dev (with a committed `.env.example`). Without a token the app degrades gracefully and Explore still works as a list. |
| D4 | **Bookings and Site Sniper:** fix the Site Sniper defects (date format and availability parsing). Keep both features marked **"Soon"** in navigation, restyled. |
| D5 | **Provider sign-in:** an in-app sign-in window on a per-provider Electron session partition. The user signs in on the provider's real page and the app keeps that session for API calls, holds, imports and the payment hand-off. **Playwright** (`playwright-core` driving the installed Edge/Chrome) is the automation runtime for providers without APIs. |

## Orchestrator defaults (stated to stakeholder, can be overridden)

| # | Default |
|---|---|
| O1 | Keep the internal `appId` `com.parkstay.bookings` so the NSIS installer upgrades in place and auto-update continues. User-visible names all change. |
| O2 | The new data folder is `%APPDATA%\WA Stay`. On first run, data is copied from `%APPDATA%\parkstay-bookings` using the SQLite backup API. The old folder is left untouched as a backup. |
| O3 | Ship as **v2.0.0**. The version bump is done by the release process, not this PR. CHANGELOG gets an Unreleased entry. |
| O4 | Use an **original** WA Stay logo. The supplied image is the WA Tourism Commission's trademark, so it is used only as colour and mood inspiration and is not copied. |
| O5 | Explore becomes the home screen. The old Dashboard is retired and its content moves into Watches and Bookings. |
| O6 | Internally, notification "providers" are renamed "notifiers" so they don't clash with accommodation providers. |
| O7 | Stored secrets move to OS-backed encryption (Electron `safeStorage`), with a transparent migration from the legacy scheme. |
| O8 | ParkStay photos and data are fetched live from ParkStay's public API and image URLs at runtime, never redistributed. |

## Success criteria

1. App, installer, emails and docs say **WA Stay**. "ParkStay" appears only where it names the provider.
2. A v1.2.0 install upgrades to WA Stay and keeps its watches, snipes, bookings, settings, notifier config and credentials. This is covered by automated migration tests.
3. The app launches straight into **Explore**. It shows a Mapbox map with every ParkStay campground (169), search and filters, and a synced result list, and degrades to a list without a token.
4. Each location has a detail view with photos, description, facilities, park/region, a provider badge and a "View on ParkStay" link that opens in the system browser.
5. Every watch, snipe, booking and notification shows its provider. Each create flow begins with provider selection, filtered by capability.
6. A new provider can be added by implementing the provider interface in `src/main/providers/<id>/` and registering it. No core service changes are needed. A developer guide covers both API and browser-automation providers.
7. Site Sniper polls successfully against live ParkStay: dates are `YYYY/MM/DD` and availability tuples are parsed correctly.
8. Every critical and high finding from the technical review is fixed or explicitly deferred with a reason.
9. `npm run lint`, `format:check`, `type-check` and `test` all pass. An Electron smoke E2E suite passes.
10. The design is coherent and distinctive, documented in `docs/design/`, with consistent primitives and no emoji icons. It meets basic accessibility: labelled controls, focus management in dialogs, AA contrast.

## Constraints

- Stack: Electron 28, React 18, TypeScript 5, Vite 5, Tailwind 3, SQLite (better-sqlite3), Jest 29 and Playwright. New runtime dependencies need a reason.
- All migrations live in `src/main/database/connection.ts` `runMigrations()`, per CLAUDE.md.
- Pre-commit gate: lint (0 errors), format:check, type-check and test.
- DBCA terms: one account per person, one booking per night, genuine intent. Payment stays a human step.

## Research inputs

- `ai-state/research/tech-review.md`: architecture and code review, with ranked findings.
- `ai-state/research/ui-review.md`: renderer, UX, accessibility and branding inventory.
- `ai-state/research/parkstay-api-review.md`: live-probed ParkStay endpoints and map data.
