# R12: Release-alert snipes: core

## Description
Today a snipe must hold a place: `snipes` needs `holds` in both registry rule sets (`registry.ts:86-91`, `:208-215`), `plan()` drops a provider without snipes (`snipe.service.ts:316`), and `execute` always ends in `holds.create` (`:506-511`).

RAC's holds stay off (brief R2), so an RAC snipe must **alert** instead (brief R3). It starts at the release, checks gently for a bounded window, and when the wanted dates are free it raises a desktop and email alert with a link to the provider's prefilled booking page.

This task makes that change in the core, for every provider, and amends architecture-notes §12.30. ParkStay snipes keep holding as they do today.

## Size
L. This task amends a binding contract rule, adds a migration, a status, a notification type and an IPC field, and changes the snipe state machine. It needs a short design approval.

## Depends on
- R3: `unitKinds` on snipes, and its rule against holding "any unit" across several kinds.
- R8: a refused stay is never `fullyAvailable`.
- R9: the unit-noun helper.
- R7: the booking link and the alert delivery are reused.

## Scope
1. **Registry** (§12.30 amended):
   - the manifest rule "snipes needs holds and availability" becomes "snipes needs availability";
   - the consistency rule `snipes` needs `availability.check` and `release.computeReleaseAt`; `holds` becomes optional;
   - `CapabilityModules.snipes` gets `holds?: HoldsModule`.

   The registry tests change with the rule. This is a contract amendment, not a weaker test. New cases:
   - a provider with snipes and no holds registers;
   - snipes without availability or without a release policy is still refused.
2. **Types and contract:**
   - `SnipeAction = 'alert' | 'hold'`; `SiteSnipe.action`; `SiteSnipeInput.action?`; `snipeInputSchema.action` (with the two-way type equality);
   - `SnipeStatus.ALERTED` and `SnipeResult.ALERTED` (`'alerted'`); `NotificationType.SNIPE_ALERT` (`'snipe_alert'`);
   - `SiteSnipe.alert?: { at: Date; unitId: string; unitName?: string; bookingUrl?: string; note?: string }`. It is what R13 shows: what was free, when, and the "Book on" link;
   - `ReleaseModeDescriptor.maxWindowMinutes?`, a whole number from 1 to 1440, in the type and in `ReleaseModeDescriptorSchema`;
   - `ReleaseComputeInput.unitIds?` and `unitKinds?` (`sdk/provider.ts:175-185`): the snipe's unit choice. `prepare` and `refreshReleaseAt` pass it, so a policy can time a category differently (R14: Margaret River's dorms are not in the member pre-sale).
3. **Migration v12** (CLAUDE.md "Adding a new migration"):
   - on `site_snipes`: `action TEXT NOT NULL DEFAULT 'hold'` and `alert JSON` (nullable);
   - on `watches` and `site_snipes`: `hold_expires_estimated INTEGER NOT NULL DEFAULT 0`. R18 writes and reads it; this task only adds the column;
   - all in one `applyMigration(db, 12, ['site_snipes', 'watches'], …)`, with `addColumns`;
   - `LATEST_SCHEMA_VERSION` becomes 12;
   - no CHECK constraint: the repository validates the value, as v7 did for notifications;
   - every existing snipe reads as `hold`;
   - upgrade tests from the v5 and v6 fixtures.
4. **`SiteSniperService`:**
   - **Default action:** `hold` when the provider has `holds`, otherwise `alert`.
   - **Refusals:**
     - `hold` on a provider without holds: `VALIDATION` with issue `action`, message "{shortName} can't hold automatically, so choose an alert";
     - changing `action` on a HELD or BOOKED snipe: `VALIDATION`.
   - **Sign-in** (`signInNeeded`, `activate`, and the check in `execute`, `:461-468`) applies to `hold` snipes only. An alert never waits for a sign-in.
   - **Window:** `prepare` stores `windowDurationMs` clamped to the mode's `maxWindowMinutes`. `plan()` clamps it too (`:327`), for older rows.
   - **On a match** (`:447`):
     - `alert`: no night guard and no hold. Store the alert, set status and result to ALERTED, make the snipe inactive, return `next: 'done'`, and notify.
     - `hold` on a provider that has lost holds (R17's switch turned off): the same, with the note "Automatic holds are off for {shortName}, so Site Sniper alerted you instead."
     - `hold` that R3 ends FAILED as ambiguous (free units of several kinds, no kind or unit chosen): it alerts instead, with R3's note in `alert.note`. The alert replaces R3's warning notification, and R3's ambiguous-snipe test changes to this rule.
     - Any other `hold`: unchanged.
   - **Booking link**, first available of:
     - the matched unit's `bookingUrl` (R7);
     - the availability's `bookingUrl`;
     - `links.booking(externalId, stay)`.

     The first candidate that passes R7's `firstBookingLink` (https, on the provider's own site) is kept; otherwise the alert has no link. R7's check does not recognise cart URLs: refusing them is the provider's job (RAC's links and client never produce one; R10 and R19 test it).
   - **A block ends the snipe:**
     - `isProviderBlock(error)` in `sdk/errors.ts` is true for a `ProviderHttpError` with status 403 or 429. R5's challenge and cool-down errors are such errors.
     - In the `catch` of `execute` (`:592-603`), a block marks the snipe FAILED with result ERROR and returns `next: 'done'`.
     - `lastError` reads "{shortName} refused the check (HTTP {status}). Site Sniper stopped and won't try again by itself."
     - Today a 429 is retryable (`errors.ts:96-107`), so the snipe would poll on (terms rule 5).
   - **Lifecycle:** `TERMINAL_SNIPE_STATUSES` (`:60-66`) gains ALERTED. Activating an ALERTED snipe is allowed, because it holds nothing; it clears `alert`. A snipe deleted during its attempt sends no alert.
5. **Notification:** `notifySnipeAlert(snipe)` (`notification.service.ts`, beside `notifySnipeHeld`, `:241`):
   - type `snipe_alert`;
   - title "A {noun} is free at {where}", with R9's noun for the matched unit ("A spot is free at …" for a mixed match);
   - the message gives the unit, the dates and the note;
   - `actionUrl` is the snipe's page;
   - the booking link travels with it as R7's watch alert does: a desktop click opens it in the browser and the snipe in the app, and the email has "Book on {shortName}" (brief R6, R7);
   - the copy never says held, secured or reserved.

   **Held snipes** (R7 left them here): `notifySnipeHeld` passes `heldInApp` and the booking link (the same candidates), as R7 does for a held watch. The email says the hold is in WA Stay on the computer and gives the public link (brief R7); a desktop click opens the snipe only.
6. **Renderer, only what the new enum members break:** `statusPresets.ts` (`:47-67`: "Alert sent", `BellRing`, tone `available`); `snipeState.ts` (finished, step id, sort order); `NotificationItem.tsx`'s `TYPE_ICONS` (`:21`: `BellRing`). The screens are R13.
7. **Docs:**
   - **`ai-state/architecture-notes.md`:** create §12.35 "RAC stream contract additions". Its first bullet records what R1–R9 added, as the master plan's Contract additions table lists it (R4's `stay` prefill amends §12.10). Its R12 bullet: `snipes` needs `availability` and release modes that `release.supports()` accepts, and `holds` is optional; a per-snipe `action`, where `hold` needs `capabilities.holds`; ALERTED reserves no night; a 403 or 429 ends a snipe as FAILED; `maxWindowMinutes`; `ReleaseComputeInput.unitIds` and `unitKinds`.

     Mark §12.30's `snipes ⇒ holds` bullet "amended by §12.35". Later tasks that add a contract item (R15, R17, R18, R19) append their own bullets.
   - **`docs/providers/adding-a-provider.md`:** the `snipes` row of the capability table (`:303`) and `maxWindowMinutes`.
   - **CLAUDE.md:** the migration list and its heading (version 12), "currently N" in "Adding a new migration", the SiteSniperService row, and the manifest bullet for `releaseModes`.

## Non-goals
- The Site Sniper screens and the "Alert me / Hold it" choice (R13).
- RAC's release policy, calendar and `snipes: true` (R14).
- Stay-type criteria (R3); nouns (R9).
- The client cool-down and the challenge detection (R5).
- Experiments and the holds switch (R17); releasing holds (R18).
- Watches: R5's cool-down makes their checks fail fast. No watch change here.
- Release-mode generalisation (rac-sdk-gaps #13).

## Completion Criteria
- [ ] `tests/unit/providers/registry.test.ts` passes, with the "snipes needs availability" case and "a snipes provider without holds registers".
- [ ] `tests/unit/core/snipe-alert.test.ts` covers each of these:
  - an alert snipe that finds a free unit ends ALERTED with its link, and calls neither `holds.create` nor `nightGuard.tryReserve`;
  - a hold snipe whose provider has no holds alerts, with the note;
  - an ambiguous hold snipe (R3) alerts with R3's note, and sends no warning notification;
  - creating a hold snipe for a provider without holds is `VALIDATION` on `action`;
  - the defaults per provider;
  - the window is clamped at create and in `plan()`;
  - an off-site or http link is dropped;
  - an alert snipe on a `required-for-holds` provider arms while signed out.
- [ ] `tests/unit/scheduler/snipe-runner.test.ts` (fake timers) covers each of these:
  - a 403 or a 429 ends the snipe FAILED with the message, and no further check is made;
  - an ALERTED snipe is not armed by `start()` or `rescheduleAll()`.
- [ ] `tests/integration/migration-v12.test.ts` passes: from the v5 and v6 fixtures every snipe has `action = 'hold'` and `alert IS NULL`, and every watch and snipe has `hold_expires_estimated = 0`; `foreign_key_check` and `integrity_check` are clean; a second run changes nothing; a fresh database has the same schema.
- [ ] `tests/unit/database/timestamps.test.ts` (`npm run test:tz`) shows that `alert.at` survives a round trip in Perth time.
- [ ] Notification tests show the stored `providerId`, an unprefixed title and the desktop title `Fake · …`. A desktop click opens the link through the shell port and navigates to `/site-sniper/:id`. The email dispatch carries the link. A held snipe's email has R7's hold sentences and the link, and its desktop click opens the snipe only.
- [ ] A night-guard test shows that an ALERTED snipe reserves no night.
- [ ] `tests/integration/sitesniper-parkstay.test.ts`, `snipe-execute.test.ts` and `snipe-create.test.ts` pass unchanged, apart from R3's ambiguous-snipe case.
- [ ] §12.35 is in the architecture notes, with the R1–R9 bullet and R12's, and §12.30 points to it.
- [ ] The full gate passes: `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`, then `npm run build:e2e && xvfb-run -a npm run test:e2e`. It touches IPC and the renderer.
- [ ] CLAUDE.md lines this task makes stale are updated (the migration list and version, the SiteSniperService row).
- [ ] The website needs no change: the alert choice becomes visible in R13, which updates it.

## Edge Cases
- An attempt aborted after the check: nothing is written (the current rule).
- No valid booking link: the alert is still sent. The email has no "Book on" link, and a click opens the snipe.
- A `cancellation` alert snipe (ParkStay) polls until a unit is free, then alerts once and ends.
- `maxAttempts` reached: EXPIRED, as today.
- The window closes for an alert snipe: EXPIRED with "The window closed before the dates were free".
- A 403 thrown during ParkStay's `holds.create` now fails the snipe instead of retrying. That is intended.
- A 429 with `Retry-After`: FAILED all the same; nothing is retried by itself (CLAUDE.md, `RATE_LIMITED`).
- Queue errors (`AccessGateError`) are unchanged.
- Sleep and resume: ALERTED is terminal, so it is never re-armed. A snipe re-activated after its window expires at once (the current rule).
- R17's switch turned off while a hold snipe is ARMED: it alerts with the note when it matches.
- An unregistered provider: `markUnknownProvider`, as today.
- Unreadable `alert` JSON: the row reads without an alert, and one warning is logged.

## Test Strategy
- **Unit (~16):** the registry rules; action defaults and refusals; window clamping; alert and fallback paths; booking-link selection; `isProviderBlock`; terminal statuses; the night guard; the notification copy (no held, secured or reserved).
- **Component (~2):** the status preset and notification icon render for `alerted` and `snipe_alert`.
- **Integration (~5):** the v12 migration; the runner with a block; the ParkStay snipe suite unchanged; snipe IPC with `action`; the notification dispatch.
- **E2E:** none new. The existing journeys pass unchanged; R13 adds the alert journey.

## Context Files to Read First
- `CLAUDE.md` ("Adding a new migration", "Provider SDK", "Notification System")
- `ai-state/streams/rac/master-plan.md` (design decision 2; Contract additions; terms rule 5)
- `ai-state/architecture-notes.md` (§12.3, §12.30, §12.31, §12.33)
- `src/main/providers/registry.ts`; `src/main/providers/sdk/provider.ts`; `src/main/providers/sdk/errors.ts`
- `src/main/core/snipes/snipe.service.ts`; `src/main/scheduler/snipe-runner.ts`; `src/main/scheduler/job-scheduler.ts`
- `src/main/database/connection.ts`; `src/main/database/repositories/site-sniper.repository.ts`
- `src/shared/types/site-sniper.types.ts`; `src/shared/types/common.types.ts`; `src/shared/contracts/snipes.ts`
- `src/main/core/notifications/notification.service.ts`; `src/main/core/holds/night-guard.ts`
- `tests/unit/core/snipe-execute.test.ts`; `tests/unit/scheduler/snipe-runner.test.ts`; `tests/integration/migration-v10.test.ts`; `tests/utils/fake-provider.ts`

## Notes
- **Why store `alert`.** Integration point 4 stores nothing new for watch alerts: the watch page reads its link from `last_availability`. Snipes have no such column, and R13 must show "Book on {shortName}" long after the alert.
- **No live holds** (§12.33): the alert path never calls `holds.create`. Tests use FakeProvider and fixtures.

## Assumptions
1. A 403 or 429 ends a snipe for every provider, ParkStay included, not only RAC.
2. An ALERTED snipe can be armed again, which clears its alert.
3. The v12 migration also adds `alert` (for R13) and `hold_expires_estimated` (for R18). Both are in the master plan's contract table.
