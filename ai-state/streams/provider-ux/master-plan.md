# Provider-first UX: master plan

**Stream:** provider-ux · **Label:** `stream:provider-ux` · **Lane:** R (renderer), after E3 · **Status:** ⬜ not started

## Goal

Rebuild Watches, Site Sniper, Bookings, Settings/Accounts and the notification and system surfaces on the WA Stay design system (D1–D3), on top of the provider-agnostic services (V4–V6).

When the stream is done:

- every create flow starts with a **provider step**, filtered by the capability the flow needs;
- every watch, snipe, booking and notification shows a `<ProviderBadge>`;
- every control on screen does something real; dead controls are wired or removed;
- renderer data access goes through `renderer/api/*` React Query hooks only;
- the large hand-rolled pages are split into focused components of 250 lines or fewer, with none of the following left: rainbow buttons, `window.confirm`, `window.open`, emoji icons, hard-coded `userId`, or full-page spinners on refresh.

This delivers brief scope item 4 (Provider-first UX) and success criterion 5. It also delivers the renderer half of criterion 10 (accessible, distinctive design) for these screens.

## Task list

| ID | Task | Size | Depends on | Soft reuse (lane order) | Status |
|---|---|---|---|---|---|
| U1 | [Watches rebuilt provider-first](tasks/U1-watches-provider-first.md): list with provider/status filters, a 3-step create flow with Explore prefill, detail without flicker, AvailabilityGrid restyle, ConfirmDialog delete | L | D3, V4, V5 | E1 (location combobox), E2 (prefill links) | ⬜ |
| U2 | [Site Sniper rebuilt provider-first ("Soon")](tasks/U2-site-sniper-provider-first.md): list, new detail route with status timeline, isolated countdown, held state with payment hand-off, create flow, connect-account prompt | M | U1, V6 | U3 (restyled ComingSoonBanner) | ⬜ |
| U3 | [Bookings rebuilt provider-first ("Soon")](tasks/U3-bookings-provider-first.md): Trips-style tabs, BookingCard, "Manage on {provider}" instead of the fake cancel, provider-first add/import, reachable remove | M | D3, V4 | U1 (ProviderPicker, LocationCombobox, StepFlow) | ⬜ |
| U4 | [Settings and Accounts](tasks/U4-settings-and-accounts.md): sub-navigation; Accounts (per-provider connect/sign out); Notifications (desktop + split email notifier, write-only secrets); Gmail (only if wired); App; About. Login page removed | L | D3, V6, P4, P5 | U2 (accounts hooks) | ⬜ |
| U5 | [Notifications and system surfaces](tasks/U5-notifications-and-system-surfaces.md): bell/popover with ProviderBadge and deep links, provider access-status chip, update card in the tray, WA Stay About dialog, provider-prefixed OS notification titles | M | D3, V4 | U2 (Countdown), U4 (AboutPanel) | ⬜ |

Lane R order (streams.md): **U1 → U3 → U2 → U4 → U5**. U2 and U3 can run in parallel worktrees once U1 is merged, provided they coordinate on `ComingSoonBanner` (see Shared building blocks).

## Shared building blocks (create once, reuse; never duplicate)

| Building block | Path | Created by | Reused by |
|---|---|---|---|
| `ProviderPicker` + `useProviders({ capability })` | `components/providers/ProviderPicker.tsx`, `renderer/api/providers.ts` | U1 (or D3 if it already shipped the hook) | U2, U3 |
| `LocationCombobox` (catalog.search, provider-scoped) | `components/LocationCombobox.tsx` | E1 if suitable, else U1 | U2, U3 |
| `StepFlow` (create-flow scaffold: step list, focus on step heading, Back/Continue) | `components/StepFlow.tsx`, or the D2 `Stepper` if one exists | U1 | U2, U3 (add-booking dialog) |
| `ProviderStayFields` (StayQuery fields + provider-declared extras) | `components/stay/ProviderStayFields.tsx` | U1 | U2 |
| `AvailabilityGrid` (restyled, `UnitAvailability[]` input) | `components/AvailabilityGrid.tsx` | U1 | U2 detail (optional), E3 if useful |
| `ComingSoonBanner` (restyled) | `components/ComingSoonBanner.tsx` | U3 (first in lane order) | U2 |
| `Countdown` + `useNow` (one shared ticker) | `components/Countdown.tsx`, `renderer/hooks/useNow.ts` | U2 | U5 |
| `ConnectAccountPrompt` + `renderer/api/accounts.ts` | `components/accounts/ConnectAccountPrompt.tsx` | U2 | U4, U3 (later) |
| `AboutPanel` | `features/settings/about/AboutPanel.tsx` | U4 | U5 (AboutDialog) |

Rule: if a block already exists when a task starts, reuse it. Otherwise the task creates it at the path above. A missing **design-system primitive** (Combobox, Menu, Popover, Switch, Disclosure, RadioCard, Stepper…) is added to `components/ui/` with its own tests, following the D2 conventions, in the same task. Each such addition is noted in the PR. Features never hand-roll a primitive.

## Route map (final state)

| Path | Owner | Notes |
|---|---|---|
| `/watches`, `/watches/create`, `/watches/:id`, `/watches/:id/edit` | U1 | Paths kept. Stored notifications use `actionUrl` `/watches/:id` (`notification.service.ts:90,124`). |
| `/site-sniper`, `/site-sniper/create`, `/site-sniper/:id` (**new**) | U2 | Notifications already link to `/site-sniper/:id` (`notification.service.ts:147,171`), but no such route exists today (`App.tsx:82-83`). |
| `/bookings`, `/bookings/:id` | U3 | `notification.service.ts:192` links to `/bookings/:id`. |
| `/settings` → `/settings/accounts`; `/settings/:section` (`accounts`, `notifications`, `app`, `about`, `gmail`?) | U4 | `?provider=<id>` focuses that row on Accounts. |

**Prefill contract (Explore E2 → U1/U2).** The query string is `?location=<locationKey>&arrival=YYYY-MM-DD&departure=YYYY-MM-DD&adults=N[&children=N]`, e.g. `/watches/create?location=parkstay:123&arrival=2026-12-12&departure=2026-12-14&adults=2`. Route state is not used, so links survive reloads and OS notifications. Every parameter is optional. The provider comes from the key prefix.

## Integration points

1. **Design system (D1, D2, D3).**
   - Tokens, type (Figtree/Fraunces) and lucide icons come from D1.
   - Primitives come from D2: Button/IconButton, Field, Select, Checkbox, Switch, RadioGroup, Dialog, ConfirmDialog, Tabs, SegmentedControl, Menu, Popover, Disclosure, Toast, EmptyState, PageHeader, Badge, Skeleton, DateRangeField, GuestsField, ProviderBadge.
   - D3 owns the route table, the top nav with "Soon" pills, the account menu (Settings, About WA Stay) and the floating tray region. U5 places the access chip and update card in the tray.
   - D3 also owns the global Toast provider, the QueryClient and the `events` → query-invalidation bridge.
   - U tasks add per-namespace hooks under `renderer/api/` if D3 did not.
2. **Providers (V1, V4, V5, V6).**
   - From V1: `providers.list()` manifests and capabilities.
   - From V4: provider-agnostic `watches` / `snipes` / `bookings` contracts (`providerId`, location key, `YYYY-MM-DD` stay, `unitIds`, `stayParams`, no `userId`).
   - From V5: `catalog.search/get/checkLocation`.
   - From V6: `accounts.*` and `snipes.openPayment`.
   - Events: `watch:updated`, `snipe:updated`, `booking:updated`, `notification:created`, `account:updated`, `provider:access-status`.
   - Gaps are listed under Open questions OQ1–OQ5.
3. **Explore (E1, E2, E3).** E2's location detail offers "Watch this place" and "Snipe a site" links using the prefill contract above. Location names in U1, U2 and U3 link back to the E2 detail route (path to confirm: OQ10). If E1's search combobox fits, it becomes `LocationCombobox`.
4. **Platform (P3, P4, P5, P6).**
   - P3: typed contracts in `shared/contracts/`.
   - P4: external links go through `setWindowOpenHandler`/`shell.openExternal`, so renderer code uses anchors and never `window.open`. P4 also provides the single-instance lock (U4's start-minimised relies on it) and Gmail OAuth, which decides whether U4 shows a Gmail section.
   - P5: secrets are write-only (`hasPassword: boolean`), so no secret reaches the renderer.
   - U5 adds one event (`app:navigate`) to the contract following the P3 pattern (OQ9).
5. **Brand (B1, B2).** User-visible "WA Stay" strings. The logo asset is used in About (fallback: text wordmark). Repo links point to `github.com/wilsonwaters/wa-stay`.
6. **Retired screens.** Explore replaces Dashboard (O5). Its "upcoming bookings" content becomes U3's Upcoming tab. `pages/Dashboard.tsx` is deleted by whichever of D3/E1 makes `/` Explore; if it still exists when U3 merges, U3 deletes it. D3 removes the login gate; U4 deletes `pages/Login.tsx` and its misleading copy.
7. **Docs & quality (Q1, Q2).** The smoke E2E selects by role and name: headings "Watches", "Site Sniper", "Bookings", "Settings"; buttons "New watch", "New snipe", "Add booking". Q2's screenshots come after U5.

## Out of scope

- Provider modules, core services, scheduler, hold/payment mechanics (P/V streams). This stream only consumes their contracts.
- Explore map, search and location detail (E stream).
- Dark theme, i18n, onboarding tours, macOS/Linux specifics.
- The RAC or any second real provider. Multi-provider behaviour is verified with a fake second provider fixture.
- Email templates and notifier internals (B2 / P3). U4 only restyles the configuration UI.
- Removing the "Soon" pills (stakeholder decision D4 keeps them).
- The Electron smoke E2E suite (Q1). U tasks write Jest/RTL tests only.

## Open questions

| # | Question | Proposed default | Blocks |
|---|---|---|---|
| OQ1 | §3 `ProviderManifest` has no declarative description of provider-specific stay fields (gear/equipment, vehicles, postcode, concessions). The renderer cannot render them without per-provider code, which §3 forbids. | V1/V4 add `stayFields?: StayFieldSpec[]` (`key, label, kind: select\|number\|text\|boolean, options?, min?, max?, pattern?, help?, usedBy: ('watches'\|'snipes')[]`), stored in `stay_params`. Fallback: render `StayQuery` fields only. | U1 step 3, U2 step 3 |
| OQ2 | There is no manifest flag for an access gate (queue). U2's queue toggle and U5's chip need one. | `capabilities.accessGate: boolean`, or `accessStatus()` returns `{ state: 'unsupported' }`. | U2, U5 |
| OQ3 | Watch auto-book is a no-op today (`watch.service.ts:199-203`). Does V4 implement "hold automatically when found" for providers with holds, or drop the field? | Show the toggle only if the V4 contract has the field **and** `capabilities.holds`. | U1 |
| OQ4 | Booking DTO "manage" link: does V4 expose `manageUrl` from `provider.links.booking()`? | `booking.manageUrl ?? manifest.website`. | U3 |
| OQ5 | Snipe release modes: a generic enum plus provider `releaseInfo` and `checkLocation().release.opensAt`, or modes declared by the provider? | Generic enum. Explanations come from provider data. | U2 step 4 |
| OQ6 | Editing an existing snipe (there is no edit UI today; `siteSniper.update` is unused). | Not in U2: disarm, delete, recreate. Revisit after release. | — |
| OQ7 | Is Gmail OTP still needed now that provider sign-in is in-app (D5)? | Remove all Gmail UI unless P4 ships `gmail.status/connect/disconnect` with a real consumer. | U4 |
| OQ8 | Start minimised: there is no tray (no `Tray` in `src/main`), so a `--hidden` launch is unreachable (`index.ts:83-89`). | Start minimised to the taskbar. Small `main-window.ts` change in U4. | U4 |
| OQ9 | §4 events have no renderer navigation event for OS-notification clicks (`sendNavigationEvent` is a stub, `notification.service.ts:279-281`). | Add `app:navigate { path }` (allow-listed paths). | U5 |
| OQ10 | E2 location detail path and prefill param names. | `/explore/location/:key` + the prefill contract above. | U1, U2 |
| OQ11 | ParkStay bulk availability has no prices (parkstay-api-review: "Watch prices always 0"). Does V4 fetch per-location prices? | Keep the max-price field, with the hint "Applied only when {provider} reports prices". | U1 (copy) |

## Changelog

- 2026-10-02: created. Five tasks (U1–U5). Dependencies follow the planning brief, which differs from streams.md in two places: U4 adds P5 and U5 adds V4. Sizes match streams.md (U1 L, U2 M, U3 M, U4 L, U5 M). U2 stays M only if it reuses U1's StepFlow, ProviderPicker and LocationCombobox; otherwise re-size it to L.
