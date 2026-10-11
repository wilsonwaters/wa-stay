# DX5 — Validation follow-ups: doc errors, account wording, preview with dates

## Description
DX4's validation run (stakeholder decision 2026-10-11: "do the developer experience fixes")
had a fresh agent add two fictional providers using only the scaffold and the docs:
- an API provider with a nested catalogue, holds, an optional account and a stay field;
- a browser provider with a search-mode catalogue.

Both reached a green gate in about 12 minutes, with no unrelated test failures and no blockers.
The run found three doc errors, several small doc gaps, Settings wording that is wrong for any
provider other than ParkStay, a preview that never exercises availability, and no working recipe
for previewing a browser provider in the app. Fix all of these.

## Scope
1. **Doc errors** (`docs/providers/adding-a-provider.md` and the examples it quotes):
   1. The Limits section says modules enforce `createLimiter` "as Example Parks… do", but
      `tests/fixtures/providers/example-api/holds.ts` calls `http.request` outside the limiter.
      Fix the example so every request goes through the limiter. The docs-sync test keeps the
      guide's quoted regions equal.
   2. `BulkAvailabilityEntry` is undocumented, and its names invite a swap: `bookableUnits` is
      the total and `availableUnits` the number free every night. Document every field in the
      guide and in a doc comment on the type (`src/shared/types/`). Read the code that consumes
      it to confirm the meaning first.
   3. A provider with an account needs a fixture route for its signed-in check in
      `tests/e2e/fixtures/http/<id>/`, or the preview and e2e log a guarded request. Say so in
      the guide. Have the scaffold's next steps say so when relevant.
2. **Doc gaps:**
   - List the `LocationKind` values and the stay-field types in the guide. Add a docs test that
     checks the lists against the types (`src/shared/types/provider.types.ts`), as
     `provider-guide.test.ts` does for timings.
   - Say which modules the contract suite (`tests/utils/provider-contract.ts`) calls and what it
     checks for each. For example, for holds it checks only that an abort is honoured.
   - Say why the generated e2e `manifest.json` differs from the Jest one: a line in the guide
     and in `tests/e2e/fixtures/http/README.md`.
   - CLAUDE.md's Provider SDK "Registry" bullet says "one line in `BUILT_IN_PROVIDERS`". Make it
     an import plus a list entry, as `src/main/providers/index.ts`'s header now says.
3. **Settings → Accounts wording follows the manifest** (`src/renderer/features/settings/accounts/accountText.ts`):
   - No "before a release" unless the provider has `snipes`. A provider with holds but no
     Site Sniper gets wording about checkout only.
   - "Site Sniper" is named only when the provider has `snipes`, and "automatic holds" only
     when it has `holds` and `watches`.
   - A provider with `account: 'none'` doesn't show "No account needed" twice (status and
     purpose). Check how the row renders both and pick the plain fix.
   - ParkStay's wording doesn't change. Add renderer tests for a provider with holds but no
     snipes, one with no holds, and one with `account: 'none'`. Assert roles and accessible
     names, never class names.
4. **The preview exercises availability** (`tests/e2e/preview-provider.spec.ts`):
   - Open Explore and the place page with dates (tomorrow in the provider's timezone, two
     nights, set through the URL's prefill or the date picker, as the existing e2e specs do).
   - Assert that availability answers without an error: the place page's night grid or "no
     availability" state; Explore's counts where the provider has `bulkAvailability`.
   - Screenshots of both. A generated provider (as scaffolded, addresses set) must still pass.
     Prove it for an `--api` and an `--api --search` provider, then delete them.
5. **A browser-provider preview recipe that works.** Fixture mode does not serve `ctx.browser`;
   building that is a separate task (the DX review's item 5). Until then, document a by-hand
   recipe in the guide's "Preview in the app" and in `browser-providers.md`.
   - **Prove it end to end** with a scaffolded `--browser` provider: Explore lists its places and
     its place page loads through the real browser. Then delete the provider.
   - **Never weaken TLS or the browser:** no `--ignore-certificate-errors`, no disabled sandbox,
     no proxy bypass, no host-resolver mapping in shipped code or the docs.
   - **Acceptable approaches:**
     - serve the provider's `site.ts` pages on loopback (a small, documented helper under
       `tests/utils/` or `scripts/` is fine);
     - point the provider's address constant at it temporarily, if the browser module allows a
       loopback `http:` address; if it refuses, say so and explain why;
     - on Linux, set `WA_STAY_BROWSER_PATH`.
   - If no safe recipe exists without a code change, document that plainly and stop. Don't
     invent one.

## Non-goals
- Fixture mode for `ctx.browser` and letting `WA_STAY_BROWSER_PATH` through the e2e harness
  (the DX review's item 5).
- New scaffold flags (`--holds`, `--account`).
- The DX review's items 6, 7, 9 and 10.

## Completion Criteria
- [ ] The example API provider's hold requests go through its limiter; docs-sync passes.
- [ ] `BulkAvailabilityEntry`'s fields are documented in the guide and on the type.
- [ ] The guide covers the signed-in check's e2e fixture route, the location kinds and
  stay-field types (checked by a test), what the contract suite calls, and the two fixture
  manifests. CLAUDE.md's Registry bullet is accurate.
- [ ] Settings → Accounts wording follows `snipes`, `holds` and `watches`, and never repeats
  "No account needed". ParkStay is unchanged. New renderer tests.
- [ ] The preview sets dates and checks availability. It passes for a generated `--api` and
  `--api --search` provider (shown in the report, then removed).
- [ ] The browser preview recipe is documented and proven end to end, or documented as not yet
  possible with the reason.
- [ ] The gate passes on Node 24: lint, format, type-check, `npm test`, `test:tz`, and
  `build:e2e` + e2e.

## Context Files to Read First
- `CLAUDE.md` (the "Adding a provider" section)
- `docs/providers/adding-a-provider.md`, `docs/providers/browser-providers.md`
- `tests/e2e/preview-provider.spec.ts`, `tests/e2e/support/wa-stay.ts`
- `scripts/new-provider.mjs` and `scripts/templates/provider/`
- `src/renderer/features/settings/accounts/`
- `tests/fixtures/providers/example-api/`
