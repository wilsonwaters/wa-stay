# Docs & quality — master plan

**Label:** `stream:docs` · **Lane:** A (assets/docs), after B1 · **Size:** M (Q2 is L, see DocQ5)

## Goal

Ship WA Stay with two things that keep it honest after this PR:

1. **An Electron smoke E2E suite (Q1).** It drives the *built* app with Playwright `_electron.launch` under xvfb. Each run gets an isolated `userData`, and the network is replaced by recorded provider fixtures, so the suite is deterministic and never touches real data or ParkStay. It covers these journeys:
   - launch to Explore;
   - top navigation to Watches, Site Sniper, Bookings and Settings;
   - a provider badge on results;
   - a create-watch flow that starts with the provider step;
   - clean shutdown;
   - no console errors.

   It replaces the stale browser specs (`tests/e2e/login.spec.ts`, `bookings.spec.ts`), which expect a login form, `.booking-card` and an h1 of "ParkStay Bookings". A CI job runs it.
2. **Documentation that describes the product we actually built (Q2).**
   - README: WA Stay as a WA accommodation booking app, with ParkStay as one provider capability, download links to `wilsonwaters/wa-stay` and an upgrade note.
   - A restructured `docs/`: index, user guide, installation, architecture overview with a provider diagram, provider developer guide with compiled skeletons, ParkStay provider docs with verified and unverified endpoints, feature docs, release process.
   - An updated `CLAUDE.md`.
   - A CHANGELOG `[Unreleased]` section to be released as 2.0.0.
   - Cleanup of 15 stale root status files.

Stream success = brief success criteria 1 (docs say WA Stay), 6 (developer guide covers API and browser providers) and 9 (the Electron smoke E2E passes).

## Task list

| ID | Task | Size | Depends | Status |
|---|---|---|---|---|
| Q1 | [Electron smoke E2E](tasks/Q1-electron-smoke-e2e.md): `_electron` harness, isolated userData (`WA_STAY_USER_DATA_DIR`), network-free fixture mode (`FixtureHttpClient` + session request guard), token-less E2E build, 4 journey specs + lifecycle, role-based selectors, typed and formatted specs, `e2e` CI job on ubuntu + xvfb | M | D3; E1 (Explore assertions); U1 (create-watch journey, DocQ1) | ⬜ |
| Q2 | [Documentation](tasks/Q2-documentation.md): README, `docs/` restructure and index, architecture overview + provider diagram, `docs/providers/` (adding-a-provider with compiled API and browser skeletons; `parkstay/` with endpoint verification status), feature docs, release process (repo rename, `MAPBOX_ACCESS_TOKEN`), CLAUDE.md, CHANGELOG `[Unreleased]`, stale-markdown cleanup, markdown link-check test, repo description | L | Q1, B1–B3, V1, V3, V6, V7, E1–E3, U1–U5, P7. Runs **last** | ⬜ |

Execution order:

- **Lane A:** B1 → Q1 → Q2.
- **Q1:** build the harness and fixture mode as soon as D3 lands. Write the journey specs once E1 (Explore) and U1 (provider step) are merged.
- **Q2:** starts only once every other task is merged or explicitly deferred. It documents what is in the code, not what the plans say.

## Integration points

| With | What crosses the boundary | Seam owner |
|---|---|---|
| **D3** app shell | D3 documents stable accessible names in `docs/design/shell.md`: nav links "Explore", "Watches", "Site Sniper, coming soon", "Bookings, coming soon"; the "Account and settings" button; one `h1` per page; route focus. Q1 selects only by role and name. | D3 → Q1 |
| **E1** Explore | The result list, item provider badge, search control and list-only notice (no token) are named in E1's spec. Q1 asserts them against an 8-location ParkStay fixture. | E1 → Q1 |
| **U1** Watches | The "New watch" button, `/watches/new` (architecture-notes §12.10; the U1 spec still says `/watches/create`), Step 1 provider picker with `aria-current="step"`, and a single qualifying provider pre-selected with "Continue" enabled (U1 completion criteria). | U1 → Q1 |
| **V1 / P3** provider context | Q1 adds `FixtureHttpClient implements HttpClient` (§3). The composition root selects it for every provider context in fixture mode. Provider code is unchanged. | V1/P3 → Q1 |
| **B3** paths | Test hooks work only when unpackaged: `WA_STAY_USER_DATA_DIR`, and `WA_STAY_LEGACY_DATA_DIR`, which disables legacy migration when unset. If Q1 lands first, it adds the user-data override to `src/main/app/paths.ts` and B3 keeps it. | B3 ↔ Q1 |
| **P4** CSP / guards | Q1's "no console errors" check catches CSP violations and blocked navigations in the built app. A Q1 failure on CSP is a P4 bug and is reported, not suppressed. | P4 → Q1 |
| **P7** dead code | **Q2 owns all markdown cleanup:** the 15 root status files, `tests/TEST_SUMMARY.md`, and stale docs. P7 owns code-level dead code, including root `start-electron.js` and `schema.sql`, and must not delete `*.md`. This is the default in DocQ3. | Q2 / P7 |
| **B2** release links | B2 changes only URLs and artifact names in `docs/release-process.md` and `.claude/commands/release.md`. Q2 adds the 2.0.0 rename checklist, the Mapbox secret and the `[Unreleased]`-rename rule. | B2 → Q2 |
| **E1** token wiring | E1 owns how `MAPBOX_ACCESS_TOKEN` reaches the build (`secrets.MAPBOX_ACCESS_TOKEN \|\| vars.MAPBOX_ACCESS_TOKEN`, OPEN-QUESTIONS Q4). Q1's `build:e2e` must produce a token-less renderer through the same mechanism. Q2 documents it for builders. | E1 → Q1, Q2 |
| **Orchestrator** | Q2 supplies the repo description and topics for `ai-state/PROGRESS.md` (OPEN-QUESTIONS Q3), and lists stakeholder actions: repo rename, social preview upload, branch protection for the `e2e` job. | Q2 → orchestrator |

### Proposed GitHub repository description (Q2 finalises)

> WA Stay: find and book places to stay across Western Australia. Explore campgrounds on a map, set availability watches and get alerted. ParkStay WA is the first provider, with more to come. Windows desktop app (Electron).

Topics: `western-australia`, `camping`, `accommodation`, `booking`, `parkstay`, `electron`, `react`, `typescript`.

## Out of scope

- Packaged-installer and auto-update E2E: covered by the B2/B3 manual Windows checklist.
- Windows or macOS E2E in CI, visual-regression baselines, and axe audits inside Q1. Q1 adds no new dependency; runtime a11y checks belong to each UI task.
- Testing against live ParkStay. Fixture refresh is a manual developer task documented in `tests/README.md`.
- Translating docs. Video or GIF tutorials. Hosting a docs site.
- Writing code to make the docs true. If a documented behaviour is missing, Q2 raises it rather than implementing it.

## Open questions

| # | Question | Blocks | Proposed default |
|---|---|---|---|
| DocQ1 | Q1's create-watch journey needs U1. Should Q1 wait for U1, or should U1 add its own E2E journey to the harness? | Q1 journey 4 | Q1 waits. The harness, launch and nav specs can merge as an early commit on Q1's branch. |
| DocQ2 | Should the `e2e` job be a required status check (branch protection is a stakeholder setting)? | Q1 CI wiring | Add the job to `ci.yml` on push and PR, and recommend making it required after 5 consecutive green runs. |
| DocQ3 | Delete or archive the v1 planning docs (`docs/architecture/*` ≈4.6k lines, `IMPLEMENTATION_PLAN.md`, `DEPLOYMENT-SUMMARY.md`, `SETUP-CHECKLIST.md`, `GMAIL-INTEGRATION-SUMMARY.md`) and the 15 root status files? | Q2 cleanup | Delete them, since git history keeps them. Keep `ADR-001` (moved to `docs/architecture/adr/`). The PR lists every deleted file. |
| DocQ4 | Is Gmail OTP still a user-facing feature in v2? It is not wired to any sign-in flow (tech-review #9), and D5 moves sign-in to an in-app window. | Q2 `docs/gmail.md` | Document exactly what the merged code does after P4/V6. If it is unused, write a short "advanced / optional" page. |
| DocQ5 | Q2 is more than 8 hours: README, about 12 docs, CLAUDE.md, CHANGELOG, two compiled example providers and a link-check test. Should it be split into Q2 (docs, README, CLAUDE.md, CHANGELOG, cleanup) and Q3 (provider developer guide with examples)? | Q2 plan approval | Keep one L issue with two commits in that order. Split if plan review estimates more than 2 days. |
| DocQ6 | README screenshots with real Mapbox tiles need the token and network. Fixture mode blocks the network. | Q2 screenshots | The docs screenshot script allow-lists only Mapbox hosts (`WA_STAY_E2E_ALLOW_HOSTS`, a Q1 hook) when a token is present locally. Without a token, it captures list mode. |

## Changelog

- **2026-10-02:** Created. Q1 and Q2 specs written. Deviations from `streams.md`:
  - Q1 also depends on E1 and U1 for two journeys.
  - Q2 is sized **L**, not M (DocQ5).
  - Markdown cleanup moves from P7 to Q2 (DocQ3).
  - The stale e2e specs also use a non-Electron `webServer` and a `baseURL` (`playwright.config.ts:20,30-35`). Both are removed.
