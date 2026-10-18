# Rottnest: master plan

**Stream:** rottnest · **Label:** `stream:rottnest` · **Lanes:** S (shared types, core, IPC), U (renderer), P (Rottnest module), D (docs) · **Status:** ⬜ planned, not started

**Waiting on:**
1. PR #68 (RAC) merging. This plan builds on its alert snipes (R12), booking links (R7), release calendar pattern (R14), unit nouns (R9) and stay types (R1).
2. The stakeholder's decisions T1–T7 (`brief-draft.md`).

No code is written before both.

## Goal

Rottnest Island, booked through Stay Rottnest (RIA), becomes WA Stay's third provider and its first **links-only** provider: **WA Stay never sends a request to Stay Rottnest** (`ai-state/research/rottnest-terms.md`, rule 1). When the stream is done:

- **Explore** shows the island's precincts with their unit types (beds, occupancy, check-in times). Instead of free counts it says "Check on Stay Rottnest". For chosen dates it says whether they are on sale or which Open Day opens them.
- **A place page** shows the rules for the chosen stay: fixed peak blocks, minimum nights, the 5/3 rule, closures and occupancy. It says whether RIA would accept the stay, and "Search on Stay Rottnest" opens the search in the browser.
- **Open Day plans** (Site Sniper, the new `remind` action) are the compliant form of the "snatch". For a stay that is not on sale yet, WA Stay names its Open Day, checks the stay against the rules, and reminds the person:
  - the evening before;
  - at 6:00 (the waiting room opens);
  - at 8:15 (join before 8:30 for a random place).

  Each reminder carries RIA's checklist, and one click opens Stay Rottnest. Nothing polls: Queue-it gives everyone a random place before 8:30, so speed buys nothing, and **readiness** is the edge.
- **Look reminders** (Watches, reminder mode) are the compliant form of the cancellation watch. For a stay that is on sale but booked out, WA Stay reminds the person to look:
  - at the moments cancellations are likely, from RIA's own fee and payment rules: the end of the 14-day cooling-off after its Open Day; around the balance due 30 days before arrival, when unpaid bookings are cancelled; and just before the 48-hour step;
  - at a cadence the person chooses.

  One click opens the search. The watch ends when the person says they booked, or the dates pass.
- **Nothing holds, carts, books or reads availability on Stay Rottnest.** The registry refuses those capabilities for a links-only provider, and its HTTP client refuses every request.
- The docs and the website describe Rottnest truthfully: reminders and links, not availability.

## How the requested features map

| Asked for | ParkStay / RAC today | Rottnest | Why |
| --- | --- | --- | --- |
| Explore, map, place page | Yes, with availability | Yes, **without** availability: unit types, rules, release status, links | Reading availability is "web scraping" / "rate shopping" (terms §3.4) |
| Watch: notify on a cancellation | Polls, alerts | **Look reminders** at cancellation hotspots; the person looks | A polled alert "assists" the booking (terms §3.2) |
| Watch: grab (auto-hold) | ParkStay holds; RAC auto-cart experiment | **Never** | "bookings may not be made ... by automated software" |
| Site Sniper ("snatch") | ParkStay holds at release; RAC alerts at release | **Open Day plans**: rules check, Open Day, reminders at 18:00 / 06:00 / 08:15, checklist, one-click open | The random queue removes the timing edge; the SMS passcode and the clause remove automation |
| Queue handling | ParkStay automates the DBCA queue | **Never**; coaching only | "mimic human behaviour to gain unauthorized access" (terms §5 (h)) |
| Accounts | ParkStay sign-in, RAC member number | **None**; the person signs in on Stay Rottnest in their browser | A saved session would only serve requests WA Stay doesn't make |
| Bookings | Manual entry, ParkStay import | Manual entry; **deadline reminders later** (RI12) | Bookings is still "Soon" |
| A real automated watch | — | **Only with RIA's written consent** (RI13) | Terms review §7, option B |

## Task list

| ID | Task | Size | Depends on | Lane |
|---|---|---|---|---|
| RI1 | [Links-only providers](tasks/RI1-links-only-providers.md): `integration: 'links'`; manifest rules (no availability, holds, import, access gate, account or experiments); a refusing `ctx.http` and browser, in fixture mode too; contract-suite checks; architecture-notes §12.36; the guide's "Links-only providers" | M | PR #68 | S |
| RI2 | [Stay rules module](tasks/RI2-stay-rules-module.md): the optional `stayRules.check` (pure, no request): a verdict with a reason and field, notes and release status; `catalog.stayRules` IPC; watch and snipe create and update refuse a stay the provider refuses (`VALIDATION` on `stay`) | M | RI1 | S |
| RI3 | [Rottnest catalogue and links](tasks/RI3-rottnest-catalogue-links.md): scaffold; manifest; the precinct and unit-type seed (facts by hand: lat/lng, kinds, beds, occupancy, check-in times); links (precinct page, search with dates and guests, booking guide PDF, never a checkout); seed and host guards; Explore and place page in fixture mode with an empty request log | M | RI1 | P |
| RI4 | [Open Day calendar, booking rules and release policy](tasks/RI4-open-days-rules-release.md): the Open Day rule plus its published table and exceptions; per-month guide data (5/3 suspensions, peak fixed blocks per precinct group, three-night minimums, event weekends, closures); WA public holidays; `stayRules.check`; `open_day` release mode; fake-clock tests over the 54 known Open Days | L | RI2, RI3 | P |
| RI5 | [Place page and Explore for links-only providers](tasks/RI5-place-explore-links-only.md): release status ("On sale" or "Opens Wed 4 Nov, 8:30 am") and rule notes for chosen dates; "Search on {shortName}"; "Check on {shortName}" on cards; the create-flow prefill to a plan or reminder | M | RI2, RI4 | U |
| RI6 | [Reminder snipes: core](tasks/RI6-reminder-snipes-core.md): `SnipeAction 'remind'`; `REMINDED`; `release.reminders` and `release.checklist`; the registry rule "snipes needs availability, unless links-only"; a reminder chain with no check, no hold and no night guard; `snipe_reminder` notifications, one per instant per provider; §12.36 | L | RI1, RI2 | S |
| RI7 | [Open Day plan screens](tasks/RI7-open-day-plan-screens.md): Site Sniper's flow for a links-only provider ("Plan for Open Day"); stay step with rules inline and a peak-block picker; release and reminder preview; the plan page with countdown, checklist and "Open Stay Rottnest"; plans grouped by Open Day | M | RI6, RI5 | U |
| RI8 | [Reminder watches: core](tasks/RI8-reminder-watches-core.md): reminder mode for links-only providers; the `reminders.next` module; cadence plus hotspots, with quiet hours; `watch_reminder` notifications; `watches.recordLook` ("Nothing yet", "I booked it"); a stay not yet on sale points to an Open Day plan; §12.36 | L | RI1, RI2 | S |
| RI9 | [Look reminder screens](tasks/RI9-look-reminder-screens.md): the watch flow's reminder mode (cadence, hotspot preview); the watch page's reminder timeline, "Nothing yet" / "I booked it", "Search on {shortName}"; the list's "Next reminder" | M | RI8, RI5 | U |
| RI10 | [Rottnest reminders](tasks/RI10-rottnest-reminders.md): Open Day steps (18:00 the day before, 06:00, 08:15) and checklist copy; cancellation hotspots (cooling-off end after the stay's Open Day; days 31–29 before arrival; days 4–2 before arrival), each with its reason; a copy guard (no "free", "found", "held", "multiple devices") | M | RI4, RI6, RI8 | P |
| RI11 | [Docs, website and release notes](tasks/RI11-docs-website.md): `docs/providers/rottnest/` (README, Open Day calendar upkeep, rules), the guide's links-only section, feature and security docs, CLAUDE.md, CHANGELOG, the site's row, colour, copy and independence notice; final gate | M | all | D |
| RI12 | _Later:_ Booking deadlines for a recorded Rottnest booking (cooling-off end, balance due, fee steps, keyholder 7 days before) | M | Bookings out of "Soon" | S, U |
| RI13 | _Only with RIA's written consent:_ [checks within its limits](tasks/RI13-checks-with-consent.md) (a check on the person's click, then a notify-only watch). Design notes only | L | RIA's answer (T2) | S, P |

Every task keeps the full gate green, updates the CLAUDE.md lines its change makes stale, and weakens no test, lint rule or coverage threshold. No task sends a request to a Stay Rottnest host, including during development: facts come from public pages and PDFs read in a browser by a person (terms rule 6).

## Recommended order and lanes

```text
PR #68 merged
   │
  RI1 (S) ──┬── RI2 (S) ──┬── RI4 (P) ── RI5 (U) ──┐
            │             │                         │
            ├── RI3 (P) ──┘                         │
            │                                       │
            ├── RI6 (S) ─────────── RI7 (U) ────────┤
            │                                       ├── RI10 (P) ── RI11 (D)
            └── RI8 (S) ─────────── RI9 (U) ────────┘
```

- **Wave 1:** RI1.
- **Wave 2:** RI2, RI3, RI6 and RI8 in parallel. RI6 and RI8 use a fake links-only provider until RI4 lands.
- **Wave 3:** RI4, then RI5 with RI7 and RI9.
- **Wave 4:** RI10, then RI11.

The process is project 2's (RO1): one PR from `ccr-b1b30894-k6djyp`; each task a GitHub issue labelled `ai-planning` and `stream:rottnest`, closed by the PR; lanes in worktrees under `/home/user/lanes/<id>`; adversarial review before each merge.

## Design decisions

1. **One switch: `integration: 'links'`.** The manifest's `integration` field (`'api' | 'browser' | 'hybrid'`) is read nowhere in `src/` today. A fourth value, `'links'`, says the app never contacts the provider.
   - Everything else follows from it in one place: manifest rules refuse the capabilities that need requests, the context gives the provider a client that refuses every request before any I/O, and the watch and snipe services pick their reminder forms.
   - A future provider whose terms forbid automation gets the same treatment by setting one field. This turns `CLAUDE.md`'s "If they forbid automated access, the provider gets links only" into a supported, tested shape rather than a dead end.
2. **Reuse Watches and Site Sniper; don't add features.** Look reminders are watches and Open Day plans are snipes, so the person's mental model, navigation, provider-first flows, lists, notifications, email and booking links all carry over. The mode comes from the provider; there is no new top-level screen.
3. **Rules and calendar are data plus pure functions, shipped in app updates.**
   - The Open Day rule (first Wednesday of M → month M+8, 08:30 Perth; 1 January moves a week) computes the calendar indefinitely. A table records the published dates and exceptions, and when RIA last confirmed them.
   - Peak blocks and per-month exceptions come from each month's booking guide, by hand, as RAC's release calendar does.
   - Unknown months say so rather than guess (T4).
4. **Reminders, not polling, on Open Day.** Arriving at 8:30:00 buys nothing; being in the waiting room before 8:30, with a passcode-ready phone and a plan, buys a fair chance. So the reminders come at 18:00 the day before, 06:00 and 08:15, and the checklist is RIA's own. Nothing at 8:30 itself does anything on the person's behalf.
5. **Cancellation timing from the terms.** "Look" reminders cluster where RIA's own rules release stock. These are inferences from the terms, stated as such in the reminder ("Unpaid bookings for these dates are cancelled about now"):
   - the end of the cooling-off for bookings made on the stay's Open Day (that Open Day + 14 days);
   - the balance-due and fee-step days (arrival − 31 to − 29);
   - the days before the 48-hour step (arrival − 4 to − 2).
6. **The person always clicks.** No Stay Rottnest page is ever opened unasked (terms rule 2). A reminder's desktop click opens the search in the **system browser**, where the person's password manager, card autofill and signed-in session live (T7). Delivering a reminder opens nothing.
7. **Honest copy.** A links-only provider's strings never say free, found, available, held or secured (terms rule 5), and the Open Day copy never suggests extra devices, phone numbers or browsers (rule 9). A copy guard test enforces both.
8. **No migration expected.**
   - `watches.last_result`, `site_snipes.status` and `site_snipes.action` are TEXT with no CHECK; notification types are validated in code.
   - The reminder cadence uses `check_interval_minutes`: 720 or 1440, or 0 for "hotspots only", which the repository accepts for reminder watches only.
   - If a column proves necessary, RI8 adds v13.

## Contract additions

Recorded in `ai-state/architecture-notes.md` §12.36 "Links-only providers" (created by RI1, extended by RI2, RI6 and RI8).

| Addition | Task | Shape |
| --- | --- | --- |
| `ProviderManifest.integration: 'links'` | RI1 | Manifest rules: `availability`, `bulkAvailability`, `holds`, `bookingImport` and `accessGate` all false; `account: 'none'`; no `experiments`; no `minRequestIntervalMs`; no release mode `usesAccessGate` |
| Refusing context | RI1 | For `'links'`, `ctx.http` rejects every request with `ProviderPolicyError` ("WA Stay doesn't contact {name}") before any I/O, also in fixture mode; `ctx.browser` refuses to launch |
| `StayRulesModule` | RI2 | `stayRules.check({ externalId, stay, unitIds?, unitKinds?, now }) → { ok: true, notes, release? } \| { ok: false, reason, field: 'arrival' \| 'departure' \| 'guests' \| 'units', notes, release? }`; `release` is `{ open: boolean; opensAt?: Date; text }`. Pure, no request; optional for any provider |
| `catalog.stayRules` | RI2 | IPC `({ key, stay, unitIds?, unitKinds? })` → the verdict, or `CAPABILITY` without the module |
| Snipes without availability | RI6 | `FLAG_RULES` "snipes needs availability" becomes "unless `integration: 'links'`"; a links-only provider's snipes need `release.reminders` |
| `SnipeAction 'remind'`, `SnipeStatus.REMINDED`, `NotificationType.SNIPE_REMINDER` | RI6 | `remind` is the default and only action for a links-only provider (`VALIDATION` on `action` otherwise). It never checks, holds or reserves a night |
| `ReleasePolicy.reminders?`, `ReleasePolicy.checklist?` | RI6 | `reminders({ releaseAt, externalId, stay, now }) → ReminderStep[]` (`{ at, title, body, reason? }`, provider copy); `checklist(externalId) → string[]` |
| `RemindersModule` | RI8 | `reminders.next({ externalId, stay, unitIds?, unitKinds?, after, cadence: 'hotspots' \| 'daily' \| 'twice-daily' }) → ReminderStep \| null`. A links-only provider with `watches` must have it |
| `WatchResult.REMINDED`, `NotificationType.WATCH_REMINDER`, `watches.recordLook` | RI8 | `recordLook({ id, outcome: 'nothing-yet' \| 'booked' })`: `booked` ends the watch (inactive, BOOKED, no hold) |

## Terms rules → task

From `ai-state/research/rottnest-terms.md` §6.

| # | Rule | Enforced in | Test |
| --- | --- | --- | --- |
| 1 | No request to Stay Rottnest | RI1 (refusing client, manifest rules), RI3 (source guard; host only in `links.ts`) | refusing-client unit test; registry tests; an e2e journey with Rottnest registered whose request log has no Stay Rottnest host |
| 2 | The person opens every page | RI6, RI8 (delivery opens nothing), RI5, RI7, RI9 (buttons and clicks only) | notification tests: delivery calls no shell opener; the click does |
| 3 | No automated booking | RI1 (manifest rules), RI3 (manifest test) | registry and manifest tests |
| 4 | No evasion | RI1 (nothing is sent); RI13 if ever | — |
| 5 | No claims the app can't know | RI6, RI8, RI10 | copy guard over links-only notification and reminder strings |
| 6 | Facts by hand, shipped with the app | RI3, RI4 (seed and calendar headers name their sources) | seed guard: no image URLs, no copied descriptions |
| 7 | Personal, non-commercial | RI11 (docs, site copy); nothing shares bookings | — |
| 8 | Booking rules shape suggestions | RI2, RI4, RI7, RI9 | rule tests from the guides' own examples |
| 9 | Fair Open Day coaching | RI10 (checklist copy) | copy guard ("devices", "numbers", "browsers" never suggested) |
| 10 | Never cancel or change a booking | RI1 (`bookingImport` off), RI12 (reminders only) | manifest test |
| 11 | Only book what you need | RI7 (no "book both" flows), RI10 (copy) | copy guard |
| 12 | Independence | RI3 (monogram, colour), RI11 (site notice) | site test (row against manifest) |
| 13 | Permission changes rules only through a review | RI13, process | — |

## Brief success criteria → task

| # | Criterion | Tasks |
| --- | --- | --- |
| 1 | Explore and the place page | RI3, RI4, RI5 |
| 2 | Open Day plans: right Open Day, rules, reminders on time | RI4, RI6, RI7, RI10 |
| 3 | Look reminders: hotspots, cadence, honest copy, stop on booked | RI8, RI9, RI10 |
| 4 | No request to any Stay Rottnest host | RI1, RI3 |
| 5 | Terms rules enforced | all (table above) |
| 6 | Full gate | every task; RI11 final |
| 7 | Docs and website truthful | RI11 |

## Integration points with PR #68

- **R7 booking links:** a reminder carries `links.booking(externalId, stay, unitId)` exactly as an alert does: https on the provider's site (`isProviderBookingLink` strips `www.` and accepts subdomains, so `bookings.stayrottnest.com` qualifies). The desktop click opens it; the email says "Search on {shortName}".
- **R12 alert snipes:** `remind` sits beside `alert` and `hold`; `REMINDED` beside `ALERTED`. The `action` column and the defaults logic (`holdsOf`) are extended, not replaced.
- **R14 release calendar:** the Open Day calendar follows its pattern (facts only, a dated table, an upkeep page, a header naming sources).
- **R1 and R9 stay types and unit nouns:** villas, cottages, bungalows and cabins → `cabin`; Kingstown dormitory rooms and hostel bunks → `dorm`; hostel family rooms → `room`; campground sites → `campsite`. The noun helper gives "cabin", "site", "bed", or "spot" for mixed precincts.
- **R17 experiments:** refused for links-only providers (RI1).

## Out of scope

- Any request to Stay Rottnest (RI13 needs RIA's consent first).
- Holds, carts, bookings, the waiting room and the SMS passcode, ever.
- Private island operators; ferries; activities.
- RottoWatch's and Quokka Watch's APIs (terms §7, option D).
- Reading the page the person has open (terms §5: avoid).

## Open questions

| # | Question | Blocks | Default |
|---|---|---|---|
| T1–T7 | Stakeholder decisions | everything | `brief-draft.md` |
| TQ1 | The search page's deep link: does `bookings.stayrottnest.com/search-rates` take dates, guests and location in its URL, and with what names and date format? The research could not see it: the site challenged the third request, and the archives were unreachable (`rottnest-booking-flow.md` §4, §10) | RI3's `links.booking` | **The stakeholder looks in a normal browser**: run one search on stayrottnest.com and copy the address bar. Until then, `links.booking` is the bare search page, and WA Stay shows the dates, guests and precinct beside the button, with a Copy button |
| TQ7 | Stay Rottnest's Privacy Statement and any separate Terms of Use were not retrieved (Cloudflare) | RI3 shipping | The stakeholder reads them in a browser and pastes any linking, framing or copyright clause into `rottnest-terms.md` §2 |
| TQ2 | Peak fixed blocks after the April 2027 school holidays are not published yet (each guide comes 1–3 weeks before its Open Day; the peak guides earlier) | RI4 for later peaks | "RIA hasn't published the blocks for these dates yet": no refusal, a note, and a link to the booking guide |
| TQ3 | When do cancelled stays reappear online: at once, or after staff process the email? | RI10's hotspot hours | Morning reminders (07:00) on hotspot days; never more than 2 a day |
| TQ4 | The 14-night maximum: all year or peak only? The guides differ | RI4 | Apply it all year, as the latest guides state |
| TQ5 | Should the Open Day calendar beyond the published table be shown as "expected" (from the rule)? | RI4, RI5 | Yes, labelled "expected"; `CALENDAR_CONFIRMED_UNTIL` marks the published end |
| TQ6 | Reminder emails: send them by default for links-only reminders, or desktop only? | RI8 | As alerts today: email when a notifier is set up |

## Changelog

- 2026-10-17: planned from the four research files; waiting on PR #68 and T1–T7.
