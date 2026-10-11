# DX3 — A fake browser that runs forms and page scripts, for provider tests

## Description
Browser-automation providers (`ctx.browser.withPage(page => …)`, a playwright-core `Page`) are hard
to test. The shipped fakes (`tests/utils/fake-playwright.ts`) support only `goto`, `title` and
`$$eval`, and run no page scripts. The DX reviewer had to write a 110-line jsdom fake to test a
provider whose availability appears only after a JavaScript search form runs. Its code is in
`/tmp/claude-0/-home-user/6194b22b-a9ee-5367-bec6-720762fbf758/scratchpad/dx-review/experiment.patch`,
under `tests/integration/coastal-caravan-provider.test.ts`; reuse what is good. The two browser
examples in the docs also use two different fakes.

Stakeholder decision (2026-10-11): do the first group of DX fixes.

## Scope
1. **`tests/utils/fake-browser.ts`**: a `BrowserAutomation` for tests, backed by jsdom.
   - Pages come from a site you describe: a route map (URL → HTML string or file, status,
     headers), or a function, like the current `FakeSite`.
   - Inline and same-origin scripts in the fixture HTML run (jsdom `runScripts: 'dangerously'` is
     acceptable for local test fixtures only). Form submits and navigations go through the route
     map.
   - It implements the subset of playwright-core's `Page` that providers realistically use. At
     minimum:
     - `goto` and `url`;
     - `title` and `content`;
     - `locator(css)`, with `fill`, `click`, `selectOption`, `check`, `textContent`,
       `innerText`, `getAttribute`, `count`, `nth`, `first`, `all`, `allTextContents`,
       `isVisible` and `waitFor`;
     - `getByRole`, `getByLabel` and `getByText` (basic);
     - `waitForSelector`, `waitForURL` and `waitForLoadState`;
     - `$`, `$$`, `$eval`, `$$eval` and `evaluate`.

     The full list is the agent's call, documented in the file.
   - Unsupported methods throw a clear "not supported by the fake browser: <method>" error. They
     never silently return `undefined`.
   - Typed, so a provider's `withPage((page) => …)` compiles against it: cast to `Page` at one
     documented boundary.
   - Records what was visited, for assertions; supports abort (`signal`) and timeouts.
   - `isAvailable()` / `close()` like the real one. It plugs into `createTestProviderContext` with
     a simple option, e.g. `createTestProviderContext(manifest, { browser: createFakeBrowser(site) })`.
2. **Use it.** Port the docs' example browser provider tests (`tests/fixtures/providers/
   example-browser`) and the browser-provider contract test to the new fake. Keep
   `fake-playwright.ts` only where tests exercise `PlaywrightBrowserAutomation` itself (launch,
   channels, kill): say which in its header.
3. **A self-test** (`tests/unit/utils/fake-browser.test.ts`) covering:
   - a form submit that runs a script and renders results;
   - locators and roles;
   - navigation through the route map;
   - an unsupported method's error;
   - abort.
4. **`createTestProviderContext`** must no longer quietly build a real Playwright browser. Default to
   a fake that throws "this test did not set up a browser" when used, unless one is passed.

## Non-goals
- No provider or app behaviour change.
- DX4 updates the provider guide to use the fake. Here, keep the docs' code blocks compiling
  (the docs-sync test) and update only the example sources and the snippets they mirror.

## Completion Criteria
- [ ] The fake browser exists with its self-test. Its supported-API list is documented at the top
  of the file.
- [ ] The example browser provider and its contract test run on it.
- [ ] `createTestProviderContext` no longer launches a real browser by default.
- [ ] The docs tests pass (code blocks equal their source regions).
- [ ] The gate passes on Node 24:
  - lint, format, type-check;
  - `npm test` (tests must also pass on Windows: no path or separator assumptions) and `test:tz`;
  - e2e.

## Context Files to Read First
- `CLAUDE.md`
- `ai-state/research/provider-dx-review.md`
- `docs/providers/browser-providers.md`
- `src/main/providers/sdk/browser.ts`, `browser-automation.ts`
- `tests/utils/fake-playwright.ts`, `tests/utils/fake-provider.ts`
- `tests/fixtures/providers/example-browser/`
- the experiment patch above
