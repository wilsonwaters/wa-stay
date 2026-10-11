# P3 — Composition root and typed IPC layer, notifier rename, preload subscriptions with unsubscribe

**Stream:** platform · **Depends on:** P2

## Description
Every later stream adds services and IPC methods. Today that means:

- editing hand wiring in `src/main/index.ts:106-161`;
- a `registerIPCHandlers` that takes 12 positional arguments, 5 of them optional (`ipc/index.ts:31-44`). A missing argument silently skips registering that domain's handlers;
- a `GmailOTPService.getInstance()` singleton (`ipc/index.ts:48`).

The 65 `ipcMain.handle` calls across 12 handler files each copy the same try/catch, and none validates input at runtime. Other problems:

- **The renderer supplies `userId`** (handlers `watch.handlers.ts:17,40`, `notification.handlers.ts:12,51` and the site-sniper equivalents; preload `preload/index.ts:97-104,124-131,151-161`). Bookings already resolve the user in main (`ipc/index.ts:51`).
- **Listeners.** Preload `on.*` returns nothing, and `off.*` calls `removeAllListeners`, which also wipes other subscribers (`preload/index.ts:284-368`).
- **Events.** Main only emits queue status, broadcast to every window (`queue.handlers.ts:127-133`), and updater events (`auto-updater.service.ts:103-107`).
- **Name clash.** Notification "providers" collide with accommodation providers.

This task delivers the composition root and the contract-driven IPC described in architecture-notes §1 and §4.

## Size
L

## Scope
- **`src/main/app/container.ts`**
  - `createContainer({ db })` builds every repository, service, notifier, dispatcher, scheduler, updater and Gmail service **once**, and returns a typed `AppContainer`.
  - `dispose()` stops the scheduler, destroys the queue and closes the DB. `before-quit` calls it.
  - `GmailOTPService` gets a public constructor that takes its `OAuth2Handler`.
- **`src/main/app/profile.ts`.** `requireUserId()` returns the first `users.id`. If there is none, it throws `AppError('NO_PROFILE')`. See master-plan open question 1.
- **`src/shared/contracts/`**
  - One file per namespace: the final §4 names (`bookings`, `watches`, `snipes`, `notifications`, `notifiers`, `gmail`, `settings`, `app`, `updater`) and the transitional `auth`, `parkstay` and `queue`, which V1, V3 and V6 replace. Plus `events.ts` and an `index.ts` exporting `contract` and `type WindowApi`.
  - Each method declares a `channel` (`<namespace>:<kebab-method>`), a zod `request` schema (one object payload, or `z.void()`) and a TS response type.
  - Channel names live in a zod-free module, so the preload never pulls in zod.
  - Delete `src/shared/constants/ipc-channels.ts`.
- **`src/main/ipc/handle.ts`.** `handle(def, fn)` is the **only** caller of `ipcMain.handle`. For each call it:
  1. Validates the sender. `event.sender.id` must be registered as trusted. `event.senderFrame` must be non-null, be the top frame, and have a URL on the app origin: the dev server URL, or the `file:` URL of `dist/renderer/index.html` built with `pathToFileURL`.
  2. Parses the payload with zod.
  3. Maps results to `APIResponse`: `{ success: true, data }`, or `{ success: false, code, error }` with code `VALIDATION` (plus issue paths), `FORBIDDEN`, `NO_PROFILE`, `NOT_FOUND` or `INTERNAL`. For `INTERNAL`, an `Error`'s message is kept and a non-Error throw becomes `Unexpected error`.
  4. Logs the channel name, never the payload or a stack in the response.
  - Add `code?: ApiErrorCode` to `APIResponse` (`shared/types/api.types.ts:99-104`).
- **Handlers and registration.** `registerIpcHandlers(container, { isTrustedSender })` replaces the positional function. There is one handler file per namespace in `ipc/handlers/`, all written on `handle()`, and no handler reads `userId` from a payload.
- **`src/main/ipc/events.ts`**
  - `RendererEvents.emit(name, payload)` sends only to trusted webContents.
  - Contract events: `notification:created`, `watch:updated`, `snipe:updated`, `booking:updated`, `updater:available|not-available|downloaded|progress|error` and `app:navigate { path }` (§12.6; U5 emits it), plus the transitional `queue:status`.
  - Migrate the queue and updater emitters onto it. Wire `notification:created` from `NotificationService.notify`. V4 wires `watch:updated` and `snipe:updated`.
- **Typed settings keys (§12.7).** `shared/contracts/settings.ts` holds a key registry: key → zod value schema, `valueType` and `category`, all owned by main. `settings.set(key, value)` no longer accepts `valueType`/`category` from the renderer (`settings.handlers.ts:39-49`). The registry starts with the key main already uses, `launchOnStartup` (`app.handler.ts:103-129`). U4 and U5 add their keys. An unknown key returns `VALIDATION`.
- **Preload.**
  - Implements `WindowApi` from the contract. Each method maps its positional arguments to the payload object.
  - `events.on(name, cb)` returns `() => void`, which removes only that wrapper.
  - Renames: `watch.execute`/`siteSniper.execute` → `watches.runNow`/`snipes.runNow`, and `notification.deleteAll` → `notifications.clearAll`.
  - `userId` parameters are removed.
  - `src/preload/window.d.ts` types `window.api` as `WindowApi` from `shared/contracts`.
- **Notifier rename (O6).** Rename only names; keep the stored values (`'email_smtp'`).

  | Kind | Before | After |
  |---|---|---|
  | Types file | `shared/types/notification-provider.types.ts` | `notifier.types.ts` |
  | Types | `NotificationProvider*`, `ProviderStatus`, `NotificationChannel` | `Notifier*`, `NotifierStatus`, `NotifierChannel` |
  | Directory | `services/notification/providers/` | `notifiers/` |
  | Classes | `BaseNotificationProvider`, `SMTPEmailProvider` | `BaseNotifier`, `SmtpEmailNotifier` |
  | Repository | `notification-provider.repository.ts` | `notifier.repository.ts` (`NotifierRepository`) |
  | Handlers | `notification-provider.handlers.ts` | `notifiers.handlers.ts` |
  | Channels | `provider:*` | `notifiers:*` |

- **Transitional renderer.** Make mechanical call-site edits only, with no visual or behavioural change:
  - Namespaces: `Watches/index.tsx`, `CreateWatch.tsx`, `SiteSniper/index.tsx`, `CreateSiteSnipe.tsx` and `EmailSettingsCard.tsx:57,154,189,217,219`.
  - Dropping the hard-coded `1` userId: `Watches/index.tsx:34`, `CreateWatch.tsx:19`, `SiteSniper/index.tsx:88`, `CreateSiteSnipe.tsx:19` and `NotificationBell.tsx:49,89`.
  - Switching `on`/`off` to the returned unsubscribe: `UpdateNotification.tsx:18-44`, `QueueStatus.tsx:41-65`, `NotificationBell.tsx:20-23` and `SiteSniper/index.tsx:68-73`.
- Update CLAUDE.md "IPC Pattern" to describe the contracts, `handle.ts` and the handler files.

## Non-goals
- **P4:** removing Gmail inbox channels, stripping secrets from responses, `main-window.ts` and single instance. P3 ports the gmail, auth and notifier channels as they are, adding no new exposure.
- **V1, V5, V6:** the `providers`, `catalog` and `accounts` namespaces, and the `CAPABILITY` code.
- **P6:** bundling the preload. P3's preload must still run under today's tsc build with `sandbox: false`.
- **D3:** the `renderer/api` hooks.
- **U5, V4:** new methods (`markAllRead`, `unreadCount`, `openPayment`, `import(providerId, …)`, list filters).
- **V4:** moving services into `core/`, and emitting `watch:updated`/`snipe:updated`.

## Completion Criteria
- [ ] `grep -rnE "new [A-Z]\w*(Service|Repository|Dispatcher|Scheduler|Notifier|Handler)\(" src/main` matches only `src/main/app/container.ts`.
- [ ] `grep -rn "getInstance" src/main` returns nothing.
- [ ] `grep -rn "ipcMain.handle" src/main` matches only `src/main/ipc/handle.ts`.
- [ ] Parity test: every contract method has exactly one registered handler, every registered channel is in the contract, and the preload exposes a function for every contract method.
- [ ] `watches.get` with `{ id: 'abc' }` returns `{ success: false, code: 'VALIDATION' }`, and the service is not called.
- [ ] Each of the following returns `code: 'FORBIDDEN'` without running the handler: an untrusted `sender.id`, a null `senderFrame`, a sub-frame, or a frame URL of `https://evil.example`.
- [ ] A test iterating every contract request schema finds no key named `userId`.
- [ ] With no `users` row, `watches.create` returns `code: 'NO_PROFILE'`.
- [ ] Two subscribers to one event: unsubscribing one leaves the other receiving events.
- [ ] `grep -rn "removeAllListeners" src` returns nothing.
- [ ] `NotificationService.notify` emits `notification:created` with the stored notification.
- [ ] `settings.set('unknown.key', 1)` returns `VALIDATION`. `settings.set('launchOnStartup', 'yes')` returns `VALIDATION`. A valid set stores the registry's `valueType`/`category`.
- [ ] Queue and updater events reach only trusted webContents.
- [ ] `grep -rniE "notification.?provider|PROVIDER_(LIST|GET|CONFIGURE|ENABLE|DISABLE|TEST)" src tests` returns nothing. Stored channel values are unchanged.
- [ ] `npm run type-check` passes with the transitional renderer.
- [ ] Runtime check (`npm run build && xvfb-run -a npx electron . --no-sandbox`, with the Electron-ABI binary per RUNBOOK): Watches lists, Create Watch saves, Settings → Email loads the saved config and the update banner subscribes. The log shows no errors.
- [ ] CLAUDE.md "IPC Pattern" is updated.
- [ ] `npm run lint && npm run format:check && npm run type-check && npm test` pass.

## Edge Cases
- **`Date` values.** `Date` fields survive structured clone, so request schemas use `z.date()` (watches, snipes, bookings).
- **Refined schemas.** Zod schemas with `.refine` (`watch.schema.ts:10-46`) cannot be `.partial()`'d. Build update payloads from the base object, and keep the cross-field rules in the services.
- **Optional arguments.** Optional arguments keep their current semantics. For example, `notifications.list` without `limit` still returns everything (`notification.repository.ts:38-43`).
- **Navigating frames.** `event.senderFrame` can be `null` while the frame navigates or is destroyed. Treat that as FORBIDDEN, not as a crash.
- **Trusted origin.**
  - Dev: derive it from the same variable used to load the window. `ELECTRON_RENDERER_URL` falls back to `http://localhost:3000`; `start-electron.js` uses 3005.
  - Prod: the install path may contain spaces or Unicode (`C:\Program Files\WA Stay\…`). Compare `pathToFileURL` hrefs, and treat the Windows drive letter case-insensitively.
- **Events with no window.** Events emitted before the window exists, or after it closes, are dropped without error.
- **Duplicate subscriptions.** The same callback subscribed twice gets two independent unsubscribers.
- **Logging secrets.** Validation-failure logs for `auth`, `gmail` and `notifiers` must not include field values, which can contain passwords. Log issue paths only.
- **Handler outlives its window.** A handler promise that rejects after the window has closed must not raise an unhandled rejection.

## Test Strategy
- **Unit:** about 24 tests.
  - `handle.ts` (10): validation, the four sender checks, error mapping ×3, no stack in the response, secret-safe logging.
  - Contract parity and the no-`userId` check (3).
  - Preload API with a mocked `electron` (6): method→channel mapping, payload shaping, subscribe/unsubscribe ×3.
  - Container (3): built once, `dispose` order, no singletons.
  - `RendererEvents` (2).
- **Component:** the existing renderer tests updated for the renamed namespaces. No new component tests.
- **Integration:** about 2 tests. A container built on a migrated in-memory DB plus a fake `ipcMain`/event, running the `watches.create` → `watches.list` round trip and a `notifiers.configure` → `notifiers.get` round trip.

## Context Files to Read First
- `ai-state/architecture-notes.md` §1, §2 (Notifier), §4, §7 and §12 (items 6, 7 and 11). `ai-state/brief.md` O6.
- `ai-state/research/tech-review.md` findings 1, 8, 13 and 15. `ai-state/research/ui-review.md` "Routes" and "Unused preload methods".
- `src/main/index.ts`, `src/main/ipc/index.ts`, `src/main/ipc/handlers/*.ts`, `src/shared/constants/ipc-channels.ts` and `src/shared/types/api.types.ts:99-104`
- `src/preload/index.ts`, `src/preload/window.d.ts`, `src/shared/schemas/*.ts` and `src/shared/types/notification-provider.types.ts`
- `src/main/services/notification/**` and `src/main/services/gmail/GmailOTPService.ts:15-50`
- The renderer call sites listed in Scope, plus `src/renderer/App.tsx` and `src/renderer/pages/Settings.tsx`

## Notes
Suggested contract shape. The agent may refine it, but must keep a single source of truth:

```ts
export const watches = {
  list:   { channel: 'watches:list',    request: z.void(),                    response: {} as Watch[] },
  runNow: { channel: 'watches:run-now', request: z.object({ id: z.number().int().positive() }), response: {} as WatchExecutionResult },
} satisfies Namespace;
```

- Commit as a small series, each commit passing the gate: (1) container and profile, (2) contracts, `handle.ts` and handlers, (3) preload and renderer call sites, (4) notifier rename.
- V1 extends the same `contract` object. Do not create a second registry.

## Orchestrator addendum (2026-10-02, from the P2 review)
- [ ] `auth.deleteCredentials` and Logout clear only the credential fields. They never delete the local profile row (architecture-notes §12.21–22). `ensureLocalProfile()` runs at startup.
- [ ] `tests/integration/local-profile.test.ts` is changed from `test.failing` to `test` and passes.
- [ ] The notifier class, file and the `providerChannel` field are renamed to match the DB (`notifiers` / `notifier_channel`, done in v7).
