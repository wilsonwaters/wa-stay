# Providers: master plan

**Stream:** providers · **Label:** `stream:providers` · **Lane:** M (main process), after P3 · **Status:** ⬜ not started

## Goal

Accommodation providers become plug-in modules behind one SDK (architecture-notes §3). ParkStay is rebuilt as the first module, using only real DBCA endpoints that were live-probed and checked against the DBCA backend source (`dbca-wa/parkstay_bs_v2`). Watches, Site Sniper, bookings, the location catalogue and provider accounts become provider-agnostic core services. A browser-automation runtime is added for providers that have no API.

When the stream is done:

- `src/main/providers/sdk/` defines the contract. `registry.ts` and `providers/index.ts` register the built-in providers. A new provider is a new folder plus one line, with no changes to core, IPC or renderer (brief success criterion 6).
- Everything DBCA-specific lives in `src/main/providers/parkstay/`. The fabricated endpoints and their types are deleted: `/auth/login`, `/account/`, `/accounts/logout/`, `/bookings/…`, `/queue/status/` and `/campsite_availability/{id}/`.
- Site Sniper polls live ParkStay correctly. It sends `YYYY/MM/DD` dates and parses `[bookable, label, price, _, _, date]` tuples (criterion 7). Watches see real per-night prices.
- `src/main/core/{watches,snipes,bookings,catalog,accounts}` resolve providers only through the registry and their capabilities. A missing capability raises a typed `ProviderCapabilityError`.
- Migration v8 makes the database provider-aware. A v6 database upgrades with no data loss (the data half of criterion 2).
- The scheduler fixes three defects: snipe ticks overlap, watch intervals are ignored, and timers are not re-armed after sleep (tech-review #2 and #11).
- ParkStay sign-in happens in the app on the `persist:provider-parkstay` session. Holds and the payment hand-off use that same session, which fixes tech-review #3 and implements brief D5.

The stream delivers brief scope items 2 and 3, part of 8, success criteria 6 and 7, and the provider half of criteria 2 and 5.

## Task list

| ID | Task | Size | Depends on | Status |
|---|---|---|---|---|
| V1 | [Provider SDK and contract](tasks/V1-provider-sdk-and-contract.md): shared provider/catalog types, `providers/sdk/*` (provider, context, HttpClient with Electron and Node implementations, KV store, scoped vault, errors, limiter), registry, built-ins index with a manifest-only ParkStay, `providers`/`catalog`/`accounts` contracts, `providers.*` handlers, FakeProvider, contract test suite | L | P3 | ⬜ |
| V2 | [Provider-aware data model](tasks/V2-provider-aware-data-model.md): migration v8 (rebuilds of watches, site_snipes and bookings, `provider_accounts`, `provider_state`, `locations` + FTS5, `YYYY-MM-DD` calendar dates), provider-aware domain types and contracts, repositories, SQLite KV store, a seeded local profile row, migration tests from the v5 and v6 fixtures | L | P2, V1 | ⬜ |
| V3 | [ParkStay provider module](tasks/V3-parkstay-provider-module.md): client, catalogue, detail, availability, access gate (queue), release policy, holds and links in `providers/parkstay/`; existing services rewired onto it; fabricated code deleted; Site Sniper date/tuple fixes; real prices; trimmed live fixtures | L | V1, V2 | ⬜ |
| V4 | [Provider-agnostic core services and scheduler correctness](tasks/V4-core-services-and-scheduler.md): `core/watches`, `core/snipes`, `core/bookings` through the registry; release and access-gate semantics from the provider; `providerId` on notifications; auto-hold; scheduler fixes (in-flight guard, chained timers, abort, intervals, `next_check_at`, resume re-arm) | L | V2, V3 | ⬜ |
| V5 | [Location catalogue service](tasks/V5-location-catalogue-service.md): `core/catalog/LocationCatalogService` (24 h sync, offline cache, per-provider isolation), FTS search and facets, cached detail, cross-provider bulk availability, `catalog.*` IPC and `catalog:updated` | M | V2, V3 | ⬜ |
| V6 | [Provider accounts, in-app sign-in and payment hand-off](tasks/V6-provider-accounts-and-sign-in.md): `core/accounts/ProviderAccountService`, ParkStay `auth.ts` (`/ssologin`, `/api/profile`), sign-in and payment windows on the provider partition, sign-out, `accounts.*` IPC, `snipes.openPayment`, payment success marks the snipe booked, legacy credentials retired (`auth` namespace, migration v9) | L | V1, V3, V4, P5 (soft D3) | ⬜ |
| V7 | [Browser automation runtime](tasks/V7-browser-automation-runtime.md): `providers/sdk/browser-automation.ts` on `playwright-core` (lazy, Edge/Chrome channel detection, persistent profile, headless/headed, timeouts, shutdown), `ProviderContext.browser`, a browser-driven FakeProvider, developer notes | M | V1 | ⬜ |

**Recommended Lane M order:** V1 → V2 → V3 → V7 → V4 → V5 → V6. V7 can go anywhere after V1. streams.md runs `{V2, V3, V7}` in parallel. This plan runs V3 after V2 because V3 rewires the existing services onto V2's types, so parallel work would mean doing those edits twice.

**Changes to streams.md dependencies.** V3 adds V2. V6 adds V4, because `snipes.openPayment` and marking a snipe booked live in V4's `core/snipes`. V6 also soft-depends on D3, because it deletes `Login.tsx` only after D3 removes the login gate. Lane order already satisfies all three, so the critical path does not change.

## Contract additions beyond architecture-notes §3–§5

Every addition is additive and is listed here so reviewers can see each one.

| Addition | Task | Reason |
|---|---|---|
| Definitions for names §3 uses but does not define: `UnitSummary`, `AccessGate`/`AccessStatus`, `ReleasePolicy`, `HoldRequest`/`HoldResult`, `ProviderAuth`/`AccountStatus`, `ExternalBooking`, `HttpClient`, `KeyValueStore`, `ScopedSecretVault` | V1 | Needed for anyone to implement against §3 |
| `UnitSummary = { unitId, unitName, unitType?, maxPeople?, maxVehicles?, equipment: string[], description? }` | V1 | Same naming as §3 `UnitAvailability`. Answers explore EQ4. E2 should read `unitId`/`unitName`/`unitType`. |
| `ProviderManifest.stayFields?: StayFieldSpec[]`, plus `StayQuery.params?` to carry their values | V1 | provider-ux OQ1. Gear type, vehicles and postcode get no hard-coding in core or renderer. |
| `ProviderCapabilities.accessGate: boolean`. `providers.accessStatus` returns `{ state: 'unsupported' }` when a provider has no gate. | V1 | provider-ux OQ2 |
| `links.manageBooking?(reference)` and the booking DTO `manageUrl` | V1, V4 | provider-ux OQ4 |
| `LocationAvailability.bookingUrl?`, filled from `links.booking(externalId, stay)` | V1, V3 | explore EQ1 |
| `catalog.search` result `facets?`. `catalog.availability` returns `{ entries, errors }` with per-provider errors. | V1, V5 | E1 filter chips; E3 per-provider error isolation (explore EQ7) |
| `CatalogQuery` uses `text` (not `q`). `limit` goes up to 5000. | V1 | explore EQ2. **provider-ux U1 must use `text`** (its spec says `q`). |
| `accounts.openSignInLink(providerId, url)` | V1, V6 | Fallback if ParkStay emails a magic link rather than a code (PQ1) |
| v8 rebuilds `watches`, `site_snipes` and `bookings` instead of only adding columns. Legacy ParkStay columns move into `stay_params`, `queue_enabled` becomes `access_gate_enabled`, and `held_*` becomes `hold_*`. | V2 | Removes NOT NULL ParkStay columns and the `release_mode` CHECK that would block other providers. No duplicate columns are left behind (§1). |
| `locations.detail` JSON plus `detail_fetched_at` | V2 | Location detail works offline (V5) |
| `LocationDetail.fetchedAt?` and `stale?` | V1, V5 | Offline or failed-refresh detail is labelled honestly instead of looking fresh |

**Answers to sibling streams' open questions:**

- provider-ux OQ1: yes, `stayFields`.
- OQ2: yes, `capabilities.accessGate`.
- OQ3: `autoHold` is wired to holds and rejected when the provider has no holds (V4; PQ4).
- OQ4: yes, `manageUrl`.
- OQ5: generic `SnipeReleaseMode` values `daily_rollover`, `scheduled` and `cancellation` (existing values, no data migration). The provider computes `release.opensAt` and `releaseInfo`.
- OQ11: per-night prices are real (V3), so `maxPrice` applies (V4).
- Explore EQ6: no manifest stay limits in this stream, so E3's default stands.
- EQ7: availability never waits in the DBCA queue. A gated provider returns an `access-gate` error entry straight away.

## Integration points

1. **Platform.**
   - **P1:** main-process tests run in the Jest `node` project.
   - **P2:**
     - the single `BaseRepository` style (injected `Database`, parameterised SQL);
     - `applyMigration`, which sets `foreign_keys=OFF` *outside* the transaction (v8 and V6's v9 rebuild tables);
     - the v5 (released v1.2.0) and v6 SQL-dump fixtures through `loadFixture` (`.gitignore` ignores `*.db`);
     - `QueueSessionRepository`, which V2 repoints to `provider_state` and V3 deletes.
   - **P3:**
     - `app/container.ts` builds the registry and core services;
     - `ipc/handle.ts` and the `shared/contracts/` pattern;
     - the events bus with unsubscribe;
     - the typed preload;
     - `requireUserId()`: V2's v8 seeds the local profile row, so `NO_PROFILE` stops happening (platform open question 1);
     - `ApiErrorCode`: V1 adds `CAPABILITY`, `UNKNOWN_PROVIDER`, `PROVIDER_ERROR`, `ACCESS_GATE` and `AUTH_REQUIRED`; V6 adds `ACCOUNT_BUSY` and `HOLD_EXPIRED`.
   - **P4:**
     - its CSP already allows `img-src https:` (platform open question 5), so provider images need no CSP change;
     - main-window navigation guards must not apply to provider windows;
     - child loggers;
     - a crash policy that does not kill snipes.
   - **P5:** V1's `ScopedSecretVault` is a namespaced layer over `SecretVault.encrypt`/`decrypt`, stored as ciphertext in `provider_state`. V6's v9 drops the `users` password columns and removes the `users` step from `migrateLegacySecrets`, since the ParkStay "password" was never used.
   - **P6:** provider windows never get the preload.
   - **P7:** none of the transitional namespaces are left for it (table below). V6 takes migration v9, so P7's `job_logs` drop uses the next free version.
2. **Design system.** D3's `ProviderManifestsProvider` needs `providers.list()` and `manifest.brand` from V1. V1 ships a manifest-only ParkStay entry for exactly this.
3. **Explore.**
   - E1: `catalog.search` / `status` / `refresh` and `catalog:updated`.
   - E2: `catalog.get`, with sanitised `descriptionHtml`, absolute image URLs, units, `releaseInfo`, `infoUrl` and `bookingUrl`.
   - E3: `catalog.availability` and `catalog.checkLocation`, including `bookingUrl` and `release`.
   - Data-quality expectations are listed in V3 and V5.
4. **Provider-first UX.**
   - U1: capability filter, `stayFields`, `WATCH_INTERVAL_OPTIONS`, `autoHold`.
   - U2: `release.opensAt`, `releaseInfo`, `snipes.openPayment`, `capabilities.account`.
   - U3: `bookings.import` (ParkStay `bookingImport: false`), `manageUrl`.
   - U4: `accounts.*` and `account:updated`.
   - U5: `providers.accessStatus` and `provider:access-status`.
5. **Brand and migration.**
   - B2: `electron-builder.json` needs `asarUnpack` for `playwright-core` (V7 adds it, B2 must keep it). Notifier email subjects use the provider `shortName` from `notification.providerId` (V4).
   - B3: copies the legacy DB before `initializeDatabase`, then v8 runs on the copy. v1 had no session partitions, so there is no partition data to migrate. The released v1.2.0 is schema v5, and B3 adds the v5 fixture.
6. **Docs (Q2).** Q2 consumes V7's developer notes and the corrected endpoint facts from V3. `docs/parkstay-api/ENDPOINTS.md` is largely guesswork and is rewritten by Q2.

### Transitional namespaces (P3) and who retires them

All of them are retired inside this stream. Each retiring task makes a minimal edit to the old screen, with no redesign, so that screen keeps working until the U task rebuilds it.

| Namespace | Interim | Old-screen consumer | Retired by |
|---|---|---|---|
| `parkstay.searchCampgrounds` / `getAllCampgrounds` | V3 serves them from the provider catalogue (campgrounds only) | `WatchForm.tsx:103`, `SiteSniperForm.tsx:155` | V5, which switches both forms to `catalog.search` |
| `parkstay.checkAvailability` | none (no renderer consumer, per ui-review) | none | V3 |
| `queue.*` and the `queue:status` event | none | `QueueStatus.tsx:25` | V3, which switches it to `providers.accessStatus` and `provider:access-status` |
| `auth.*` (legacy email+password) | unchanged until V6 | `Settings.tsx`, `Login.tsx` | V6, which adds "Connect ParkStay" through `accounts.signIn`, deletes `Login.tsx` after D3, and runs migration v9 |

## Out of scope

- The RAC Parks & Resorts module, which is the next project. ParkStay's map already lists "RAC Margaret River Nature Park" (`campground_type` 2, id 116) as an external location. Cross-provider dedupe belongs to the RAC project.
- Airbnb, Hipcamp, BIG4, Tasman and every other real provider.
- Importing bookings from ParkStay. Its manifest says `bookingImport: false`, and there is no `/mybookings` scraping.
- Gmail OTP or magic-link auto-completion. `GmailOTPService` stays unwired (provider-ux OQ7).
- Automated payment. Payment stays a human step (brief constraints).
- Renderer screens (D, E and U streams). V2, V3, V5 and V6 make only minimal edits to existing pages so they keep working.
- README and user docs (Q2). V7 writes developer notes only.
- Upgrading Electron, and macOS/Linux packaging. V7's channel detection must not assume Windows, though.

## Open questions

| # | Question | Proposed default | Blocks |
|---|---|---|---|
| PQ1 | Does ParkStay sign-in (Azure AD B2C, `dbcab2c.b2clogin.com`, policy `B2C_1A_Parkstay_prod`) email a **code** or a **magic link**? `docs/parkstay-api/AUTHENTICATION_FLOW.md:86-96` says link, but that doc is unverified. | Support both. A code is typed in the sign-in window; a link is pasted via `accounts.openSignInLink`. The stakeholder confirms during V6 runtime verification. | V6 |
| PQ2 | Signed-in check: `GET https://parkstay.dbca.wa.gov.au/api/profile` (no trailing slash; `parkstay/urls.py:58`, `IsAuthenticated` at `api.py:4720-4731`, fields per `serialisers.py:794-807`). It was not probed with a real session. | 200 JSON with `email` means signed in. 401/403 means signed out. Anything else (queue interstitial, 5xx, network) means `unknown`. | V6 |
| PQ3 | Daily rollover instant. The current code and `docs/SITE_SNIPER.md:26` say 00:00 AWST. The backend opens the furthest date at the campground's `release_time`, Perth local (`api.py:1358-1372`; model default 10:00, `models.py:228`). Bungarra reports `release_time_friendly: "02:00 AM"`. | Use the per-campground `release_time_friendly` when known; otherwise 00:00 AWST. When a release period applies (`release_date` set), describe it and suggest `scheduled`. | V3 |
| PQ4 | Watch auto-hold: implement it or remove the no-op checkbox (`watch.service.ts:199-203`)? | Implement it as `autoHold`. It places a hold only when `capabilities.holds` is true and the account is signed in, and it reuses the one-booking-per-night guard. Otherwise create/update reject it and U1 hides it. | V4, U1 |
| PQ5 | Payment window top-level hosts. Checkout is under `/ledger-api` on the ParkStay host (`middleware.py:12`), with BPOINT/3-D Secure probably in iframes. | Allow `https://*.dbca.wa.gov.au` and the B2C hosts at top level. Leave subframes unrestricted (no preload, sandboxed). Log blocked hosts. Confirm with a real hold. | V6 |
| PQ6 | Minimum watch interval. The DB default is 5 minutes (`connection.ts:81`); the UI offers 60–1440. | `WATCH_INTERVAL_OPTIONS = [15, 30, 60, 240, 720, 1440]`, default 60. Legacy values below 15 are clamped when scheduling, not rewritten. | V4, U1 |

## Changelog

- **2026-10-02:**
  - Created with V1–V7 specs. Dependencies are refined as described above (V3 adds V2, V6 adds V4 and a soft D3). Contract additions are listed in their own section. Open questions PQ1–PQ6 are recorded for OPEN-QUESTIONS.md.
  - Aligned with the platform specs:
    - dropped a proposed `assetOrigins` manifest field (P4 allows `img-src https:`);
    - error codes follow P3's `ApiErrorCode`;
    - `ScopedSecretVault` follows P5;
    - V2 uses P2's v5 and v6 fixtures and seeds the profile row;
    - the transitional `parkstay`/`queue`/`auth` namespaces are retired by V5/V3/V6 instead of U-stream shims.
