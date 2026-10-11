# WA Stay app shell

The frame around every page: the header, the route table, the floating tray, error handling and focus management. It lives in `src/renderer/app/`, and the data layer it relies on lives in `src/renderer/api/`. There is no login gate (brief D2): the app opens straight on Explore.

The accessible names in [Stable names](#stable-names) are a contract with the Electron smoke tests (Q1). Change one only together with this page and those tests.

## Files

| File | What it is |
| --- | --- |
| `main.tsx` | Renders `app/App` in `StrictMode`. Nothing else. |
| `app/App.tsx` | Fonts and styles, `AppProviders`, the app-level error boundary and `AppRoutes`. |
| `app/AppProviders.tsx` | `HashRouter` (production loads `file://`), `QueryClientProvider`, `LucideProvider` (stroke 1.75, 20 px), `ToastProvider`, `AnnouncerProvider` and `ProviderManifestsProvider`, filled from `useProviders()`. |
| `app/AppRoutes.tsx` | The route table. (Not `routes.tsx`: `./routes` would be ambiguous, and Vite, Jest and TypeScript all resolve it to `routes.ts` first.) |
| `app/routes.ts` | `PATTERNS`, `ROUTES`, `buildPath()`, `LEGACY_REDIRECTS` and `pageTitleFor()`. |
| `app/AppShell.tsx` | Header, `<main id="main">`, the route error boundary and the tray. |
| `app/TopNav.tsx`, `app/AccountMenu.tsx` | The primary navigation and the account menu. |
| `app/Tray.tsx` | The bottom-right stack of floating messages. |
| `app/ErrorBoundary.tsx` | `AppErrorBoundary` and `RouteErrorBoundary`. |
| `app/useRouteFocus.ts` | Focus and announcements on page changes. |
| `app/NotFoundPage.tsx` | The 404 page. |
| `features/explore/ExplorePage.tsx` | Explore, the home screen (E1): search pill, filters, results and the map ([map.md](map.md)). |
| `features/place/PlaceDetailPage.tsx` | A place's detail page (E2): gallery, About (the provider's notices, then its description, in sections as an accordion when it has them), facilities, sites, booking rules, and the "Check your dates" card with the night grid and the hand-offs. |
| `app/stayParams.ts` | The stay in a query string (`arrival`, `departure`, `adults`, `children`, `infants`): parsed, validated and written in one order. |

## Header

```
+--------------------------------------------------------------------------------------+
| [WA Stay lockup]  Explore  Watches  Site Sniper (Soon)  Bookings (Soon)  [Bell] [Acc] |  64 px
+--------------------------------------------------------------------------------------+
   link to /        <nav aria-label="Primary">                              Bell  Account menu
```

- 64 px high, `sticky top-0 z-header`, `surface` background with a hairline `border` bottom. Gutters are 24 px, or 32 px from 1024 px wide.
- **Skip link** first: "Skip to content", visually hidden until focused, then shown over the logo. It is the first Tab stop and moves focus to `<main id="main">` (by script, since a plain `#main` link would change the HashRouter route).
- **Logo:** the B1 lockup (`components/brand/Logo.tsx`, architecture-notes §12.28), decorative, inside a link to `/` named "WA Stay, Explore".
- **Primary nav:** Explore, Watches, Site Sniper, Bookings.
  - The current item has `aria-current="page"`, ink text at weight 600 and the D1 `underline` brushstroke in ocean, which is `aria-hidden`. The stroke sits in the label's own box at full width, so it is as wide as the label (not the Soon pill) at any zoom. Other items are `fg-secondary` at weight 500. A hidden bold copy of each label reserves its width, so the nav does not shift between pages.
  - Explore is current on `/` and on `/places/*`. Watches is current on `/watches` and everything under it, and the same for Site Sniper and Bookings. On Settings, nothing in the nav is current.
  - Site Sniper and Bookings carry a sun `Badge` reading "Soon", which is `aria-hidden`. Their name comes whole from `VisuallyHidden` text ("Site Sniper, coming soon"), with the visible label hidden from assistive technology, so the name has no stray separator in any engine. Below 900 px wide (a narrow window or 200% zoom) the pills collapse and only the hidden text remains.
- **Right:** the `NotificationBell` (`features/notifications/`), then the account menu. The account menu is an `IconButton` with `CircleUser`, named "Account and settings". Its items are "Settings" (a link to `/settings`) and "About WA Stay", which opens `AboutDialog` (`features/settings/about/`), a `Dialog` named "About WA Stay" around `AboutPanel`, headed by the B1 lockup (the text wordmark if the artwork fails to load). Focus returns to the menu button when the dialog closes. There is no Logout and no sign-in (§12.21–22); provider accounts arrive with V6 and U4.

### Notifications (U5)

- **Bell.** An `IconButton` with the lucide `Bell`, named "Notifications", or "Notifications, 23 unread" from main's `notifications.unreadCount()` (every unread one, not only the loaded page); the count also shows in a decorative `accent` badge, "99+" at most. `notification:created` marks the count and the list stale, so the badge follows without a remount, and the new notification is announced in the polite live region ("New ParkStay notification: Sites available at Osprey Bay").
- **List.** The bell opens a `Popover` named "Notifications" (`aria-expanded`, `aria-controls` on the bell); focus moves to its "Notifications" heading, and Escape or a click outside closes it and gives focus back to the bell. It loads the newest 20 (`notifications.list(20)`) when it opens: a skeleton while loading, an inline error with Retry, "You're all caught up" when empty. The header has "Mark all as read" (while any are unread) and "Clear all", which asks in a `ConfirmDialog` ("Clear all notifications?").
- **Item.** A `ProviderBadge` (or the WA Stay mark, named "WA Stay", for app-wide notifications; "Unknown provider" for one no longer registered), a lucide type icon, the title, the message, "5 min ago" and the word "Unread". Its icon buttons are named "Mark as read: {title}" and "Delete notification: {title}"; both act at once and roll back with an error toast if main refuses. The title is a link when the notification has an in-app page: clicking anywhere on the item marks it read, opens the page and closes the list.
- **Deep links** (`features/notifications/deepLink.ts`). A notification's `actionUrl` is followed only when it is one of `/watches/:id`, `/site-sniper/:id`, `/bookings/:id` or `/settings/:section` (`shared/utils/app-links.ts`, the one allow-list main uses too); otherwise the link comes from its `relatedType`/`relatedId` through `ROUTES`; otherwise there is none. An external address is never followed.
- **Desktop notifications** (main). The OS title is `${shortName} · ${title}` ("ParkStay · Sites available at Osprey Bay"); the stored title has no prefix. A click restores and focuses the window, then main sends `app:navigate { path }` with the notification's allow-listed page, and `useAppNavigate` (in `AppShell`) follows it after checking the same allow-list. A click while the app is quitting is ignored.
- The header never wraps. Down to the 960 × 640 minimum window (`minWidth`/`minHeight` on the `BrowserWindow`) there is no horizontal scrolling.
- Zoomed in, the viewport can be narrower than 960 CSS px. Below 900 px the Soon pills collapse; below 640 px the lockup gives way to the square mark and the gutters tighten. If the nav still does not fit (about 200% zoom), the nav strip scrolls sideways on its own, with its scrollbar hidden (Tab scrolls a focused link into view), and the page itself never scrolls sideways.

## Routes

Build every address with `ROUTES` (or `buildPath` with a pattern), never by joining strings. `buildPath` `encodeURIComponent`s each parameter, so an `externalId` may hold `/`, `?` or spaces.

| Path | `ROUTES` key | Renders | Notes |
| --- | --- | --- | --- |
| `/` | `explore` | `ExplorePage` | Its state lives in the query string (`q`, filters, dates, guests, `map`, `follow`, `view`, `sel`). |
| `/places/:providerId/:externalId` | `placeDetail(providerId, externalId, stay?)` | `PlaceDetailPage` | E2. Its stay (`arrival`, `departure`, `adults`, `children`, `infants`) is in its own query, and an unknown place shows "This place isn't available". |
| `/watches` | `watches` | `WatchesPage` | Provider and status filters in the URL (`?provider=&status=`). |
| `/watches/new` | `watchNew(prefill?)` | `NewWatchPage` | The five-step create flow, filled from the prefill query. |
| `/watches/:id` | `watchDetail(id)` | `WatchDetailPage` |  |
| `/watches/:id/edit` | `watchEdit(id)` | `EditWatchPage` |  |
| `/site-sniper` | `snipes` | `SnipesPage` | Keeps its "Soon" pill and `ComingSoonBanner` (D4). Pushed updates change cards in place. |
| `/site-sniper/new` | `snipeNew(prefill?)` | `NewSnipePage` | The five-step create flow (provider, location, stay, release and timing, review), filled from the prefill query. |
| `/site-sniper/:id` | `snipeDetail(id)` | `SnipeDetailPage` | Notifications link here. An unknown id shows "Snipe not found". |
| `/bookings` | `bookings` | `BookingsPage` | Upcoming / Past / Cancelled tabs, provider filter and search in the URL (`?tab=&provider=&q=`). |
| `/bookings/:id` | `bookingDetail(id)` | `BookingDetailPage` | "Manage on {shortName}" hands off to the provider; "Remove from WA Stay" never cancels there. |
| `/settings/:section?` | `settings(section?, { provider? })` | `SettingsPage` | U4. Sections `accounts`, `notifications`, `app` and `about`, in a sub-navigation (`nav` "Settings sections"). `/settings` and an unknown section go to `accounts`, keeping the query; `?provider=<id>` focuses that provider's row on Accounts. |
| `/__design` | `design` | `DesignPreviewPage` | Development builds only, lazy, outside the shell (it has its own header and main). |
| `/watches/create`, `/site-sniper/create` |  | redirect | To `/new`, keeping the query string (§12.19). |
| anything else |  | `NotFoundPage` | "Page not found" and "Back to Explore". |

**Prefill query** for create flows (§12.10): `?provider=<id>&location=<externalId>&arrival=YYYY-MM-DD&departure=YYYY-MM-DD&adults=N&children=N`. `ROUTES.watchNew(prefill)` and `ROUTES.snipeNew(prefill)` build it and leave out empty values, and `parseCreatePrefill(search)` reads it back, dropping values that are not valid. `location` is the provider's external id, not the composite location key. New watch (U1) and New snipe (U2) read it with `parseCreatePrefill`, keep the dates to the provider's day with `clampStayParams`, and say which parts of a link they could not use.

**From Explore to a place and back.** Explore's cards and the map preview's "View details" open `ROUTES.placeDetail(providerId, externalId, stay)` with Explore's stay, and history state `{ from: 'explore', search }` (`PlaceLinkState`). The place page's back link, "← Explore" (`BackLink`, as `PageHeader`'s on every other page), goes back one step when it has that state, so Explore returns exactly as it was left: its state is in the URL, and `useExploreScrollMemory` puts back the window's scroll and the number of cards, saved per search in `sessionStorage['ws:explore:scroll:' + search]`. Otherwise it opens Explore with the place's stay. Explore's hidden `h1` is `fixed`, so the focus it takes on arrival never scrolls the list.

## Focus and announcements

- After every change of page (pathname, not the query string), `useRouteFocus` moves focus to the page's `h1` (given `tabIndex={-1}` if it has none), or to `<main>` when there is no `h1` yet, and announces the title through the polite live region. The announcement is the `h1` text, or the route's title from `pageTitleFor()`.
- Settings' sections are one page (`routeFocusKey()`): its sub-navigation moves focus to the section's `h2` instead. A page that moves focus inside `<main>` itself before the route-focus frame keeps it (Settings → Accounts focusing the row a `?provider=` link asked for); the title is still announced.
- A page that loads before showing its heading gets two seconds' grace: if its `h1` appears while focus is still on `<main>` (or was lost to the body), focus moves to it. The same applies when a page replaces the `h1` it showed first (heading, spinner, heading again): focus lost with the old heading moves to the new one.
- The first page after launch is left alone, so the first Tab still reaches the skip link. In a quick run of navigations, only the last page takes focus.
- A heading focused this way (`h1`–`h3` with `tabindex="-1"`) draws no focus ring (a base rule in `styles/index.css`): it is a reading position, not a control. Everything a person can Tab to keeps the 2 px ring.
- Landmarks: one `banner` (the header), one `navigation` named "Primary", one `main`. Each page has exactly one `h1`, normally from `PageHeader`.

## Tray

One column, `fixed bottom-4 right-4`, 380 px wide at most, with an 8 px gap, portalled outside `#root`. The column stretches its cards (`items-stretch`) and the toast region fills it, so the stacked cards share one width and never overlap. Top to bottom, in DOM and visual order:

1. `ToastViewport` (the "Notifications" region)
2. `UpdateCard` (`features/notifications/`), a region named by its title, from `updater:*` events (each through `events.on` and its own unsubscribe): "Update available" with Download and Later; "Downloading WA Stay 2.1.0" with a `progressbar` ("Update download", `aria-valuenow`); "Update ready" with Restart now and Later; "WA Stay couldn't update" with the message and Dismiss. Its close button is "Dismiss update" (not while downloading). Later or Dismiss sets that news aside: the card comes back only for something new (available → downloaded, or a newer version).
3. `AccessStatusChips`: one `AccessStatusChip` per provider with `capabilities.accessGate` whose gate is not idle, a region named "{shortName} queue": "ParkStay queue · position 123 · about 4 min", "ParkStay · access granted · 12 min left" (a `Countdown`), "ParkStay queue session expired", or "ParkStay queue status unavailable". Each expands ("ParkStay queue details") to say more. It reads `providers.accessStatus(id)` once and then `provider:access-status` events; nothing polls. A change of state is announced in the polite live region at once, a new queue position at most once a minute.

- The column never takes clicks itself (`pointer-events-none`); only the cards in it do.
- Each card sits in a slot with no box of its own (`display: contents`), so a card that renders nothing (the chips while every gate is idle) leaves no gap.
- **Layers.** The tray is at `z-tray` (40), under the modal scrim (`z-overlay`, 50). Being portalled, it is never made `inert` by a modal. While a modal is open (the overlay stack marks `#root` inert), or the notification list is open (it shares the bottom-right corner on short windows), the tray rises to `z-toast` (60) so toasts stay readable and clickable above it, and the update and access slots are made `inert` and invisible, keeping their space so toasts do not move. Everything returns when the modal or the list closes: one floating layer at a time.
- **Explore (E1):** the tray covers the bottom-right corner of the map, so the Mapbox logo and attribution sit bottom-left, where it never covers them (Mapbox terms).

## Errors

- `AppErrorBoundary` wraps everything inside the providers. Anything that throws outside a page (the header, the tray) replaces the window with a full-page `EmptyState`: "WA Stay hit a problem", with "Reload WA Stay" and "Copy error details" (message, stack, component stack and route).
- `RouteErrorBoundary` wraps only the routed page and is keyed by pathname. A page that throws shows "This page hit a problem" with the error message, "Try again" and "Back to Explore", while the header and tray keep working. Going to any other page starts with a fresh boundary.

## Data layer (`renderer/api/`)

`src/renderer/api/` is the only place that touches `window.api` (architecture-notes §8).

- `client.ts`: `unwrap(call)` resolves an `APIResponse` to its `data` or rejects with `ApiError { message, code?, issues? }`. Pass a function of the API, `unwrap((api) => api.app.getInfo())`, so that a missing `window.api` also becomes an `ApiError` (`API_UNAVAILABLE`).
- `queryKeys.ts`: the only place query keys are built, with `providers`, `catalog`, `notifications`, `app` and `updater` namespaces. Invalidate a namespace with its `all` prefix.
- `events.ts`: `useApiEvent(name, cb)` subscribes for as long as the component is mounted and always calls the latest `cb`. `useInvalidateOn(event, queryKey)` marks a query stale when the event arrives.
- `providers.ts`: `useProviders()`, `useProvider(id)` and `useProvidersWith(capability)`. Until V1 (#19) adds the shared `ProviderManifest` and `window.api.providers`, they use a local structural type marked `TODO(V1)` and resolve to an empty list when the preload has no `providers` namespace. `useAccessStatus(id)`: a provider's access gate, fetched once and then set from `provider:access-status` (an answer older than the last event is dropped).
- `app.ts`: `useAppInfo()` and `useOpenLogsFolder()` for About; `useLaunchAtLogin()` and `useSetLaunchAtLogin()` for Settings → App.
- `settings.ts`: `useSetting(key)` (the stored value, or the key's default) and `useSetSetting(key)` (renderer-writable keys only; optimistic, rolled back on failure).
- `accounts.ts`: `useAccountStatus(id)`, `useAccounts()` (both reloaded on `account:updated`), `useAccountCheck(id)` (one read-only `accounts.status` per visit, never polled), `useSignIn()`, `useSignOut()` and `useOpenSignInLink()`.
- `notifiers.ts`: `useEmailNotifier()` (`hasPassword`, never a password), `useConfigureEmailNotifier()`, `useSetEmailNotifierEnabled()` and `useTestEmailNotifier()`.
- `notifications.ts`: `useNotifications()` (the newest 20), `useUnreadNotificationCount()`, `useNotificationUpdates()` (both stale on `notification:created`), and the actions: `useMarkNotificationRead()`, `useMarkAllNotificationsRead()` and `useDeleteNotification()` change the cache at once and roll back if main refuses; `useClearNotifications()` waits for main.
- `updater.ts`: `useDownloadUpdate()` and `useInstallUpdate()` (the update card), and `useCheckForUpdates()` (Settings → About).
- `catalog.ts`: `useCatalogSearch(query)` (`catalog.search` with `limit: 5000`, previous results kept while the next load, 5 minutes fresh), `useCatalogAll()` (the unfiltered catalogue, for filter options and suggestions; the same cache entry as an empty search), `useCatalogStatus()`, `useCatalogRefresh()`, and `useCatalogUpdates()`, which reloads them on `catalog:updated`. The map area is never sent: Explore filters by area in the renderer.
  - `useLocationDetail(key)`: `catalog.get` (10 minutes fresh; main caches it 6 hours), showing the place's summary from a cached search (`isPlaceholderData`) while it loads. `useLocationDetailUpdates(key)` reloads only that detail when its provider's catalogue syncs.
  - `useLocationCheck(key, stay)`: `catalog.checkLocation`, asked only once a stay is given (the person pressed Check), one cache entry per stay, 1 minute fresh as in main, and never retried by itself.
  - `useBulkAvailability(stay, { settled, online })` (E3): `catalog.availability(stay, { providerIds: [id] })`, one query per catalogue provider with `bulkAvailability`, so one provider failing or slow never holds up another. Keyed by provider and the stay fields it reads (`stayKeyFor(stay, manifest.bulkAvailabilityStayFields)`, `shared/utils/stay-key.ts`; every field when a provider declares none), so changing guests reuses ParkStay's answer; 2 minutes fresh, kept 15 minutes, never retried or refetched by itself. Main's bulk cache uses the same key. Nothing is asked while the stay is still changing (`settled`, Explore debounces it 400 ms) or offline, but a stay already in the cache shows at once. A sync (`catalog:updated`) or a refresh reloads every catalogue query except these.
- **Query client** (`app/queryClient.ts`): `staleTime` 60 s, no refetch on window focus, queries retry once except for `VALIDATION`, `CAPABILITY`, `NOT_FOUND`, `NOT_IMPLEMENTED` and `API_UNAVAILABLE`, and mutations never retry.
- **Guard:** `tests/unit/renderer/api-boundary.test.ts` fails if `window.api` appears outside `renderer/api/`. Its legacy allow-list is empty (the U tasks rebuilt every pre-redesign page) and can never grow again; the token guard's list of legacy pages is empty too.

### Outside the app

With no `window.api` (the renderer opened in a plain browser with `npm run dev:renderer`), the shell still renders. A warning `Notice` at the top of `<main>` says the background service isn't available, and the bell is left out (it has nothing to count). The tray's update card and access chips render nothing: no events arrive and no provider is listed.

### Provider manifests

`ProviderManifestsProvider` is filled from `useProviders()`, so `<ProviderBadge providerId="parkstay" />` needs no `info`. If the list is empty or fails, badges fall back to their unknown variant, and a failure raises one error toast ("Provider details couldn't be loaded. …") after a single retry.

## Stable names

| What | Role | Accessible name |
| --- | --- | --- |
| Skip link | link | Skip to content |
| Logo | link | WA Stay, Explore |
| Primary navigation | navigation | Primary |
| Nav items | link | Explore · Watches · Site Sniper, coming soon · Bookings, coming soon |
| Notifications bell | button | Notifications, or "Notifications, N unread" |
| Account menu button | button | Account and settings |
| Account menu items | menuitem | Settings · About WA Stay |
| About | dialog | About WA Stay |
| Notification list | dialog, heading level 2, buttons | Notifications · Mark all as read · Clear all · Mark as read: {title} · Delete notification: {title} |
| Clear all | alertdialog | Clear all notifications? |
| Update card | region, progressbar, button | Update available · Downloading WA Stay {version} · Update ready · WA Stay couldn't update · Update download · Dismiss update |
| Access chip | region, button | {shortName} queue · {shortName} queue details |
| Toasts | region | Notifications |
| Settings | heading level 1, navigation, heading level 2 | Settings · Settings sections · Accounts, Notifications, App or About WA Stay |
| Settings → Accounts | list, heading level 3 per row | Provider accounts · the provider's name |
| 404 | heading level 1, button | Page not found · Back to Explore |
| Route error | heading level 1, buttons | This page hit a problem · Try again · Back to Explore |
| App error | heading, buttons | WA Stay hit a problem · Reload WA Stay · Copy error details |
| Explore page title | heading level 1 (visually hidden) | Explore places to stay |
| Explore search | search, combobox, button | Search places · Where · Search |
| Explore filters | group, buttons | Filters · Provider · Type · Region · Facilities · Book online · Available only · Clear all (a chip with choices: "Region, 1 selected") |
| Explore results | region, heading level 2 | Results · "169 places", or "12 places in map area" once the person has moved the map; with dates "169 places · 8 available for 6–8 Nov", or "… · checking availability…" |
| Explore availability | button, list | Retry {shortName} availability · Map key |
| Explore map | region, switch | Map of places · Search as I move the map |
| Explore below 1024 px | button | Show map · Show list |
| Place page title | heading level 1 | The place's name, or "This place isn't available" |
| Place page | link, region, button | Explore (the back link) · Check your dates · Check availability |
| Place hand-offs | link | Book on {shortName} (opens in your browser) · Watch for availability · Snipe a site, coming soon |
| Place gallery | button, dialog | Show all {n} photos · Photos of {name} |
| Place results | region, table, switch | Availability · Availability by night, {dates} · Fully available only |
| Bookings | heading level 1, button, tablist, tab | Bookings · Add booking (· Import booking, only when a provider can import) · Trips · "Upcoming, 2 trips", "Past, 1 trip", "Cancelled, 0 trips" |
| Booking card | article, link, button, menuitem | The place's name · More actions for {place} · Remove from WA Stay |
| Booking page | heading level 1, link, button, region | The place's name · Manage on {shortName} (opens in your browser) · About {place} · Copy reference {ref} · Stay, Unit, Guests, Cost, Reference |
| Site Sniper | heading level 1, link, list, article | Site Sniper · New snipe · Snipes · the snipe's name |
| Snipe card | timer, button | "Opens in 2 days 4 hours" · Arm, Disarm, Arm again or View booking · More actions for {name} (View details · Run now · Delete) |
| Held snipe | region, timer, button, alert | Hold at {place} · "22 minutes left to pay" · Pay now · "Site held at {place}. Pay within {n} minutes." |
| New snipe | navigation, radiogroup, button | New snipe steps · When are the sites released? · Advanced timing · Create snipe |

## Testing

- `tests/utils/renderer/renderWithApp.tsx`: `renderWithApp({ route, api })` renders the whole app at a route, in a `#root` container, with a fresh query client. `api` takes stubs for `createMockApi`, a ready `MockApi`, or `null` for no `window.api`. `currentRoute()` reads the HashRouter path. `getBanners()` returns the banner landmarks as a browser computes them: jsdom also counts every `PageHeader`'s `<header>`, which browsers do not.
- `tests/utils/renderer/createMockApi.ts`: a strict `window.api` (an un-stubbed method rejects with an error naming it) that answers the shell's first calls, with a working `events.on`. `emit(name, payload)` drives events inside `act`, and `unsubscribes` holds a spy for each subscription.
