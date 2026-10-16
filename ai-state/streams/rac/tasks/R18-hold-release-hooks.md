# R18: Hold release hooks

## Description
RAC's terms rule 15: a cart (RAC's only hold) is let go as soon as the person declines it or the payment window closes, and a hold is never treated as "secured" before the provider confirms it. Today a hold simply runs out: the core has no way to let one go early, and it shows every expiry as exact.

This task adds the generic hooks:
- `HoldsModule.release` and `releaseOnPaymentClose`;
- "Let it go" in the hold panel, for the person to decline;
- `HoldSuccess.expiresAtEstimated`, so a guessed expiry reads "about";
- interactive pace for hold requests.

**The provider decides.** The core never treats "the payment window closed with no confirmation" as unpaid. On a close or a decline it calls `holds.release`, and the provider checks its own side first: RAC's release reads the cart, and does nothing once the stay has left it (R19). For a provider without `release`, nothing changes from today: ParkStay's holds behave exactly as now.

## Size
M (declining needs two IPC methods and a button)

## Depends on
R12 (migration v12 adds `hold_expires_estimated` to `watches` and `site_snipes`), R17 (the same hold paths, in Lane S order); R2 (`withRequestPriority`) and R7 (held notifications) are already in.

## Scope
1. **SDK** (`src/main/providers/sdk/provider.ts`):
   - `HoldsModule.release?(hold: { reference; unitId?; expiresAt }, signal?)` resolves to `{ outcome: 'released' | 'gone' }`:
     - `released`: the provider let it go;
     - `gone`: it no longer held it (paid, expired, or removed on the provider's own page).
     - It rejects when the provider could not be asked.
   - `HoldsModule.releaseOnPaymentClose?: boolean`: call `release` when the payment window closes without a confirmed payment.
   - `HoldSuccess.expiresAtEstimated?: boolean`: the provider guessed the expiry.
   - `ProviderManifest.holdRelease?: boolean` (in `provider.types.ts`): the renderer's cue to offer "Let it go".
   - New `CONSISTENCY_RULES` (`registry.ts:151`):
     - `holdRelease` with `capabilities.holds` on needs `holds.release`;
     - `holds.release` needs `holdRelease`;
     - `releaseOnPaymentClose` needs `holds.release`.
   - The scaffold and `tests/fixtures/providers/example-*` stay valid: everything is optional.
2. **Expiry estimate:**
   - The watch and snipe repositories (`markHeld`, `watch.repository.ts:289`, `site-sniper.repository.ts:344`) write `hold_expires_estimated` from `expiresAtEstimated`.
   - `Watch.hold.expiresEstimated?` and `SiteSnipe.holdExpiresEstimated?` read it. R18 adds no migration.
   - The words follow:
     - `components/stay/HoldPanel.tsx` says "Held until about 10:42 am", and its timer is named "About 9:59 left to pay";
     - `notifyWatchHeld` and `notifySnipeHeld` (`notification.service.ts:214,241`) and their emails say "within about N minutes".
   - NightGuard and `HOLD_EXPIRED` use the estimate as it is.
3. **Releasing** (core; implemented in `HoldPaymentService`, which owns paying for holds):
   - **When the window closes** (`hold-payment.service.ts:238-244`), call `release` once if all of these hold:
     - the window closed normally: not disposed, and not a first page that failed;
     - no confirmation was recorded (`payment.done` is false);
     - the provider has `releaseOnPaymentClose`;
     - the hold has not expired.
   - **When the person declines:**
     - `watches.releaseHold({ id })` and `snipes.releaseHold({ id })` call `release` (channel, contract, handler and preload; the parity tests);
     - errors: `NOT_FOUND`; `CAPABILITY` without `release`; `HOLD_EXPIRED` with nothing unexpired to let go; `PROVIDER_ERROR` when `release` rejects.
   - **Deleting** a watch or snipe whose hold is unexpired calls `release` first, on a provider with `release`. A rejection is logged, and the delete goes ahead.
   - **Recording, in one transaction:** the hold ends now (`hold_expires_at` = now, so NightGuard frees the nights). A snipe goes EXPIRED, with `SnipeResult.EXPIRED`. A watch keeps `last_result 'held'` with the hold now expired. The message (`last_error`):
     - `released`: "You let it go." On a close: "Let go when the payment window closed."
     - `gone`: "{shortName} no longer holds it. If you paid, look for {shortName}'s confirmation email."
   - Then `watch:updated` or `snipe:updated`. There is no notification: the person did it.
   - **A rejected release** changes nothing: the hold stays until its expiry, and Pay now is still offered. It is logged without the reference's secrets, and the decline answers `PROVIDER_ERROR`.
   - At most one release per hold at a time. A second request joins the first.
   - **Quit:** nothing is released; the hold lapses on its own.
4. **Interactive pace** (decision 3):
   - The core runs `holds.create` and `holds.release` inside R2's `withRequestPriority('interactive', …)`: the watch auto-hold (`watch.service.ts:461`), the snipe hold (`snipe.service.ts:508`), and every release path.
   - The snipe's polling stays background.
   - A hold is one booking attempt the person opted into; polling keeps the 10 s gap.
5. **Renderer:** `HoldPanel` gets "Let it go" beside "Pay now" when `manifest.holdRelease` is set and the hold is unexpired.
   - It opens a `ConfirmDialog` (`tone="danger"`): "Let this hold go?", with "{unit} at {place} goes back on sale. You can't undo this." and a "Let it go" button.
   - The page then shows the ended hold's message.
   - It works through `renderer/api/` hooks (`useReleaseWatchHold`, `useReleaseSnipeHold`).
6. **Docs here:**
   - the guide's holds section (`docs/providers/adding-a-provider.md`): `release`, `releaseOnPaymentClose`, `holdRelease`, `expiresAtEstimated`, and "the provider decides";
   - CLAUDE.md: the HoldPaymentService row and the IPC table rows (`watches`, `snipes`);
   - `ai-state/architecture-notes.md` §12.35: a hold-release bullet (`release` and its outcomes, `releaseOnPaymentClose`, `holdRelease`, `expiresAtEstimated`, the two `releaseHold` methods, interactive pace for holds).

## Non-goals
- RAC's `release`, its estimate and its cart (R19). The experiment switch (R17).
- A ParkStay `release`. DBCA's hold lapses after 30 minutes, as today.
- Telling a paid hold from an unpaid one without `bookedReference`: the provider's `release` decides.
- Releasing on quit, or retrying a failed release (nothing retries in a loop).
- The v12 column itself (R12).

## Completion Criteria
- [ ] Registry tests:
  - `holdRelease` without `holds.release` is refused, and so is `release` without `holdRelease`;
  - `releaseOnPaymentClose` without `release` is refused;
  - with holds off, `holdRelease` alone is fine (RAC's experiment off);
  - the contract suite, the scaffold test and the example providers pass unchanged.
- [ ] Repository tests: `markHeld` with and without `expiresAtEstimated`; the read flag round-trips; v12 rows read `false`.
- [ ] `tests/unit/core/holds/hold-release.test.ts`, with fake windows and a fake provider:
  - a close without a confirmation calls `release` once;
  - a close after a recorded confirmation does not;
  - a first page that failed does not;
  - dispose (quit) does not;
  - a provider without `releaseOnPaymentClose` does not;
  - an expired hold does not;
  - `released` and `gone` each end the hold now, with their message;
  - a rejection leaves the row unchanged;
  - two releases at once make one call.
- [ ] Decline over the IPC harness: both methods; every error code; `snipe:updated` and `watch:updated` are emitted; afterwards NightGuard lets another hold take the same nights.
- [ ] Delete: a HELD snipe and a held watch on a releasing provider call `release` first. A rejection still deletes and is logged. ParkStay's delete makes no call (its fake has no `release`).
- [ ] **ParkStay unchanged:**
  - `tests/e2e/held-snipe.spec.ts` passes as is, with no "Let it go" button;
  - closing ParkStay's payment window changes nothing;
  - ParkStay's suite passes.
- [ ] **Interactive pace:** with a paced fake (R2) during a background poll, `holds.create` and `holds.release` run at `interactive` (`currentRequestPriority()` seen by the fake). The poll's check stays `background`.
- [ ] The estimate's words, in renderer and notification tests:
  - "Held until about …" and a timer named "About … left to pay" when estimated;
  - unchanged copy when exact;
  - "within about N minutes" in the held notification and its email.
- [ ] HoldPanel renderer tests: "Let it go" shows only with `holdRelease` and an unexpired hold; confirming calls the hook; the error shows.
- [ ] A11y:
  - "Let it go" is a button named "Let it go";
  - the dialog is an `alertdialog` named by its title. Focus starts on Cancel, Escape cancels, and focus returns to "Let it go", or to the panel's heading once the button is gone;
  - the ended-hold message is announced (`useAnnounce`);
  - the timer's accessible name carries "About" when estimated.
- [ ] Docs: the guide section, §12.35 and the CLAUDE.md rows above.
- [ ] Full gate: `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`, then `npm run build:e2e && xvfb-run -a npm run test:e2e`.

## Edge Cases
- **The person paid, then closed the window,** on a provider without `bookedReference`: the provider's `release` finds the hold gone and answers `gone`. The message points to the provider's confirmation email. It never says "booked".
- **A confirmation page and a close race:** the confirmation's write wins (`payment.done`), and then no release.
- **The hold expired while the window was open:** no release, and the existing expired state.
- **A decline while the payment window is open:** the window closes first, then a single release runs (it joins the close's).
- **`release` hangs:** it is aborted after the provider's request timeout. The decline answers `PROVIDER_ERROR`, and the hold stays.
- **A provider block** (403, 429, challenge) during release: a typed error, the hold stays, and nothing is retried.
- **Deleting a row whose hold has already expired:** no call.
- **Releasing a snipe that was deleted meanwhile:** `NOT_FOUND`, with no call.
- **R17's switch turned off while a hold is open:** refused by R17. After a restart without holds, a held row has no `release` and is left to lapse.

## Test Strategy
- **Unit (~22):** registry rules, repository flag, the release decision table, recording, joining, interactive priority, notification words.
- **Component (~5):** HoldPanel's "about" copy, "Let it go" visibility, the dialog flow and a11y.
- **Integration (~5):** IPC decline and delete through the harness; NightGuard after a release; ParkStay unchanged.
- **E2E:** none new (R19's journey covers RAC). `held-snipe.spec.ts` must pass unchanged.

## Context Files to Read First
- `CLAUDE.md` ("No live holds", "Key Services": HoldPaymentService, NightGuard; "IPC Pattern")
- `ai-state/streams/rac/master-plan.md` (decision 1, terms rule 15, RS5); `ai-state/research/rac-terms.md` rule 15
- `ai-state/streams/rac/tasks/R2-polite-request-pacing.md` (priority), `R12-alert-snipes-core.md` (v12), `R17-experimental-switches.md`, `R19-rac-auto-cart.md`
- `src/main/providers/sdk/provider.ts`, `src/main/providers/registry.ts`, `src/shared/types/provider.types.ts`
- `src/main/core/holds/hold-payment.service.ts`, `src/main/core/holds/night-guard.ts`
- `src/main/core/watches/watch.service.ts`, `src/main/core/snipes/snipe.service.ts`, `src/main/core/notifications/notification.service.ts`
- `src/main/database/repositories/watch.repository.ts`, `site-sniper.repository.ts`
- `src/shared/contracts/watches.ts`, `snipes.ts`, `channels.ts`; `src/preload/index.ts`
- `src/renderer/components/stay/HoldPanel.tsx`, `src/renderer/components/ui/ConfirmDialog.tsx`; `tests/e2e/held-snipe.spec.ts`

## Notes
- **Why the provider decides:** RAC has no confirmation page the app can read (RS5), so a closed window means nothing on its own. Only the provider can look at its own cart, and a release that finds the stay gone must never touch a booking (RAC's rule 10).
- **Why end the hold at once after a release:** NightGuard then frees the nights, so a later match can hold them again.

## Assumptions
- `ProviderManifest.holdRelease` and the two `releaseHold` IPC methods are in the master plan's contract table. The renderer needs a cue, and declining needs an action.
- Deleting a held watch or snipe counts as declining.
- A released or gone hold ends with existing states (EXPIRED, or an expired hold). No new status.
