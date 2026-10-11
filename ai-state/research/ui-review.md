# Renderer review (pre-refactor baseline)

## Routes
HashRouter. Login is NOT a route: App.tsx shows <Login> until auth.validateSession succeeds. Logout calls auth.deleteCredentials (wipes creds).

| Path | Component | Key window.api calls |
|---|---|---|
| / | pages/Dashboard.tsx | booking.list |
| /bookings | pages/Bookings/BookingsList.tsx ("Soon") | booking.list, booking.delete (delete dialog unreachable) |
| /bookings/:id | pages/Bookings/BookingDetail.tsx | booking.get, booking.update(id,{}) (fake cancel), booking.delete |
| /watches | pages/Watches/index.tsx | watch.list(1), activate, deactivate, execute, delete |
| /watches/create | pages/Watches/CreateWatch.tsx | watch.create(1, …) |
| /watches/:id | pages/Watches/WatchDetail.tsx | watch.get, execute, activate, deactivate; polls 30s (flickers: sets isLoading) |
| /watches/:id/edit | pages/Watches/EditWatch.tsx | watch.get, update, delete (window.confirm) |
| /site-sniper | pages/SiteSniper/index.tsx ("Soon") | siteSniper.list(1), activate, deactivate, execute, delete, on.snipeStatusUpdate; 1s countdown re-render breaks toasts |
| /site-sniper/create | pages/SiteSniper/CreateSiteSnipe.tsx | siteSniper.create(1, …) |
| /settings | pages/Settings.tsx (5 tabs) | auth.getCredentials/storeCredentials/validateSession, app.get/setAutoLaunch |

Unused preload methods: all settings.*, all gmail.*, parkstay.checkAvailability, booking.sync/syncAll, auth.updateCredentials, siteSniper.get/update, updater.checkForUpdates/getStatus, queue.check/wait/clear, notificationProvider.list, on.bookingUpdated, on.watchResult.
Preload `on.*` returns no unsubscribe; `off.*` calls removeAllListeners (wipes other subscribers).

Map data: parkstay.getAllCampgrounds returns GeoJSON-derived {id,name,type,coordinates:[lon,lat]} (parkstay.service.ts:315-327). searchCampgrounds re-downloads the full list every call.

## Components
MainLayout (256px sidebar, emoji nav, Soon pills, Logout; header title + bell; QueueStatus floating), AvailabilityGrid, QueueStatus (fixed bottom-right, polls 10s), NotificationBell/NotificationList, UpdateNotification (fixed bottom-right), Toast (per-page state), ConfirmDialog, AboutDialog, ComingSoonBanner, ErrorBoundary, LoadingSpinner, forms/WatchForm (439 lines), forms/SiteSniperForm (648), forms/ManualBookingForm, forms/ImportBookingForm, settings/EmailSettingsCard (547), settings/SMTPSetupInstructions.

## Styling/state/forms
- Tailwind 3 inline utilities; only token = `primary` (sky blue). index.css has .btn/.input/.card used inconsistently. No @tailwindcss/forms. No fonts, no icon library (emoji + copy-pasted heroicons SVG). No dark mode.
- useState/useEffect fetch per page. React Query QueryClient set up in main.tsx but unused (and in devDependencies).
- userId hard-coded to 1 in Watches, CreateWatch, SiteSniper, CreateSiteSnipe, NotificationBell.
- react-hook-form + zodResolver for WatchForm/SiteSniperForm/ManualBookingForm (resolver cast `as any`); Login/Settings/EmailSettingsCard/ImportBookingForm plain useState.

## Top UX problems
1. Dead controls: Settings Gmail "Authorize" only sets local state (Settings.tsx:112-126); Desktop notifications/Sound/Minimize to tray/Log level save nothing (:345-443, :466-472); "Open Folder" (:497) / "Clear All Data" (:512) have no handler; BookingDetail "Cancel Booking" fakes status (:57-60); Dashboard "Add Booking" → Soon page.
2. Generic AI look: emoji icons, gradient Login bg (Login.tsx:63), pastel callouts, rainbow buttons on watch cards (Watches/index.tsx:193-236).
3. Inconsistent layout: duplicate titles, multiple h1, nested p-6, mixed radii, 5 date formats incl. US style.
4. Overlapping fixed bottom-right UI: QueueStatus, UpdateNotification, ToastContainer, inline toasts.
5. Flicker bugs (WatchDetail refresh, SiteSniper status push), toast timers reset (Toast.tsx:48 removeToast dep), LoadingSpinner fullScreen overflow.
6. Duplication: status badges x4, error alerts x4, modal overlays x5, 7+ spinners, two campground comboboxes, label+input+error ~40x.
7. A11y: modals lack role=dialog/aria-modal/focus trap/Escape; icon-only buttons unlabeled; checkboxes without labels; tabs lack tablist/aria-selected; no aria-current; comboboxes lack ARIA/keyboard; no aria-live; errors not linked; gray-400 text fails AA.
8. Split: SiteSniperForm 648, EmailSettingsCard 547, Settings 538, WatchForm 439, WatchDetail 406, SiteSniper index 360, BookingsList 356.
9. Copy: Login "never sent to any external servers" (wrong); Gmail "never leaves your device".
10. window.open used for external links; no setWindowOpenHandler → opens Electron windows (security/UX). Use shell.openExternal.
11. Unit tests assert CSS classes (bg-red-600 etc.) → break on redesign; e2e specs stale (.booking-card, h1 "ParkStay Bookings").

## Branding inventory (user-visible)
index.html:6; MainLayout.tsx:36-37; Dashboard.tsx:69-71; Login.tsx:67,70,129; Settings.tsx:199,202,280,325,524; CreateWatch.tsx:118; AboutDialog.tsx:59,101,109; QueueStatus.tsx:164,172; ImportBookingForm.tsx:61,75; main/index.ts:61 window title; email-smtp.provider.ts (From name, subjects, bodies; green #2d5a27); oauth2-handler.ts:200; app-constants.ts:3 APP_NAME; electron-builder.json; resources/installer.nsh (37 lines).
~855 lines across 95 files repo-wide (mostly docs).

## DO NOT rename blindly (existing installs depend on them)
- package.json "name": "parkstay-bookings" determines userData folder (no top-level productName). Holds parkstay.db (connection.ts:435) and logs.
- electron-builder appId com.parkstay.bookings → NSIS upgrade-in-place + auto-update.
- Encryption secrets/salts: AuthService.ts:13 & :220, notification-provider.repository.ts:21 & :402, oauth2-handler.ts:32.
- QUEUE_GROUP='parkstayv2', PARKSTAY_*_URL, browser-headers.ts = DBCA identifiers (not branding).

## CSP
None today. Recommend CSP via onHeadersReceived (dev) / meta at build (prod): default-src 'self'; img-src 'self' data: blob: <tile hosts>; connect-src 'self' <tile/style/glyph hosts>; worker-src blob:; child-src blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; dev: ws://localhost:3000 + script-src 'unsafe-inline'. Add setWindowOpenHandler → shell.openExternal.
