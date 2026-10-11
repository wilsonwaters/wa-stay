# DX1 — Tests that hold with any number of providers

## Description
The provider developer-experience review (`ai-state/research/provider-dx-review.md`) found that
registering a second provider in `BUILT_IN_PROVIDERS` breaks 16 existing tests, so "adding a
provider is one line" is not true:

- 10 Jest tests in `providers-ipc`, `registry`, `container` (×2), `catalog` (×2), `accounts-ipc`,
  `secret-sweep` and `legacy-upgrade`;
- 6 e2e journeys: `create-watch` (the ParkStay radio is no longer pre-checked), `launch` ×3,
  `explore-resize` and `held-snipe`.

All of them assume ParkStay is the only provider, or that there are 11 places. Make every test
hold when more providers are registered, without weakening what each test proves about ParkStay.

Stakeholder decision (2026-10-11): do the first group of DX fixes.

## Scope
1. **Choosing the providers.**
   - `createContainer` takes an optional `providerFactories` (default `BUILT_IN_PROVIDERS`), passed
     to `registerBuiltInProviders`.
   - Test harnesses (`tests/utils/ipc-harness.ts`, `core-harness.ts` and any other that builds a
     container or registry) take the same option. Tests about ParkStay's behaviour pin
     `[parkstayFactory]` explicitly.
   - Tests about the registry or container in general iterate over `BUILT_IN_PROVIDERS`, or use
     fakes, instead of asserting "one provider, parkstay".
2. **e2e.** Add a test hook, `WA_STAY_PROVIDERS` (comma-separated ids). It is honoured only when
   `runsFromSource`, like the other hooks in `src/main/testing/env.ts`.
   - When it is set, only the listed built-ins register. An unknown id fails start-up loudly.
   - The e2e harness (`tests/e2e/support/wa-stay.ts`) sets it to `parkstay` by default; a spec can
     pass its own list.
   - The packaged-smoke test must show the package ignores it, like the other hooks.
   - Document it with the other hooks in `CLAUDE.md` and `tests/README.md`.
3. **Assertions about counts and pre-selection.** Where a test asserts "11 places" or "the only
   provider is pre-selected", make the assertion explicit about its provider set, or count
   ParkStay's places only.
4. **Proof.** Temporarily add the guide's example API provider (`tests/fixtures/providers/
   example-api`), or a minimal fake built-in, to `BUILT_IN_PROVIDERS`. Then run the full
   `npm test` and `npm run build:e2e && xvfb-run -a npm run test:e2e`. Everything must pass.
   Revert the temporary registration, and record the result in the report.
   - Add a permanent Jest test that builds a container with ParkStay plus a fake second provider
     (through `providerFactories`) and runs the key IPC reads: `providers.list`, `catalog.search`,
     `accounts.list`. They must work, and existing ParkStay-specific expectations must still hold
     when filtered to ParkStay.

## Non-goals
- No change to app behaviour. The default build registers exactly what it does today.
- No scaffold or docs beyond the hook documentation (DX4 does those).

## Completion Criteria
- [ ] `createContainer({ providerFactories })` exists, with a unit test.
- [ ] The `WA_STAY_PROVIDERS` hook:
  - is source-only, with unit tests;
  - fails loudly on an unknown id;
  - is shown to be ignored by the package in the smoke test.
- [ ] With a second provider temporarily registered, the full Jest suite and e2e suite pass
  (evidence in the report). With it removed, the same is true.
- [ ] The new permanent two-provider container test passes.
- [ ] The gate passes on Node 24:
  - lint, format, type-check;
  - `npm test` and `test:tz`;
  - e2e;
  - the packaged smoke test.

## Context Files to Read First
- `CLAUDE.md` (Test hooks, Provider SDK)
- `ai-state/research/provider-dx-review.md`
- `src/main/app/container.ts`
- `src/main/providers/index.ts`
- `src/main/testing/env.ts`
- `tests/utils/ipc-harness.ts`, `tests/utils/core-harness.ts`
- `tests/e2e/support/wa-stay.ts`
- the failing tests listed above
