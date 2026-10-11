# U5 — Notifications and system surfaces

**Stream:** provider-ux · **Depends on:** D3, V4

## Description

As a WA Stay user:

- I always know which provider an alert is about, and I can jump straight to the related watch, snipe or booking.
- I can see at a glance when a provider's queue is holding me up.
- The update and About surfaces look like WA Stay, not like floating boxes that cover each other.
- My Windows notifications tell me which provider they come from.

### Today's problems

**Notification bell and list**

- `NotificationBell` hard-codes `userId` 1 (`NotificationBell.tsx:49,89`).
- It counts unread items only among the 20 it has loaded (`:98`).
- It closes only on outside mouse-down: no Escape, no focus management (`:27-42`).
- `NotificationList` uses emoji icons (`NotificationList.tsx:27-48,100`). The "✕" delete button (`:119-124`) and the refresh button (`:75-81`) have no accessible names.
- Clicking an item does nothing, even though every notification stores an `actionUrl`.
- The renderer listens for `notificationCreated`, but main never sends it: `sendToRenderer` is a stub (`notification.service.ts:270-274`).

**Floating panels**

- `QueueStatus` polls every 10 s (`QueueStatus.tsx:62`) and is fixed bottom-right (`:107`), on top of `UpdateNotification` (`UpdateNotification.tsx:61`). This is ui-review #4.
- The update card's close button is an unlabelled SVG (`:133-145`). Its progress bar has no role (`:88-93`).
- `AboutDialog` has no dialog semantics (`AboutDialog.tsx:56-57`). It uses `window.open` to reach `parkstay-bookings` (`:100-110`).

**OS notifications**

- Titles carry no provider and read "Site Held — Complete Payment!" or "Snipe Booked!" (`notification.service.ts:143,167`).
- Clicking one calls a stub, `sendNavigationEvent` (`:244-249,279-281`).

## Size

M. Several small surfaces with one concern: system feedback. The main-process change is limited to OS notification title and click handling.

## Scope

- **In scope**
  - **Feature folder and hooks**
    - Create `features/notifications/`.
    - Add `renderer/api/notifications.ts` (if D3 did not create it) with: list, `unreadCount`, `markRead`, `markAllRead`, `delete`, `clearAll`.
    - Subscribe to the `notification:created` event; it invalidates both the list and the count.
  - **`NotificationBell`** (in D3's top-nav slot)
    - Icon button named "Notifications, {n} unread", or "Notifications" when nothing is unread.
    - The badge comes from `notifications.unreadCount()` and caps at "99+".
    - The bell opens a D2 `Popover` containing `NotificationList`.
  - **`NotificationItem`**
    - Shows a `ProviderBadge` when `providerId` is set. Otherwise it shows a neutral WA Stay glyph named "WA Stay".
    - Shows a lucide type icon, title, message, relative time ("5 min ago"), and an "Unread" text marker.
    - Clicking an item marks it read, navigates to its deep link and closes the popover.
    - Per-item "Mark as read" and "Delete" buttons are named with the item title.
    - The list header has "Mark all as read" and "Clear all"; "Clear all" asks for confirmation in a `ConfirmDialog`.
  - **Deep-link resolver**
    - Uses `actionUrl` only if it matches an allow-listed internal pattern: `/watches/:id`, `/site-sniper/:id`, `/bookings/:id`, `/settings/:section`.
    - Otherwise it derives the link from `relatedType`/`relatedId`.
    - Otherwise there is no link. Never navigate to an external URL.
  - **`AccessStatusChip`** (replaces `QueueStatus`, lives in D3's floating tray)
    - Data comes from `providers.accessStatus(id)` for providers with an access gate (OQ2), plus `provider:access-status` events. The renderer does not poll.
    - Text by state:
      - waiting: "ParkStay queue · position 123 · about 4 min";
      - active: "ParkStay · access granted · 12 min left", using U2's `Countdown`;
      - expired: "ParkStay queue session expired";
      - idle: the chip is hidden.
    - There is one chip per provider with a non-idle status. Each expands to show details.
  - **`UpdateCard`** (replaces `UpdateNotification`, lives in the tray)
    - Available: Download / Later.
    - Downloading: a `progressbar` with `aria-valuenow`.
    - Downloaded: Restart now / Later.
    - Error: the message and Dismiss.
    - Uses `events.on('updater:*')` with its returned unsubscribe, not `off.*`, which `removeAllListeners` other subscribers (`preload/index.ts:332-368`).
    - The tray stacks the chip and the card vertically, with no overlap.
  - **`AboutDialog`** (`features/settings/about/AboutDialog.tsx`)
    - A D2 `Dialog` wrapping U4's `AboutPanel`.
    - Header uses the WA Stay logo from B1 if present; otherwise a text wordmark.
    - Opened from D3's account menu item "About WA Stay".
  - **OS notifications** (main, `core/notifications` NotificationService)
    - Desktop title is `${manifest.shortName} · ${title}` when `providerId` is set, e.g. "ParkStay · Sites available at Osprey Bay". The stored and in-app title stays unprefixed, because the badge already shows the provider.
    - Rewrite the builder titles in calm sentence case:

      | Event | New title |
      |---|---|
      | Watch found | "Sites available at {location}" |
      | Watch partly found | "Some nights available at {location}" |
      | Snipe held | "Site held at {location}" |
      | Snipe booked | "Booked at {location}" |
      | Booking confirmed | "Booking confirmed at {location}" |

    - Clicking an OS notification restores and focuses the main window. It then emits the new `app:navigate { path }` event (OQ9; path allow-listed in main and again in the renderer), and the renderer navigates.
  - **Cleanup:** delete `components/{NotificationBell,NotificationList,QueueStatus,UpdateNotification,AboutDialog}.tsx` and any remaining `queue.*` renderer usage.
- **Out of scope**
  - Notification persistence, dispatch and notifiers (P3/V4).
  - The queue implementation (V3).
  - Auto-updater behaviour (unchanged).
  - Email subjects and bodies (B2).
  - Tray container layout (D3).

## Non-goals

- No notification preferences UI; U4 owns it.
- No per-item snooze, grouping or a notifications page. The popover is the only list.
- No sound changes; U4 wires sound.
- No system tray icon. The floating tray is an in-window region.
- No changes to how often the DBCA queue is polled in main.

## Completion Criteria

- [ ] **Unread count.** With a fixture of 25 notifications and `unreadCount() = 23`, the bell's accessible name is "Notifications, 23 unread". The count comes from `unreadCount`, not from the loaded page.
- [ ] **Provider marking.**
  - Items with `providerId: 'parkstay'` render a ParkStay ProviderBadge.
  - Items with a null `providerId` render the "WA Stay" glyph.
  - `features/notifications` contains no emoji characters.
- [ ] **Deep links.** Clicking an item navigates, calls `markRead(id)` and closes the popover:
  - a watch item goes to `/watches/12`;
  - a snipe item goes to `/site-sniper/7`;
  - a booking item goes to `/bookings/3`.
  An item whose `actionUrl` is `https://evil.example` does not navigate.
- [ ] **Bulk actions.**
  - "Mark all as read" calls `notifications.markAllRead`, and the badge disappears.
  - "Clear all" opens a ConfirmDialog; confirming calls `notifications.clearAll`.
- [ ] **Live updates.** Emitting `notification:created` updates the badge without remounting the component.
- [ ] **Access chip.**
  - Waiting `{ position: 123, estimatedWaitSeconds: 240 }` renders "ParkStay queue · position 123 · about 4 min".
  - Active renders "access granted".
  - Idle renders no chip.
  - `grep -rn "queue.getStatus\|setInterval" src/renderer/features/notifications` → 0 results.
- [ ] **Update card.**
  - Each of the four states renders its buttons.
  - Downloading renders `role="progressbar"` with `aria-valuenow`.
  - When both are present, the chip and the card render inside the single tray region, in order.
- [ ] **About.** "About WA Stay" in the account menu opens a dialog showing "WA Stay", the version, and a link to `https://github.com/wilsonwaters/wa-stay`.
- [ ] **OS notification title (main unit test).** With a mocked Electron `Notification`, a ParkStay watch-found notification gets the desktop title "ParkStay · Sites available at Osprey Bay", and the stored title is "Sites available at Osprey Bay".
- [ ] **OS notification click.**
  - Main unit test: the click focuses the window and emits `app:navigate` with `/watches/12`.
  - Renderer test: on that event, the route changes.
- [ ] **Cleanup.**
  - The five legacy components are deleted.
  - `grep -rn "window.api\|userId" src/renderer/features/notifications` → 0 results.
  - No file is over 250 lines.
- **Accessibility**
  - [ ] **Popover focus.** The bell has `aria-expanded` and `aria-controls`. Opening moves focus to the popover heading. Escape and outside click close it and return focus to the bell.
  - [ ] **Accessible names.** Icon-only controls are named:
    - "Delete notification: {title}";
    - "Mark as read: {title}";
    - "Dismiss update".
  - [ ] **Announcements.**
    - New notifications and access transitions (waiting → access granted) go through one polite live region.
    - A queue position change is announced at most once a minute.
  - [ ] **Unread is not colour-only.** Unread state is shown as text, not only as a dot or tint. The badge meets AA contrast.
  - [ ] **About dialog.** It has `role="dialog"`, `aria-labelledby` its title, and traps focus. Escape closes it and returns focus to the account menu button.
- [ ] **Gate.** `npm run lint` (0 errors), `npm run format:check`, `npm run type-check` and `npm test` all pass.

## Edge Cases

- **Empty and failed list.**
  - An empty list shows the EmptyState "You're all caught up".
  - A failed list load shows an inline error with Retry; the badge keeps its last value.
- **Unknown provider.** A `providerId` that is no longer registered shows the fallback badge "Unknown provider".
- **Optimistic actions.** `markRead` and `delete` update optimistically and roll back on failure, showing an error toast.
- **Deleted target.** A deep link to a deleted watch, snipe or booking lands on the target page's "not found" state (owned by U1/U2/U3).
- **Legacy links.** v1 `actionUrl` values (`/watches/12`, `/site-sniper/7`, `/bookings/3`) stay valid.
- **New item while open.** A notification created while the popover is open is prepended without stealing focus.
- **Access status.**
  - An error or unknown state shows "ParkStay queue status unavailable", collapsed.
  - Multiple providers with an access gate each get their own chip.
  - Position 0 or a missing wait estimate omits that part of the text.
- **Updater edge cases.**
  - An updater event arriving after "Later" re-shows the card only for a new state (available → downloaded).
  - A download error mid-way switches the card to the error state.
- **Window state.** An OS notification click while the window is minimised or hidden restores it. While the app is quitting, the click is ignored.
- **Bad navigation paths.** An `app:navigate` path that is not allow-listed is ignored and logged at warn level in main.
- **Missing logo.** If the B1 logo asset is missing, the About dialog shows the wordmark and does not render a broken image.

## Test Strategy

- **Unit (~5):**
  - deep-link resolver: allow-list, `relatedType` fallback, external URL rejected;
  - bell label and "99+" formatter;
  - access-status text formatter;
  - announcement throttle;
  - OS title builder (shared or main helper).
- **Main unit (~2):**
  - `showDesktopNotification` prefix and click → focus + `app:navigate`;
  - builder titles.
- **Component (~10):**
  - NotificationBell: count, open/close, focus, Escape;
  - NotificationItem: badge/glyph, navigation, names;
  - mark all / clear all;
  - event-driven update;
  - AccessStatusChip states;
  - UpdateCard states and progress bar;
  - tray stacking;
  - AboutDialog;
  - `app:navigate` handler.
- **Integration (~1):** `notification:created` event → badge increments → open popover → click item → route `/watches/12`, with the item marked read.

## Context Files to Read First

- `CLAUDE.md`
- `ai-state/architecture-notes.md` §2, §4 (notifications, providers.accessStatus, events), §7, §8
- `ai-state/streams/provider-ux/master-plan.md`
- `ai-state/research/ui-review.md` (#4, #5, #7, #10) and `ai-state/research/tech-review.md` (#10, #15)
- D3 shell outputs: `src/renderer/app/*` (top nav slot, account menu, tray region, events bridge); `src/renderer/components/ui/*` (Popover, Dialog)
- U2 `components/Countdown.tsx`; U4 `features/settings/about/AboutPanel.tsx`
- `src/shared/contracts/{notifications,providers,updater,events}*`
- Current code to replace:
  - `src/renderer/components/{NotificationBell,NotificationList,QueueStatus,UpdateNotification,AboutDialog}.tsx`;
  - `src/main/services/notification/notification.service.ts` (or its `core/notifications` successor);
  - `src/preload/index.ts:284-368`

## Notes

- The `app:navigate` event is a small addition to the §4 event list (OQ9). Add it to `shared/contracts` following P3's pattern. Validate the path in main before sending it.
- The OS title prefix uses `manifest.shortName` resolved through the registry in main. Provider code never formats titles.
- U5 lands last in lane R. If `Countdown` (U2) or `AboutPanel` (U4) is missing, create it at the master-plan path rather than inlining it.
- Toast stacking and timers belong to D2's Toast. The `Toast.tsx:48` timer-reset bug is not re-fixed here.
