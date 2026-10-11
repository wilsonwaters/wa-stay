# D3 — App shell: top navigation, no login gate, data layer, tray

**Stream:** design-system · **Depends on:** D2, V1

## Description

Today `App.tsx` blocks the whole app behind `<Login>` until `auth.validateSession` succeeds. Navigation is a 256 px sidebar with emoji, and QueueStatus, UpdateNotification and toasts all pin themselves to `fixed bottom-4 right-4` and overlap (ui-review #4). React Query is configured but unused, and components call `window.api` directly with `userId` hard-coded to 1.

This task builds the WA Stay shell in `src/renderer/app/`:
- A top header with logo lockup and primary nav, a notification bell and an account menu.
- No login gate (brief D2). The app opens on Explore at `/`.
- Routes reorganised under `features/`.
- A React Query client plus the `renderer/api/*` hook layer (architecture-notes §8).
- A floating tray that stacks overlays without overlap.
- Error boundaries and a 404.
- Focus management on route changes.

Existing pages keep working inside the shell until the provider-ux stream rebuilds them.

As a WA Stay user, I open the app and land straight on Explore, with clear top navigation and notifications that never cover each other, so I can get around without signing in first.

## Size

M. This is at the upper bound: shell, routes and data layer are one concern ("frame of the app"), but no domain UI is rebuilt.

## Scope

**In scope:**
- **`src/renderer/app/`:**
  - `App.tsx`: moved from `src/renderer/App.tsx`, which is deleted.
  - `AppProviders.tsx`: `HashRouter`, `QueryClientProvider`, `LucideProvider` (moved from `main.tsx`), `ToastProvider`, `AnnouncerProvider`, and `ProviderManifestsProvider`, filled from `useProviders()`.
  - `queryClient.ts`, `routes.tsx` (route table), `routes.ts` (`ROUTES` constants and `buildPath()`), `AppShell.tsx`, `TopNav.tsx`, `AccountMenu.tsx`, `Tray.tsx`, `NotFoundPage.tsx`, `ErrorBoundary.tsx` (app-level and `RouteErrorBoundary`), `useRouteFocus.ts`, `Wordmark.tsx`.
  - `src/renderer/main.tsx` only imports `app/App`.
- **Header:**
  - 64 px, sticky, `surface` background with a hairline bottom border.
  - Left: logo lockup. Use `assets/brand/logo-lockup.svg` if B1 has landed, else `Wordmark` ("WA Stay" in Fraunces with a brush dab). It is a link to `/` with the accessible name "WA Stay, Explore".
  - Then `<nav aria-label="Primary">` with NavLinks: **Explore** (`/`, also active for `/places/*`), **Watches**, **Site Sniper**, **Bookings**.
  - The active link has `aria-current="page"`, ink text at weight 600, and the D1 `Brushstroke underline` (`aria-hidden`).
  - Site Sniper and Bookings stay navigable and show a sun-tone `Badge` reading "Soon". Their accessible names are "Site Sniper, coming soon" and "Bookings, coming soon" (visual pill `aria-hidden` plus `VisuallyHidden`).
  - Right: the existing `NotificationBell` (legacy, U5 rebuilds it), and an `AccountMenu` `IconButton` (`CircleUser`) labelled **"Account and settings"**. Its `Menu` items are "Settings" (→ `/settings`) and "About WA Stay", which opens the existing AboutDialog content re-hosted in the D2 `Dialog`.
- **Remove the login gate:**
  - Delete the `isAuthenticated`/`checkAuth`/`handleLogout` logic, the startup `auth.validateSession` call, `pages/Login.tsx` and the Logout control.
  - Delete `pages/Dashboard.tsx` (O5) and `components/layouts/MainLayout.tsx`.
- **Route table** (`ROUTES`), matching architecture-notes §12.10 exactly:
  - `/` → `features/explore/ExplorePage.tsx`: a placeholder `PageHeader` "Explore" plus `EmptyState` "The map is on its way". E1 replaces it.
  - `/places/:providerId/:externalId` is reserved for E2 and renders NotFound until then.
  - `/watches`, `/watches/new`, `/watches/:id`, `/watches/:id/edit`.
  - `/site-sniper`, `/site-sniper/new`, `/site-sniper/:id` (reserved for U2, renders NotFound until then).
  - `/bookings`, `/bookings/:id`.
  - `/settings/:section?`.
  - `/__design` (DEV only, lazy).
  - `*` → `NotFoundPage`.
  - Legacy `/watches/create` and `/site-sniper/create` redirect to `/new` and **keep the query string**, so prefill links (§12.10) survive.
- **Legacy pages** move unchanged except for import paths, with `git mv`:
  - `pages/Watches/*` → `features/watches/legacy/`
  - `pages/SiteSniper/*` → `features/snipes/legacy/`
  - `pages/Bookings/*` → `features/bookings/legacy/`
  - `pages/Settings.tsx` → `features/settings/legacy/`
  - The routes wrap each one in `<LegacyPageFrame>`, which supplies the padding and max-width they used to get from MainLayout. `src/renderer/pages/` is removed.
- **`src/renderer/api/`** (the only place `window.api` is touched):
  - `client.ts`: `unwrap<T>(p: Promise<APIResponse<T>>): Promise<T>`, which throws `ApiError { message, code? }`.
  - `queryKeys.ts`: a key factory with `providers`, `catalog`, `notifications`, `app` and `updater` namespaces.
  - `providers.ts`: `useProviders()`, `useProvider(id)` and `useProvidersWith(capability)`.
  - `events.ts`: `useApiEvent(name, cb)`, which subscribes through `window.api.events.on`, unsubscribes on unmount and holds the latest callback in a ref. Also `useInvalidateOn(event, queryKey)`.
  - `app.ts`: `useAppInfo()` for About.
  - `index.ts`.
- **`queryClient.ts`:** `staleTime` 60 s, `refetchOnWindowFocus: false`, query `retry: 1` except for `ApiError` codes `VALIDATION`/`CAPABILITY`/`NOT_FOUND` (0), mutation `retry: 0`.
- **Tray** (`Tray.tsx`):
  - One `fixed bottom-4 right-4 z-tray` flex column, gap 8, max width 380.
  - Slots in fixed DOM and visual order, top to bottom: `ToastViewport`, `UpdateNotification`, `QueueStatus`.
  - Remove the `fixed …` positioning from `QueueStatus.tsx` and `UpdateNotification.tsx` (positioning only; U5 restyles them).
  - The tray never captures clicks outside its children (`pointer-events-none` container, children `auto`).
- **Error handling:**
  - The app-level `ErrorBoundary` shows a full-page `EmptyState` "WA Stay hit a problem", with "Reload WA Stay" and "Copy error details" buttons.
  - `RouteErrorBoundary` wraps the routed outlet, keyed by `location.pathname`, so the header stays usable and navigating away recovers.
- **`useRouteFocus`:** on pathname change (not search-param-only changes), move focus to the page `h1` (`tabIndex={-1}`), falling back to `<main>`. Announce the page title politely.
- **Window size:** set `minWidth: 960, minHeight: 640` in `src/main/app/main-window.ts`, or wherever the BrowserWindow is created after P3/P4. Layout rules down to 960 px: no horizontal scroll, and the header never wraps.
- **Guard and docs:**
  - API-boundary guard test `tests/unit/renderer/api-boundary.test.ts`, with an explicit legacy allow-list.
  - Test helpers `tests/utils/renderer/{renderWithApp.tsx,createMockApi.ts}`.
  - `docs/design/shell.md`: header anatomy, the route table, tray order and stable accessible names for Q1.

**Out of scope:** rebuilding legacy pages (U1–U4), Bell, QueueStatus and Update (U5), Accounts UI (U4), and Explore content (E1).

## Non-goals

- No new IPC, preload or contract changes. If a needed method is missing from `src/shared/contracts/`, hide the dependent UI and record the gap in the PR notes.
- No sign-in prompts. Per-provider accounts arrive in V6/U4.
- No `index.html` title or window-title rename (B2), no custom title bar, no side navigation, no hamburger menu.
- Legacy pages are not converted to React Query. They stay on the guard allow-list until rebuilt.

## Completion Criteria

- [ ] Launching the app with no stored credentials lands on `/` (the Explore placeholder) with no Login screen. `auth.validateSession` is not called at startup (the mock asserts this).
- [ ] The header shows the lockup and four nav links, the bell and "Account and settings". On `/watches/12`, the Watches link has `aria-current="page"` and Explore does not. On `/places/parkstay/1`, Explore is current.
- [ ] `getByRole('link', { name: 'Site Sniper, coming soon' })` and `{ name: 'Bookings, coming soon' }` both exist and navigate to their pages.
- [ ] The account menu opens with Enter. "Settings" navigates to `/settings`, and "About WA Stay" opens a `role="dialog"` named "About WA Stay" that returns focus to the menu button on close.
- [ ] Every route in the table renders. `/does-not-exist` shows NotFound with a "Back to Explore" button, and `/watches/create?location=1&adults=2` lands on `/watches/new?location=1&adults=2`.
- [ ] `src/renderer/pages/`, `App.tsx` (old location), `MainLayout.tsx`, `Login.tsx` and `Dashboard.tsx` no longer exist. The legacy Watches, Site Sniper, Bookings and Settings pages still load their data and work inside the shell.
- [ ] `useProviders()` returns manifests from `window.api.providers.list()` through `unwrap`. `ProviderBadge providerId="parkstay"` renders the manifest's shortName with no `info` prop. A rejected response surfaces `ApiError.message`.
- [ ] `useApiEvent` unsubscribes on unmount: the mock's unsubscribe spy is called once.
- [ ] With a toast, an update-available card and an active queue session all present, the tray holds all three in that order inside one container and none overlap (screenshot during runtime verification).
- [ ] A component that throws inside a route shows the route error panel while the header stays interactive. Navigating to Explore clears the error.
- [ ] The BrowserWindow minimum is 960×640. At 960×640 the header does not wrap and the page has no horizontal scrollbar (runtime check).
- [ ] The API-boundary guard passes, with `window.api` only in `src/renderer/api/**` plus the listed legacy files. The token guard passes for `app/**` and `api/**`.
- [ ] **Accessibility:**
  - [ ] On navigation via the nav, focus lands on the new page's `h1`, and a polite live region announces the page title. Search-param changes do not move focus.
  - [ ] A "Skip to content" link is the first Tab stop and moves focus to `<main id="main">`.
  - [ ] Landmarks: one `banner` (header), one `navigation` named "Primary", and one `main`. Exactly one `h1` per routed page (asserted for Explore placeholder, NotFound and Settings).
  - [ ] The active-nav brushstroke is `aria-hidden`. Active state is also conveyed by `aria-current` and weight, not colour alone. axe on `/`, `/watches` and `/settings` reports 0 critical/serious issues.
- [ ] The 4-check gate passes: `npm run lint` (0 errors), `npm run format:check`, `npm run type-check`, `npm test`.

## Edge Cases

- `providers.list()` fails or returns an empty array: the shell still renders. `ProviderBadge` falls back to its unknown variant, and a single error toast appears without looping retries.
- `window.api` missing (renderer opened in a plain browser via `npm run dev:renderer`): `api/client.ts` throws `ApiError('API_UNAVAILABLE')`. The shell renders with a `Notice` instead of crashing. Playwright web tests rely on this.
- Deep link straight to `#/watches/5` on cold start renders the legacy page inside the shell (HashRouter, `file://` in production).
- An unknown `/settings/:section` falls back to the default section. The legacy Settings ignores the param until U4.
- An error thrown inside the tray or header is caught by the app-level boundary, and the reload button works.
- `QueueStatus` returns `null` when idle, so the tray collapses with no empty padding box.
- Rapid navigation (Explore → Watches → Explore): `useRouteFocus` focuses the final page only, with no focus fight.
- At 200% Electron zoom the viewport can drop below 960 CSS px. Nav labels stay on one line and the Soon pills collapse to their visually hidden text below 900 px.

## Test Strategy

- **Unit:** about 10 tests. Cover `unwrap` (success, failure, missing api), the `retry` predicate, `buildPath` encoding of `externalId`, the `queryKeys` shape, `useApiEvent` subscribe and unsubscribe with the latest-callback ref, and the API-boundary guard with a self-test fixture.
- **Component:** about 14 tests using `renderWithApp({ route, api })`:
  - nav `aria-current` per route, including `/places/*`
  - Soon link names
  - account menu keyboard flow and the About dialog
  - no-login-gate startup
  - 404 and redirects
  - route error boundary recovery
  - tray order with all three items
  - skip link
  - route focus on `h1`
  - ProviderBadge via context
- **Integration:** one flow in `tests/integration/renderer/shell.test.tsx`: start at `/`, go to Watches through the nav, open the account menu, open Settings, then hit an unknown route and go back to Explore. Electron smoke coverage follows in Q1.

## Context Files to Read First

- `ai-state/streams/design-system/master-plan.md`, the D1 and D2 specs, `docs/design/design-language.md` and `docs/design/components.md`.
- `ai-state/architecture-notes.md`: §1 layout (`renderer/app`, `api`, `features`), §4 IPC (`providers`, `events`), §8 conventions.
- `ai-state/brief.md`: D2 (no login gate), O5 (Dashboard retired).
- `ai-state/research/ui-review.md`: Routes, Components, top UX problems #4 and #7.
- `src/renderer/App.tsx`, `main.tsx`, `components/layouts/MainLayout.tsx`, `components/{QueueStatus,UpdateNotification,NotificationBell,AboutDialog,ErrorBoundary}.tsx`, `pages/**`.
- `src/shared/contracts/` and `src/shared/types/provider.types.ts` (from V1/P3), `src/preload/index.ts`, `src/main/app/main-window.ts`.

## Notes

- Keep **HashRouter**, because production loads `file://`. Do not adopt a data router: legacy pages are not loader-based.
- `ROUTES` keys, which later tasks reference by name: `explore`, `placeDetail`, `watches`, `watchNew`, `watchDetail`, `watchEdit`, `snipes`, `snipeNew`, `snipeDetail`, `bookings`, `bookingDetail`, `settings` (optional `section`), `design`.
- `ROUTES.placeDetail` is `buildPath('/places/:providerId/:externalId', …)`. E1 and E2 must use it, never string concatenation, and `externalId` is `encodeURIComponent`-ed.
- Stable names for Q1: "Explore", "Watches", "Site Sniper, coming soon", "Bookings, coming soon", "Account and settings", "Skip to content". Changing them requires updating `docs/design/shell.md` and Q1.
- On the Explore map, the tray sits bottom-right. E1 must move the Mapbox logo and attribution to bottom-left so the tray never covers them (Mapbox terms).
- The legacy allow-list in both guards is an explicit file list. U tasks delete entries as they rebuild pages, and the list must never grow.
