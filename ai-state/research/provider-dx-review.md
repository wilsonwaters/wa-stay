# Provider developer-experience review

_2026-10-11, on `be4a971` (Node 24, Electron 44, TypeScript 6, Vite 8, Jest 30)._

**Question (stakeholder):** what would it take for an AI agent to add a new camping provider? Is the
documentation good? Is the SDK sensible and extendable with good defaults, yet flexible enough for
very different provider systems? Is it quick to get going?

**Method:** a reviewer agent built two throwaway providers from the docs alone, read source only
when the docs ran out, and logged each friction point. It used fixtures only and no live sites.
Nothing was committed.

- **Bush Camps WA:** a JSON API provider with catalogue, availability, bulk availability, watches,
  holds over fake HTTP and an optional account.
- **Coastal Caravan Co:** a browser-automation provider whose availability appears only after a
  JavaScript search form runs, with a `search`-mode catalogue and slow limits.

It then assessed seven harder provider types on paper.

## Verdict

The core design is good. The docs are accurate where they cover something, and an API provider
goes from nothing to visible in the app in about 11 minutes. Specifically:

- The manifest drives all of the UI, so a provider needs no renderer, IPC or core code.
- The registry's validation errors are excellent.
- The extension points are well chosen: stay fields, release modes, access gates, holds with
  `bookedReference`, unit aliases and scoped secrets.
- The contract suite and the e2e harness are strong.

Five things stand between that and "an agent succeeds first time on any provider":

1. **Registering a second provider breaks 16 existing tests.** Ten Jest and six e2e tests assume
   ParkStay is the only provider or that there are 11 places. The guide calls registering "one
   line".
2. **`catalogMode: 'search'` is accepted but not wired up.** Nothing in the app calls `searchArea`.
   A search-mode provider shows 0 places on Explore, and the watch flow says "No locations match".
3. **Browser providers lack test support.**
   - The shipped fakes support only `goto`, `title` and `$$eval` and run no page scripts.
   - The reviewer wrote a 110-line locator-capable fake.
   - Fixture mode doesn't cover `ctx.browser`, so a `full`-mode browser provider would crawl its
     live site during e2e.
4. **No scaffold.** There is no `provider:new` command, no AGENTS.md or add-provider checklist,
   and no template provider outside `tests/`.
5. **Model gaps for different provider types:**
   - only `browser-session` sign-in is implemented;
   - no minimum-stay night reason;
   - one currency per provider, with no tax or fees;
   - no rate limiting or `Retry-After`, so the core ignores `retryable`;
   - core timeouts are fixed and not configurable per provider.

## Time to first running provider

| Provider | Compiles | Contract suite green | Visible in the app |
| --- | --- | --- | --- |
| Bush Camps WA (API) | 5 min | 7 min (1 fix) | 11 min (Explore, place page, Accounts) |
| Coastal Caravan (browser) | 2 min | 3 min (27/27, plus 3/3 on real Chromium) | Dead end: `search` mode is not wired |

**What made it fast:**
- the compiling examples in `tests/fixtures/providers/`;
- zod with strict types;
- clear registry errors;
- the e2e harness (fixture mode, seeding, screenshots).

**What made it slow:**
- a bare "Expected: true / Received: false" contract failure;
- the 16 unrelated test failures after registering;
- writing a fake browser.

## Documentation

**Strengths:**
- It is easy to find: README, then `docs/README.md`, then `docs/providers/adding-a-provider.md`.
  CLAUDE.md also has a Provider SDK section.
- The guide's code blocks equal their source regions (a docs test checks this), and all 105 docs
  tests pass.

**Wrong or misleading on this branch:**
1. `adding-a-provider.md` §2: stay fields with `appliesTo: 'availability'` are said to show on the
   place page. They don't; only the watch, snipe and auto-hold forms render them.
2. `search` catalogue mode is presented as usable. `LocationCatalogService` skips it, and the app
   never calls `searchArea`.
3. `browser-providers.md`: "throw a retryable error and let the core's scheduling decide." The core
   only logs `retryable`, and `ProviderHttpError` drops `Retry-After`.
4. Registering is "one line" plus "contract suite and mapping tests pass". It also breaks 16
   existing tests.

**Gaps:**
- no compiling example of holds or sign-in;
- the core timeouts aren't documented (catalogue sync 60 s, detail and availability 20 s);
- `FixtureHttpClient` works in Jest but isn't suggested;
- `startFixtureServer` in the guide is a private helper in a test file;
- nothing says where provider tests go or how to preview a provider in the app;
- internal references (§12, V7) mean nothing to an outsider;
- the two browser examples use two different fakes.

## SDK interface

- **Defaults:** limits have defaults. But all 10 capability flags are required (no `defineManifest`
  with flags defaulting to off), and there is no `postJson` or schema-validated request helper, no
  rate limiter, and no reusable access-gate base (ParkStay's queue is 632 lines).
- **Errors, from 12 deliberate mistakes:**
  - TypeScript catches capability typos ("Did you mean…") and invalid location kinds or night
    states.
  - The registry reports every manifest problem in one message, and its capability-module check
    is clear ("capability bulkAvailability needs availability.search"). That check runs only at
    runtime.
  - Weak messages: "it has no links", "invalid provider id", and contract failures for an ignored
    abort or a night outside the stay shown as bare booleans.
- **Testing utilities:**
  - The contract suite is strong but can't pass a unit id to its hold check.
  - It doesn't check coordinate ranges, `fullyAvailable` consistency, missing nights, the unit
    filter or https images.
  - `createTestProviderContext` quietly builds a real Playwright browser.

## Flexibility for different provider systems

| Provider type | Verdict | What's missing |
| --- | --- | --- |
| OAuth / API key (Hipcamp-like) | Needs SDK changes | `credentials` sign-in isn't implemented; no OAuth code capture or token refresh |
| Cabins with guest counts and minimum stays (RAC, BIG4) | Partly | Guests work; a minimum stay can only be faked as closed nights plus a label (needs a night reason) |
| Airbnb-like listings | Needs SDK and core changes | `search` mode, hosts, request-to-book vs instant-book, per-listing fees |
| Waiting room or queue | Supported | Heavy lift: no shared gate helper |
| Month-calendar availability | Supported | An adapter inside the provider |
| Multi-currency or GST | Partly | One non-AUD currency works; mixed currencies and tax display don't |
| HTTP 429 / rate limits | Workarounds only | No rate limiter, no `Retry-After`, no core backoff (`createLimiter` caps concurrency only) |

## Recommendations, ranked by effort saved

1. **Make the core and e2e tests provider-agnostic.**
   - Add a `providerFactories` option to `createContainer` and the test harnesses.
   - Have the e2e specs filter to ParkStay rather than assume it is alone.
   - Then registering really is one line.
2. **Add a scaffold.**
   - `npm run provider:new <id> --api|--browser` (`scripts/new-provider.mjs`): manifest, modules,
     fixtures, contract-suite test and a registration line.
   - `.claude/commands/add-provider.md` and an "Adding a provider" checklist in CLAUDE.md that runs
     the full `npm test` and `test:e2e`.
3. **Wire `searchArea` into Explore and the watch flow's location search.** Until then, have the
   registry refuse `catalogMode: 'search'`, and fix the docs.
4. **Ship one locator-capable fake browser** in `tests/utils/fake-browser.ts` that can run forms and
   page scripts, and use it in both browser examples.
5. **Bring fixture mode to `ctx.browser`.** Route it to `tests/e2e/fixtures/browser/<id>/`, or
   refuse to launch a browser in fixture mode.
6. **Type-check capabilities against modules at compile time.** Make `defineProvider` typed so a
   claimed capability without its module fails `tsc`. Add a `defineManifest` with flags defaulting
   to off.
7. **Improve the contract suite.**
   - Descriptive failure messages.
   - The missing checks: coordinates, `fullyAvailable`, missing nights, the unit filter, https
     images.
   - Allow `sample.unitId`.
8. **Fix the docs.** Correct the four claims above, add a quick start, a holds and sign-in example,
   a "preview in the app" recipe, and the core timeouts.
9. **Add SDK helpers:**
   - `postJson` and `requestJson(schema)`;
   - `createRateLimiter`;
   - `Retry-After` on `ProviderHttpError`, with core backoff for `retryable`;
   - per-provider timeouts in `limits`.
10. **Fill the model gaps:**
    - a minimum-stay night reason;
    - per-price currency, tax and fees;
    - `credentials` and OAuth sign-in;
    - an access-gate base class;
    - manifest-driven account wording;
    - reading a booking reference from the confirmation page.

Items 1–4 and 8 would get an agent from "registered" to "working in the app" first time for
API providers and most browser providers. Items 5, 6, 7 and 9 make providers safer and quicker
to write. Item 10 is for the providers on the roadmap (RAC, Hipcamp, Airbnb).

## Evidence

The reviewer's friction log (40 timestamped entries), screenshots of Bush Camps WA in Explore, its
place page and Settings → Accounts, the search-mode dead end, the deliberate-mistake catalogue and
the experiment's code as a patch were kept with the orchestrator's working files.

## Validation after the first fixes (DX1–DX4)

_2026-10-11, on `1e048cf`._ A fresh agent, new to the codebase, added two fictional providers
using only the scaffold and the docs. It started from README, CLAUDE.md and AGENTS.md, logged
every source file the docs didn't point to, and used fixtures and loopback only.

- **Saltbush Cabins** (API): a nested `parks[].cabins[]` catalogue of 5 parks, a per-cabin
  `{date, status, priceCents}` calendar, bulk availability, watches, holds over fake HTTP, an
  optional `browser-session` sign-in and a `pets` stay field.
- **Dune Trail Camps** (browser): a `search`-mode catalogue (area and name search), with
  availability that appears only after a JavaScript search form runs.

| Provider | Compiles | Own tests green | Visible in the app | Full gate green |
| --- | --- | --- | --- | --- |
| Bush Camps WA (API), before | 5 min | 7 min (1 fix) | 11 min | 16 unrelated failures |
| Saltbush Cabins (API), after | 3.8 min | 5.0 min (51/51, first run) | 6.0 min (preview spec, first run) | 11.5 min (Prettier on hand-written files) |
| Coastal Caravan (browser, search), before | 2 min | 3 min | Dead end (search mode not wired) | — |
| Dune Trail Camps (browser, search), after | 2.3 min | 2.9 min (42/42, first run) | 7.6 min (improvised; see below) | 12.8 min |

- **Unrelated test failures after registering:** none. With both providers registered: 4043
  tests passed, `test:tz` passed, and e2e had 21 passed.
- **Source-diving:** four short lookups, about 2 minutes in total.
- **No blockers.** The one major friction was previewing a browser provider in the app: there
  is no recipe, because fixture mode does not serve `ctx.browser`. The agent improvised with a
  loopback copy of its pages and a Chromium wrapper; that recipe weakens TLS and is not
  documented.
- **Doc errors:**
  - the example's hold requests bypass its limiter;
  - `BulkAvailabilityEntry` is undocumented and its field names invite a swap;
  - the signed-in check's e2e fixture route isn't mentioned.
- **Wording bug for providers other than ParkStay:** Settings → Accounts says "before a
  release" for a provider without Site Sniper, and "No account needed" twice.

Follow-ups are in DX5 (`ai-state/streams/providers/tasks/DX5-validation-follow-ups.md`). The
review's item 5 (fixture mode for `ctx.browser`) is now the most valuable next fix.

**Verdict:** an AI agent succeeds first time with an API provider. With a browser provider it
gets everything first time except the in-app preview.
