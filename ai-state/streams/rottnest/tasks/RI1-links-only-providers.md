# RI1: Links-only providers

## Description

`CLAUDE.md` says a provider whose terms forbid automated access "gets links only". Today that is a rule with no supported shape. Nothing stops such a provider's code from sending a request, and nothing in the registry knows the difference.

Stay Rottnest is the first such provider (`ai-state/research/rottnest-terms.md`, rule 1: **WA Stay never sends a request to Stay Rottnest**). This task makes "links only" a declared, enforced provider shape, `integration: 'links'`, and amends the contract in a new architecture-notes §12.36.

## Size

M. One manifest value, manifest rules, a refusing client and browser, contract-suite checks, docs. No migration, no IPC, no renderer.

## Depends on

- PR #68 merged (R12's snipe rules, R17's experiments, R2's pacing are what the new rules sit beside).

## Scope

1. **Type:**
   - `ProviderManifest.integration` becomes `'api' | 'browser' | 'hybrid' | 'links'` (`src/shared/types/provider.types.ts:307`), and the zod enum (`:731`) follows, with the two-way type equality test.
   - The field is read nowhere in `src/` today, so existing providers are unaffected.
2. **Manifest rules** (`FLAG_RULES` in `src/main/providers/registry.ts`, so experiments are checked against them too). For `integration: 'links'`:
   - `availability`, `bulkAvailability`, `holds`, `bookingImport` and `accessGate` must all be false. One rule per capability, so the message names it: "a links-only provider can't have capability holds".
   - `account` must be `'none'`.
   - `experiments` must be absent or empty, because an experiment exists to turn on a capability the provider ships off.
   - `limits.minRequestIntervalMs` must be absent or 0.
   - No release mode may set `usesAccessGate`.
   - `holdRelease` must be off.
   - `watches` and `snipes` stay allowed. RI6 and RI8 add what they need: release reminders and the reminders module.
3. **Consistency rules** (`CONSISTENCY_RULES`):
   - a links-only provider has no `availability`, `holds`, `bookings`, `access` or `auth` module (a module for a capability it may not have is a mistake);
   - `catalog.listLocations` is required (`catalogMode: 'full'`, a seed), and `catalogMode: 'search'` is refused for links-only, since a search would need requests.
4. **Refusing context** (`createProviderContext`, `src/main/providers/sdk/context.ts:85`). For `integration: 'links'`:
   - **`http`:** a `RefusingHttpClient` (new, `sdk/http-refusing.ts`). Every method rejects with a new `ProviderPolicyError` (`sdk/errors.ts`; kind `policy`, not retryable, `toApiError` → `PROVIDER_ERROR`) whose message is "WA Stay doesn't contact {name}". It rejects before any I/O and logs the attempt once per run, with the path only. `deps.createHttp` is **not called**, so neither fixture mode (`container.ts:234`) nor pacing can replace it, and no session partition is created.
   - **`browser`:** a refusing `BrowserAutomation` whose launch rejects with the same error, so no profile directory is created.
   - **`registry.httpOf(id)`** returns the refusing client.
5. **The network guard:** in fixture mode the existing guard already cancels unrouted requests. Add a unit test that a links-only provider registered in fixture mode never reaches `FixtureHttpClient`.
6. **The contract suite** (`tests/utils/provider-contract.ts`). When the manifest says `'links'`:
   - run every module function the provider has (catalogue `listLocations` and `getLocation`, `links.*`, `release.*`, and, once RI2, RI6 and RI8 land, `stayRules.check`, `release.reminders` and `reminders.next`) with a **recording** refusing client in the context;
   - assert zero calls;
   - check every link is https on the provider's site (`isProviderBookingLink`);
   - leave the availability, holds and access checks out.
7. **A fake links-only provider** (`tests/utils/fake-links-provider.ts`, from `createFakeProvider`) for RI2, RI6 and RI8's core tests, with a seeded catalogue and links.
8. **Docs:**
   - **architecture-notes §12.36 "Links-only providers"**: the value, the rules, the refusing context. RI2, RI6 and RI8 append their bullets.
   - **`docs/providers/adding-a-provider.md`**: a "Links-only providers" section (when: terms that forbid automation, as step 1 of the checklist says; what you get: a seeded catalogue, links, optional stay rules, release reminders and look reminders) and the `integration` row of the manifest table.
   - **CLAUDE.md**: the manifest bullet and step 1 of "Adding a provider" ("set `integration: 'links'`").
9. **Scaffold** (`scripts/new-provider.mjs`): `--links` generates a links-only provider: manifest, seed catalogue, links, the contract test with the zero-calls check, no fixtures. The scaffold test (`tests/scripts/new-provider.test.ts`) gains a links case that type-checks, lints, formats and passes its own test.

## Non-goals

- Stay rules (RI2), reminder snipes (RI6) and reminder watches (RI8).
- The Rottnest module (RI3).
- Any change to ParkStay or RAC.

## Completion criteria

- [ ] `tests/unit/providers/registry.test.ts`:
  - each forbidden capability, a non-`none` account, an experiment, pacing and a gated release mode is refused for `'links'` with its own message;
  - a links-only provider with a seeded catalogue, links and nothing else registers;
  - ParkStay's and RAC's manifests still pass.
- [ ] `tests/unit/providers/http-refusing.test.ts`: every method rejects with `ProviderPolicyError` and no transport call; `toApiError` gives `PROVIDER_ERROR`; the log carries the path only.
- [ ] `tests/unit/providers/context.test.ts`: for `'links'`, `createHttp` is never called (in fixture mode too), `browser` refuses to launch, and no profile directory exists.
- [ ] The contract suite runs the fake links-only provider with zero recorded calls.
- [ ] The scaffold's links case passes.
- [ ] §12.36 exists; the guide's section and CLAUDE.md are updated; the docs tests pass (backticked paths exist).
- [ ] The full gate passes. No renderer or IPC change, so `build:e2e` and `test:e2e` only confirm nothing regressed.

## Edge cases

- A links-only provider that wants a document window (a PDF map): out of scope. `DocumentWindows` fetches from its own in-memory partition, so it would be a request WA Stay sends. Links open in the browser instead.
- A provider switching from `'api'` to `'links'` in an update: its stored watches and snipes keep their rows. RI6 and RI8 decide how they read (reminder mode).
