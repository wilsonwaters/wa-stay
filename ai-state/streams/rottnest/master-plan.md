# Rottnest: master plan

**Stream:** rottnest · **Label:** `stream:rottnest` · **Lanes:** S (shared types, core, IPC), U (renderer), P (Rottnest module), D (docs) · **Status:** 🟦 in progress

The brief is Project 3 in `ai-state/brief.md` (decisions T1–T7, defaults TO1–TO6). The rules are `ai-state/research/rottnest-terms.md` §9 (the automated watch) and §6 rules 7–12 (booking). The first plan of 2026-10-17 (links-only, reminders instead of a watch) was superseded by the stakeholder's decisions of 2026-10-18; its research stands.

## Goal

Rottnest Island (Stay Rottnest, RIA) becomes WA Stay's third provider. When the stream is done:

- **Explore** shows the island's nine precincts, each with its room types (sleeps, bedrooms, kind), and, once the person has accepted the notice, free counts for chosen dates, from **one** search for the whole island.
- **The place page** checks a stay on the person's click: each room type free or not, with the whole-stay price and its rate (25% deposit, or paid in full). "Book on Stay Rottnest" opens RIA's search with the stay filled in.
- **Watches** check every 30 minutes at most, alert on a freed room type with the search link, and never hold.
- **The first-use notice:** nothing is sent to Stay Rottnest until the person has read the notice of clause 4's risk and ticked "I understand"; withdrawing it stops every check.
- **The client** is guarded:
  - only `GET /rates-room1`;
  - one request at a time, 60 s apart in the background, one shared search per stay and party;
  - nothing on Open Day mornings;
  - a 12-hour cool-down, doubling to 7 days, on any block, challenge or waiting room.
- **The rules and the calendar:** the place page and the watch flow know RIA's booking rules (fixed peak blocks, the 5/3 rule, minimum nights, closures) and the Open Day that opens a stay.
- **Open Day plans** (Site Sniper's `remind` action) remind the person the evening before, at 6 am and at 8:15, with RIA's checklist. They never poll at the release.
- The docs and the website describe Rottnest truthfully, the risk included.

## Task list

| ID | Task | Size | Depends on | Lane | Status |
|---|---|---|---|---|---|
| RI1 | [Rottnest catalogue, links and client](tasks/RI1-catalogue-links-client.md): scaffold; manifest; the seed of 9 precincts and 68 room types (code, group, kind, sleeps, bedrooms); the search link; the client (host, path and query allow-list, block and waiting-room detection, the 12 h → 7 day cool-down, the Open Day morning pause, the shared search); guards | M | — | P | ⬜ |
| RI2 | [Rottnest availability, Explore counts and watches](tasks/RI2-availability-bulk-watches.md): the results-page parser; `availability.check` (whole-stay answers, prices, rates, a party over `data-sleeps` refused); bulk `availability.search` (one search, all precincts, `byKind`); `watches` on at 30 minutes; trimmed fixtures from the stakeholder's capture; e2e fixtures and journeys; the preview | M | RI1 | P | ⬜ |
| RI3 | [Provider notices](tasks/RI3-provider-notices.md): `manifest.notice`; acceptance in `provider_state`; checks, bulk, watch create, activate and runs refused until accepted (`NOTICE_REQUIRED`); the notice dialog in the watch flow, the place page and Explore; Settings → Accounts shows it, with Withdraw | M | RI1 | S, U | ⬜ |
| RI4 | [Stay rules module](tasks/RI4-stay-rules.md): the optional, pure `stayRules.check`; `catalog.stayRules`; watch and snipe create refuse a stay the provider refuses | M | — | S | ⬜ |
| RI5 | [Open Day calendar, booking rules and release policy](tasks/RI5-open-days-rules-release.md): the Open Day rule and its published table; per-month guide data (5/3 suspensions, peak blocks, minimums, closures, events); WA public holidays; Rottnest's `stayRules`; the `open_day` release mode | L | RI1, RI4 | P | ⬜ |
| RI6 | [Rules and release status on the place page and Explore](tasks/RI6-place-explore-rules.md): "Opens Wed 4 Nov, 8:30 am" and the rules for chosen dates, with block suggestions | M | RI4, RI5 | U | ⬜ |
| RI7 | [Reminder snipes: core](tasks/RI7-reminder-snipes-core.md): `remind`, `remindOnly` release modes, `REMINDED`, `release.reminders` and `checklist`, one notification per instant per provider | L | RI4 | S | ⬜ |
| RI8 | [Open Day plan screens](tasks/RI8-open-day-plan-screens.md) | M | RI7, RI6 | U | ⬜ |
| RI9 | [Rottnest Open Day reminders](tasks/RI9-rottnest-reminders.md): the steps (18:00 the day before, 06:00, 08:15), the checklist, a copy guard; `snipes` on | S | RI5, RI7 | P | ⬜ |
| RI10 | [Docs, website and release notes](tasks/RI10-docs-website.md); final gate | M | all | D | ⬜ |
| RI11 | _Later:_ booking deadlines for a recorded Rottnest booking (cooling-off, balance due, fee steps) | M | Bookings out of "Soon" | S, U | — |

**Order:** RI1 → RI2 → RI3, then RI4 → RI5 → RI6, then RI7 → RI8 → RI9, then RI10. Every task keeps the full gate green, updates the CLAUDE.md lines its change makes stale, and weakens no test, lint rule or coverage threshold. **No agent sends a request to any Stay Rottnest host:** samples come from the stakeholder's captures (T7).

## Design decisions

1. **One search, shared.** `GET /rates-room1` answers for every room type on the island. The module keeps one search per stay and party for two minutes (single-flight), and every caller uses it: a place-page check, Explore's bulk search, and every watch. A precinct's check is that search, filtered by `data-group`.
2. **Room types are units, counted as "at least one free".** The page says whether a type is free for the whole stay, never how many of its units. Each type is a unit (`unitId` = its code), `freeCount` 1 when free and 0 when not, and the place page lists them as types (`unitsAreTypes`). So Explore's "4 spots free" means at least four, and no total is given.
3. **Whole-stay answers.** A free type's nights are all `available`, priced only as the stay's `total`. An unavailable type's nights are `unknown` with the label "Unavailable for these dates": a whole-stay "no" can't say which nights. So partial matches never fire for Rottnest, and the watch flow hides them.
4. **The notice is the core's, not the provider's.**
   - The manifest declares it (`notice: { id, version, title, body, points, confirmLabel }`). The core keeps the acceptance (`core.notices` in `provider_state`, which providers can't read), and refuses every check, bulk search and watch run until it is accepted (`NOTICE_REQUIRED`).
   - The renderer asks at the first place it would be needed.
   - Any provider can use it.
5. **The client is the module's single door** (RAC's pattern), with Rottnest's stricter rules:
   - `GET` only, one host, one path, the search's own query fields only;
   - no redirect followed: any redirect is a block, and a waiting-room or challenge redirect is reported so;
   - the cool-down is 12 hours, doubling to 7 days;
   - the Open Day morning pause is decided before anything is sent.
6. **No holds, no experiments, no account.** The manifest declares none, and the client cannot reach the booking step (`/details/`) even if asked.
7. **The app's one browser identity** (§12.32) is used unchanged: no Rottnest-specific headers beyond `Accept: text/html`, and nothing rotated.

## Terms rules → task

From `rottnest-terms.md` §9 (the automated watch) and §6 rules 7–12.

| # | Rule | Task | Test |
|---|---|---|---|
| §9.1 | The person is told and agrees first | RI3 | unaccepted: a watch run, a check and a bulk search send nothing and are refused |
| §9.2 | Notify only; `GET /rates-room1` only | RI1 | client allow-list; manifest |
| §9.3 | 30-minute watches; 60 s background gap; one shared search | RI1, RI2 | pacing and memo tests with a fake clock |
| §9.4 | Quiet on Open Day mornings | RI1 | fake clock on 4 Nov 2026 |
| §9.5 | No evasion; cool-down on any block | RI1 | each block kind; cool-down length and persistence |
| §9.6 | Anonymous | RI1 | no `auth`; the client sends no cookie of its own |
| §9.7 | Facts only | RI1, RI2 | seed and fixture guards |
| §9.9, §6.9 | Open Days are reminders | RI7, RI9 | `remindOnly` mode never checks |
| §6.8 | Booking rules shape suggestions | RI4, RI5, RI6 | rule tests from the guides |
| §6.12 | Independence | RI1, RI10 | site test |

## Out of scope

Holds, carts, bookings, the waiting room or the passcode; any request beyond `GET /rates-room1`; private island operators; third-party watchers' APIs.

## Open questions

| # | Question | Blocks | Default |
|---|---|---|---|
| TQ1 | How does a month not yet released answer? | RI2's reading of it | Every type unavailable: the check marks the stay not released when RI5's calendar says so |
| TQ2 | Does a party bigger than a type's `data-sleeps` hide it, or mark it unavailable? | nothing | The parser refuses it itself |
| TQ3 | Peak blocks after April 2027 aren't published yet | RI5 | A note, no refusal |
| TQ4 | The 14-night maximum: all year or peak only? | RI5 | All year |
| TQ5 | A second capture (an unreleased month, a peak block) would harden the parser | nothing | The stakeholder may add one |

## Changelog

- 2026-10-17: first plan (links-only).
- 2026-10-18: replanned after the stakeholder's decisions T1–T7 and the HAR.
