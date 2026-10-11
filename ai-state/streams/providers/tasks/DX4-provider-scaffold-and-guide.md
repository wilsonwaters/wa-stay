# DX4 — Provider scaffold, agent checklist and guide rewrite

## Description
The last step of the first group of DX fixes (stakeholder decision 2026-10-11). It builds on:
- DX1: tests hold with any number of providers, the `WA_STAY_PROVIDERS` hook;
- DX2: search-mode catalogues work in the app;
- DX3: a fake browser for provider tests.

The provider DX review (`ai-state/research/provider-dx-review.md`) found no scaffold, no agent
checklist, four wrong claims in the docs, and gaps: no quick start, no holds or sign-in example, no
"preview in the app" recipe, undocumented core timeouts, and internal references. Close all of
these, so an AI agent (or a person) can add an API or browser provider and see it working in the
app first time.

## Scope
1. **Scaffold: `npm run provider:new -- <id> [--api|--browser] [--search]`** (`scripts/new-provider.mjs`).
   - Validates the id against the registry's id rule, and refuses one that exists.
   - Generates `src/main/providers/<id>/`, with a manifest (sensible defaults, every capability
     explicit and commented) and modules:
     - `--api`: an `http`-based catalogue, availability and links;
     - `--browser`: a `ctx.browser` page flow, plus a local fixture site for the fake browser;
     - `--search`: `catalogMode: 'search'` with `searchArea`.
   - Generates fixtures:
     - `tests/fixtures/providers/<id>/` for Jest;
     - `tests/e2e/fixtures/http/<id>/`, in the fixture-mode route format, for the API template.
   - Generates `tests/integration/<id>-provider.test.ts`, running `describeProviderContract` plus a
     mapping test, all passing as generated.
   - Adds the registration line to `BUILT_IN_PROVIDERS`, or prints it with `--no-register`.
   - Prints next steps: the checklist, the commands to run, and the preview recipe.
   - Generated code passes lint, format, type-check and the full `npm test` and e2e as generated.
     DX1 makes that possible: the e2e harness pins ParkStay unless told otherwise.
   - **Template decision:** the API template should hold up even if the provider ships, so
     placeholders must fail loudly at runtime (unset base URL, …) and never contact a real site.
2. **Agent checklist.**
   - Add an "Adding a provider" section to `CLAUDE.md`, which agents read first. It covers:
     - the scaffold command;
     - the files it creates;
     - the rules: no live holds; fixtures, never live sites, in tests; the contract suite; the full
       `npm test` + `test:e2e` before done;
     - how to preview in the app;
     - what "done" means.
   - Add `.claude/commands/add-provider.md`: a slash command that walks an agent through the
     checklist, in the style of the existing `.claude/commands/release.md`.
   - Optionally add `AGENTS.md` at the root, pointing to the same checklist for non-Claude agents.
     Keep one source of truth: AGENTS.md links to the CLAUDE.md section and doesn't copy it.
3. **Guide rewrite** (`docs/providers/adding-a-provider.md`, `browser-providers.md`, `README.md`).
   - **A quick start first:** scaffold, fill in the API calls, run the contract suite, preview in
     the app, register.
   - Fix the four wrong claims:
     1. availability stay fields "show on the place page": say where they actually show;
     2. search mode "leaves a hook": describe how it works after DX2;
     3. "throw a retryable error and the core decides": describe actual behaviour; the core only
        logs `retryable`;
     4. registering is "one line": accurate after DX1, plus the checklist.
   - Add a compiling **holds** example and a **sign-in (`browser-session`)** example. Each comes
     from source regions in `tests/fixtures/providers/`, checked by the docs-sync test, and gets a
     test.
   - Document:
     - the core timeouts (catalogue sync 60 s, detail and availability 20 s; read the real values
       from `DEFAULT_CATALOG_TIMINGS`);
     - `FixtureHttpClient` for Jest;
     - where provider tests go;
     - the fake browser (DX3);
     - the `WA_STAY_PROVIDERS` hook and the "preview in the app" recipe (`npm run build:e2e` with
       a small harness spec, or `WA_STAY_E2E_FIXTURES_DIR` from source).
   - Replace internal references (§12.x, V7, brief D5) in provider-facing docs with plain words or
     links to the code.
   - One browser example, using one fake.
4. **Validate with a fresh run.** A reviewer agent (dispatched by the orchestrator) adds a new
   provider using only the scaffold and the guide, and reports the time to "visible in the app" and
   any friction. Target: no source-diving and no unrelated test failures.

## Non-goals
- The rest of the review's recommendations (typed `defineProvider`, contract-suite message quality,
  rate limiter, `Retry-After`, model gaps). They are follow-ups.

## Completion Criteria
- [ ] For each of `--api`, `--browser` and `--search`, a generated provider passes lint,
  format:check, type-check, the full `npm test` and the e2e suite.
  - A test script (`tests/scripts/new-provider.test.ts`) generates each into a temp copy, or
    checks the templates compile and pass the contract suite, and cleans up.
- [ ] CLAUDE.md "Adding a provider" section and `.claude/commands/add-provider.md` exist; the docs
  tests pass (paths exist).
- [ ] The guide has a quick start, the four corrections, compiling holds and sign-in examples,
  timeouts, fixtures, the fake browser and the preview recipe. Internal references are gone from
  provider-facing docs.
- [ ] The gate passes on Node 24: lint, format, type-check, `npm test`, `test:tz`, e2e.
