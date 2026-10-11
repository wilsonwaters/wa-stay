# V4 design: provider-agnostic core services and scheduler correctness (#22)

**Status:** for approval. No code is written until this is approved.
**Inputs:** the V4 spec and both orchestrator addenda; architecture-notes §1–§4 and §12; tech-review #2, #11, #14, #15; lane/w at `546aae1`, with V3 merged.

## 1. Module layout after the move

### 1.1 Files

| New path | From | Contents |
|---|---|---|
| `core/watches/watch.service.ts` | `services/watch/watch.service.ts` | `WatchService`: CRUD, `execute`, auto-hold |
| `core/watches/matching.ts` | split out of the watch service | Pure functions: wanted units, the price rule, full and partial matches |
| `core/watches/next-check.ts` | new | Pure functions: the effective interval, jitter, `nextCheckAt`, stagger offsets |
| `core/snipes/snipe.service.ts` | `services/sitesniper/sitesniper.service.ts` | `SiteSniperService` (the §1 class name is kept) |
| `core/bookings/booking.service.ts` | `services/booking/BookingService.ts` | `BookingService` |
| `core/holds/night-guard.ts` | new (replaces `hasOverlappingHold`) | `NightGuard`: one booking per night across snipes and auto-hold watches |
| `core/stay-params.ts` | new | Fills in stay-field defaults from `manifest.stayFields`. Replaces the ParkStay-only `PARKSTAY_SNIPE_DEFAULTS` that sits in core today |
| `core/notifications/**` | `services/notification/**` | Service, dispatcher, `notifier-view`, `notifiers/`. P3 did not move them |
| `scheduler/job-scheduler.ts` | rewritten | Facade: `start`, `stop`, `rescheduleAll`, `powerMonitor`, and delegation to the two parts below |
| `scheduler/watch-loop.ts` | new | `WatchLoop`: the due-loop |
| `scheduler/snipe-runner.ts` | new | `SnipeRunner`: the per-snipe state machine |

- Files are moved with `git mv`, and the old folders are deleted. `services/` keeps only `auth`, `gmail` and `updater`.
- The dead code goes: `runSnipeWindow` and `delay`, `importBooking`, `syncBooking`, `getBookingStats`, the no-op cleanup job, `getJobStatus`, and the service wrappers `getArmed` and `getCancellationDue`.

### 1.2 Imports

- `core/**` and `scheduler/**` import only `providers/registry` (`ProviderRegistry`, `ProviderWith`) and `providers/sdk` (errors and module types). Every provider and manifest comes from `registry.require(row.providerId, capability)` or `tryGet`, so `PARKSTAY_PROVIDER_ID` and `parkstayManifest` disappear from core. The criterion grep finds 0.
- Import updates:
  - `app/container.ts`;
  - `ipc/handlers/notifiers.handlers.ts` (`notifier-view`);
  - the tests in §7;
  - the path references in `docs/SITE_SNIPER.md`, `docs/development.md` and the CLAUDE.md "Key Services" table, plus the CLAUDE.md node-cron rows (§8).

### 1.3 Container wiring (`app/container.ts`)

```ts
const nightGuard = new NightGuard(repositories.snipes, repositories.watches);
const providerName = (id: string) => providers.tryGet(id)?.manifest.shortName;
const notificationService = new NotificationService(repositories.notifications, notifierDispatcher,
  rendererEvents, { providerName });
const watchService = new WatchService({ watches: repositories.watches, providers, notifications: notificationService,
  nightGuard, events: rendererEvents,
  accountState: (id) => repositories.providerAccounts.get(id)?.status ?? 'unknown' }); // V6 swaps in its service
const siteSniperService = new SiteSniperService({ snipes: repositories.snipes, providers,
  notifications: notificationService, nightGuard, events: rendererEvents });
const bookingService = new BookingService({ bookings: repositories.bookings, providers, events: rendererEvents });
const scheduler = new JobScheduler({ watches: watchService, snipes: siteSniperService, providers, power: powerMonitor });
```

- Services take one options object instead of positional arguments, with optional `clock` and `random` for tests.
- The `NotificationService` constructor keeps its three existing arguments and gains a fourth options argument.
- Container edits stay within service construction, the scheduler and `dispose` (§4). V5 edits the catalogue part in parallel.

## 2. Watch due-loop

### 2.1 Timing maths (`core/watches/next-check.ts`)

- `effectiveMinutes(watch, manifest) = max(watch.checkIntervalMinutes, 15, providerLimits(manifest).minWatchIntervalMinutes)`.
  - The floor is never below 15 (PQ6), but a provider can raise it.
  - A legacy row with `5` runs at 15, and the stored value is not rewritten.
- `nextCheckAt(checkedAt, minutes, random) = checkedAt + minutes·60 000·(1 + 0.1·random())`, where `random ∈ [0,1)`, so the jitter is 0–10 %.
  - It is persisted after **every** run: found, not found, error, unknown provider, or a gated provider.
  - It is not persisted after an aborted run.
- When `next_check_at` changes outside a run:
  - create and activate set it to now, so the watch is due on the next tick;
  - an update that changes the location, stay, units, stay params or interval also sets it to now.

### 2.2 The loop (`scheduler/watch-loop.ts`)

- **Tick.** One chained `setTimeout` every `TICK_MS = 30 000`.
  - Each tick reads `watches.findDue(now, registeredProviderIds)`: active rows with `next_check_at IS NULL OR <= now` and `provider_id IN (…)`, ordered by `next_check_at`, with parameterised SQL.
  - It launches every row that is not already in flight, then arms the next tick. It never awaits the runs.
  - The tick body has a try/catch, so one bad row cannot stop the loop.
- **In flight.** `inFlight: Map<watchId, { promise, controller, providerId }>`, the spec's `Set<watchId>` plus the promise that run-now joins. An entry is removed in `finally`, only if it is still the same entry.
- **Per-provider cap.** Each provider has a `createLimiter(min(2, providerLimits(m).maxConcurrentRequests))` from `providers/sdk/concurrency.ts`.
  - A due watch that is queued behind the limiter is already in `inFlight`, so the next tick does not launch it twice.
  - When a queued task starts, it checks `signal.aborted` first.
- **Startup stagger.** In `start()`, before the first tick:
  - overdue rows (null first, then oldest) get `next_check_at = now + round(i·120 000/n)`, which is persisted;
  - the ticks at 0, 30, 60 and 90 s then pick them up, so the load is spread over the first 2 minutes.
- **Run now.** `runWatchNow(id)` returns `inFlight.get(id).promise` when the watch is in flight, so no second request starts. Otherwise it launches through the same limiter with `manual: true`, which also runs an inactive watch, as today. The IPC result is the same `WatchExecutionResult`.
- **Cancel.** `cancelWatch(id)` aborts that watch's in-flight run. The deactivate and delete handlers call it.
- **Unknown provider.**
  - At `start()`, active rows whose provider is not registered get `last_result = 'error'` and are logged with `UNKNOWN_PROVIDER`.
  - `findDue` never selects them, so the loop does not spin on them.
  - `runNow` on such a row returns `{ success: false, errorCode: 'UNKNOWN_PROVIDER' }`.

### 2.3 `WatchService.execute(id, { signal, manual })` (never throws, except `NOT_FOUND`)

1. Re-read the row.
2. Return `skipped` if the watch is inactive and the run is not manual.
3. `provider = registry.tryGet(...)`. A missing provider, or one without `capabilities.watches`, is recorded as an error with the code `UNKNOWN_PROVIDER` or `CAPABILITY`.
4. **Expiry.** If `compareDates(stay.arrival, todayIn(manifest.timezone, now)) < 0`, deactivate the watch, emit, and return `expired`. There is no 08:00 AWST rule any more.
5. `await provider.availability.check(externalId, toStayQuery(stay, stayParams), { signal })`.
   - **Deviation:** `unitIds` is not passed. The wanted units are filtered locally by id **or name**, which is V3's `isWanted`. Legacy watches store site names, and ParkStay filters by id only. It is one request either way.
   - If `signal.aborted`, return `aborted` with **no writes**.
6. Match the units (§2.4).
   - Store `lastAvailability: UnitAvailability[]` (the wanted units), `last_result`, `found_count`, `last_checked_at` and `next_check_at` in one repository transaction (`recordRun`).
   - Notify and emit `watch:updated`.
7. `catch`:
   - an abort writes nothing;
   - an `AccessGateError` or any other error is recorded as `last_result = 'error'` with the normal `next_check_at`. **No `ensure()`**: watches never wait in a queue.

### 2.4 Matching, partial runs and price rules (`core/watches/matching.ts`)

- **Price rule** for a run of nights:
  - `priceKnown = every night has a price`;
  - when `maxPrice` is set and `priceKnown`, every night must be `<= maxPrice`;
  - otherwise the run passes with `priceKnown: false`.
- **Full match:** `unit.fullyAvailable`, and the price rule passes over all of its nights.
- **Partial matches:** only when there is no full match and `allowPartialMatch` is on.
  - Per unit, each maximal run of consecutive `available` nights from the **same** response that passes the price rule becomes `{ arrival: first night, departure: last night + 1 }`.
  - No extra request is made.
- Result type: `WatchMatch { unitId, unitName, unitType?, arrival, departure, partial, priceKnown, total? }`. It replaces `AvailabilityResult`, which used `siteId`/`siteName`/`price: 0`.

### 2.5 Auto-hold (PQ4)

When there is a full match and `watch.autoHold` is on, the watch tries to hold the first matching unit (in provider order):

1. **Sign-in check.** If `capabilities.account ∈ {required, required-for-holds}` and `accountState(providerId) !== 'signed-in'`, notify a normal match and add "Sign in to {shortName} to enable automatic holds".
2. **Night guard.** If `nightGuard.tryReserve(...)` finds a conflict, notify a normal match and log the conflict.
3. **Hold.** `await provider.holds.create({ externalId, unitId, stay }, signal)`. The reservation is released in `finally`.
   - **Success:** set `last_result = 'held'` (new `WatchResult.HELD`), deactivate, and `notifyWatchHeld`. That notification has type `SNIPE_HELD`, `relatedType: 'watch'` and the minutes left. The `WatchExecutionResult` carries `hold { reference, expiresAt, unitId, paymentUrl }`. A hold that succeeds after an abort is still recorded (§4).
   - **`auth-required`:** treated like step 1.
   - **Any other failure:** notify a normal match and add "Automatic hold failed: {message}".
- `autoHold: true` is rejected at create or update with `ProviderCapabilityError(id, 'holds')`, which maps to `CAPABILITY`, when `!capabilities.holds`.
- Activating a watch whose `lastResult` is `held` is refused with `VALIDATION`, so it cannot hold the same nights again (open question 6).

## 3. Snipe scheduler state machine (`scheduler/snipe-runner.ts`)

### 3.1 States and transitions (`SnipeStatus`)

```
arm ──► EXPIRED (window over, or arrival < todayIn(tz))
 │──► ARMED ──(warm-up timer: releaseAt − lead)──► QUEUEING* ──► WAITING_RELEASE ──(release timer)──► SNIPING
 │──► SNIPING (cancellation, or now ≥ releaseAt within the window)
SNIPING ──poll──► HELD | FAILED (auth-required, night-guard conflict) | EXPIRED (window end, max attempts)
SNIPING ──AccessGateError & gate on──► QUEUEING ──► SNIPING      any ──deactivate/delete──► (unscheduled)
```

- `*` QUEUEING only happens when the gate is on: `accessGateEnabled && capabilities.accessGate && releaseMode.usesAccessGate`.
- **Terminal states:** HELD, BOOKED, FAILED, EXPIRED and DISABLED.
  - `arm()` never starts a terminal or inactive row. This covers "quit mid-hold, restart, no re-hold".
  - Activating a HELD or BOOKED snipe is refused with `VALIDATION`.

### 3.2 The run record

```ts
interface SnipeRun {
  gen: number;                 // generation token, from a counter on the runner
  controller: AbortController; // per snipe; aborts ensure, check and holds.create
  timer?: Timeout;             // the ONE pending timer: re-arm | warm-up | release | poll
  releaseGate?: () => void;    // from access.holdOpen(), wrapped so it runs once
  inFlight?: Promise<SnipeOutcome>;
}
runs: Map<snipeId, SnipeRun>
```

- **One timer per run.** Each step clears and replaces `run.timer`. There is no `setInterval` anywhere in `scheduler/`.
- The window end is checked at every step. The poll delay is `min(pollMs, windowEnd − now)`, so expiry lands on time without a second timer.
- **`arm(id)`** (schedule, reschedule, activate and `rescheduleAll`):
  1. `unschedule(id)`, then a new run with `gen = ++counter`. `run.inFlight = prepare(run)`.
  2. Re-read the row; stop if it is inactive or terminal.
  3. Unknown provider: record `ERROR` with `lastError = 'UNKNOWN_PROVIDER: …'`, then stop.
  4. **Daily-rollover recompute (addendum):** `fresh = await release.computeReleaseAt({ mode, externalId, stay, params, now, signal })`. Persist it if it differs from the stored `releaseAt`. On failure, log it and keep the stored value.
  5. Expiry checks.
  6. Delays come from the wall clock.
     - `warmupAt − now > MAX_TIMER_MS` (2 000 000 000) means a 1-day re-arm timer that calls `arm(id)` again. This is the kept long-timer path.
     - Otherwise the warm-up timer is set at `max(0, warmupAt − now)` with status ARMED. Cancellation snipes go straight to SNIPING, with the first poll at 0.
- **`warmUp(run)`**:
  1. If the gate is on: status QUEUEING, then `await access.ensure({ signal, maxWaitMs: windowEnd − now })`, then the **token check**.
  2. Then, synchronously, with no await between the two: `run.releaseGate ??= once(access.holdOpen())`.
  3. If `ensure` fails without an abort: log it, set `lastError`, and carry on. Polls will re-queue.
  4. Status WAITING_RELEASE, and the release timer at `max(0, releaseAt − now)`.
- **`poll(run)`**:
  1. Token check, then the window check.
  2. `p = inFlight.get(id) ?? execute(id, { signal })`, so a manual run that is already in flight is joined.
  3. Log `snipe tick start id gen`, await, then log `snipe tick end id gen ms result`. Then the **token check**.
  4. Branch on the outcome:
     - `done`: `finish(run)`;
     - `access-gate` with the gate on: run the QUEUEING step again;
     - `continue`: set the next timer at `max(pollMs, floor)` **after** the step has settled. So there is at most one check per snipe, ever.
- **Where the token is checked:**
  - at the start of every timer callback;
  - after each `await` in `prepare` (`computeReleaseAt`), in `warmUp` (`ensure`) and in `poll` (`execute`);
  - in `finish`, so only the current run removes itself.
  - A stale continuation returns without writing, arming or `holdOpen`, which fixes `startWarmup`.
  - Every step re-reads the row by id, so there are no stale closures.
- **`unscheduleSnipe(id)`** is synchronous:
  - delete the run from the map;
  - `clearTimeout`, `controller.abort()`, and `releaseGate?.()` exactly once (the shared `stopKeepAlive` is gone);
  - return `run.inFlight`, which `stop()` awaits.

### 3.3 `SiteSniperService.execute(id, { signal, manual })` → `SnipeOutcome { result, next }`

1. Re-read the row. Return early (`done`) unless it is active and not terminal, and is SNIPING or the run is manual.
2. `registry.require(id, 'snipes')`.
3. If max attempts are reached: EXPIRED.
4. `check(externalId, stay, { unitIds, signal })`.
5. Take the first `fullyAvailable` unit.
6. `nightGuard.tryReserve`. On a conflict: **FAILED**, deactivate, and the message "Another hold covers these nights (one booking per night)". This is a deliberate change from today's endless retry; see open question 7.
7. `holds.create(req, signal)`. The outcome decides what happens next:

| Hold outcome | Write | Attempts | Next step |
|---|---|---|---|
| `ok` | `markHeld` (status HELD; `holdReference`, `holdExpiresAt`, `holdUnitId`, `paymentUrl = holds.paymentUrl(hold)`; deactivate) in one transaction; notify | +1 | done |
| `taken` | UNAVAILABLE | +1 | continue |
| `in-progress` | ERROR "booking in progress" | **not counted** | continue |
| `auth-required` | FAILED, "Sign in to {shortName}", deactivate | +1 | done (not retried) |
| closed, invalid or error | ERROR | +1 | continue |
| no unit free | TOO_EARLY or UNAVAILABLE | +1 | continue |
| `AccessGateError` thrown | `QUEUE_FULL` | not counted | `access-gate` |
| abort | none | – | done |

### 3.4 Access gate lifecycle

- There is one `holdOpen()` per snipe run, taken only after `ensure` resolves and the token is still current.
- It is released exactly once, from `unschedule` or `finish`, through a `once()` wrapper. The ParkStay release is idempotent as well.
- The ref count is shared across snipes: two gated snipes give 2. When the first finishes, the count is 1 and the keep-alive keeps running.

### 3.5 `powerMonitor` and `rescheduleAll()`

- `JobScheduler` subscribes to `power.on('resume' | 'unlock-screen')` and unsubscribes in `stop()`. The `power` dependency is Electron's `powerMonitor`; in tests it is an `EventEmitter`.
- `rescheduleAll()`:
  - re-arms every active snipe **that has no step in flight**, so delays are recomputed from `Date.now()` and expired windows become EXPIRED;
  - a step that is in flight already reads the wall clock when it continues;
  - then `watchLoop.kick()` clears the tick timer and ticks now, so overdue watches run and expired ones deactivate. The cap of 2 still applies.
- Skipping runs with a step in flight makes the frequent `unlock-screen` event harmless.

### 3.6 Snipe create and update (`core/snipes/snipe.service.ts`)

1. `registry.require(id, 'snipes')`.
2. If `!release.supports(mode)`: `VALIDATION` with `issues: ['releaseMode']`.
3. Calendar dates, arrival `>= todayIn(tz)`, and departure after arrival.
4. Stay params get `manifest.stayFields` defaults for `appliesTo: 'snipe'`. For ParkStay that gives the same `gearType: all` and `numVehicles: 1` as before.
5. `releaseAt = await release.computeReleaseAt({ mode, externalId, stay, params, requestedAt: input.releaseAt, now })`. A `ProviderError` with the code `provider` becomes `AppError('VALIDATION', message, { issues: ['releaseAt'] })`.
   - `AppError` gains optional `issues`, and `handle.ts` passes them through.
   - This gives the field-level message for a scheduled release without `requestedAt`.
6. `accessGateEnabled = input && capabilities.accessGate`.
7. `pollIntervalMs = max(input ?? 1500, cancellation ? floor.continuous : floor.window)`. The same clamp is applied again at run time for legacy rows.
8. On update, steps 2–7 are re-run for any field they depend on. The handlers then call `scheduler.rescheduleSnipe(id)`, which gives a new generation.

### 3.7 One booking per night (`core/holds/night-guard.ts`)

`tryReserve({ providerId, userId, stay, owner })` is synchronous, so it is atomic in the main process. It returns a `Reservation` (with `release()`) or a conflict. A conflict is any of these whose nights overlap (`a.arrival < b.departure && b.arrival < a.departure`):

- HELD or BOOKED snipes of the same provider and user, other than the owner;
- watches of the same provider with `last_result = 'held'`, other than the owner;
- reservations still in flight (a hold that has been requested but has not answered).

Both queries are new parameterised repository methods. The in-memory reservations close the race that a check-then-act guard would leave open.

## 4. Quit

- `JobScheduler.stop(): Promise<void>`:
  1. Set `running = false`, clear the tick timer, and remove the power listeners.
  2. Unschedule every snipe run, which aborts it and releases its gate.
  3. Abort every watch run and every manual run.
  4. Await all in-flight promises with `Promise.race([allSettled, sleep(SCHEDULER_STOP_GRACE_MS = 3 000)])`.
  5. If the bound passes, log the run ids still open.
- **No job writes to a closed database:**
  - After an abort, `execute` writes nothing, with one exception: a hold that **succeeded** is still recorded by `markHeld`, inside the bound, because the database is open until `stop()` settles.
  - Writes that happen after an abort are wrapped in try/catch, so a non-abortable provider that outlives the bound only logs.
- **`AppContainer.dispose()`** with V7's quit hold (`app/quit-hold.ts`, `QUIT_GRACE_MS = 6 000`):

```
revokeAll() → stopping = scheduler.stop()          // aborts and releases gates synchronously
            → providersClosing = providers.disposeAll()  // starts now, in parallel: browsers ≤ 5 s
            → await stopping (≤ 3 s) → closeDatabase(db) → await providersClosing
```

- The database now closes **after** the scheduler settles instead of synchronously. Running the two in parallel keeps the total at about 5 s or less, within the 6 s hold. Run in sequence, it would be 8 s.
- The comments in `container.ts`, `quit-hold.ts` and `index.ts` are updated to match. The container tests change to `await dispose()`, and the call-order assertions are kept.
- **Next start:** `arm()` re-reads the status. A HELD snipe is never re-armed. A SNIPING snipe whose hold was aborted is armed again; ParkStay then answers `in-progress`, which is transient.

## 5. Contracts and IPC

| Item | Change |
|---|---|
| `watches.list`, `snipes.list`, `bookings.list` | Request `{ providerId?: ProviderId, status? }`, with args `[filter?]` and the preload mapper `(f) => ({ ...f })`. `status` is `'active' \| 'inactive'` for watches, `SnipeStatus` for snipes and `BookingStatus` for bookings. The repository filters use parameterised SQL. Main resolves the profile; there is no `userId`. |
| `autoHold` | Replaces `autoBook` in `WatchInput`, `Watch` and the zod schema (the repository maps it to `auto_book`). The legacy form gets the field rename and the §12.4 label "Hold a site automatically when found". |
| `WATCH_INTERVAL_OPTIONS = [15, 30, 60, 240, 720, 1440]`, `DEFAULT_WATCH_INTERVAL = 60` | Defined in zod-free `shared/constants/app-constants.ts`, replacing `DEFAULT_WATCH_INTERVAL = 5`, `MIN_`/`MAX_WATCH_INTERVAL` and `MAX_CONCURRENT_WATCHES`. Re-exported from `contracts/watches.ts`. The schema refines `checkIntervalMinutes` to these options, so the type stays `number` and `assertTypeEquals` holds. The repository default 5 becomes 60. |
| `*:updated` events | Services emit after every state change, through the injected `EventSink`. **Watch:** create, update, activate, deactivate, delete (last state), and each run, expiry and hold. **Snipe:** create, update, activate, deactivate, delete, every scheduler status change through `setStatus`, and each execute write. **Booking:** create, update, delete, cancel and import. |
| `bookings.sync`, `bookings.syncAll` | Removed from `channels.ts`, the contract, the preload, the handlers and the service. |
| `bookings.import` | Request `{ providerId, reference }`, args `[providerId, reference]`. It runs `registry.require(id, 'bookingImport')`, then `bookings.get`, then an upsert on `(providerId, reference)`. ParkStay gives `CAPABILITY`. The legacy `ImportBookingForm` passes `'parkstay'` until U3. |
| `manageUrl` | `Booking.manageUrl?` = `links.manageBooking?.(ref) ?? manifest.website`, or undefined for an unknown provider. It is added by `BookingService` to every booking it returns. |
| Watch DTO | `lastAvailability?: UnitAvailability[]`. The repository parses only arrays of `{unitId, nights[]}`, and legacy shapes are read as `undefined`. `WatchResult.HELD`. `WatchExecutionResult` gets `matches: WatchMatch[]`, `error?: string`, `errorCode?: ApiErrorCode` and `hold?`. |
| Snipe DTO | Unchanged. `runNow` returns `SnipeExecutionResult`. |
| Renderer | Compile-level edits only: `WatchForm`, `watch.schema.ts`, `legacy-mapping`(+test), `WatchDetail` (the grid gets `executionResult.matches`, plus a stored-units count), the `AvailabilityGrid` field names and `ImportBookingForm`. |
| Parity tests | `tests/unit/ipc/contract.test.ts` and `tests/unit/preload/preload.test.ts` keep enforcing the four-way agreement. New assertions: no `bookings:sync*` channels, the list filter schemas accept `{}` and reject `userId`, and the `WATCH_INTERVAL_OPTIONS` export exists. |

## 6. Errors and edge cases

| Edge case | Behaviour | Test |
|---|---|---|
| Unknown `providerId` on a stored row | Watch: `last_result 'error'`, logged `UNKNOWN_PROVIDER`, never selected as due. Snipe: `ERROR`, with `lastError` starting `UNKNOWN_PROVIDER:`, and not armed. Other rows still run. | int `scheduler`: "skips rows of an unknown provider and keeps running the rest" |
| `AccessGateError` during a watch | The run is recorded as an error, `next_check_at` is normal, and `ensure` is never called. | unit `watch.service`: "records a gated provider as an error without queueing" |
| Hold `in-progress` | Transient. `attemptsCount` is unchanged and the next tick retries. | unit `snipe-execute`: "in-progress is retried and not counted" |
| Hold `auth-required` | FAILED with "Sign in to Fake", deactivated, no further ticks. | unit `snipe-execute`; int `scheduler`: "auth-required stops the chain" |
| `computeReleaseAt` throws (scheduled without a time) | `VALIDATION` with `issues: ['releaseAt']` and the provider's message. | int `core-ipc`: "scheduled snipe without releaseAt is a field-level VALIDATION" |
| `releaseAt` more than 24.8 days ahead | A 1-day re-arm, then the warm-up. No timer ever exceeds `MAX_TIMER_MS`. | int `scheduler`: "re-arms a 40-day release daily, then warms up on time" |
| Release already past at schedule time | SNIPING straight away. EXPIRED if the window has passed too. | int `scheduler`: "past release snipes now / past window expires" |
| Calendar boundaries (AWST vs UTC, both ways) | `todayIn(manifest.timezone, now)`. At 20:00Z on 4 Oct, arrival 4 Oct has expired and 5 Oct is valid. At 15:59:59Z on 4 Oct, arrival 4 Oct is still today. | unit `watch.service`: "expiry follows the provider's calendar" (×2), plus snipe create validation |
| Run-now while a scheduled run is in flight | The in-flight promise is joined: one `check` call, and the same result. | int `scheduler`: "run-now joins the in-flight watch run / snipe tick" |
| Quit mid-hold | `stop()` aborts. The next start re-reads: a HELD row is not re-armed and a SNIPING row is armed again. | int `scheduler`: "after stop, a HELD snipe is never re-held on restart" |
| Legacy interval 5 | Runs at 15 min. The stored value stays 5. | int `scheduler`: "legacy 5-minute watch runs at 15 and keeps its value" |
| Re-arm during the warm-up `await` | A stale continuation returns without `holdOpen` or a timer. | unit `snipe-runner` (gate double that ignores abort); int `scheduler` |
| Migrated rollover row at 00:00, provider time 02:00 | Recomputed, persisted, and armed for 02:00 AWST. | int `snipe-rollover-rearm`: real ParkStay policy, `release.time.20 = '02:00'` |
| Legacy `last_availability` JSON | Read as `undefined` and overwritten on the next run. | unit `watch.repository` |
| Re-activating a HELD snipe or held watch | `VALIDATION`, so there is no second hold for the same nights. | unit `snipe-create`, `watch.service` |

## 7. Test plan

**Fake timers:**
- `jest.useFakeTimers({ now: FIXED_NOW })` (modern), with `await jest.advanceTimersByTimeAsync(ms)` so promises settle between timers. `jest.getTimerCount()` checks for leaks.
- Sleep is simulated with `jest.setSystemTime(now + 3 h)` **without** advancing. Fake timers move pending timers along, so their remaining delay is unchanged, the way a monotonic clock behaves over sleep. Then `power.emit('resume')`.
- `random` is injected as a constant for the spacing tests.

**Real in-memory database:**
- `openDatabase(':memory:')`, which runs v1–v8 and seeds profile 1, plus the real V2 repositories.
- A `ProviderRegistry` that holds **only** FakeProvider instances, built with `createTestProviderContext(m, { clock: () => new Date() })` so the clock follows fake time.
- The real core services and a `JobScheduler` with an `EventEmitter` as `power`, and an `EventSink` spy.

**FakeProvider additions** (test utilities only, additive):
- per-night states and prices per unit, including unpriced nights;
- `setAvailability()`;
- `scriptHold(...results)`;
- `delays` per module;
- the `signal` recorded in `calls`;
- `peakInFlight(module)`.

| Criterion or addendum | Test file › name |
|---|---|
| Moved; no `providers/parkstay` in core or scheduler | `tests/unit/core/layout.test.ts` › "services/{watch,sitesniper,booking} are gone and core/scheduler never import providers/parkstay" |
| `watches.create` on fake succeeds; no `watches` capability gives `CAPABILITY`; unsupported `release.supports` mode is rejected | `tests/unit/core/watch.service.test.ts` › "creates on a registry of fakes only" and "rejects a provider without watches with ProviderCapabilityError"; `tests/integration/core-ipc.test.ts` › "watches.create returns CAPABILITY" and "snipes.create rejects an unsupported release mode" |
| $30 nights with `maxPrice` 25 filtered; unknown prices give `priceKnown: false`; nights 1–2 of 3 give one partial result from one `check` | `tests/unit/core/watch-matching.test.ts` (~11, matching and price rules) › "filters a unit priced above maxPrice per night", "passes unpriced units with priceKnown false" and "a 3-night stay with nights 1–2 free yields one partial run"; `watch.service.test.ts` › "partial runs come from one check call (call log length 1)" |
| 5 s check, 1500 ms poll, 20 s window: ≤ 1 check in flight, `holds.create` at most once, unschedule aborts and leaves 0 timers | `tests/integration/scheduler.test.ts` › "never overlaps snipe checks", "places at most one hold after the first success" and "unschedule aborts the in-flight check and leaves no timers" |
| Two gated snipes: `holdOpen` count 2 → 1, keep-alive continues | `scheduler.test.ts` › "gate ref count drops 2→1 when the first snipe finishes" |
| 15-minute watch over 2 h: 8 ± 1 runs; `next_check_at` persisted | `scheduler.test.ts` › "runs a 15-minute watch 8±1 times in 2 hours" and "persists next_check_at after each run" |
| Resume after 3 h sleep re-arms; passed window becomes EXPIRED | `scheduler.test.ts` › "resume re-arms to the remaining delay" and "resume expires a snipe whose window passed" |
| Reschedule during the `startWarmup` await gives one chain | `scheduler.test.ts` › "rescheduling during warm-up leaves one live chain"; `tests/unit/scheduler/snipe-runner.test.ts` › "a stale ensure continuation takes no hold and arms no timer" |
| Notifications carry `providerId` and a `"Fake: "` title; `watch:updated`/`snipe:updated` emitted | `tests/unit/core/notification.service.test.ts` › "watch, snipe and booking notifications carry providerId and a Fake: title"; `scheduler.test.ts` › "emits watch:updated and snipe:updated" |
| Auto-hold: one hold, then deactivated; `autoHold` without holds rejected | `tests/unit/core/auto-hold.test.ts` (~4) › "a full match holds once and deactivates the watch", "rejects autoHold at create without holds", "signed out notifies with the sign-in hint" and "night-guard conflict notifies instead" |
| `bookings.import('parkstay', 'PB123')` gives `CAPABILITY`; DTOs have `manageUrl` | `core-ipc.test.ts` › "bookings.import on ParkStay returns CAPABILITY"; `tests/unit/core/booking.service.test.ts` (~3) › "every booking DTO has manageUrl" and "import upserts on (providerId, reference)" |
| No `setInterval` in the scheduler | `layout.test.ts` › "scheduler has no setInterval" |
| Runtime check | §6e: see open question 5 |
| Quality gate | Run before the commit |
| **Addendum (V7):** `stop()` aborts and awaits with a bound, before the database closes | `tests/integration/quit-shutdown.test.ts` › "dispose waits for a slow in-flight job, then closes the database" and "a job that ignores abort is cut off at the bound without writing" |
| **Addendum (V3 review):** rollover `releaseAt` recomputed on arm | `tests/integration/snipe-rollover-rearm.test.ts` › "a migrated 00:00 row is re-armed for the 02:00 release" |

**Other tests:**
- Unit tests for snipe create (~5) and execute outcomes (~6): `tests/unit/core/snipe-create.test.ts` and `snipe-execute.test.ts`.
- The night guard (~3): `tests/unit/core/night-guard.test.ts`.
- Interval and jitter maths (~5): `tests/unit/core/next-check.test.ts`.
- Existing tests are moved and rewired: services, the scheduler warm-up test (folded into `snipe-runner`), the `watch-parkstay` and `sitesniper-parkstay` integration tests, `container.test.ts`, `parameterised-sql.test.ts`, and the IPC and preload parity tests.

## 8. Risks, open questions and deviations

**node-cron.** After V4 nothing uses it. `npm uninstall node-cron @types/node-cron` changes `package.json` and `package-lock.json`, which carries a small merge risk with lane Y. The PR records the removal, and CLAUDE.md's "Scheduling | node-cron" row becomes "timers (chained `setTimeout`)".

**Open questions** (each with my recommendation):

1. **Title prefix: V4 and U5 conflict.**
   - V4 wants stored titles that start with `"Fake: "`.
   - U5 wants stored and in-app titles left unprefixed, and only the OS title prefixed, as `"{shortName} · "`.
   - *Recommendation:* follow V4 literally, with the prefix built in one place (`NotificationService.notify`). The dispatcher gets the **unprefixed** title plus `providerId`, because B2's email subject already adds the provider and would otherwise double it. U5 later moves the prefix to the desktop title in one line.
   - Alternative: adopt U5's rule now and test the OS title. Please choose.
2. **Watch holds have nowhere to be stored.**
   - `watches` has no `hold_*`, `payment_url` or `last_error` columns, and the migration numbers are fixed (§12.26).
   - *Recommendation:* no migration in V4. Use `last_result 'held'` for the guard, and put the hold details in the result and the notification. V6's v9 then adds `hold_reference`, `hold_expires_at`, `hold_unit_id`, `payment_url` and `last_error` to `watches`, plus a payment hand-off for watch holds.
   - Without that, a ParkStay watch hold cannot be paid, because payment needs the partition. Alternatively, approve V4 taking v9, with V6 moving to v10 and P7 to v11.
3. **Hold expiry.** V6's edge cases assume "the snipe expires through V4's timers" once `holdExpiresAt` passes, but the V4 spec does not list it.
   - *Recommendation:* add a HELD → EXPIRED timer at `holdExpiresAt`, re-armed by `rescheduleAll`. It also stops a lapsed hold from blocking nights.
   - It is implemented only if approved.
4. **Stay-param validation (§12.1) has no owner.** V4 applies the descriptor defaults, which is needed to remove ParkStay code from core. Validating declared keys (type, options, min/max, pattern, required, with issues `stayParams.<key>`) is about 40 lines, and undeclared legacy keys such as `parkId` pass through.
   - *Recommendation:* include it in V4, or assign it to U1/U2.
5. **The runtime check against politeness.** A cancellation snipe at the 3 s floor makes about 200 DBCA requests in 10 minutes.
   - *Recommendation:* run the 10-minute check in fixture mode (`WA_STAY_E2E_FIXTURES_DIR`, with fixtures for availability and the queue, no network), then a short live sanity run with `pollIntervalMs` at 60 000 (about 12 requests).
6. **Re-activating a held snipe or watch is refused.** This is new; without it the item could place a second hold for the same nights, because the guard excludes the owner itself. Please confirm.
7. **A night-guard conflict now ends the snipe** (FAILED). Today the snipe polls forever, but the guard will keep blocking, so further polls do nothing. Please confirm.
8. **Cancellation snipes expire once the arrival date has passed.** Today they poll forever. This is a small addition; please confirm.

**Deviations** (small, with reasons):
- Watches call `check` without `unitIds` and filter locally by id or name, which keeps legacy name preferences (§2.3).
- The watch concurrency cap is `min(2, limits.maxConcurrentRequests)`, so a provider that declares 1 gets 1.
- An unsupported release mode returns `VALIDATION` (`issues: ['releaseMode']`), because the spec only says "rejected".
- The signed-in state for auto-hold comes from `provider_accounts.status` until V6 provides its account service.
- Deletes emit `*:updated` with the last state; the renderer refetches.

**Risks:**
- `last_availability` grows to roughly 40 B × units × nights per watch per run. That is acceptable.
- The ParkStay gate's `holds--` would go negative if a release ran after `dispose()`. This cannot happen, because `stop()` releases before `disposeAll()`.
- `dispose()` now closes the database asynchronously, within 3 s. The crash policy already ignores errors once the quit has begun.
