# Q2 doc plan (#41)

Base `3561abd`. Every claim is checked against the merged code; `client.ts`, `connection.ts`,
`src/shared/contracts/` and the SDK are the sources of truth. Design round waived (docs).

## Deviations from the spec (§12 and the dispatch win)
- Migrations are **v1–v10** (P7 added v10), not v1–v8.
- Gmail OTP is gone (P7): no `docs/gmail.md`; every Gmail doc is deleted and the upgrade notes
  say what to delete and how to revoke access (CHANGELOG wording).
- Root status files and `tests/TEST_SUMMARY.md` were already removed by P7.
- `docs/design/shell.md`: only the stale `features/<domain>/legacy/` row and guard lines (dispatch).
- `docs/developer/browser-providers.md` moves to `docs/providers/browser-providers.md`.
- `docs:screenshots` lives in `tests/docs/` with its own Playwright config (lane V owns
  `tests/e2e/**`). It reuses the harness's paths and fixtures but launches Electron itself: the
  harness takes no launch arguments, and Mapbox under xvfb needs SwiftShader flags. With a token
  only `api.mapbox.com` is allowed; provider photos stay blocked (O8: never in the repository).
- The provider guide's examples are type-checked inside the test (TypeScript API, main tsconfig),
  since the gate's `type-check` does not cover `tests/`.
- `search_suggest` and `campsites/{id}` were verified live but `client.ts` no longer calls them:
  listed as "Verified live, not used".

## Files
- `README.md` rewrite: banner, pitch, screenshots, Features (Site Sniper and Bookings coming
  soon), Providers matrix, Download, Upgrading from WA ParkStay Bookings, Building from source,
  Development, Documentation, Disclaimer, License; repo rename note.
- `CLAUDE.md`: overview (WA Stay, version per package.json), tech stack, §1 tree
  (`app/`, `api/`, `components/`, `features/**`), composition root, DB v1–v10 (migration rules
  kept verbatim), secrets (SecretVault, write-only over IPC), provider SDK summary, IPC
  namespaces table, error codes (`RATE_LIMITED`, `CONFLICT`), retention job, UI status, key
  components, testing (Jest projects, e2e harness, `test:tz`, `test:electron`), release (wa-stay).
  Pre-Commit and Git sections verbatim.
- `CHANGELOG.md`: `[Unreleased]` "to be released as 2.0.0": Added, Changed, Removed (P7 Gmail,
  kept), Fixed, Security, Upgrade notes; issue numbers from merged commits. 1.2.0 and older unchanged.
- `docs/README.md` index linking every page.
- `docs/user-guide.md`, `installation.md` (with the upgrade section), `troubleshooting.md`,
  `development.md` (trimmed, current scripts), `security.md` (Gmail rows gone, provider state in SQLite).
- `docs/architecture/overview.md` (process model, layout, composition root, Mermaid provider
  diagram + text equivalent, data model v1–v10, security baseline, upgrade path);
  `architecture/adr/ADR-001-ui-framework-choice.md` (moved); other `architecture/*` deleted.
- `docs/providers/README.md` (matrix, SDK summary), `adding-a-provider.md` (manifest,
  capabilities, auth kinds, catalogMode, stayFields, releaseModes, limits,
  bulkAvailabilityStayFields, waitingRoomOrigins, HttpClient, fixtures, contract tests,
  registration), `browser-providers.md` (moved), `parkstay/{README,endpoints,authentication}.md`.
- `docs/site-sniper.md` (from `SITE_SNIPER.md`), `watches-and-notifications.md` (from
  `ADVANCED_FEATURES_GUIDE.md`), `code-signing.md` (trimmed), `release-process.md` (2.0.0
  rename checklist, redirect curl, Mapbox secret, `[Unreleased]` rule, repo description),
  `release-checklist-2.0.md` (stakeholder manual checks), `.claude/commands/release.md` step 4.
- Deleted: `docs/{IMPLEMENTATION_PLAN,DEPLOYMENT-SUMMARY,SETUP-CHECKLIST,GMAIL-INTEGRATION-SUMMARY,
  gmail-otp-setup,gmail-otp-quick-start,gmail-usage-examples,ADVANCED_FEATURES_GUIDE,SITE_SNIPER,
  code-signing-and-deployment}.md`, `docs/architecture/*` except ADR-001, `docs/parkstay-api/`,
  `docs/developer/`.
- `docs/images/*.png` (Explore, place detail, Watches) from `npm run docs:screenshots`.

## Tests (acceptance proof)
- `tests/fixtures/providers/example-api/index.ts` and `example-browser/index.ts`: the guide's
  code blocks are `// #region docs:<name>` regions of these files.
- `tests/unit/docs/example-providers.test.ts`: both register in a fresh `ProviderRegistry`,
  pass the provider contract suite, list normalised `LocationSummary[]`, availability returns
  `NightStatus` with `YYYY-MM-DD` dates (API over `NodeHttpClient` + loopback fixture server;
  browser with a fake `BrowserAutomation`).
- `tests/unit/docs/docs-sync.test.ts`: every marked code block equals its source region.
- `tests/unit/docs/markdown-links.test.ts`: relative links and images resolve, alt text is
  non-empty, backticked `src/`, `tests/`, `docs/` paths in CLAUDE.md exist; no external fetch.
- `tests/unit/docs/endpoints-doc.test.ts`: every endpoint row has a legend Status; no
  "Not a real route" path appears in `client.ts`.

## Order
plan → example providers + tests → link test → docs moves/rewrites → README/CLAUDE/CHANGELOG
→ screenshots → gate ×3 + `test:tz` → squash wip.
