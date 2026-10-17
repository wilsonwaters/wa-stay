# Project Progress — WA Stay

_Last updated: 2026-10-16 (orchestrator)_

# Project 2 — RAC Parks & Resorts provider

Branch `ccr-573ddb1d-hir0sq` (from `main` at `4bd5d62`, the v2.0.0 release). The brief is the Project 2 section of `ai-state/brief.md`.

## Phase
Phase 3–4 (task specs, then execution). The stakeholder approved the 20-task plan and decided R6–R8 (alert clicks for every provider, a phone booking link in alert emails, interactive pacing).

## Currently in flight
- **R17 (#64)**: review REQUEST_CHANGES (a hold in flight slipped past the turn-off guard); the implementer is fixing on `lane/r17`.
- **R13 (#60)** and **R14 (#61)**: implementation agents in `/home/user/lanes/r13` and `r14` (at `348d6d2`).
- Next: R16 (after R11, R13, R14, R15), R18 (after R12, R17), R19, R20.

## Completed
- **R11 (#58) merged**: RAC bulk availability on Explore (one interactive POST per park; "51 spots free", no "of M"; `bookableUnits` optional end to end; "Still checking RAC…"; a newer search cancels the older one's waiting POSTs but lets a sent one finish, via a new SDK `HttpRequestOptions.onSend`); bulk agrees with the per-park check on every fixture; every park's fixture now a real recording (7 anonymous POSTs on 17 Oct 2026, ≥12 s apart). Review REQUEST_CHANGES (party refusals counted bookable; overlapping requests on RAC's server) → fixes `ba2e798`, `6e3e378` → APPROVE. Gate: 5161 tests, e2e 25, RAC preview passed.
- **R12 (#59) merged** (`348d6d2`): snipes without holds; per-snipe `action` (`alert` | `hold`, default `hold`) and `alert` (v12, plus `hold_expires_estimated` for R18); `ALERTED` reserves no night; an alert notification and email with the public booking link; `maxWindowMinutes`; a 403/429 ends a snipe FAILED for every provider; §12.35 catch-up for R1–R9. Review APPROVE (minors routed to R13/R14). Gate: 5085 tests, e2e 24.
- 2026-10-17 ~07:00–08:10 UTC: a second account usage limit stopped the R11 implementer, the R12 reviewer and the R17 fixer (R17 review: REQUEST_CHANGES — a hold in flight slipped past the turn-off guard); all resumed after the reset.
- Integration gate on `cf154cb` (R1–R10, R15): lint 0 errors, format clean, 5002 tests + 6 skipped, test:tz 7, e2e 24 passed + 2 opt-in skipped (incl. the RAC watch journey).
- **R9 (#56) merged** (`cf154cb`): one noun helper (`src/shared/utils/unit-noun.ts`) for sites, cabins, rooms, dorm beds, glamping and "spots" at mixed places; no hard-coded "site" in notifications, services or flows (a guard test); copy fixes routed from the R3, R5 and R6 reviews (provider-neutral empty states, hold-rule wording, link notices). Review APPROVE; fixes `5c199e9`, `cd0c598`; merged R10 cleanly. ParkStay copy unchanged. Gate: 4947 tests, e2e 24.
- **R15 (#62) merged** (`d6e36af`): the `credentials` sign-in kind — write-only `accounts.saveCredentials` with confirmations checked in main, `accounts.copyCredential` (main writes the clipboard), values sealed in the provider's vault, a generic Settings → Accounts form, `onCredentialsChanged`, and `signIn` may return normalised values (digits only for RAC). §12.35 created. Security review APPROVE; fix `4918f04` (payload caps, no close while saving, leak test before sign-out, normalised values). Gate: 4817 tests, e2e 23.
- **R10 (#57) merged** (`5d61de1`): RAC availability per park (one paced POST), category units with per-night prices, codes mapped to available/booked/closed/split/not-released, stay rules from tariffs on every night, member tariffs ignored until R16, `bookingUrl` = RAC's `online_booking_url` (verified live with one anonymous GET: empty cart), watches on, block cool-down honouring `Retry-After` and doubling to 24 h, a hardened fixture guard, an RAC watch e2e journey (24). Live: 1 GET + 3 availability POSTs. Review REQUEST_CHANGES (code 2 marked sold-out categories "closed as of 2010") → fix `87904fb` → APPROVE. **RAC cancellation watches work end to end in fixture mode.**
- **R8 (#55) merged**: stay rules (`min-stay` night reason; `minNights` per night and per unit; `noArrival`/`noDeparture`; `priceNote`), matching that trims or drops runs a provider would refuse, night-grid notes and key, stay-step warnings, a contract check that a refused stay has no free night. Review APPROVE (38 matching probes across time zones); fixes `82a98f1`, `a6ecf76` (contract uses core's effective minimum; found card counts as the grid does). Gate: 4762 tests, e2e 23.
- **R7 (#54) merged** (`01971e3`): a found or partial alert's click opens the watch then the provider's booking page (every provider); a held alert opens the watch only; emails carry a public "Book on {shortName}" link (HTML and text, never a cart URL; a held email says the hold is in the app); link checks (https, the provider's own site) in core and again in `notify`; `links.booking(…, unitId?)`. Review REQUEST_CHANGES → fix `b619fd1` (a location edit forgets the last check; quiet read path; scaffold site check; malformed rows) → APPROVE. Follow-ups (nits): a check already running when the location changes can write the old result back (fix: cancel the watch's in-flight check on a location change); `last_error`/`found_count` survive a location change. A separate pre-existing issue was suggested to the stakeholder as a task: a held watch can still be edited.
- Integration gate on R1–R6 (`71db261`): lint 0 errors, format clean, 4569 tests + 6 skipped, test:tz 7, e2e 23 passed + 2 opt-in skipped.
- 2026-10-17 ~02:00–03:10 UTC: an account usage limit stopped the R7 fix and R8 agents; both resumed from their saved worktrees after the reset.
- **R5 (#52) merged** (`71db261`): the RAC module (`src/main/providers/rac/`): eight-park seed, book-now page parser, categories as units with stay types, place detail, links (no cart), a host-locked client with Cloudflare/403/429 block handling (a 30-minute stop, no retry loop), trimmed fixtures with a guard, one e2e journey (23). 0 live requests. Review APPROVE; minors forwarded to R10 and R9.
- **R6 (#53) merged** (`9328ab9`): stay-type chips on the watch and snipe stay steps at mixed places, UnitPicker grouped by kind, `stay=` prefill checked against the place, a stay type or unit needed to hold at a mixed place; `unitKindOfUnit` moved to `src/shared/utils/unit-kinds.ts`. Review APPROVE; fix `0940ce3` (Edit keeps stored stay types as chips so focus isn't lost). Copy notes forwarded to R9. Gate: 4350 tests.
- **R2 (#49) merged** (`3a28271`): `limits.minRequestIntervalMs`, a paced client (one in flight; interactive 1 s gap, background at the provider's interval), core-set priority (place page, Explore, "Check now" interactive; due loop and sync background), deadlines grown with pacing, unpaced fixture mode, form-field fixture routes. Review REQUEST_CHANGES (a FIFO module limiter put interactive requests last) → fix `443629f` (limiters start interactive tasks first; sync-deadline tests; field names only in fixture errors) → APPROVE. Side effect accepted: ParkStay's limiter also lets person-triggered requests go first.
- Cluster check after R1+R3+R4: full suite 4277 passed + 6 skipped.
- **R4 (#51) merged** (`4d32817`): Explore "Stay type" chip replaces "Type", `stay=` param, free counts per stay type (`byKind`, else "Check dates"), prefill `&stay=`. Review APPROVE (nits: stale results briefly read "Check dates" while a new search loads; `%2C` re-encoding on the place page). Follow-ups: R20 retakes `docs/images/explore.png` with a Mapbox token; R11 must carry an unknown `bookableUnits` through `deriveAvailability`.
- **R3 (#50) merged** (`3563100`): `unitKinds` on watches and snipes (types, contracts, repositories), matching by ids > kinds > all, no automatic hold across stay types. Review APPROVE; fix `4e51842` (fixtures typed, docs wording). Notes for R6: remove the docs' "does not offer stay types yet" phrases (`docs/watches-and-notifications.md`, `docs/site-sniper.md`); consider moving `unitKindOfUnit` (`core/watches/matching.ts`) into `src/shared/utils/unit-kinds.ts` so the renderer's "mixed" rule can't drift.
- **R1 (#48) merged** (`8455c07`): unit kinds, five stay types, migration v11, catalogue filter and facet, ParkStay mapping. Commits `924ea34`, `d95b5ec`, review fix `6084c96` (bunk word boundary). Review APPROVE, nits only (read/filter mismatch on hand-edited rows; v11 backfill uses the live table). Gate: 4203 tests, test:tz 7, e2e 22.
- 2026-10-16: kickoff research, three parallel read-only agents.
  - `ai-state/research/rac-booking-flow.md` (63 anonymous requests; samples in `ai-state/research/rac-samples/`):
    - NewBook behind Cloudflare;
    - plain-HTTP availability per park with `X-Requested-With`;
    - a 364-day window rolling at midnight Perth;
    - school holidays released on fixed dates, 48 h earlier for members;
    - category inventory, no queue;
    - opening `online_cart_url` creates a cart.
  - `ai-state/research/rac-terms.md` (31 requests): not links-only; personal non-commercial use; 10 s crawl delay; 16 rules.
  - `ai-state/research/rac-sdk-gaps.md`: watches need only the module; changes for stay types, member number, minimum stay and release alerts.
- 2026-10-16: the stakeholder decided R1–R5 (brief). Brief written.
- 2026-10-16: master plan (`ai-state/streams/rac/master-plan.md`, R1–R20, lanes S/U/P) approved; decisions R6–R8. 20 specs written by four parallel agents, reconciled (decisions D-a…D-l), filed as issues #48–#67. Baseline gate recorded in RUNBOOK (the true unit baseline is 4128 + 6 skipped once Electron's binary is installed).
- 2026-10-16: stakeholder decided RS1 (Experimental switch for everyone, off), RS10/RS11 (as proposed), RS12 (**free units only**, no total), RS13 (digits only; never use real numbers in tests or docs).

## Next
1. Review the master plan, then spec-writing agents (parallel), then GitHub issues (`ai-planning`, `stream:rac`).
2. Execution loop per the plan's lanes.

## Environment notes
- Node 24 is linked into `/root/.local/bin` (the container's default is Node 22); `npm ci` is done.
- Commits are authored as the stakeholder (`git config` set locally in the repo), with no tool attribution (D1).

---

# Project 1 — WA Stay 2.0 (complete)

## Phase
Post-PR follow-ups on PR #42 (open, `ccr-da6e94c0-litpr7` → `main`, repo `wilsonwaters/wa-stay`). Phase 6 is done: the final review fixes are merged and the PR is open. The stakeholder asked for CI fixes, Node 24, hardening, dependency upgrades and developer-experience fixes on the same PR.

## Currently in flight
- **ParkStay details round** (the stakeholder's Windows testing, 2026-10-11). Parallel agents allowed again (stakeholder, 2026-10-11 after the quota reset; earlier: series only).
  - **Research:** done, in `ai-state/research/parkstay-details.md`.
    - "View on ParkStay" fails because ParkStay's campground page refuses requests without its `Referer`. The fix is the information page with `campground_id`.
    - Per-site details are already in the availability view.
    - The About shows a legacy description whose "not available" strike-through our sanitiser drops (a real bug: Bungarra shows pets and campfires as allowed).
    - The detailed sections and notices exist only in the campground page's HTML.
    - The map PDF path is in the availability view; the PDF is public, with `X-Frame-Options: DENY`.
  - **Specs, in order:**
    1. PD1: links, per-site details, the About bug.
    2. PD2: sections and notices in an accordion (one page GET per campground per 6 h).
    3. PD3: the campground map in a sandboxed document window.

    All are in `ai-state/streams/providers/tasks/`.
  - **PD1 is merged:** `e98457f`, review fix `249ea90`. Review APPROVE.
    - The minor finding is fixed: a unit without details keeps its old heading width. The test compares `outerHTML` and fails without the fix.
    - Gate: 4006 tests; e2e 21 passed (the review's run).
    - The `wip/pd1-parkstay-details` backup can be deleted.
  - **PD2 is merged:** `76ccfdf`, review fixes `e9e916d`. Review APPROVE.
    - The minor finding is fixed: the sanitiser maps `b`→`strong` and `i`→`em`.
    - The README terms line now says the page request goes with the app's ParkStay session.
    - Open nit for the stakeholder: Bungarra's 11 notices take about 290 px above the accordion.
    - Gate: 4045 tests; e2e 21 passed (the review's run).
    - The `wip/pd2-campground-sections` backup can be deleted.
  - **PD3 is merged:** `66208db`, review fixes `aa3646a`. Review APPROVE: the reviewer's own Electron probes refused PDF links, new windows, PDF JavaScript and form submits, and allowed only the document as a download.
    - The four nits are fixed:
      - the fixture guard matches http/https only;
      - loopback http is test-only;
      - an `onBeforeRequest` allow-list on the document partition, logging origins only;
      - a live test clicks a real PDF link annotation.
    - Gate: 4102 tests; e2e 22 passed; `test:electron` 4/4.
    - The `wip/pd3-campground-map` backup can be deleted.
  - **All three stakeholder findings are done (PD1–PD3), plus the notices toggle (PD4).**
  - **Also merged:** `8b089c3`. The macOS unit tests run Jest with `node --no-sparkplug`. The crash report showed a V8 GC fault (EXC_BAD_ACCESS in `ClearStaleLeftTrimmedPointerVisitor`, from a Sparkplug baseline prologue's stack check) on Node 24.21.0 darwin-arm64 only.
  - **Also merged:** `9a44593`. IconButton's required label is now checked by `tsc` (`IconButton.type-test.tsx`) rather than a TypeScript program in Jest, after the macOS SIGSEGV in that test twice (`10512b5`, `6921509`). The crash-report upload paths are widened, since no report was found.
  - **PD4 is merged:** `77a5d52`, review fix `6c89bdf`. Review APPROVE.
    - What it does: 3 notices shown, ordered warning, then caution, then info, with "Show all N notices" for the rest. Bungarra's row drops from about 280 px to 104 px.
    - The minor finding is fixed: a collapsed test on an unsorted list.
    - Bungarra's seasonal-closure caution sits behind the toggle (the reviewer advises keeping the rule; closed nights show in the night grid). A possible follow-up names the hidden cautions in the button.
  - **Queue endpoint: out of this PR** (stakeholder, 2026-10-11). Tracked as the bug issue [#43](https://github.com/wilsonwaters/wa-stay/issues/43). A read-only research agent is still running; its findings go to #43 as a comment, never into this PR.
  - **Also merged:** `e18a6e7`, the Explore map test now waits for the map's data. It raced on macOS at `249ea90`.
  - **Open for the stakeholder:**
    - PD2 reads ParkStay's public page HTML, so DBCA's terms for reusing page content are unknown.
    - The queue endpoint change is noted as a follow-up under "Next to dispatch".
- PR #42 is green on `af83d28`. The safety-net check-in is cancelled while paused; re-arm it on resume.

## Notes
- 2026-10-10 ~04:30 UTC: a third usage limit stopped U4 (final gate), U2 (gate), the U3 fix and the E3 fix; all resumed at 06:25 UTC from saved state (U4 `28f3e40` and U2 `cd243b0` backed up to `wip/*`).
- 2026-10-09 23:45 UTC: standing stakeholder permission to back up in-progress lanes to GitHub `wip/*` branches at each checkpoint (the git proxy refuses deletes; the stakeholder deletes merged ones). Current: `wip/u1-watches`, `wip/v3-class-listed` (plus merged `wip/v4-core-scheduler`, `wip/v6-accounts-phase1`, `wip/e1-explore`, deletable). Multiple agents in parallel approved.
- 2026-10-09 ~19:30 UTC: a second account usage limit stopped the U1 review and the V3 follow-up 2 fix; both resumed at 23:40 UTC from their saved state (lane/x wip `67c7964`).
- 2026-10-09: the stakeholder resumed. V4 and E1 rebased onto `47ceaf1` (`a14dfe3`, `16bc8c4`; wip backups updated); V4 and E1 reviews running in parallel (two agents at a time to pace quota).
- 2026-10-04 11:45 UTC: the stakeholder paused new agent work to save quota. Running agents finish their current step; no reviews, merges or new dispatches until the stakeholder resumes. Next on resume: review V4 → merge → V6 phase 2 → review V6; review E1 (merge needs a rebase onto V4/V6 changes); then P7, U1, U3, U5, E2, E3, U2, U4, Q1 phase 2 review, Q2. All work is committed on lanes; nothing is running. Unmerged lanes are backed up on GitHub (stakeholder-approved): `wip/v4-core-scheduler` (lane/w, `41001c1`), `wip/v6-accounts-phase1` (lane/a, `037468f`), `wip/e1-explore` (lane/r, `8405824`). On a fresh container: `git fetch origin wip/...` and recreate the lanes from them. Delete each wip branch once its work is merged.
- 2026-10-04: V4's live sanity run placed a real anonymous hold (#2072968, Bungarra site 02, 3–5 Nov 2026; lapsed unpaid 12:04 UTC). New hard rule §12.33: no live holds in any run; added to both agent contracts.
- 2026-10-04 ~10:30 UTC: an account usage limit stopped all agents; resumed at 10:55 from their saved lanes (pre-rebase work pinned as `backup/e1-pre-rebase` and `backup/v4-pre-rebase`, local only).

## Completed
- **DX5** Validation follow-ups (`2a83dbd`..`49c7589`, review follow-ups `fea81aa`).
  - **Settings → Accounts wording** follows `snipes`, `holds` and `watches`, and "No account needed" shows once.
  - **The example API provider** sends every request through its limiter.
  - **Docs:**
    - `BulkAvailabilityEntry` is documented, on the type and in the guide;
    - the guide's tables of location kinds, stay-field types and bulk fields are checked against the code;
    - a contract-suite coverage table;
    - the signed-in check's e2e fixture route;
    - why there are two fixture manifests.
  - **Browser preview:** `tests/utils/fake-site.ts` and `scripts/serve-provider-site.mjs` serve a browser provider's `site.ts` on loopback. The preview recipe (a temporary loopback address and `WA_STAY_BROWSER_PATH`) is proven end to end with no TLS weakening.
  - **The preview spec:**
    - sets dates (`PREVIEW_ARRIVAL`, default tomorrow);
    - checks Explore's counts and "Check availability";
    - fails on any request fixture mode refused;
    - warns when every night reads Unknown.
  - **Guards:** `tests/unit/providers/no-loopback-addresses.test.ts` means no provider can ship a loopback address.
  - **Windows:** the scaffold's rollback fix (`5c56c76`).
  - **Review:** APPROVE. The minors were fixed in `fea81aa`.
  - **Gate:** 3985 tests, `test:tz`, and e2e with 21 passed.
- **DX4** Provider scaffold, agent checklist and guide (`1e048cf`, review follow-ups `3726435`).
  - **Scaffold:** `npm run provider:new -- <id> [--api|--browser] [--search] [--name] [--no-register]` (`scripts/new-provider.mjs`, templates in `scripts/templates/provider/`). Every variant passes the full gate and e2e as generated. Placeholder addresses fail loudly and nothing is sent.
  - **Checklist:** CLAUDE.md "Adding a provider", `.claude/commands/add-provider.md`, and `AGENTS.md` pointing to it.
  - **Guide:** a rewrite with a quick start, the four corrections, compiling holds and sign-in examples, core timeouts, fixtures, the fake browser and an opt-in preview spec (`PREVIEW_PROVIDER`); internal references removed.
  - **Review:** REQUEST_CHANGES, then fixed. The timeouts table now covers the 15 s sign-in check and bulk availability's 20 s. The ParkStay docs lose the open-question codes, and the docs test refuses them. The scaffold handles an empty built-in list, exits 1 on a Prettier failure, and undoes its folders on a failed run.
  - **Validation run** (fresh agent, docs only; results in `ai-state/research/provider-dx-review.md`): an API provider was visible in the app in 6 min and green on the full gate in 11.5 min; a browser search-mode provider was green in 12.8 min. 0 unrelated failures (16 before). The browser preview needed improvising → DX5.
- **DX3** Fake browser (`2a76509`): a jsdom `BrowserAutomation` with strict Playwright-like locators that runs page scripts. `createTestProviderContext` refuses a browser unless the test gives one.
- **DX2** Search-mode catalogues in the app (`44f4dbb`, review follow-ups `b9c66ed`):
  - `catalog.searchArea` by snapped map area, optional `searchText`;
  - limits: at most 5 pages, a 20 s deadline, the provider's TTL, a 60 s failure backoff, only the 2 newest area searches keep paging;
  - `pending` on results, `catalog:updated` on new places;
  - Explore and the watch flow's location step work for such providers.
- **DX1** Provider-agnostic tests (`6130011`): `providerFactories` on `createContainer`; the source-only `WA_STAY_PROVIDERS` hook (the e2e harness pins ParkStay); a two-provider container test. Registering a provider breaks no existing test.
- **Provider DX review** (`61e11fd`, `ai-state/research/provider-dx-review.md`): two throwaway providers built from the docs, seven provider types assessed, ten ranked recommendations. The stakeholder approved the first group (DX1–DX4).
- **M3** Tooling (`803c8b1`, Prettier reformat `bf5d405`, test waits `a7d52ed`): TypeScript 6.0 (not 7: typescript-eslint and ts-jest), Vite 8, Jest 30 with jsdom 26, ESLint 10 flat config, React Router 8 (ES modules only, compiled for Jest by esbuild), Prettier 3.9, husky 9.
- **M2** Frameworks (`038b99c`, follow-ups `ae30dc3`): React 19, React Router 7, Tailwind CSS 4 (`@tailwindcss/postcss`), zod 4, react-hook-form 7.89. The token guard learned Tailwind 4's palette and utilities.
- **M1** Platform (`102b196`):
  - Node 24, Electron 44, better-sqlite3 13 (one Node-API binary for Node and Electron; `electron-rebuild` dropped in `2352340`), electron-builder 26;
  - packaged hardening: fuses off for RunAsNode, NODE_OPTIONS and inspect; asar-only with integrity; a permission handler; no client certificates;
  - packaging: one better-sqlite3 binary per platform; Windows exe checks in `build.yml`.
- **CI on Windows and macOS** (`7caccca`, `a51e6a3`, `8024464`, `b182fae`, `6df444a`, `8af2606`, `d643f47`):
  - Windows: file locks, path separators, ES-module transform patterns;
  - Node differences: the emoji guard on Node 20;
  - e2e: focus and date-pick waits; midnight-safe hold labels;
  - CI setup: newest Node 24 patch on every runner (`check-latest`), and Jest recycles grown workers (`workerIdleMemoryLimit`), which fixed a macOS segfault.
  - LICENSE holder is WA Stay. `.blockmap` files are uploaded for differential updates. `npm audit --omit=dev` = 0.
- **Q2** (#41) Documentation (`35d6186` + example-provider tests `1b1c4ec`): README, upgrade guide (password and Gmail OTP do not carry over), accurate CLAUDE.md (migration rules intact), provider developer guide covering API and browser-automation providers with compiling examples registered in tests, verified ParkStay endpoint and auth docs, Gmail docs and stale architecture docs removed, CHANGELOG 2.0.0 [Unreleased], `docs/release-checklist-2.0.md`, `npm run docs:screenshots` (provider photos blocked per brief O8). Tests: example-providers, docs-sync, markdown-links, endpoints-doc. Gate ×3 green (3634) + test:tz. Merged; its independent review is folded into the Phase 6 final review. Open stakeholder decision: `LICENSE` copyright holder still "WA ParkStay Bookings".
- **Final polish batch**: `runsFromSource` for the browser path and provider-window devTools; snipe unit names refresh on `catalog:updated`; one step total across snipe states (Held 4 of 5; cancellation 3 of 4); main rejects a scheduled release on/after check-in (`VALIDATION`, `releaseAt`); retention generation guard; Combobox fits 8 two-line suggestions (≈45 px may still scroll at the absolute minimum window; accepted). Gate ×3 green (3529) + test:tz; e2e 20/20. Merged.
- **Q1 phase 2** (#40) E2E suite: review REQUEST_CHANGES (attribute selectors vs the grep criterion; leftover `test.fail`; Explore dates needed a host network; three journeys missing). Fixed (`ca4eb9f`): `runsFromSource` gate (unpackaged and not in asar) for hooks and the renderer URL, role-based step checks, `forceOnline()` via CDP, Perth dates, all Settings sections walked, persistence via a relaunched watch, CI artifacts `if: always()`, `test:tz` in the release-gating job, new `packaged-smoke` CI job; new journeys place → watch (+ relaunch), held snipe + notification deep link (seeded, payment page blocked, no hold), legacy v5 upgrade. 19/19 ×3 under xvfb and under `unshare -n`. Gate green (3517) + test:tz. Merged. Follow-ups for final polish: `WA_STAY_BROWSER_PATH`/provider-window devTools should use `runsFromSource`; the snipe page should refresh unit names on `catalog:updated`; the packaged-smoke job has only run locally.
- **P7** (#18) Dead code cleanup: review APPROVE (deletions proven unreferenced incl. installer/builder/CI; `npm ls` clean; v10 atomic and safe from v5/v6/v9 and the B3 v1 path; retention bounded, abortable, renderer-proof; Gmail deletion confined to the WA Stay folder (symlink targets and decoys kept); ExploreMap race fix verified under load). Orchestrator fix `988d3ac`: CHANGELOG now tells v1.2.0 upgraders the old folder keeps `gmail-oauth.json` (safe to delete) and how to revoke Google access; retention test typed. Q2 spec and architecture notes amended (Gmail no longer carries over). Merged. Backup `wip/p7-cleanup` deletable.
- **U2** (#36) Site Sniper provider-first: review REQUEST_CHANGES (held cards showed raw `class:117`; one `account:updated` → 27 IPC calls; Run now on stopped snipes; duplicate landmarks). Fixed (`26c71d3`) + rebased onto U3/U4: named held units ("One site - select on arrival is held for you"), one account subscription, Run now only while running, unique hold landmarks, AUTH_REQUIRED opens the connect dialog, visible release errors, "View booking" → `/bookings?q=<ref>`, current-step-only cards; took U3's banner, `PlacePhoto`, U4's `useSignIn`/`useAccountCheck`; `legacy-mapping` deleted; window.api allow-list and token-guard lists now 0/0 (every legacy screen replaced). Gate ×3 green (3504) + test:tz; e2e 16/16. Merged. Polish for the final review: held cards say "Step 4 of 4" but booked "Step 5 of 5"; `LegacyPageFrame` unused; main does not validate a scheduled release against arrival. Backup `wip/u2-snipes` deletable.
- **U4** (#38) Settings and accounts: review APPROVE (security attacks held; password write-only end to end; preferences honoured). Pre-merge fixes (`cc58655`): two columns from a 960 px window (`md`), honest signed-in hint, v1 Start-minimised stored only on Windows/installed, Linux auto-launch disabled with a note (`supported` on `getAutoLaunch`), plain-language SMTP errors, stable sign-in button, About "Technical details" folded. Rebased onto E3+U3 (allow-list max 3, token guard 2). Gate ×3 green (3399) + test:tz; e2e 15/15. Merged. Start minimised on Windows → UQ1. Backup `wip/u4-settings` deletable.
- **U3** (#37) Bookings provider-first: review REQUEST_CHANGES (paid-hold bookings showed the global campsite id as a site number). Fixed (`6f16f36`): hold payments store the unit name (from the watch's last check or the cached catalogue units; `[]` if unknown); only `class:` ids hidden; typed `CONFLICT` for duplicates; https-only manage links; shared `PlacePhoto`/`useCatalogPlaces`/`providerToday` moved to components; perf test warm-up + best of 3; status pill only when not confirmed; hero detail page with check-in/check-out side by side; paired add fields; "Other provider (id)". Orchestrator rebase onto E3 (import conflict), gate green (3264) + test:tz; screenshots checked. Merged. Owns `ComingSoonBanner`. Backup `wip/u3-bookings` deletable.
- **E3** (#34) Date-aware discovery: review REQUEST_CHANGES (leaving Explore mid-pulse crashed: pulse cleanup after `map.remove()`, fakes did not model a removed map; "Fully booked" overstated). Fixed (`787dab4`): controller no-ops after destroy, map removed in the last effect, fakes throw like a removed map, unmount-mid-pulse test; "None free" / "No site free every night"; `bulkAvailabilityStayFields` (ParkStay: dates + gear type) so guest changes make 0 calls; single failure announcement; only pending pills pulse; quiet "Info only" pills; clusters show "N free"; honest key. Also `2338973`: ParkStay bulk counts were inverted (verified against DBCA source and 106 live campgrounds). Gate ×3 green (3173) + test:tz; merged. Follow-up: the E1 `ExploreMap` timing test flakes under heavy load (seen by U3 twice). Backup `wip/e3-dates` deletable.
- **U5** (#39) Notifications and system surfaces: review APPROVE (29 hostile link strings refused; §12.31; no IPC polling). Folded in before merge (`689a29b`): single-place email subjects; every repository timestamp read via `readInstant` (fixed a pre-existing 8 h Perth offset in bookings/watches/snipes/notifiers/users/settings); `npm run test:tz` (Perth-pinned) + CI step; Countdown, tray/popover and `AboutPanel align` nits. Gate ×3 green (3067) + test:tz 6/6. Merged. Created reusable `AboutPanel`, `Countdown`, D2 Card `floating`; fixed D2 Popover focus return. CLAUDE.md "Key components" stale (Q2). Backup `wip/u5-notifications` deletable.
- **U1** (#35) Watches provider-first: review REQUEST_CHANGES (a legacy 5-minute interval blanked "Check every" and blocked Save; Paused included held/booked; stepper/boolean errors hidden; design critique: no photos, tall text cards, flat review). Fixed in `d672fae`: legacy intervals kept as an honest extra option; filters fixed; every stay-field type shows and focuses errors; photo-led cards (4:3 thumbnail from the local catalogue, no provider requests), photo in the create flow and detail header; review grouped Where/When/Who/Alerts; one refetch per Check now; currency from the manifest. Gate green ×3 (2941); e2e 13/13; screenshots checked by the orchestrator. Shared blocks for U2/U3: StepFlow, ProviderPicker, LocationCombobox, stay/{ProviderStayFields, UnitPicker}, useNow, timeFormat, useAccountStatus, `PageHeader media`, `LocationPhoto alt`. Merged. Backup `wip/u1-watches` deletable.
- **V3 follow-up 2** (#21) Class-listed campgrounds: focused review REQUEST_CHANGES (legacy numbered site ids silently never matched; split nights read as "didn't say"; ties hid the longest run). Fixed: one unit per class (`class:<id>`, stable), legacy ids resolve from the view alone (`UnitAvailability.aliases`, `knownUnitIds` check option, core `wantedUnits` honours aliases), holds post `campsite_class` (DBCA refuses a specific site there), `NightStatus.reason: 'split'` with generic NightGrid wording, longer runs win ties, `getLocation(..., { summary })` skips the cold 1.2 MB campground map, 429/408 on `create_booking` → `ProviderHttpError`. The reviewer's legacy-id probe passes; gate green (2770) after the orchestrator rebase. Merged (`99d1708`). Backup `wip/v3-class-listed` deletable.
- **E2** (#33) Location detail: review REQUEST_CHANGES (NightGrid counted unknown/not-released nights as "not free"; hidden cell text made the page scroll sideways). Fixed in `e354116`: counts use only settled nights with honest "didn't say" / "not released yet" summaries (generic `source` prop); scroll region contained and a tab stop only when overflowing; typed `RATE_LIMITED` (contract + `toApiError`, never auto-retried); URL stays clamped to 30 nights and dropped if before today; one-column order card → results → About; "Bookable as 1 site type"; name announced on cold deep link; no refetch on reconnect; gallery photos dropped from the description; provider headings demoted so the highest is h3. Sanitiser verified safe by the reviewer (~50 attacks). Orchestrator rebase + gate green (2716). Merged. CLAUDE.md should list `RATE_LIMITED` (Q2 docs pass).
- **E1** (#32) Explore screen: review REQUEST_CHANGES (flaky camera-URL tests; list narrowed to the old area during a fit; stock map outranked our pins; design critique). Fixed in `b06e97a` + `54fa8bf`: only user moves write `map=`; results narrow only after the user moves the map; POIs/shields/airports hidden, faint sand roads, filled ink pins with white ring; popup styled with app tokens; focus returns to the card; new `Chip` primitive and Button `pill`/`floating`/`inverse` variants (no `!` overrides); softer selected card; default order by distance from map centre (A–Z with number-led names last without a map); "169 places" until the map moves; https-only card photos. Orchestrator rebase onto V4/V6 (shell test conflict resolved), gate green (2583), before/after screenshots checked. Security/politeness confirmed by the reviewer (token build-time only, 1 ParkStay call per session, 0 IPC on pan). Q1 phase-2 Explore journey included. Merged. Follow-ups for E2: replace NotFound at `/places/:providerId/:externalId`; the preview shows only the "PS" monogram, so also show the provider name (§12.9); back/forward that only changes `map=`; lazy 1.9 MB mapbox chunk. Backup `wip/e1-explore` can be deleted on GitHub.
- **V6** (#24) Provider accounts, in-app sign-in and payment: review REQUEST_CHANGES (a window whose first load was blocked or hung never showed; the DBCA queue bounced sign-in/payment to the search page). Fixed in `06f9221`: windows always show or close with `PROVIDER_ERROR`; a window back from the waiting room reloads its target once; `openPayment` runs the access gate first (≤ 60 s); ParkStay payment also needs `PB<ref>` on the page (find-in-page, no script); v9 under `secure_delete` with a VACUUM retry task; `done` set after commit; `unknown` cached 5 s. Gate green (2401); live Electron suite 3/3 files (orchestrator re-ran). Security confirmed by the reviewer: hardening, matcher attacks blocked, no secrets in logs, ciphertext gone after v1→v9. ParkStay `account: optional` (§12.32); PQ1: ParkStay emails a code. Merged. Stakeholder checklist items: real sign-in (code), sign-in surviving a restart, sign-in and payment while the queue is active, anonymous hold → sign in inside payment → basket kept → BOOKED (genuine intent only). Backup `wip/v6-accounts-phase1` can be deleted on GitHub.
- **V4** (#22) Core services and scheduler: review REQUEST_CHANGES (generation-unscoped attempts could leave a re-armed snipe not polling; an in-flight night-guard conflict killed the other snipe). Fixed in `cc10ea6` with 9 race tests that fail on the old code; the reviewer's 15 adversarial tests pass; gate green (2268). Also: no timers after stop(), unlock keeps runs and gate holds, hold notified for a deleted snipe, catalogue sync waits only for non-cancellation QUEUEING/WAITING_RELEASE/SNIPING snipes. node-cron removed. Merged. The `wip/v4-core-scheduler` backup could not be deleted (the git proxy refuses branch deletes); the stakeholder can delete it on GitHub.
- **V5** (#23) Location catalogue service: review APPROVE (all 13 criteria met; ~70-input FTS5 fuzz with no throws; FTS integrity checked; perf 34–53 ms; quit mid-sync leaves no write). Merged (`9010679`). Accepted risk: the first cold detail per session re-fetches ParkStay's campground_map (~64 KB gzip), tracked for E2. Follow-up merged (`fe52f9b`): sweep covers `catalog:availability`/`check-location` (coverage guard widened; `accounts:status` pending for V6), 60 s cache for access-gate/timeout errors, empty-catalogue retries at 1/2/5 min, future timestamps count as stale.
- **V3** (#21) ParkStay provider module: review APPROVE; merged. Follow-up merged (`c649534`): the gate reports `idle` when unheld, a negative cache for a missing release time, a warning on an empty bulk response. Known, deliberately left: `toofar` labelling of nights past the horizon; the unit id for class-listed campgrounds is one free site id (watches filter locally by id or name since V4). Migrated daily-rollover `releaseAt` recompute is in V4.
- **B3** (#28) Legacy install migration: review REQUEST_CHANGES (a stale `in-progress` marker could delete a live `wa-stay.db`). Fixed: stale markers cleared on fresh-install/declined, the redo moves `wa-stay.db` aside and never deletes it, target-folder errors name the WA Stay folder, the welcome notice and login-item replacement are retried until done, the staging folder is swept. Orchestrator added a guard so the final rename never replaces a `wa-stay.db` that appears mid-copy (+ test). 12/12 adversarial scenarios, 31 kill points; gate green after rebase on V3 (2099 tests). Merged. Manual Windows checklist (BQ3/BQ4) stays with the stakeholder.
- **Q1** (#40) phase 1: Electron smoke E2E harness, test env hooks (gated `!isPackaged`), network-free fixture mode, 10 journeys, CI e2e job. Also fixed a D3 route-focus race. Merged after an orchestrator rebase and checks (gating reviewed; e2e 10/10 locally). Phase 2 (Explore and create-watch journeys) is handed to E1/U1; the full independent review happens then.
- **V2** (#20) Data model v8: APPROVE after an adversarial migration review (every row and column matched on v5/v6 plus edge data). Orchestrator rebase onto B2: notifications carry the real provider and location, orphan adoption keeps `updated_at`. Merged.
- **B2** (#27) App identity rename: review REQUEST_CHANGES (the installer snapshot didn't close the running v1 exe; dead finish page). Fixed: legacy app closed before the snapshot, standard finish page, small email logo. Merged.
- **P6** (#17) Sandboxed preload: APPROVE (the reviewer re-verified V1 namespaces in the sandboxed built and packaged app), merged.
- **P5** (#16) SecretVault: APPROVE. Durability fixes: read-back verification before the legacy copy is replaced, fsync before rename, `conf` pinned. Merged.
- **V7** (#25) Browser automation: review REQUEST_CHANGES (Playwright launched Edge/Chrome with Chromium's sandbox off). Fixed: `chromiumSandbox: true`, quit hold hides windows, safe kill, docs for search-mode providers. Merged after resolving P5 overlaps.
- **V1** (#19) Provider SDK and contract: review REQUEST_CHANGES (Electron transport couldn't see redirects in production). Fixed on `net.request` with 21/21 live Electron tests (`npm run test:electron`). Registry flag rules, two-way schema/type assertions and extensibility hooks (§12.30). Merged.
- **D3** (#31) App shell: review REQUEST_CHANGES (emoji bell, heading ring, brushstroke width), fixed. TODO(V1) shim swapped for the real types; window minimum 960×640 moved into main-window.ts. Merged.
- **P4** (#15) Main-process hardening: reviewed (APPROVE; the reviewer independently re-ran 27/27 runtime checks). Fixed: SMTP password not reused across host/user changes, queue key masked in logs, recursive log redaction, flaky OAuth test. Merged.
- **D2** (#30) UI component library: review REQUEST_CHANGES (toasts inert under modals, plus minors), fixed (toasts portalled outside `#root`, persistent live region, focus-trap robustness, calendar band), merged.
- **P3** (#14) Composition root and typed IPC: reviewed (APPROVE; verified with a real untrusted window), small follow-ups fixed by the orchestrator, merged. Logout no longer deletes the profile (§12.22).
- **B1** (#26) Brand assets: the stakeholder chose the "Roofline sunset" logo. Review found a Windows CRLF CI failure (pre-existing in a D1 test); fixed with `.gitattributes` `eol=lf` plus CRLF-tolerant tests. Optical centring fixed, merged.
- **P2** (#13) Database foundation: reviewed (APPROVE; minors fixed in a fix commit, which adds the FK baseline rule, full-row upgrade assertions and an FK-off guard), merged. The v6 delivery-log FK bug is reproduced and fixed by v7.
- **D1** (#29) Design language and tokens: reviewed (APPROVE + minors fixed in a fix commit; palette anchors re-sampled from the stakeholder reference: ocean #3A74B8, sun #E8B858, coral #D05830), merged.
- **P1** (#12) Test infrastructure: reviewed (APPROVE, 1 minor + 3 nits fixed by the orchestrator, plus the CSS stub mock), merged.
- Board: 30 `ai-planning` issues filed, #12–#41 (mapping in streams.md).
- Kickoff: technical, UI and ParkStay API reviews (`ai-state/research/`).
- Brief, streams, architecture notes (§1–§12 amendments), 7 master plans, 30 task specs.
- Dependencies installed: playwright-core 1.56.1, sanitize-html 2.17, mapbox-gl, lucide-react, Figtree and Fraunces.

## Next to dispatch
- **The DBCA queue endpoint change** (`queue-endpoint.dbca.wa.gov.au`) is issue #43, to resolve after PR #42, not in it.
- Nothing. All 30 tasks, the verification and final-review fixes, M1–M3 and DX1–DX5 are merged. More provider DX work waits for the stakeholder (see Active blockers).

## Notes
- Spec files in `ai-state/streams/*/tasks/` are canonical. Orchestrator addenda are added there, and issue bodies are synced at the end.

## Stakeholder next steps (noted 2026-10-11; after this round or after merging)
- [ ] Delete the 11 merged `wip/*` branches on GitHub (the git proxy refuses deletes): `wip/e1-explore`, `wip/e3-dates`, `wip/p7-cleanup`, `wip/u1-watches`, `wip/u2-snipes`, `wip/u3-bookings`, `wip/u4-settings`, `wip/u5-notifications`, `wip/v3-class-listed`, `wip/v4-core-scheduler`, `wip/v6-accounts-phase1`.
- [ ] Add the `MAPBOX_ACCESS_TOKEN` Actions secret (or variable), a public `pk.` token.
- [ ] Check that the old name's `releases/latest` and `releases.atom` redirect to `wa-stay`.
- [ ] Tag `v2.0.0` (builds a draft), run the manual Windows checks on the draft's installer (`docs/release-checklist-2.0.md`), publish, then check a real v1.2.0 auto-update.
- [ ] Optional provider DX round, if wanted:
  - fixture mode for `ctx.browser` (the most valuable next fix);
  - a typed `defineProvider`;
  - contract-suite messages and checks;
  - SDK helpers: `requestJson`, a rate limiter, `Retry-After`, per-provider timeouts;
  - model gaps for RAC, Hipcamp and Airbnb-like providers: minimum stay, tax and fees, OAuth sign-in.

## Active blockers
- None. Stakeholder actions (non-blocking, all in `docs/release-checklist-2.0.md`): add the `MAPBOX_ACCESS_TOKEN` Actions secret; the manual Windows checks, the ParkStay sign-in checks (PQ1/PQ2) and the GPU check; delete the 11 `wip/*` branches on GitHub (the git proxy refuses deletes). Done by the stakeholder: repo renamed to `wa-stay` with its description; LICENSE holder decided (WA Stay).
- Provider DX follow-ups not yet approved: fixture mode for `ctx.browser` (the most valuable next fix: it would let the preview spec cover browser providers), a typed `defineProvider`, contract-suite messages and checks, SDK helpers (`requestJson`, a rate limiter, `Retry-After`, per-provider timeouts), and the model gaps (minimum stay, tax and fees, `credentials`/OAuth sign-in, an access-gate base class).

## Proposed GitHub repo description (stakeholder to paste)
> WA Stay — find and book places to stay across Western Australia. Map-first discovery, availability watches and instant site holds across providers, starting with ParkStay WA. Electron desktop app.
