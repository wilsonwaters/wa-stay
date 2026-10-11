# U2 — Site Sniper rebuilt provider-first ("Soon")

**Stream:** provider-ux · **Depends on:** U1, V6

## Description

As a traveller chasing a high-demand site, I can arm a snipe for any provider that supports snipes and understand, in plain language, when the site will be released. I can watch the snipe move through clear stages. When a site is held, I can complete payment on the provider straight away, before the hold expires.

Problems in today's Site Sniper:

- **Re-renders and flicker.** The whole list page re-renders every second, because one `now` state drives every countdown (`SiteSniper/index.tsx:57,77-81`). Every pushed status update also sets `loading` (`:85`), which swaps the page for a full-screen spinner (`:177-179`) and unmounts open toasts (ui-review #5).
- **Payment hand-off.** It uses `window.open` on a generic `/booking/` URL (`:173-175`, `sitesniper.service.ts:238`), which is not bound to the session that holds the site (tech-review #3).
- **Form.** The form is 648 lines and ParkStay-specific: free-text site IDs (`SiteSniperForm.tsx:303-320`), Ningaloo/DBCA wording in the release modes (`:33-49`), and hard-coded AWST maths (`:56-92`).
- **Broken links.** Notifications link to `/site-sniper/:id` (`notification.service.ts:147,171`), but that route does not exist (`App.tsx:82-83`).

The feature keeps its **"Soon"** pill and the restyled `ComingSoonBanner` (stakeholder decision D4), but it must be fully usable.

## Size

M. This size assumes U1's `StepFlow`, `ProviderPicker`, `LocationCombobox` and `ProviderStayFields` are reused. Without that reuse, re-size to L.

## Scope

- **In scope**
  - **Feature folder and routes.** `features/snipes/` covers `/site-sniper` (list), `/site-sniper/:id` (**new** detail page) and `/site-sniper/create`.
  - **API hooks.** `renderer/api/snipes.ts`: list, get, create, delete, activate, deactivate, runNow and openPayment. `snipe:updated` invalidates the affected queries.
  - **Account API.** `renderer/api/accounts.ts`: `useAccountStatus(providerId)` and `useSignIn()`. U4 reuses both.
  - **ComingSoonBanner.** Reuse the version U3 restyled; if U3 has not landed, restyle it here. Its copy reads: "Site Sniper is still being finalised. It works, but expect rough edges."
  - **SnipeCard:**
    - Shows a `ProviderBadge`, name, location, stay, a status label, a compact timeline, a `<Countdown>` to `releaseAt`, the attempt count and the last error.
    - One visible primary action, chosen by status: Paused → "Arm", active → "Disarm", Held → "Complete payment on {shortName}".
    - A "More actions for {name}" menu holds View details, Run now and Delete.
  - **`components/Countdown.tsx` and `renderer/hooks/useNow.ts`:**
    - A single shared 1 s ticker, built on `useSyncExternalStore`. Only Countdown leaves re-render on each tick.
    - The ticker pauses while `document.hidden`.
    - Countdown renders `role="timer"`.
  - **SnipeTimeline:**
    - Steps: Armed → Queueing → Waiting for release → Sniping → Held, then Booked if a reference exists.
    - Queueing is shown only when the snipe uses the provider's access gate.
    - Expired and Failed are terminal states and show the last error. Disabled shows as "Paused".
  - **Held panel** on both the card and the detail page:
    - Shows the expiry ("Held until 10:42 am · 23:10 left").
    - The primary button "Complete payment on {shortName}" calls `snipes.openPayment(id)`, which opens V6's payment window on the provider partition.
    - Once the hold expires, the button disappears and "Hold expired. The site has been released." is shown.
  - **Create flow** (U1's `StepFlow`):
    - **Step 1, Provider.** Only providers with `capabilities.snipes`.
    - **Step 2, Location.** Uses `LocationCombobox`. Locations whose `bookingMode !== 'online'` are disabled with the reason "Not bookable online".
    - **Step 3, Units and party:**
      - Preferred units are a searchable checkbox list from `catalog.get(key).units`; leaving it empty means any unit.
      - Party uses `GuestsField`; vehicles and postcode come from `ProviderStayFields` (OQ1).
    - **Step 4, Release and timing:**
      - Release mode is a radio group: "When new dates open", "At a scheduled time" or "When someone cancels" (OQ5).
      - Each option is explained in plain language, using `LocationDetail.releaseInfo` and a preview from `catalog.checkLocation(key, stay).release.opensAt`. Example: "Sites for Sat 11 Apr open Mon 13 Oct, 12:00 am AWST (in 11 days)."
      - Scheduled mode asks for a date and time in `manifest.timezone`.
      - An "Advanced timing" `Disclosure`, collapsed by default, holds lead time (s), check every (s, minimum 0.5), keep trying for (min), max attempts (0 = unlimited) and "Use {provider} queue". The queue option appears only when the provider has an access gate (OQ2). The UI converts to the contract's ms fields.
    - **Step 5, Review.** Shows a responsible-booking notice: "Hold only what you will use. Payment is always completed by you on {provider}." Provider-specific terms are added if the manifest supplies them.
  - **ConnectAccountPrompt** (`components/accounts/`):
    - Shown when `capabilities.account` is `required-for-holds` or `required` and the account is not signed in.
    - Appears on the Review step, on affected cards and on the detail page.
    - "Connect {shortName}" calls `accounts.signIn(providerId)`.
    - "Arm" on such a snipe opens the prompt in a Dialog instead of arming.
  - **Delete** goes through ConfirmDialog. For a held snipe, the dialog warns: "Deleting does not release the hold on {provider}."
  - **Legacy files deleted:** `pages/SiteSniper/*`, `components/forms/SiteSniperForm.tsx`, and `shared/schemas/site-sniper.schema.ts` if the V4 contract replaces it.
- **Out of scope**
  - Snipe engine, timers, queue, holds and the payment window (V3/V4/V6).
  - OS notification copy (U5).
  - Settings → Accounts page (U4).

## Non-goals

- Editing an existing snipe (OQ6). The workflow stays disarm, delete, recreate.
- Removing the "Soon" pill or the banner.
- Booking confirmation detection after payment. `setBooked` is never triggered today (tech-review dead code); "Booked" is rendered only if the status arrives.
- Any change to scheduler timing defaults.

## Completion Criteria

- [ ] `/site-sniper` shows the restyled banner and a "New snipe" button. The nav item still carries the "Soon" pill and the page is fully usable.
- [ ] Each SnipeCard shows a ProviderBadge, location, stay, status label and timeline.
- [ ] Countdown efficiency: over 5 seconds of fake-timer ticks, the list page component renders once while the countdown text changes 5 times (render-count spy).
- [ ] A `snipe:updated` event updates the affected card in place. No spinner replaces the page, and a toast that is already open stays visible.
- [ ] `/site-sniper/7` renders that snipe's detail page with the timeline. Unknown ids show a "Snipe not found" EmptyState instead of redirecting.
- [ ] A Held snipe shows "Complete payment on ParkStay" as the primary button, with a hold countdown. Clicking it calls `snipes.openPayment(7)`. `grep -rn "window.open" src/renderer/features/snipes` → 0 results.
- [ ] Once `heldExpiresAt` passes, the payment button is gone and "Hold expired" is shown.
- [ ] Create Step 1 lists only providers with `capabilities.snipes`.
- [ ] Step 3 lists the location's units as checkboxes. No free-text site-ID input remains.
- [ ] Step 4:
  - shows the provider's `releaseInfo` and the computed open time;
  - without `opensAt`, shows "Release time unknown. Site Sniper will keep checking.";
  - "Advanced timing" starts with `aria-expanded="false"`.
- [ ] Submit sends `providerId`, location, `unitIds`, the stay as `YYYY-MM-DD`, the release mode and timing in ms, and no `userId`. It then navigates to the new detail page.
- [ ] Account-required provider with the account signed out:
  - the Review step and the card show "Connect ParkStay";
  - clicking it calls `accounts.signIn('parkstay')`;
  - after `account:updated` reports signed in, the prompt disappears.
- [ ] Legacy files are deleted. In `features/snipes`: every file is 250 lines or fewer, and `grep -rn "window.api\|userId"` → 0 results.
- **Accessibility**
  - [ ] Countdown has `role="timer"` and is not a live region. Its accessible label updates at most once a minute ("Opens in 2 days 4 hours").
  - [ ] Status transitions are announced once in a polite live region. The Held transition uses `role="alert"`: "Site held at {location}. Pay within {n} minutes."
  - [ ] The timeline is an ordered list with `aria-current="step"` on the current step. States are named in text, not only by colour.
  - [ ] Release mode is a `radiogroup`, and each option's explanation is linked via `aria-describedby`.
  - [ ] When the sign-in window closes, focus returns to the Connect button and the outcome is announced.
- [ ] `npm run lint` (0 errors), `npm run format:check`, `npm run type-check` and `npm test` all pass.

## Edge Cases

- No provider supports snipes: EmptyState, with "New snipe" disabled.
- Account status errors or is unknown: treat it as signed out and offer Retry.
- The sign-in window is closed without signing in: show "Not connected. You can connect later in Settings → Accounts." The snipe remains unarmed.
- Cancellation mode (`releaseAt` is null): no countdown; the card reads "Watching for cancellations".
- `releaseAt` is in the past while the status is still Armed (the app was closed): show "Opening now".
- A held snipe has no `heldExpiresAt`: show the held panel without a timer.
- The countdown would go negative: render "now", never a negative value.
- `openPayment` fails (hold gone, provider error): show an error toast. The button stays, and the snipe is refetched.
- Scheduled release time:
  - in the past → validation error;
  - provider timezone differs from local → show both ("10:00 am AWST · 12:00 pm your time").
- Party larger than the selected units' known capacity: show a warning and still allow submitting.
- 50 armed snipes: the shared ticker still runs a single interval; nothing runs per card.
- Window hidden, then shown: the ticker resumes with correct values.
- Statuses `disabled` and `booked` map to "Paused" and "Booked". An unknown status falls back to its raw label without crashing.

## Test Strategy

- **Unit (~6):**
  - countdown formatter: d/h/m/s, plus a coarse screen-reader label;
  - status → timeline mapping, including the omitted queue step;
  - release preview text with timezone handling;
  - s/min ↔ ms conversion;
  - `useNow` store: one interval for many subscribers, paused while hidden.
- **Component (~12):**
  - list page: render-count spy, in-place push update, toast preserved;
  - SnipeCard: primary action for each status;
  - SnipeTimeline;
  - Held panel: `openPayment` call, expiry;
  - ConnectAccountPrompt: `signIn` call, focus return, announcement;
  - UnitsStep checkbox list;
  - ReleaseStep: radiogroup, `releaseInfo`, collapsed advanced section;
  - ReviewStep payload;
  - detail route and its not-found state.
- **Integration (~1):** create flow → detail page, then a pushed Held event → payment button → `openPayment`, using the fake api.

## Context Files to Read First

- `CLAUDE.md`; `ai-state/architecture-notes.md` §2, §3, §4, §7, §8; `ai-state/streams/provider-ux/master-plan.md`; `ai-state/streams/provider-ux/tasks/U1-watches-provider-first.md`
- `ai-state/research/ui-review.md` (#4, #5, #7, #8, #10), `ai-state/research/tech-review.md` (#2, #3), `ai-state/research/parkstay-api-review.md` (release regimes, hold)
- `docs/SITE_SNIPER.md` (release regimes, compliance wording)
- U1 outputs: `components/StepFlow.tsx`, `components/providers/ProviderPicker.tsx`, `components/LocationCombobox.tsx`, `components/stay/ProviderStayFields.tsx`
- `src/shared/contracts/{snipes,accounts,catalog,providers}*` (V4/V6), `src/renderer/components/ui/*` (D2)
- Current code to replace: `src/renderer/pages/SiteSniper/*`, `src/renderer/components/forms/SiteSniperForm.tsx`, `src/shared/schemas/site-sniper.schema.ts`, `src/shared/types/site-sniper.types.ts`, `src/shared/types/common.types.ts` (SnipeStatus, SnipeReleaseMode)

## Notes

- Keep `/site-sniper` paths. Existing notifications in users' databases already deep-link to them.
- **Timeline order.** The order follows the state machine in tech-review (summary item 5): ARMED → QUEUEING → WAITING_RELEASE → SNIPING → HELD/EXPIRED.
- **Compliance copy.** DBCA-specific wording ("one account per person, one booking per night") must come from provider data, not renderer constants. Until the manifest carries it, use the generic notice. If no V-stream field appears, raise this with OQ1.
- **Primitives.** If D2 has no `Disclosure` or `RadioCard`, add them to `components/ui/` with tests in this task.

## Orchestrator addendum (2026-10-04, from the V6 design review; architecture-notes §12.32)
- ParkStay declares `account: 'optional'`: arming a snipe never requires sign-in. Replace any blocking "connect" prompt with a non-blocking hint for optional providers ("Connect ParkStay before the release so checkout is quicker"), with a Connect button that calls `accounts.signIn`. Keep the blocking prompt only for providers that declare `required-for-holds`/`required` (tested with FakeProvider).
- A HELD snipe's primary action is "Pay now" (`snipes.openPayment`), which may show ParkStay's own sign-in inside the payment window. `HOLD_EXPIRED` gets its own copy.
