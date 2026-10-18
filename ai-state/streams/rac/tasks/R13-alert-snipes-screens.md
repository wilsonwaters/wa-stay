# R13: Release-alert snipes: Site Sniper screens

## Description
As a person setting up Site Sniper, I choose what happens when my dates come free:
- **"Alert me"**: a desktop alert, and an email if set up, with a link to book on the provider's own site;
- **"Hold it for me"**: where the provider allows holds.

When a snipe has alerted, I see what was free and when, and I can open "Book on {shortName}" straight away.

RAC has no holds, so it offers the alert only. ParkStay offers both (RS9: provider-neutral). R12 built the core; this task builds the screens.

## Size
M

## Depends on
R12 (`action`, `ALERTED`, `SiteSnipe.alert`, `maxWindowMinutes`). It uses R9's nouns.

## Scope
1. **Create flow** (`src/renderer/features/snipes/create/`):
   - **Form:** `action` in `snipeForm.ts` (form values, defaults, validation) and `snipeFormMapping.ts` (it goes into `SiteSnipeInput.action`). The default is `hold` when `manifest.capabilities.holds`, otherwise `alert`. This keeps ParkStay's behaviour and its journeys unchanged.
   - **Release step** (`steps/ReleaseStep.tsx`), after the release-mode group:
     - With holds, a `RadioCardGroup` labelled "When the dates are free" offers two cards:
       - "Alert me": "A desktop alert and email with a link to book on {shortName}. Nothing is held, so book it before someone else does.";
       - "Hold it for me": "Holds a {noun} for you, then you pay on {shortName}'s page in WA Stay."
     - Without holds, one line of text instead: "When the dates are free, Site Sniper alerts you with a link to book on {shortName}. Automatic holds aren't available for {shortName}."
   - **Account prompt:** `ConnectToArmDialog` and any "sign in to hold" hint show only for `hold`.
   - **Mixed places (R6's rule):** only a hold needs a stay type or a unit. R6's Stay-step refusal moves to the Release step: at a mixed place with neither chosen, choosing "Hold it for me" shows R6's message and refuses Continue. "Alert me" needs neither, and a provider without holds never asks.
   - **Provider step** (`steps/ProviderStep.tsx`): a provider without holds says "Alerts only" under its name.
   - **Review step** (`steps/ReviewStep.tsx`): "When the dates are free: Alert me" or "Hold a {noun}".
2. **Advanced timing** (`steps/AdvancedTiming.tsx`, `snipeForm.ts`):
   - **Hint:** when the chosen mode has `maxWindowMinutes`, "Keep trying for (minutes)" says "Up to {n} minutes on {shortName}."
   - **Error:** a larger value reads "{shortName} allows at most {n} minutes".
   - **Mode change:** switching to a mode with a lower cap checks the field again.
   - The default (15 minutes) stays within RAC's 30.
3. **Alerted state:**
   - **List card** (`list/SnipeCard.tsx`): the "Alert sent" status with its time, and a "Book on {shortName}" link when `alert.bookingUrl` is set.
   - **Detail page:** `shared/AlertedPanel.tsx`, the counterpart of `HeldPanel.tsx`, shown for ALERTED. It has:
     - the heading "{Unit} was free";
     - when the alert came, the stay, and `alert.note` if any;
     - "Book on {shortName}", a link to `alert.bookingUrl` that opens in the system browser (main opens https links outside the app);
     - "Arm again", which calls `snipes.activate`.
   - **Timeline** (`shared/SnipeTimeline.tsx`): the last step is "Alert sent".
   - **Summary** (`detail/SnipeSummary.tsx`): a "When free" line, and "Keeps trying" shows the clamped window.
   - **Announcements** (`shared/useStatusAnnouncements.tsx`): when a snipe on screen becomes ALERTED, a polite announcement says "{name}: {unit} is free. Book on {shortName}."
   - **FAILED after a block** shows R12's message, as other failures do.
4. **E2E** (`tests/e2e/alert-snipe.spec.ts`, ParkStay, fixture mode). Nothing checks or holds anything live (§12.33).
   - **Seeded part:** the profile is seeded with an ALERTED snipe at Bungarra and its `snipe_alert` notification. Add `seedAlertedSnipe` to `support/seed.ts`, following `seedHeldSnipe`. Then:
     - the bell's notification opens the snipe;
     - the panel shows the unit and "Book on ParkStay";
     - the link's `href` is on ParkStay's host.
   - **Create part:** create a snipe with "Alert me" and a scheduled release two weeks away, as `create-snipe.spec.ts` does. The new snipe's page reads "When free: Alert me".
5. **Website:** in `site/index.html`, "Coming next" → Site Sniper, say that it alerts you the moment the dates are free, or, where the provider allows it, tries to hold a site for you to pay for. Keep the "Soon" pill. `tests/unit/site/site.test.ts` passes.

## Non-goals
- The core behaviour, the migration and the notification (R12).
- RAC's release modes, calendar and preview text (R14).
- The member-number copy button by "Book on RAC" (R16).
- Editing a snipe after creation: there is no edit route today.
- Prefilling `action` from Explore.
- `docs/site-sniper.md` and screenshots (R20).
- Removing the "Soon" label: it stays (brief success criterion 9).

## Completion Criteria
- [ ] **Release step** (`ReleaseStep` tests):
  - with ParkStay, the radio group "When the dates are free" has "Alert me" and "Hold it for me", and "Hold it for me" is checked;
  - with a provider without holds, there is no radio group and the alert line shows.
- [ ] Mixed place (R6's fake detail), no stay type or unit: "Alert me" continues; "Hold it for me" shows R6's message on the Release step; the Stay step no longer refuses.
- [ ] `NewSnipePage.submit.test.tsx`: submitting with "Alert me" sends `action: 'alert'`, and the default ParkStay submit sends `action: 'hold'`.
- [ ] Advanced timing tests:
  - a mode with `maxWindowMinutes: 30` shows the hint;
  - 45 shows the error;
  - 30 submits.
- [ ] `AlertedPanel` tests:
  - the unit, the time and the note render;
  - "Book on ParkStay" is a link to the stored URL;
  - with no URL there is no link;
  - "Arm again" calls `activate`.
- [ ] `SnipeCard` and `SnipeTimeline` tests cover ALERTED. `snipeState.test.ts` covers the finished check, the step and the sort order.
- [ ] `alert-snipe.spec.ts` passes, and `create-snipe.spec.ts` and `held-snipe.spec.ts` pass unchanged.
- [ ] **Accessibility:**
  - "When the dates are free" is a radiogroup with that accessible name, and each card's text is its accessible description;
  - an ALERTED change is announced once, in a polite live region;
  - "Book on {shortName}" has role link with that accessible name, plus visually hidden "(opens in your browser)";
  - after "Arm again", focus moves to the snipe's status line, never to `body`;
  - the "Alert sent" badge uses an existing status tone (`tests/unit/design/token-guard.test.ts`).
- [ ] The site's Site Sniper copy is updated and the site test passes.
- [ ] The full gate passes: `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`, then `npm run build:e2e && xvfb-run -a npm run test:e2e`.
- [ ] CLAUDE.md is updated where it describes Site Sniper's screens or the journey count (as earlier tasks left it).

## Edge Cases
- A provider with holds and an account that is `required-for-holds`: "Alert me" needs no sign-in, so no Connect dialog for it.
- Switching from "Hold it for me" to "Alert me" hides the hold-only hints. Switching back shows them.
- An ALERTED snipe whose `alert` is missing (unreadable JSON, R12): the panel shows "Dates were free" with no unit or link.
- A link that is not https: main never opens it (CSP and navigation guard). The panel shows no link, because R12 stored none.
- "Arm again" after the window: the snipe expires at once (R12, the existing rule), and the page shows Expired.
- A FAILED snipe after a 403 or 429: the message is shown, and "Arm again" is offered as for other failures.
- A narrow window: the panel and cards wrap at 360 px wide with no horizontal scroll.
- Times are shown in the provider's zone (Perth) and the local zone, as the existing panels do.

## Test Strategy
- **Unit (~6):** form defaults and validation with `maxWindowMinutes`; mapping `action`; `snipeState` for ALERTED.
- **Component (~12):**
  - `ReleaseStep` with and without holds;
  - `AdvancedTiming`;
  - `ReviewStep`;
  - `ProviderStep`'s "Alerts only";
  - `SnipeCard` alerted;
  - `AlertedPanel`: link, no link, note, "Arm again" and its focus;
  - `SnipeTimeline`;
  - announcements.
- **Integration (~2):** a `NewSnipePage` submit with the strict mock `window.api`.
- **E2E:** 1 journey (seeded alert, plus creating an alert snipe).

## Context Files to Read First
- `CLAUDE.md` ("UI Status", "Website", renderer rules)
- `ai-state/streams/rac/tasks/R12-alert-snipes-core.md`; `ai-state/streams/rac/master-plan.md` (decision 2; RS9)
- `docs/design/design-language.md`; `docs/design/components.md`
- `src/renderer/features/snipes/create/` (`SnipeFlow.tsx`, `snipeForm.ts`, `snipeFormMapping.ts`, `steps/*`)
- `src/renderer/features/snipes/shared/` (`HeldPanel.tsx`, `SnipeTimeline.tsx`, `snipeState.ts`, `useStatusAnnouncements.tsx`, `ConnectToArmDialog.tsx`)
- `src/renderer/features/snipes/detail/` and `list/SnipeCard.tsx`; `src/renderer/components/ui/statusPresets.ts`
- `tests/e2e/held-snipe.spec.ts`; `tests/e2e/create-snipe.spec.ts`; `tests/e2e/support/seed.ts`
- `site/index.html` ("Coming next"); `tests/unit/site/site.test.ts`

## Notes
- The copy never says an alert holds, secures or reserves anything (terms rule 15's spirit). It says "book it before someone else does".
- Booking links open in the system browser, as the place page's do (master plan, "Also decided"). Only R19's cart uses the payment window.

## Assumptions
1. ParkStay keeps "Hold it for me" as its default (RS9 offers the alert; it does not change the default).
2. The choice sits on the Release step, not in a new step: the flow stays at five steps.
3. "Arm again" on an ALERTED snipe is wanted (R12 allows it).
