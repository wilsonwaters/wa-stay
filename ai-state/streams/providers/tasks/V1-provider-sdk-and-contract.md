# V1 — Provider SDK and contract

**Stream:** providers · **Depends on:** P3

## Description

Every later provider task, and the whole renderer lane, codes against this contract. V1 turns architecture-notes §3 into code:

- the serialisable shared types;
- the main-process `AccommodationProvider` interface and `ProviderContext`;
- an `HttpClient` abstraction bound to a per-provider Electron session partition;
- the provider registry;
- the IPC contracts for the `providers`, `catalog` and `accounts` namespaces.

V1 also registers a **manifest-only** ParkStay entry, so `providers.list()` returns real data for D3's `ProviderBadge` before V3 lands.

The task also defines the types §3 names but never specifies, and the additive fields agreed with sibling streams (see the master plan, "Contract additions").

This is a technical task.

## Size

L. It is architectural: six provider tasks and lanes R and A depend on these interfaces. A design review is needed before planning.

## Scope

- **`src/shared/types/provider.types.ts`.** Shared types; no node or electron imports.
  - The §3 types: `ProviderId`, `ProviderManifest`, `ProviderCapabilities`, `LocationKind`, `BookingMode`, `StayQuery`, `NightState`, `NightStatus`, `UnitAvailability`, `LocationAvailability`, `BulkAvailabilityEntry`.
  - Addition to `ProviderManifest`: `stayFields?: StayFieldSpec[]`, where `StayFieldSpec = { key, label, kind: 'select'|'number'|'text'|'boolean', options?, min?, max?, pattern?, help?, default?, usedBy: ('watches'|'snipes'|'holds')[] }`.
  - Addition to `ProviderCapabilities`: `accessGate: boolean`.
  - Additions to `StayQuery`: `params?: Record<string, string | number | boolean>`.
  - Addition to `LocationAvailability`: `bookingUrl?`.
  - New types:
    - `AccessStatus = { providerId, state: 'unsupported'|'idle'|'waiting'|'active'|'expired'|'error', position?, etaSeconds?, expiresAt?, message?, updatedAt }`;
    - `AccountStatus`;
    - `ProviderAccount = { providerId, requirement: ProviderCapabilities['account'], status: 'signed-in'|'signed-out'|'unknown', displayName?, email?, lastSignedInAt?, lastCheckedAt? }`.
  - zod schemas next to the types: `ProviderIdSchema` (`/^[a-z][a-z0-9-]{1,31}$/`), `CalendarDateSchema` (`YYYY-MM-DD`, a real date), `StayQuerySchema` (departure after arrival, adults ≥ 1).
- **`src/shared/types/catalog.types.ts`.**
  - `LocationSummary`.
  - `LocationDetail`, plus `fetchedAt?: string` and `stale?: boolean` so offline detail can be shown honestly (V5).
  - `UnitSummary = { unitId, unitName, unitType?, maxPeople?, maxVehicles?, equipment: string[], description? }`.
  - `CatalogQuery = { text?, providerIds?, kinds?, regions?, amenities?, bookingModes?, bbox?: [west, south, east, north], limit? (1–5000, default 50), offset?, sort?: 'relevance'|'name' }`.
  - `CatalogSearchResult = { items, total, facets?: { regions, amenities, kinds, providers: { value, count }[] } }`.
  - `CatalogAvailabilityResult = { entries: BulkAvailabilityEntry[], errors: { providerId, code, message }[] }`.
  - `CatalogStatus = { providers: { providerId, count, syncedAt?, stale, syncing, lastError? }[] }`.
- **`src/shared/utils/location-key.ts`:**
  - `makeLocationKey(providerId, externalId)`;
  - `parseLocationKey(key)`, which splits on the **first** `:` and throws on a bad key.
- **`src/main/providers/sdk/`:**
  - `provider.ts`:
    - `AccommodationProvider` and `ProviderFactory` per §3;
    - the modules `CatalogModule`, `AvailabilityModule`, `HoldsModule` (`create`, `paymentUrl`, `paymentOrigins?`), `BookingsModule`, `ProviderLinks` (`location`, `booking`, `manageBooking?`);
    - `AccessGate`:
      - `status(): AccessStatus`;
      - `ensure({ signal?, maxWaitMs? })`, which resolves when the gate is active;
      - `holdOpen(): () => void`, a ref-counted keep-alive that returns its release function;
      - `onStatus(cb) => unsubscribe`;
      - `dispose()`.
    - `ReleasePolicy`:
      - `supports(mode)`;
      - `computeReleaseAt({ mode, externalId, stay, requestedAt?, now, signal? }): Promise<Date | null>`, where `null` means continuous;
      - `describe(externalId, signal?)`;
      - `suggestScheduledAt?(externalId, now)`;
      - `pollFloorMs: { window, continuous }`.
    - `HoldRequest = { externalId, unitId?, unitGroupId?, stay }`.
    - `HoldResult = { ok: true, reference, expiresAt, unitId? } | { ok: false, reason: 'taken'|'in-progress'|'auth-required'|'closed'|'invalid'|'error', message }`.
    - `ProviderAuth = { kind: 'browser-session', signInUrl, allowedOrigins, completionUrlPatterns?, isSignedIn(http, signal?) }`. §3's `isSignedIn(session)` takes the provider's `HttpClient` here.
    - `ExternalBooking`.
    - `SnipeReleaseMode` is re-used from `common.types.ts:27-31`.
  - `context.ts`: `ProviderContext` per §3, plus `createProviderContext(id, deps)`.
  - `http.ts`:
    - the `HttpClient` interface: `request(method, url, { query?, headers?, body?, timeoutMs = 30000, signal?, redirect? })` returns `HttpResponse { status, ok, url, headers, text(), json() }`;
    - `getJson` / `postForm` helpers, which throw `ProviderHttpError` on a non-2xx response and `ProviderParseError` on a non-JSON body;
    - `withDefaults({ headers })`;
    - `cookies: CookieStore` with `get(url, name)`, `getAll(url)`, `set(cookie)` and `clear()`.
  - `http-electron.ts`: `ElectronSessionHttpClient`.
    - Uses `session.fromPartition('persist:provider-<id>')` and calls `ses.fetch(url, { credentials: 'include', ... })`.
    - Sets the partition user agent once with `ses.setUserAgent` (the Chrome UA, so the sign-in windows match).
    - Cookies go through `ses.cookies`.
    - This is the **only** file under `providers/` that imports `electron`.
  - `http-node.ts`: `NodeHttpClient`, for tests.
    - Uses global `fetch` with `redirect: 'manual'` and follows up to 5 hops itself, capturing `Set-Cookie` on every hop.
    - Has an RFC 6265-style in-memory `CookieJar`: the value is everything after the **first** `=`; `Domain`/`Path`/`Expires`/`Max-Age`/`Secure` are honoured; a domain cookie for `dbca.wa.gov.au` matches its subdomains.
  - `kv-store.ts`: the async `KeyValueStore` (`get<T>`, `set`, `delete`, `list(prefix)`) and `InMemoryKeyValueStore`. V2 adds the SQLite store.
  - `secrets.ts`: `ScopedSecretVault` (`get`/`set`/`delete`) and `createScopedSecretVault({ vault, store })`. This is a thin layer over P5's `SecretVault.encrypt`/`decrypt` (P5 scope note). It stores only ciphertext in the provider's `KeyValueStore` under `secret:<key>`, so values become persistent once V2 swaps in the SQLite store. Also `FakeSecretVault` for tests (a reversible fake cipher).
  - `browser.ts`: the `BrowserAutomation` interface (`isAvailable()`, `withPage(fn, opts)`, `close()`) and `UnavailableBrowserAutomation`, which throws `BrowserUnavailableError`. V7 replaces it.
  - `errors.ts`:
    - the base `ProviderError { providerId, code, retryable, cause? }`;
    - subclasses `ProviderCapabilityError { capability }`, `UnknownProviderError`, `ProviderRegistrationError`, `ProviderHttpError { status, url }`, `ProviderTimeoutError`, `ProviderParseError`, `ProviderAuthRequiredError`, `AccessGateError { state }`, `BrowserUnavailableError`;
    - `toApiError(err)`, which maps any of these to `{ code, message }` for P3's `handle.ts`. V1 extends P3's `ApiErrorCode` with:
      - `CAPABILITY` (the platform master plan names it);
      - `UNKNOWN_PROVIDER`;
      - `PROVIDER_ERROR` (HTTP, timeout and parse failures, with `retryable` kept in the log);
      - `ACCESS_GATE`;
      - `AUTH_REQUIRED`.

      V6 adds `ACCOUNT_BUSY` and `HOLD_EXPIRED`.
  - `concurrency.ts`: `createLimiter(n)` and `mapWithConcurrency(items, n, fn)`.
  - `index.ts`: the barrel.
- **`src/main/providers/registry.ts`.** `ProviderRegistry` with:
  - `register(factory, ctx)`;
  - `get` (throws `UnknownProviderError`) and `tryGet`;
  - `list()`: manifests sorted by `name`;
  - `withCapability(cap)`;
  - `require(id, cap)`, which throws `ProviderCapabilityError`;
  - `disposeAll()`.

  It validates every manifest with zod and enforces these consistency rules:
  - `catalog` needs `catalog`;
  - `availability` and `watches` need `availability.check`;
  - `bulkAvailability` needs `availability.search`;
  - `holds` needs `holds`;
  - `snipes` needs `availability`, `holds` and `release`;
  - `accessGate` needs `access`;
  - `account !== 'none'` needs `auth`;
  - `bookingImport` needs `bookings.get`.
- **`src/main/providers/index.ts`.** `BUILT_IN_PROVIDERS = [parkstayFactory]` and `registerBuiltInProviders(registry, makeContext)`.
- **`src/main/providers/parkstay/index.ts`.** Manifest only:
  - `id 'parkstay'`, `name 'ParkStay WA'`, `shortName 'ParkStay'`;
  - `website https://parkstay.dbca.wa.gov.au`, `integration 'api'`;
  - `timezone 'Australia/Perth'`;
  - `locationKinds`: the V3 list;
  - `brand { color, monogram: 'PS' }`;
  - every capability `false` and `account: 'none'`. V3 and V6 turn them on as the modules land.
  - `links.location(id)` returns `https://parkstay.dbca.wa.gov.au/search-availability/campground/?site_id={id}`.
- **Contracts:** `src/shared/contracts/{providers,catalog,accounts}.ts` follow P3's pattern: channel names, zod request schemas, response types and event payloads (`provider:access-status`, `catalog:updated`, `account:updated`).
  - `accounts` includes `openSignInLink(providerId, url)`.
  - The `catalog` and `accounts` namespaces are exported for typing only. V5 and V6 wire them into the preload with real handlers.
- **`src/main/ipc/handlers/providers.handlers.ts`:**
  - `providers.list()`;
  - `providers.accessStatus(id)`, which returns `{ state: 'unsupported' }` when there is no gate;
  - forwarding of `access.onStatus` to the `provider:access-status` event through P3's events bus;
  - the preload exposes the `providers` namespace.
- **Container (P3 `app/container.ts`).** One registry. Each provider context gets:
  - `ElectronSessionHttpClient`;
  - `InMemoryKeyValueStore`, until V2 swaps in SQLite;
  - `createScopedSecretVault` over P5's vault and the provider's KV store;
  - a child logger `{ provider }`;
  - `clock`;
  - `UnavailableBrowserAutomation`.

  `registry.disposeAll()` runs on `before-quit`.
- **`tests/utils/fake-provider.ts`.** `createFakeProvider({ id = 'fake', capabilities?, locations?, availability?, account? })`.
  - It implements every module in memory: a fake access gate with scripted states, a release policy and holds.
  - Knobs: `failNext(module, error)`, `delayMs`, AbortSignal handling, and a `calls` log.
  - A second instance (`id: 'fake2'`) proves multi-provider behaviour.
- **`tests/utils/provider-contract.ts`.** `describeProviderContract(name, makeProvider)`, a reusable conformance suite: manifest valid, capabilities match the modules, keys round-trip, `AbortSignal` honoured, errors are `ProviderError`. V3 and V7 reuse it.

## Non-goals

- ParkStay behaviour, endpoints and fixtures (V3). Its capabilities stay `false` here.
- The `provider_state`, `provider_accounts` and `locations` tables, and the SQLite KV store (V2).
- `catalog.*` handlers (V5). `accounts.*` handlers and the sign-in windows (V6).
- The Playwright runtime (V7). Core services (V4).
- Renderer hooks and the `ProviderBadge` UI (D2/D3).

## Completion Criteria

- [ ] `src/shared/types/provider.types.ts` and `catalog.types.ts` export every §3 type plus the additions listed under Scope. `grep -rn "from 'electron'\|from 'node:\|from 'fs'" src/shared` → 0 results.
- [ ] `grep -rln "from 'electron'" src/main/providers` → only `sdk/http-electron.ts`. `grep -rn "axios" src/main/providers` → 0.
- [ ] Registry tests, table-driven with one case per rule, pass:
  - a duplicate id throws `ProviderRegistrationError`;
  - an invalid id (`'ParkStay'`) throws;
  - each of the eight capability/module consistency rules throws when broken;
  - `require('fake', 'holds')` on a provider without holds throws `ProviderCapabilityError` with `providerId` and `capability` set;
  - `get('nope')` throws `UnknownProviderError`.
- [ ] `CookieJar` tests pass:
  - `sitequeuesession=AB=C==; Domain=dbca.wa.gov.au; Path=/` round-trips the value `AB=C==`;
  - it is sent to `https://queue.dbca.wa.gov.au/api/x` and `https://parkstay.dbca.wa.gov.au/` but not to `https://example.com/`;
  - `Max-Age=0` deletes the cookie;
  - an expired `Expires` is not sent.
- [ ] `NodeHttpClient` tests against a local `http.createServer` on 127.0.0.1 pass:
  - cookies set on a 302 hop are stored and sent on the final hop;
  - `timeoutMs: 100` against a hanging route throws `ProviderTimeoutError`;
  - an aborted signal rejects with an `AbortError`;
  - `getJson` on a `text/html` 200 response throws `ProviderParseError`;
  - `getJson` on a 500 throws `ProviderHttpError` with `status 500`.
- [ ] `ElectronSessionHttpClient` test (`jest.mock('electron')`):
  - `session.fromPartition` is called with `'persist:provider-parkstay'`;
  - `ses.fetch` receives `credentials: 'include'` and the `Referer` header passed in;
  - `ses.setUserAgent` is called once;
  - `cookies.get`, `cookies.set` and `cookies.clear` map to `ses.cookies.get`, `ses.cookies.set` and `ses.cookies.remove`.
- [ ] Contract schema tests pass:
  - `CatalogQuery` rejects `limit: 0` and `limit: 5001`, and a `bbox` with a non-finite value;
  - `StayQuerySchema` rejects `departure <= arrival` and `2026-02-30`;
  - `parseLocationKey('parkstay:12:3')` returns `{ providerId: 'parkstay', externalId: '12:3' }`;
  - `parseLocationKey('nokey')` throws.
- [ ] `providers.list()` over IPC (handler test with P3's harness) returns one manifest, `id: 'parkstay'`, which passes the manifest zod schema. `providers.accessStatus('parkstay')` returns `{ state: 'unsupported' }`. `providers.accessStatus('nope')` returns `success: false` with code `UNKNOWN_PROVIDER`.
- [ ] `describeProviderContract` passes for FakeProvider and for a two-provider registry (`fake`, `fake2`).
- [ ] Scoped-vault test: `secrets.set('token', 'abc')` on provider `fake` writes a `secret:token` entry to the KV store, and that entry is not the plaintext. `get` returns `'abc'`. Provider `fake2` cannot read it.
- [ ] The app starts (`npm run build && xvfb-run -a npx electron . --no-sandbox`). DevTools `await window.api.providers.list()` returns the ParkStay manifest.
- [ ] `npm run lint && npm run format:check && npm run type-check && npm test` passes.

## Edge Cases

- **Location keys.** An external id containing `:` round-trips. An empty provider or external id is rejected.
- **Bad provider registration.** A factory that throws during registration surfaces a `ProviderRegistrationError` naming the provider. The app still starts with the other providers. Test this with FakeProvider.
- **Cookies:**
  - `Set-Cookie` with `SameSite=None` and no `Secure` is accepted by the Node jar (tests only);
  - multiple `Set-Cookie` headers in one response are read via `headers.getSetCookie()`;
  - a host-only cookie (no `Domain`) does not leak to subdomains.
- **Requests:**
  - `timeoutMs` and a caller `signal` are combined, and whichever fires first wins;
  - the timer is cleared on success, so no open handles are left in Jest;
  - a redirect loop over 5 hops throws `ProviderHttpError`.
- **Disposal.** `disposeAll()` calls `dispose` on every provider even if one rejects. It logs the failures and never throws on quit.
- **Missing preload namespaces.** The `catalog` and `accounts` namespaces are not in the preload until V5/V6, so the renderer must use their types only.

## Test Strategy

- **Unit (~45):**
  - registry rules (~12);
  - `CookieJar` (~10);
  - `NodeHttpClient` against a local server (~8);
  - `ElectronSessionHttpClient` with mocked electron (~4);
  - location-key and zod schemas (~8);
  - `createLimiter` concurrency cap and order (~3).
- **Component:** none (no UI).
- **Integration (~4):**
  - `providers.*` handlers through P3's `handle()` harness;
  - FakeProvider and a two-provider registry through `describeProviderContract`.

## Context Files to Read First

- `ai-state/architecture-notes.md` §1–§4, §7, §10 (binding).
- `ai-state/streams/providers/master-plan.md`: "Contract additions" and "Integration points".
- `ai-state/streams/provider-ux/master-plan.md`: OQ1, OQ2, OQ4.
- `ai-state/streams/explore/master-plan.md`: EQ1, EQ2, EQ4, EQ7.
- `ai-state/streams/design-system/master-plan.md`: the V1 row (`ProviderBadgeInfo`).
- `src/main/app/container.ts`, `src/main/ipc/handle.ts`, `src/shared/contracts/*` and `src/preload/index.ts`, as left by P3.
- `src/main/services/parkstay/parkstay.service.ts:81-124`: today's hand-rolled cookie handling, which this replaces. The bug at `:117` and `:172` is `split('=')`.
- `src/main/utils/browser-headers.ts:13-57`: the Chrome UA to reuse for the partition.
- `src/shared/types/common.types.ts:27-31` (`SnipeReleaseMode`) and `src/shared/types/api.types.ts:98-104` (`APIResponse`).

## Notes

- **Why ParkStay is manifest-only here.** D3 needs real manifests (brand, `shortName`) and must not wait for V3. Capabilities stay `false` so the registry rules hold, and the ParkStay module can be filled in without changing the contract.
- **Brand colour.** Pick a dark green that passes AA with a white monogram, for example `#2F5D50`. D1 may map it to a token. This is data, not renderer styling.
- **`ses.fetch` cookie behaviour.** Electron 28 exposes it. `credentials: 'include'` makes it use and store session cookies. If live testing (V3) shows `Referer` is dropped by Chromium's network stack, set `init.referrer` as well. Note the outcome in the PR.
- **ParkStay blocks some user agents.** It rejects UAs containing `axios`, `python`, `curl`, `java`, `httpclient` and similar (`parkstay_bs_v2/parkstay/queue_middleware.py:16-28`), returning a queue-redirect page. The partition UA must be the Chrome UA and never a library default.
- **New dependencies.** None; `sanitize-html` and `playwright-core` are already installed (§10). Commit as `feat(providers): provider SDK, registry and contracts (#<issue>)`.
