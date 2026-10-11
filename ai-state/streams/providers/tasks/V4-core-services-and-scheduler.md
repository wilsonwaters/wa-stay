# V4 — Provider-agnostic core services and scheduler correctness

**Stream:** providers · **Depends on:** V2, V3

## Description

After V3, the Watch and Site Sniper services call the ParkStay module directly, and the scheduler still has the timing defects found in review. V4 does three things:

1. **Moves the services to `src/main/core/`.** WatchService, SiteSniperService and BookingService move there, and resolve every provider through the registry and its capabilities, so a second provider needs no core change.
2. **Takes release and queue semantics from the provider.** Release rules come from `provider.release` and queue rules from `provider.access`.
3. **Fixes the scheduler.**
   - Snipe ticks overlap and can place several holds (tech-review #2, HIGH).
   - Watch intervals are ignored, `next_check_at` is unused, `startWarmup` races, there is no re-arm after sleep, and closures are stale (tech-review #11).

Every notification also starts carrying `providerId`.

Story: as a user with watches and snipes, each check runs exactly when it should and never twice at once. Every alert says which provider it came from.

## Size

L. It spans three services, the scheduler and the contracts, and the timing-correctness work is subtle. Design approval is required.

## Scope

- **`core/watches/watch.service.ts`** (moved from `services/watch/`).
  - Runs `registry.require(watch.providerId, 'watches')`, then `availability.check(location.externalId, { ...stay, params: stayParams }, { unitIds })`.
  - Matching:
    - a unit matches when `fullyAvailable`;
    - partial matches are runs of `available` nights from the **same** response, with no extra requests;
    - `maxPrice` applies per night only when every night has a price; otherwise the unit passes with `priceKnown: false`.
  - Expiry: deactivate once `stay.arrival < todayIn(manifest.timezone)`. This replaces the 08:00 AWST quirk at `watch.service.ts:100`.
  - `lastAvailability` stores `UnitAvailability[]`.
- **Auto-hold (PQ4).** The `auto_book` column becomes the domain/contract field `autoHold`.
  - Create/update with `autoHold: true` rejects with `ProviderCapabilityError` when `!capabilities.holds`.
  - On a full match with `autoHold`, place **one** hold on the first matching unit via `holds.create` and notify (`snipe_held`-style, `relatedType 'watch'`). This only happens when the account is signed in or `capabilities.account` is not `required-for-holds`/`required`. Otherwise notify as a normal match, with the message "Sign in to {shortName} to enable automatic holds".
  - It reuses the one-booking-per-night guard below. After a hold the watch deactivates.
- **`core/snipes/snipe.service.ts`** (moved from `services/sitesniper/`). Runs `registry.require(id, 'snipes')`.
  - Create/update:
    - validate `release.supports(mode)`;
    - set `releaseAt = await release.computeReleaseAt({ mode, externalId, stay, requestedAt, now })`;
    - use the access gate only when `accessGateEnabled && capabilities.accessGate`;
    - clamp `pollIntervalMs` up to `release.pollFloorMs.window`, or `.continuous` for `cancellation`.
  - `execute(id, signal)` re-reads the snipe, returns early unless it is in `SNIPING` (or a manual run-now), then calls `check` → guard → `holds.create`.
  - On success: status `HELD` with `holdReference`, `holdExpiresAt`, `holdUnitId` and `paymentUrl = holds.paymentUrl(hold)`.
  - The one-booking-per-night guard covers HELD/BOOKED snipes **and** auto-hold watches of the same provider (`sitesniper.service.ts:396-410`).
  - Delete the dead `runSnipeWindow` (`:305-332`).
- **`core/bookings/booking.service.ts`** (moved from `services/booking/`).
  - Bookings are provider-aware and unique on `(providerId, reference)`.
  - `import(providerId, reference)` runs `registry.require(id, 'bookingImport')`, then `bookings.get`. For ParkStay this throws `ProviderCapabilityError`, by design.
  - The DTO gets `manageUrl = links.manageBooking?.(reference) ?? manifest.website`.
  - Delete the placeholders `importBooking`, `syncBooking` and `getBookingStats` (`BookingService.ts:186-235,292-314`), and the `booking:sync*` channels.
- **Notifications.** `NotificationService.notify*` takes and stores `providerId` from the watch, snipe or booking. Titles are prefixed `"{shortName}: "`. The dispatcher passes `providerId` to notifiers (B2 owns email copy). `notifySnipeBooked` stays, and V6 triggers it. If P3 did not already move NotificationService to `core/notifications/`, move it here.
- **Contracts and IPC** (`shared/contracts/{watches,snipes,bookings}` and their handlers):
  - `list(filter?: { providerId?, status? })`;
  - no `userId` (main resolves the profile);
  - `WATCH_INTERVAL_OPTIONS = [15, 30, 60, 240, 720, 1440]` and `DEFAULT_WATCH_INTERVAL = 60` exported (PQ6);
  - `watch:updated`, `snipe:updated` and `booking:updated` are emitted after every state change through P3's events bus. Today main never sends them (tech-review #15).
- **`scheduler/job-scheduler.ts`, watches:**
  - Replace the per-watch cron expressions (`job-scheduler.ts:98-154`, the ≤60-minute bug at `:114`) with a single due-loop. It is a chained `setTimeout` every 30 s that runs watches with `next_check_at <= now`.
  - Persist `next_check_at = lastCheckedAt + max(interval, 15 min) + jitter(0–10%)`. On startup, overdue watches are spread over the first 2 minutes.
  - There is an in-flight `Set<watchId>` and at most 2 concurrent executions per provider.
- **`scheduler/job-scheduler.ts`, snipes.** Each snipe gets an `AbortController` and a **generation token**.
  - Warm-up, release and poll steps are chained `setTimeout`s. The next tick is scheduled only after the previous `execute` settles. There is no `setInterval` (`:176`, `:268`).
  - After every `await`, the step checks that its token is still current (fixes `startWarmup` at `:221-255`).
  - Each tick re-reads the snipe by id, so there are no stale closures (`:164`, `:281`).
  - `unscheduleSnipe` aborts any in-flight HTTP.
  - The access gate is used through `ensure({ signal })` and a `holdOpen()` release stored per snipe and released exactly once. The shared `stopKeepAlive` at `:289` and `:313` goes away.
- **`scheduler/job-scheduler.ts`, lifecycle.** `powerMonitor` `resume` and `unlock-screen` events trigger `rescheduleAll()`, which recomputes every snipe timer and runs overdue watches. `stop()` aborts everything. Remove the no-op cleanup job (`:408-440`). Keep the long-timer re-arm (`:197-204`).
- **Renderer.** Make only minimal compile-level edits to the existing pages and forms (field names, `autoHold`), with no redesign (U1–U3 own that).

## Non-goals

- The ParkStay module internals (V3). The catalogue service (V5).
- Sign-in, account status and the payment window. `snipes.openPayment` and marking a snipe BOOKED after payment are V6.
- New renderer screens (U1–U3). Email template wording (B2).
- Per-provider rate-limit configuration beyond the floors and the concurrency cap of 2.

## Completion Criteria

- [ ] `ls src/main/services/{watch,sitesniper,booking}` fails (moved). `grep -rn "providers/parkstay" src/main/core src/main/scheduler` → 0 results.
- [ ] With a registry holding only FakeProvider (`fake`) and FakeProvider without `watches`:
  - `watches.create({ providerId: 'fake', … })` succeeds;
  - `watches.create` for a provider without the capability returns `success: false` with code `CAPABILITY`;
  - `snipes.create({ releaseMode: 'daily_rollover' })` on a provider whose `release.supports` returns false is rejected.
- [ ] Watch execution on FakeProvider:
  - a unit with 2 available nights at $30 and `maxPrice: 25` is filtered out;
  - a unit with unknown prices passes with `priceKnown: false`;
  - a 3-night stay with nights 1–2 available yields one partial result `{arrival: d1, departure: d3}` from **one** `check` call (call log length 1).
- [ ] With fake timers and a FakeProvider `check` that takes 5 s while `pollIntervalMs` is 1500 for 20 s of a snipe window:
  - at most 1 `check` is in flight at any time;
  - `holds.create` is called at most once after the first success;
  - `unscheduleSnipe` during an in-flight check aborts it (`signal.aborted === true`) and leaves `jest.getTimerCount() === 0`.
- [ ] Two snipes with `accessGateEnabled` on the same provider: when the first finishes, the gate's `holdOpen` ref count drops from 2 to 1, and the keep-alive keeps running for the second.
- [ ] A 15-minute watch runs at about 15-minute spacing over a simulated 2 hours: 8 ± 1 executions, against 2 today. `next_check_at` is persisted after each run.
- [ ] Emitting `powerMonitor` `resume` (mocked) after a simulated 3-hour sleep reschedules snipe timers to the correct remaining delay. A snipe whose window passed during sleep is marked EXPIRED.
- [ ] Rescheduling a snipe during `startWarmup`'s `await` leaves exactly one live timer chain (generation-token test).
- [ ] Notifications for watch, snipe and booking events have `providerId` set, and their title starts with `"Fake: "` (FakeProvider shortName). `watch:updated` and `snipe:updated` are emitted (event bus spy).
- [ ] Auto-hold:
  - FakeProvider with `holds`, signed in: a full match places exactly one hold and deactivates the watch;
  - `autoHold: true` on a provider without holds is rejected at create.
- [ ] `bookings.import('parkstay', 'PB123')` returns code `CAPABILITY`. Booking DTOs include `manageUrl`.
- [ ] `grep -rn "setInterval" src/main/scheduler` → 0 results.
- [ ] Runtime check: run the app with one ParkStay watch (15 min) and one cancellation snipe for about 10 minutes. The log shows no overlapping `snipe tick` entries, and the watch's `next_check_at` advances.
- [ ] `npm run lint && npm run format:check && npm run type-check && npm test` passes.

## Edge Cases

- **Provider problems:**
  - an unknown `providerId` on a stored row (provider removed): the watch or snipe is marked in error with `UNKNOWN_PROVIDER` and skipped, and the scheduler continues;
  - a provider throws `AccessGateError` during a watch: the run is recorded as error with no queue joining (watches never wait in a queue), and the next run is scheduled normally;
  - a hold returns `in-progress`: treat it as transient and retry on the next tick, without counting it towards `maxAttempts`;
  - a hold returns `auth-required`: the snipe moves to FAILED with the message "Sign in to {shortName}", and is not retried.
- **Release and timing:**
  - `computeReleaseAt` throws (missing `requestedAt` for `scheduled`): reject at create, with a field-level message;
  - `releaseAt` lies more than 24.8 days ahead: use the re-arm path;
  - the release is already past at schedule time: go straight to SNIPING, and to EXPIRED if the window has also passed.
- **Calendar boundaries.** The arrival is today in AWST but yesterday in UTC, and the reverse. Both are covered with `todayIn` tests.
- **Lifecycle:**
  - a manual "run now" while a scheduled tick is in flight joins the in-flight promise and never starts a second request;
  - the app quits mid-hold: `stop()` aborts, and the next start re-reads status and does not re-hold a HELD snipe;
  - a legacy watch with `check_interval_minutes = 5` is scheduled at 15 and its value is left unchanged in the DB.

## Test Strategy

- **Unit (~40):**
  - watch matching and partial runs (~8);
  - price rules (~3);
  - auto-hold (~4);
  - snipe create validation (~5);
  - execute outcomes (~6);
  - per-night guard (~3);
  - booking import and `manageUrl` (~3);
  - notification `providerId` and title (~3);
  - interval and jitter maths (~5).
- **Component:** none.
- **Integration (~10)** (`tests/integration/scheduler.test.ts`): fake timers plus FakeProvider plus a real in-memory DB (V2 repositories), covering:
  - overlap prevention;
  - abort on unschedule;
  - the generation token;
  - access-gate ref counting;
  - resume re-arm;
  - watch due-loop spacing;
  - startup stagger;
  - expiry on resume.

## Context Files to Read First

- `ai-state/research/tech-review.md` findings #2, #11, #14, #15. `ai-state/architecture-notes.md` §1, §3, §4.
- `ai-state/streams/providers/master-plan.md` (PQ4, PQ6; contract additions). `ai-state/streams/provider-ux/master-plan.md` (OQ3, OQ4, OQ5, OQ11).
- `src/main/scheduler/job-scheduler.ts` (all).
- `src/main/services/watch/watch.service.ts`, `src/main/services/sitesniper/sitesniper.service.ts` and `src/main/services/booking/BookingService.ts`, as rewired by V3.
- `src/main/services/notification/notification.service.ts:36-196` and `notification-dispatcher.ts`, or their P3 locations.
- `src/main/providers/sdk/provider.ts` (V1) and `src/main/providers/parkstay/{release-policy,holds,queue/access-gate}.ts` (V3).
- `src/main/ipc/handlers/{watch,site-sniper,booking}.handlers.ts`. `src/shared/contracts/{watches,snipes,bookings}` (V2).
- `tests/utils/fake-provider.ts` (V1).

## Notes

- **Why a due-loop rather than per-watch cron.** It honours any interval, uses the persisted `next_check_at` (resilient to restarts), and makes per-provider concurrency trivial. node-cron is no longer used by watches, so remove the dependency if nothing else uses it, and record that in the PR.
- **Auto-hold and DBCA terms.** Auto-hold respects DBCA terms (genuine intent, one booking per night) the same way snipes do. Payment stays a human step. If the stakeholder rejects auto-hold (PQ4), delete the `autoHold` field and the column use, keeping the DB column as dead data. U1 hides the toggle via the contract.
- **Commit.** `refactor(core): provider-agnostic services and scheduler fixes (#<issue>)`.

## Orchestrator addendum (2026-10-04, from V7)
- [ ] On quit, `JobScheduler.stop()` aborts in-flight watch and snipe executions (AbortController) and awaits them, with a bound, before `container.dispose()` closes the database. No job may write to a closed DB. Fit this into V7's quit hold (`src/main/app/quit-hold.ts`). Test it with a slow in-flight job.

## Orchestrator addendum (2026-10-04, from the V3 review)
- [ ] V3 made `computeReleaseAt` return the stored `releaseAt`. Daily-rollover snipes that v8 migrated still carry the old midnight-AWST instant, so a snipe at a campground released at 02:00 (Bungarra) fires at 00:00 and its window closes before the release. When arming a `daily_rollover` snipe that is not terminal (and on `rescheduleAll()`), recompute `releaseAt` through `release.computeReleaseAt` and persist it if it changed. Test: a migrated row at 00:00 AWST with a provider release time of 02:00 is re-armed for 02:00.
- V3 rewired the services in place. Its access gate (`providers/parkstay/queue/access-gate.ts`) exposes `ensure({ signal })`, `holdOpen()` and `status()`. A small V3 follow-up in lane X changes only the gate's idle status and two ParkStay nits, and will merge before V4.
- V5 (catalogue service, lane Y) runs in parallel and touches `app/container.ts` and the catalogue. Keep container edits to the service moves.
- Process (L task): first write a design and plan to `ai-state/streams/providers/designs/V4-design.md` (module layout after the move, scheduler state machine for watches and snipes with the generation token and abort, the access-gate hold lifecycle, quit hold, how each criterion and edge case is tested), commit it as `docs(ai-state): V4 design`, and hand back for approval before writing code.
