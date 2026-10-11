# Project Brief — WA Stay

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
