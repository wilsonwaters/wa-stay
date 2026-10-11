# Add a provider

Add an accommodation provider to WA Stay, from nothing to visible in the app. The checklist is the "Adding a provider" section of `CLAUDE.md`, and the reference is `docs/providers/adding-a-provider.md`: read both first. They are the single source of truth; this command walks you through them.

## Instructions

### Step 1: Preflight

- Read the "Adding a provider" section of `CLAUDE.md`, then the guide's quick start (`docs/providers/adding-a-provider.md`).
- Check `git status`. If the tree is dirty with unrelated changes, stop and tell the user.
- List the built-in providers (`BUILT_IN_PROVIDERS` in `src/main/providers/index.ts`) so the new id does not clash.

### Step 2: Gather what the scaffold needs

Ask the user (AskUserQuestion) for anything you cannot find out yourself:

- The provider's name, and an id: 2–32 lower-case letters, digits or hyphens, starting with a letter. It is stored in user data, so it never changes.
- Its terms of use. If they forbid automated access, stop: the provider can be listed with links only. Record what they say for the module's header comment.
- API or browser: look at the site's network panel (or ask). Prefer an API (`--api`); choose `--browser` only when the pages are built from data no request returns.
- Whether its catalogue can be listed in full, or only searched by map area (`--search`, for a marketplace).
- What it can do: availability, holds, sign-in, bulk availability. Start with what the scaffold generates (catalogue, availability, watches); add the rest later, each with its module.

### Step 3: Scaffold

Run `npm run provider:new -- <id> [--api|--browser] [--search] --name "<name>"`. It writes the module, sample fixtures and a test that runs the contract suite, registers the provider, and prints the next steps. Run `npx jest tests/integration/<id>-provider.test.ts` once to see it pass as generated.

### Step 4: Implement

Work through every `TODO` the scaffold left, in `src/main/providers/<id>/` and its tests:

- Set the address constants. Until then every call fails with a `ProviderError` naming the constant.
- Replace the request paths and parameters (or the site's paths, labels and attributes in `pages.ts`), the raw shapes and the provider's words.
- Record a few of the provider's public responses: anonymously (never signed in), politely (a browser user agent, one request each, not a crawl), trimmed, with no personal data. Put them in `tests/fixtures/providers/<id>/` with their routes in its `manifest.json`, and the ones the app needs in `tests/e2e/fixtures/http/<id>/`. For a browser provider, put a trimmed copy of the markup in `tests/fixtures/providers/<id>/site.ts`.
- Update the generated test's expectations to the real data, and add tests for anything you add (holds, sign-in, bulk availability; the guide has compiling examples of each).

### Step 5: Test and preview

1. `npx jest tests/integration/<id>-provider.test.ts` until it passes.
2. API providers: `npm run build:e2e`, then `npx cross-env PREVIEW_PROVIDER=<id> playwright test preview-provider` (`xvfb-run -a` in front on Linux without a display). Look at the screenshots in the report: the provider's places on Explore, Explore with dates, a place page with its availability, Settings → Accounts. If it warns that every night reads Unknown, run it again with `PREVIEW_ARRIVAL=YYYY-MM-DD` set to dates your `tests/e2e/fixtures/http/<id>/` responses cover. If it fails, the message quotes what the app logged about the provider, or names the request that needs a route (a provider with an account needs one for its signed-in check).
3. Browser providers: fixture mode does not serve `ctx.browser`. Follow "Preview in the app" in `docs/providers/browser-providers.md`: serve the made-up site on loopback (`node scripts/serve-provider-site.mjs <id>`), point the address at it for the preview, and set it back afterwards (`npm test` fails while a provider names a loopback address). Never point the app or a test at the live site.

### Step 6: Gate

Run all of it, and fix what fails:

1. `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`
2. `npm run build:e2e && npm run test:e2e` (`xvfb-run -a npm run test:e2e` on Linux)

### Step 7: Report

Tell the user what the provider can do, what is left (capabilities not built yet), the test and preview results, and anything the terms of use limit. Commit only if they ask, with a conventional message.

## Rules

- Do NOT place a real hold, booking or payment, ever, and do NOT point a test or trial run at the live site.
- Do NOT change core services, IPC, the renderer or `src/shared/` for one provider: if the SDK cannot express something, stop and tell the user.
- Do NOT weaken the contract suite, another test, a lint rule or a coverage threshold. Existing tests do not depend on which providers are built in, so a test that fails after registering found a real problem.
- Do NOT leave a `TODO` or a placeholder address behind, or call the work done before the whole gate passes.
- Do NOT add Co-Authored-By trailers or AI attribution to commits, code, fixtures or docs.
