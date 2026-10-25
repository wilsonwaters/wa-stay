# RI3: Provider notices (first-use acknowledgement)

## Description

The stakeholder's decision T4: Rottnest's checks are offered to everyone, but before WA Stay sends Stay Rottnest its first request, the person reads a notice of clause 4's risk and ticks "I understand" once (`rottnest-terms.md` §9.1). This task makes that a core feature any provider can declare.

## Size

M. Types, the core's gate, three IPC methods, a dialog and a Settings row.

## Depends on

- RI1 (Rottnest declares the first notice).

## Scope

1. **Manifest:** `notice?: ProviderNotice`, an object of:
   - `version`: a whole number; a higher one asks again;
   - `title`;
   - `body`: plain text;
   - `points`: plain-text bullets;
   - `confirmLabel`: "I understand".

   Validated by the schema; text only, no links or HTML.
2. **State:** the person's acceptance in `provider_state` as `('<id>', 'core.notice')`: `{ version, acceptedAt }`. Providers can't read it (`core.*`). Anything unreadable counts as not accepted.
3. **`ProviderNotices` (core):**
   - `status(providerId)` → `{ required, accepted, acceptedAt?, version? }`;
   - `accept(providerId, version)` (`VALIDATION` for a stale version);
   - `withdraw(providerId)`;
   - `assertAccepted(providerId)`: throws `AppError('NOTICE_REQUIRED')`, a new `ApiErrorCode`.
4. **The gate:**
   - **The catalogue service:** before `checkLocation` and the bulk search for the provider, refuse (a check) or skip (bulk: no entries, so Explore shows the notice state).
   - **The watch service:** `create`, `update`'s activate and `activate` refuse; `execute` (scheduled or `runNow`) records "Paused: read and accept Stay Rottnest's notice in WA Stay" and sends nothing.
   - **The snipe service:** a snipe that would check refuses; a `remind` snipe needs no notice.
   - Withdrawing drops the provider's cached availability.
5. **IPC:**
   - `providers.notice({ providerId })` → the notice and its status;
   - `providers.acceptNotice({ providerId, version })`;
   - `providers.withdrawNotice({ providerId })`.

   Each with its contract, handler, preload and parity tests.
6. **Renderer:**
   - **`ProviderNoticeDialog`:** the title, body and points, a checkbox labelled with `confirmLabel`, and Continue (disabled until ticked) or Not now.
   - **Where it asks:**
     - the watch flow's provider step (after picking a provider whose notice is not accepted);
     - the place page's "Check availability";
     - Explore, where an unaccepted provider's cards read "Read Stay Rottnest's notice to check dates", with a button that opens the dialog.
   - **Settings → Accounts:** the provider's row shows "Notice accepted on {date}" with Withdraw, or "Notice not accepted" with Read.
7. **Docs:** architecture-notes §12.37 "Provider notices"; CLAUDE.md (manifest, IPC table, error codes).

## Completion criteria

- [x] Core tests: unaccepted, a watch run, a check and a bulk search send nothing (a recording client) and are refused or skipped; accepted, they run; withdraw stops them; a new version asks again. (`tests/integration/provider-notices.test.ts`.)
- [x] IPC parity, handler and renderer tests (dialog, gating in each place, Settings row). *Deviation:* no axe scans: the repository has no axe tooling (no `jest-axe`, nothing in e2e), so the tests assert roles, accessible names and descriptions, as the rest of the suite does.
- [x] An e2e journey: Explore → dates → "Read Stay Rottnest's notice" → accept → counts appear; nothing is sent before acceptance (`tests/e2e/rottnest-notice.spec.ts` starts with no Stay Rottnest routes, so any request would be refused and logged), and a withdrawal in Settings offers the notice again.
- [x] The full gate passes.

## Notes from the build

- *Bulk* reports an unaccepted provider as an error entry with the new `CatalogErrorCode` `notice` rather than as no entries, so Explore can tell it apart from "no answer".
- *Watches* stay active while paused (a run records `ERROR` with the paused message and asks nothing), so they check again by themselves once the notice is accepted; *snipes* end `FAILED` on a poll and are armed again by hand, as after a provider block.
- *Registry rule* "notice needs no account and no access gate": their signed-in check and queue would ask the provider outside the gate.
- *Renderer:* withdrawing resets the provider's availability queries (`resetQueries`), since a failed refetch keeps the old data on screen.
