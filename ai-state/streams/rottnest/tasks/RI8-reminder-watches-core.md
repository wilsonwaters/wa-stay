# RI8: Reminder watches: core ("Look reminders")

## Description

The stakeholder's priority is to learn when a booked-out stay frees up through a cancellation. For Stay Rottnest, an automatic check is out: a polled alert "assists" the booking, and RIA may then cancel it without refund (terms §3.2, §3.6).

What WA Stay can do is remind the person to look **when cancellations are most likely**, and get them there in one click. RIA's own rules say when:

- **the end of the 14-day cooling-off** for bookings made on the stay's Open Day: a full refund while more than 30 days out, and RIA complains of people who "book more than they need, only to dump it later";
- **around 30 days before arrival:** unpaid balances are cancelled automatically, and the cancellation fee steps up;
- **just before the 48-hour step,** when the fee becomes the whole stay.

This task gives watches a **reminder mode** for links-only providers. It needs no availability call: the provider says when to remind and why, the person says what they found, and the watch ends when they have booked or the dates pass.

## Size

L. The watch flow, the scheduler's due-loop, a module type, notifications and one IPC method, with §12.36.

## Depends on

- RI1, RI2.

## Scope

1. **Type** (`sdk/provider.ts`):

   ```ts
   type ReminderCadence = 'hotspots' | 'daily' | 'twice-daily';
   interface RemindersModule {
     /** The next reminder after `after`, or null when there is none before arrival. Pure. */
     next(input: { externalId: string; stay: StayQuery; unitIds?: string[]; unitKinds?: UnitKind[];
                   after: Date; cadence: ReminderCadence }): ReminderStep | null;
   }
   ```

   `ReminderStep` is RI6's.

   **Registry:** a links-only provider with `watches` must have `reminders.next` and `stayRules`.
2. **Cadence storage, with no migration:** `check_interval_minutes` holds 0 (`hotspots`), 720 (`twice-daily`) or 1440 (`daily`) for a reminder watch. The repository accepts 0 only for a links-only provider, and `minWatchIntervalMinutes` does not apply. If review finds this too clever, v13 adds `reminder_cadence TEXT`.
3. **`WatchService`** (`execute`, `src/main/core/watches/watch.service.ts:308`), for a links-only provider:
   - **No availability call.** At `next_check_at` the watch sends a `watch_reminder` notification with the step's title, body and reason, and the booking link (R7's candidates: `links.booking(externalId, stay, unitId)`).
   - **Then it sets:**
     - `lastResult = REMINDED`;
     - `lastCheckedAt` = now;
     - `next_check_at` = `reminders.next({ …, after: now })`.
   - **No next step:** the arrival has come, so the watch deactivates with "The dates have passed."
   - **Create and update:**
     - `stayRules.check` must pass;
     - a stay **not yet on sale** is `VALIDATION` on `stay` ("These dates open on {Open Day}. Plan for the Open Day instead."), with RI5's prefill path in the message's meta for the screen;
     - `autoHold` is `VALIDATION`;
     - `notifyOnly`, `allowPartialMatch` and `maxPrice` are ignored and hidden (RI9).
   - **`runNow`** ("Remind me now") sends the reminder at once and keeps the schedule. It is the person's own action, so it's allowed.
4. **`watches.recordLook({ id, outcome: 'nothing-yet' | 'booked' })`** (IPC, `watches:record-look`):
   - `nothing-yet` stores `lastLookedAt` (in `last_availability` JSON as `{ lookedAt }`; no migration);
   - `booked` makes the watch inactive with `lastResult = BOOKED` and no hold. The copy is "You booked it", and nothing is recorded in Bookings: the person adds it there while Bookings is "Soon", and RI12 later.
   - `NOT_FOUND`, and `VALIDATION` for a provider that isn't links-only.
5. **Scheduler:** the due-loop needs no change beyond honouring `next_check_at`. Quiet hours: a step the provider gives between 21:00 and 07:00 Perth moves to 07:00, unless the provider marks it `urgent` (none do today).
6. **Notifications:**
   - **Copy:** provider copy, with the desktop title `{shortName} · {title}`;
   - **Click:** opens the watch, then the booking link (R7). Delivery opens nothing (terms rule 2);
   - **Email:** "Search on {shortName}" with the reason line;
   - **No new found counts:** `found_count` is untouched.
7. **Copy guard:** `watch_reminder` and `snipe_reminder` strings, and a links-only provider's step copy (sampled through the provider's own tests in RI10), contain none of: free, found, available, held, secured, reserved.
8. **§12.36:** reminder mode, the reminders module, cadence, `recordLook`, and delivery opening nothing.

## Non-goals

- The screens (RI9).
- Rottnest's hotspots (RI10).
- Any automatic check (RI13, with consent only).

## Completion criteria

- [ ] `tests/unit/core/watch-reminders.test.ts` covers each of these:
  - no availability call (spy);
  - a reminder sent at `next_check_at`, with the link and reason;
  - the next step stored;
  - deactivation when none is left;
  - a not-yet-on-sale stay refused with the plan hint;
  - a refused stay;
  - `autoHold` refused;
  - `runNow`;
  - `recordLook` both ways;
  - quiet hours;
  - ParkStay and RAC watches unchanged.
- [ ] Notification tests: delivery opens nothing, the click opens the link once, and the email carries the link and reason.
- [ ] The copy guard test passes and fails on a planted "free".
- [ ] IPC parity and handler tests pass for `recordLook`.
- [ ] `npm run test:tz`: `next_check_at` round-trips in Perth time.
- [ ] The full gate passes, including `build:e2e` and `test:e2e`.

## Edge cases

- **A watch edited to a stay not yet on sale:** refused, as at create.
- **A watch created the day before arrival:** `next` may be null at once, so refuse with "Too close to arrival for reminders".
- **A provider switched to links-only by an update**, with existing polling watches: on the next run they read as reminder watches. Their old cadence is clamped to 720 or 1440, and the person is told once.
