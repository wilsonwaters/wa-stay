# U1 — Watches rebuilt provider-first

**Stream:** provider-ux · **Depends on:** D3, V4, V5

## Description

As a WA traveller, I can watch any location from any provider that supports watches. I pick the provider, then the location, then my stay, and I get alerted when units free up. I can always see which provider each watch belongs to.

Today Watches is hard-wired to ParkStay and built from one-off markup:

- `WatchForm.tsx:103` calls `parkstay.getAllCampgrounds`, and `:130-132` copies the campground into park fields.
- `WatchForm.tsx` is 439 lines, and `:60` casts the zod resolver `as any`.
- The list has five rainbow buttons per card (`Watches/index.tsx:193-236`) and hard-codes `userId` 1 (`:34`, `CreateWatch.tsx:19`).
- The detail page flickers: `setIsLoading(true)` runs on every 30-second refresh (`WatchDetail.tsx:27,48-55,98-104`).
- Delete uses `window.confirm` (`EditWatch.tsx:79-81`).
- `AvailabilityGrid` draws a column for the checkout day (`eachDayOfInterval` at `AvailabilityGrid.tsx:37`) and hides every night column when the stay is longer than 14 nights (`:176,:209`).

This task rebuilds the feature under `features/watches/` on D2 primitives and V4/V5 contracts. It also creates the shared building blocks that U2 and U3 reuse (see the master plan).

## Size

L. Cross-concern: a new create-flow pattern, shared domain components, and four pages.

## Scope

- **In scope**
  - `features/watches/` pages for `/watches`, `/watches/create`, `/watches/:id` and `/watches/:id/edit`, registered in D3's route table. Paths are unchanged.
  - `renderer/api/watches.ts` hooks if D3 did not create them: `useWatches(filter)`, `useWatch(id)`, create, update, delete, activate, deactivate and run-now mutations. `watch:updated` invalidates them.
  - **List page:**
    - `PageHeader` "Watches" with one primary "New watch" button.
    - Provider filter (`SegmentedControl`): "All", then one option per provider with `capabilities.watches`.
    - Status filter: All / Active / Paused.
    - Filter state lives in the URL (`?provider=&status=`).
  - **`WatchCard`:**
    - `ProviderBadge`, name, location and area, stay ("Fri 12 – Sun 14 Dec · 2 guests"), status.
    - Last checked, shown relative ("12 min ago").
    - Result summary: "3 units available", "Nothing yet", "2 nights partly available" or "Last check failed".
    - One visible action, "Check now", plus a "More actions" menu with Pause/Resume, Edit and Delete. The title links to the detail page.
  - **Create flow** (`StepFlow`):
    - **Step 1: Provider.** `ProviderPicker`, filtered to `capabilities.watches`. If only one provider qualifies it is pre-selected but still shown.
    - **Step 2: Location.** `LocationCombobox` backed by `catalog.search({ q, providerIds: [id] })`. Debounced, minimum 2 characters.
    - **Step 3: Stay and preferences.**
      - `DateRangeField`, `GuestsField`, and `ProviderStayFields` (OQ1).
      - Unit type: the distinct `unitType` values from `catalog.get(key).units`.
      - Preferred units: a multi-select of those units.
      - Max price per night.
      - Check interval: options from the V4 contract.
      - Notify toggle and "Alert on partial availability" toggle.
      - "Hold automatically when found" appears **only** if `capabilities.holds` and the V4 contract has the field (OQ3). Its help text links to `/settings/accounts?provider=<id>` when the provider needs an account for holds.
      - A name is suggested ("{location} · {dates}"). Notes field.
    - **Step 4: Review.** A summary, then "Create watch".
  - **Explore prefill:** `/watches/create?location=<key>&arrival=&departure=&adults=` (master-plan contract). Valid parameters fill steps 1–3 and the flow opens on the first incomplete step.
  - **Split `WatchForm`** into `WatchFlow`, `steps/{Provider,Location,Stay,Review}Step` and a shared `WatchPreferencesFields`. Edit reuses the same fields. On edit the provider is read-only; the location can change within the same provider.
  - **Detail page:**
    - Header with `ProviderBadge`, name, location (linked to E2 detail), status and actions (Check now, plus a menu with Pause/Resume, Edit and Delete).
    - Stay, Preferences and Status (last/next check, found count) summaries.
    - An Availability section.
    - Refetches run in the background through React Query. A subtle "Updating…" indicator shows; content is never replaced by a spinner.
  - **`AvailabilityGrid` restyle** (stays in `components/`):
    - Input is `UnitAvailability[]` (`NightStatus` per night). The two legacy input shapes (`AvailabilityGrid.tsx:12-21,49-101`) are removed.
    - One column per night, from arrival to departure−1.
    - Sticky unit column and header row; horizontal scroll for long stays.
    - A legend for available / booked / closed / not released / unknown, using icon and text.
    - Unavailable units sit in a collapsed `Disclosure`. Tokens only.
  - **Delete** goes through `ConfirmDialog` from the list, the detail page and the edit page. Success shows a global toast; deleting from the detail page navigates to `/watches`.
  - **Delete legacy files:** `pages/Watches/*`, `components/forms/WatchForm.tsx`, and `shared/schemas/watch.schema.ts` if the V4 contract replaces it.
- **Out of scope**
  - Site Sniper (U2), Bookings (U3), the notification bell (U5) and the Explore detail page (E2).

## Non-goals

- No change to watch execution, matching, scheduling or intervals (V4).
- No auto-hold behaviour. The toggle is rendered only when the contract supports it (OQ3, V4/V6).
- No in-flow account sign-in. U1 links to Settings → Accounts; U2 builds `ConnectAccountPrompt`.
- No bulk actions, watch duplication or watch history timeline.
- No E2E specs (Q1).

## Completion Criteria

- [ ] `/watches` shows one `h1` "Watches" and one "New watch" button. Each `WatchCard` shows a ProviderBadge, location, stay, last checked and result summary.
- [ ] Each card has exactly one visible button ("Check now") and a "More actions for {name}" menu containing Pause or Resume, Edit and Delete.
- [ ] With a two-provider fixture, the provider filter shows "All", "ParkStay" and the fake provider, and narrows the list. `?provider=parkstay&status=active` restores both filters on load.
- [ ] Empty states:
  - no watches → EmptyState with "Create your first watch";
  - filters match nothing → "No watches match these filters" with "Clear filters".
- [ ] Step 1 lists only providers with `capabilities.watches`. With a single qualifying provider it is pre-selected and "Continue" is enabled.
- [ ] Step 2 calls `catalog.search` with `providerIds: [<chosen>]`. No results shows "No locations match "{q}"".
- [ ] `/watches/create?location=parkstay:123&arrival=2026-12-12&departure=2026-12-14&adults=2` opens on Step 3 with provider, location, dates and guests filled in.
- [ ] Holds toggle:
  - absent from the DOM when the provider has `holds: false`;
  - present when `holds: true` and the contract supports it.
- [ ] Submit calls `watches.create` with `providerId`, the location key or external id, and the stay as `YYYY-MM-DD` strings, and with no `userId`. It then navigates to `/watches/:newId` and shows a success toast.
- [ ] Edit shows the provider read-only, pre-fills every field (including legacy `siteType` CSV and preferred units) and saves via `watches.update`.
- [ ] Detail: while a refetch is in flight (`watch:updated` or Check now), the watch heading and summaries stay rendered and no full-page spinner appears.
- [ ] AvailabilityGrid:
  - a 2-night stay renders exactly 2 night columns;
  - a 21-night stay renders 21 columns inside a scroll container;
  - the legend lists all 5 states.
- [ ] Delete in list, detail and edit opens ConfirmDialog. `grep -rn "window.confirm" src/renderer` → 0 results.
- [ ] Legacy files deleted. In `src/renderer/features/watches`: every file is 250 lines or fewer, and `grep -rn "window.api\|userId"` → 0 results.
- **Accessibility**
  - [ ] Location combobox follows the ARIA combobox pattern: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`. Up/Down/Enter/Escape work, and the result count is announced politely ("5 locations").
  - [ ] Changing step moves focus to the new step's heading. The current step has `aria-current="step"`. On submit, the first invalid field takes focus and its error is linked via `aria-describedby`.
  - [ ] The "More actions for {name}" menu uses `role="menu"`. Escape closes it and returns focus to its trigger.
  - [ ] The Check now outcome is announced in a polite live region ("3 units available at Osprey Bay" / "Nothing available yet").
  - [ ] Grid cells have text names (e.g. "Site 12, Sat 13 Dec: available, $35"). State is never conveyed by colour alone. Legend swatches meet 3:1 non-text contrast.
- [ ] `npm run lint` (0 errors), `npm run format:check`, `npm run type-check` and `npm test` all pass.

## Edge Cases

- No provider has `capabilities.watches`: "New watch" is disabled, with the explanation "No provider supports watches yet".
- A watch's `providerId` is not registered: show the ProviderBadge fallback "Unknown provider". Only Delete stays enabled.
- `providers.list` fails: watches still render with fallback badges, plus an inline retry.
- `catalog.search` fails or the app is offline: inline error in the combobox with Retry.
- Catalogue not yet synced (`catalog.status`): show "Locations from {provider} are still loading".
- Prefill problems:
  - an unknown or malformed key, or a provider without watches → drop that parameter and show an inline notice;
  - `departure <= arrival`, or a past arrival → drop the dates;
  - unknown parameters → ignore.
- Arrival is "today or later" in the provider's `manifest.timezone`, not the machine's local timezone.
- The location has no `units` (or `unitCount` is unknown): hide Unit type and Preferred units.
- The provider reports no prices (OQ11): max price stays, with the hint "Applied only when {provider} reports prices".
- The last check failed: the summary shows "Last check failed" and the detail page shows the error text.
- A watch whose stay has started or ended shows "Ended" instead of Active/Paused.
- Check now double-click: the button is disabled while pending, so only one `runNow` call is made.
- Bursts of `watch:updated` events are coalesced into one invalidation per 500 ms.
- Long names truncate visually; the full name stays in the accessible name.

## Test Strategy

- **Unit (~8):**
  - prefill parser (valid, partial, malformed, past dates, wrong provider);
  - `nightsOf(arrival, departure)` (excludes departure, crosses month and year);
  - result-summary formatter;
  - form → create payload mapper (`YYYY-MM-DD`, no `userId`, `unitIds`, `stayParams`);
  - URL filter state parse/serialise.
- **Component (~14), RTL by role and name, fake api via D3 test utilities:**
  - list page: filters, URL state, both empty states, menu actions;
  - WatchCard;
  - ProviderStep: capability filter, single pre-select;
  - LocationStep: keyboard, provider-scoped call, announcement;
  - StayStep: holds toggle conditional;
  - ReviewStep: submit payload;
  - detail page: content kept during refetch, live region;
  - AvailabilityGrid: column count, legend, cell names, scroll;
  - EditWatch: provider read-only, ConfirmDialog delete.
- **Integration (~1):** the full create flow in jsdom (provider → location → stay → review → detail) against the fake api, with a two-provider fixture.

## Context Files to Read First

- `CLAUDE.md`; `ai-state/architecture-notes.md` §2, §3, §4, §8, §9; `ai-state/streams/provider-ux/master-plan.md`
- `ai-state/research/ui-review.md` (#1, #3, #5, #6, #7, #8, #11) and `ai-state/research/tech-review.md` (#11, #14, #15)
- `docs/design/` (D1), `src/renderer/components/ui/*` (D2), `src/renderer/app/*` and `src/renderer/api/*` (D3)
- `src/shared/contracts/{providers,catalog,watches}*` and `src/shared/types/provider.types.ts` (V1/V4/V5)
- `src/renderer/features/explore/*` (E1/E2: combobox, LocationCard, links into this flow)
- Current code to replace: `src/renderer/pages/Watches/*`, `src/renderer/components/forms/WatchForm.tsx`, `src/renderer/components/AvailabilityGrid.tsx`, `src/shared/schemas/watch.schema.ts`, `src/shared/types/watch.types.ts`

## Notes

- Route paths stay the same because stored notifications link to `/watches/:id` (`notification.service.ts:90,124`).
- **Provider filter visibility.** It is rendered when two or more providers have `watches`, or when the user has watches from two or more providers. With ParkStay alone it is hidden: "All · ParkStay" adds nothing. Tests use the two-provider fixture. Flip this decision in review if the stakeholder wants it always visible.
- **Check intervals.** Today the options are 60/240/720/1440 (`WatchForm.tsx:33-38`, `watch.schema.ts:27-32`), while the scheduler runs every watch of 60 minutes or less hourly (tech-review #11). Use the V4 contract's options verbatim; do not redefine them in the renderer.
- **Shared blocks created here:** `ProviderPicker`, `StepFlow`, `ProviderStayFields`, `AvailabilityGrid` and `LocationCombobox` (if E1 has none). Keep them domain-generic: no "watch" wording inside.
- **Dates.** Format with the shared en-AU helpers (D1/V4 `shared/utils`). ui-review #3 found five date formats in use, including US style.

## Orchestrator addendum (2026-10-02)
- [ ] Clears the legacy axe colour-contrast failure on /watches (legacy `bg-yellow-500 text-white` Edit button at `features/watches/legacy/index.tsx:226`) by replacing the legacy page. axe reports 0 critical/serious on /watches with data.
- [ ] Removes `features/watches/legacy/*` entries from the token-guard and API-boundary legacy allow-lists.
- [ ] Create-watch route is `/watches/new` with the §12.10 prefill query (supersedes any `/watches/create` wording in this spec).
- [ ] Fixes the two legacy WatchForm bugs reported by V2 (also on base): the form won't submit with no site type ticked, and an empty max price fails with NaN. Both must work in the rebuilt flow, with tests.
- [ ] Q1 phase 2: add `tests/e2e/create-watch.spec.ts` (provider step → location → stay → review) using the network-free fixtures. Remove the Bookings-h1 `test.fail` mark if U3 has landed.
