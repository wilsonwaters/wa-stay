# R2: Polite request pacing

## Description
RAC's terms ask for 10 s between automated requests, one at a time (`ai-state/research/rac-terms.md` rules 2 and 4). The SDK has `maxConcurrentRequests` but no spacing, and each provider enforces its own limit (ParkStay: `src/main/providers/parkstay/client.ts:125`). Brief R8 adds a second speed: what the person triggers (Explore dates, a place page, "Check now") goes one at a time with a short gap, while background work (watches, catalogue sync, snipes) keeps the full gap.

This task adds core-owned pacing of a provider's `ctx.http`, request priorities, deadlines that grow with pacing, no pacing in fixture mode, and fixture routes that match form fields. RAC's availability is one POST path, told apart only by its form.

## Size
M

## Depends on
R1 (same file, `provider.types.ts`: Lane S order only).

## Scope
1. **Limit:**
   - `ProviderLimits.minRequestIntervalMs?: number` (`provider.types.ts:102`, `ProviderLimitsSchema` `:476`): an integer from 0 to 60 000. 0 or absent means unpaced, and `DEFAULT_PROVIDER_LIMITS` leaves it out.
   - A `MANIFEST_RULES` entry (`src/main/providers/registry.ts:85`): `minRequestIntervalMs > 0` needs `maxConcurrentRequests: 1`.
2. **Paced client**, new `src/main/providers/sdk/pacing.ts`, exported from the barrel:
   - `createPacedHttpClient(inner, { intervalMs, … })` implements `HttpClient`, with one request in flight.
   - **Gaps.** A request starts only when the gap since the previous request ended has passed. A request ends when its response is read or it fails. The gap is `intervalMs` for a background request and `INTERACTIVE_REQUEST_GAP_MS` (1 000) for an interactive one. Measure it with a monotonic clock, never `Date`.
   - **Order.** Interactive requests start before queued background ones. Each class keeps call order.
   - **Every path takes a turn:** `request`, `getJson` and `postForm`. `withDefaults()` returns a client on the same queue. `cookies` is the inner store.
   - **Waiting.** A request's `timeoutMs` starts when it is sent, not while it waits. A caller's abort removes a waiting request at once with an `AbortError`, and it uses no turn. A redirect chain counts as one request.
   - **Priority.** `HttpRequestOptions.priority?: 'interactive' | 'background'` (`http.ts:45`). Without it, the ambient priority applies: `withRequestPriority(priority, fn)` (AsyncLocalStorage) and `currentRequestPriority()`, default `background`. It is read when `request` is called.
3. **Wiring:**
   - `createProviderContext` (`context.ts:89`) wraps `deps.createHttp(id)` when the provider's `minRequestIntervalMs > 0`, unless `ProviderContextDeps.unpaced` is true.
   - `registry.httpOf` returns the paced client, so the account check shares the queue.
   - The container (`src/main/app/container.ts:218`) sets `unpaced: true` in fixture mode only.
   - **Interactive:** `LocationCatalogService.get` (`:844`), `.availability` (`:981`) and `.checkLocation` (`:1074`), and `WatchLoop.launch` (`watch-loop.ts:126`) when `manual`.
   - Enter the scope inside the limiter task: a queued task inherits the context of whatever starts it.
   - **Background:** everything else (sync, `refresh`, area and text searches, the due loop, snipes, account checks).
4. **Deadlines** (`location-catalog.service.ts:208-210`, `catalog-helpers.ts`):
   - `pacedDeadlineMs(baseMs, limits, { requests, priority })` returns `baseMs` for an unpaced provider. Otherwise it returns `baseMs + requests × (gap + PACED_REQUEST_ALLOWANCE_MS)`, with an allowance of 10 000 ms.
   - `requests` per call:
     - `getLocation` and `check`: 2 (its own, and one already in flight ahead of it);
     - bulk `search`: the provider's stored location count (at most one request per place);
     - `listLocations`: the stored count, at least 1, with the background gap.
   - ParkStay's deadlines are unchanged.
5. **Fixture routes** (`src/main/testing/fixture-http-client.ts:41-48, 76-90`):
   - Optional `form: Record<string, string>`. It matches a request whose body, read as `application/x-www-form-urlencoded`, has those values. Fields the route leaves out may have any value.
   - A route with `form` never matches a request without a form body.
   - `matchFixtureRoute(routes, method, url, body?)`, so `fixture-documents.ts:75` still works.
   - A refused request's log entry and message name the form fields.
6. **Docs:**
   - `docs/providers/adding-a-provider.md`:
     - the limits table (`:324-328`) and the "slow down" advice (`:1366`): `minRequestIntervalMs`, priorities, and that the core keeps a paced provider to one request in flight;
     - the Timeouts table (`:1338-1342`): how paced deadlines grow;
     - the route format (`:1424`).
   - `tests/e2e/fixtures/http/README.md`: the route format.
   - CLAUDE.md: the HTTP row of Tech Stack, the Provider SDK "Context" bullet, and the LocationCatalogService row.

## Non-goals
- RAC's manifest, client, headers and block cool-down (R5).
- RAC's eight-POST bulk search and "Still checking RAC…" (R11). A 403 or 429 ending a snipe (R12).
- No change to ParkStay's limits or its own limiter.
- No pacing of provider windows or of images the renderer loads. No retry or backoff in the core.

## Completion Criteria
- [ ] `tests/unit/providers/pacing.test.ts` (fake timers) proves each rule:
  - "no two background requests start within intervalMs of the previous end";
  - "one in flight";
  - "interactive first, after a 1 s gap";
  - "withDefaults shares the queue";
  - "getJson and postForm take a turn";
  - "abort leaves the queue without a turn";
  - "the timeout counts from the send";
  - "explicit priority beats the ambient one";
  - "the ambient priority holds inside a limiter task".
- [ ] `registry.test.ts`:
  - `minRequestIntervalMs: 10_000` with `maxConcurrentRequests: 4` fails registration, naming the rule;
  - the schema rejects -1, 1.5 and 60 001.
- [ ] `tests/unit/providers/context.test.ts`: the http is paced with the limit, and not with `unpaced` or without the limit. ParkStay's context http is the inner client, unwrapped.
- [ ] `tests/unit/testing/container-fixture-mode.test.ts`: fixture-mode contexts are unpaced.
- [ ] Catalogue tests (fake paced provider, fake timers):
  - a bulk search of 8 places sending 8 requests finishes inside its deadline;
  - an unpaced provider keeps the 20 s deadline;
  - `get`, `checkLocation` and `availability` send interactive requests, and sync sends background ones.
- [ ] Scheduler test: "Check now" sends interactive requests and the due loop sends background ones.
- [ ] `tests/unit/testing/fixture-http-client.test.ts`:
  - a `form` route matches;
  - fields it leaves out may be anything;
  - it never matches a request without a body;
  - two routes on one path are told apart by `blog_id`;
  - the manifest schema rejects non-string form values.
- [ ] The guide, the fixtures README and CLAUDE.md are updated. `tests/unit/docs/provider-guide.test.ts` passes.
- [ ] The full gate passes: `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`, then `npm run build:e2e && xvfb-run -a npm run test:e2e`. Journey times are unchanged, because fixture mode is unpaced.

## Edge Cases
- A request that fails (network, 4xx, 5xx, timeout) still ends its turn and starts the gap.
- The wall clock is set back or the computer sleeps: the monotonic gap never shrinks. After a resume it may be longer, never shorter.
- Quit with requests waiting: callers' signals abort (catalogue `stop`, scheduler `stop`), and `tests/integration/quit-shutdown.test.ts` still passes.
- A provider without the limit: no wrapper, no change.
- Nested `withRequestPriority`: the inner one wins.
- Steady interactive traffic delays background requests. That is bounded: Explore's bulk answers are cached for 5 min.
- A paced provider with 0 stored places: `requests` is 1.
- A route with both `query` and `form`: both must match.

## Test Strategy
- **Unit:** pacing (≈12), `pacedDeadlineMs` (≈5), fixture `form` matching (≈6), schema and manifest rule (≈4).
- **Component:** none.
- **Integration:** context and container (≈3), catalogue priorities and deadlines (≈4), the watch loop's priority (≈2).
- **E2E:** none new. The suite must pass unchanged.

## Context Files to Read First
- `ai-state/brief.md` Project 2 (R8, RO3); `ai-state/research/rac-terms.md` rules 2–5
- `ai-state/streams/rac/master-plan.md` (decision 7, RS2)
- `src/main/providers/sdk/http.ts`, `concurrency.ts`, `context.ts`, `index.ts`, `errors.ts`
- `src/main/providers/registry.ts` (`MANIFEST_RULES`, `httpOf`)
- `src/main/app/container.ts:200-230`
- `src/main/core/catalog/location-catalog.service.ts`, `catalog-helpers.ts`
- `src/main/scheduler/watch-loop.ts`
- `src/main/testing/fixture-http-client.ts`, `fixture-documents.ts`
- `tests/unit/testing/fixture-http-client.test.ts`, `tests/unit/providers/context.test.ts`
- `docs/providers/adding-a-provider.md` (Limits, Timeouts, FixtureHttpClient), `tests/unit/docs/provider-guide.test.ts`

## Notes
- **Why an ambient priority.** The core knows who asked: the place page, or the due loop. The provider does not. A scope set by the core needs no change to module signatures, and a provider cannot mislabel its traffic. The per-request option stays as the master plan's override.
- **Interactive pace.** With a 1 s gap, eight RAC POSTs at 4–8 s each take about 40–70 s, which matches brief R8.
- **Spacing.** The gap is measured from the end of one request to the start of the next. That is stricter than start-to-start and matches "10 s between requests".

## Assumptions
- `INTERACTIVE_REQUEST_GAP_MS` (1 000 ms) is a core constant, not a per-provider limit. The master plan lists only `minRequestIntervalMs`.
- "Priority for checks" (master plan R2 row) means requests the person triggers, per brief R8.
- A manual `catalog.refresh` stays background: it is a whole-catalogue sync.
- One queue per provider per app run, shared by every caller. Rule 4's "one session" holds.
