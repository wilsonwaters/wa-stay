# RI6: Reminder snipes: core ("Open Day plans")

## Description

A snipe today checks availability from its release instant, then holds (`hold`) or alerts (`alert`, R12). For Stay Rottnest neither is allowed or useful:

- polling "assists" a booking (terms §3.2), and holding "makes" one;
- Queue-it gives everyone in the waiting room before 8:30 a random place, so being first at 8:30:00 buys nothing (`rottnest-release-rules.md`).

What helps is **readiness**: knowing the Open Day, having a stay RIA will accept, and being reminded in time to join the waiting room with a phone for the passcode.

This task adds a third snipe action, **`remind`**. It sends the provider's reminders at the provider's instants around the release, never checks availability, never holds and reserves no night. It is the only action a links-only provider allows.

## Size

L. It amends a manifest rule, the snipe state machine, notifications and the scheduler's chain, and appends to §12.36.

## Depends on

- RI1 (links-only), RI2 (rules refuse a stay at create).

## Scope

1. **Registry** (§12.36):
   - `FLAG_RULES` "snipes needs availability" becomes "snipes needs availability, unless `integration: 'links'`";
   - a consistency rule: a links-only provider with `snipes` has `release.computeReleaseAt` and `release.reminders`.
2. **Types and contract:**
   - `SnipeAction = 'alert' | 'hold' | 'remind'` (`SNIPE_ACTIONS`, the zod schema, the type-equality test);
   - `SnipeStatus.REMINDED` and `SnipeResult.REMINDED` (`'reminded'`);
   - `NotificationType.SNIPE_REMINDER` (`'snipe_reminder'`);
   - `ReleasePolicy.reminders?(input: { releaseAt: Date; externalId: string; stay: StayQuery; now: Date }): ReminderStep[]`, where `ReminderStep = { at: Date; title: string; body: string; reason?: string }` is provider copy, in time order;
   - `ReleasePolicy.checklist?(externalId: string): string[]`;
   - `SiteSnipe.reminders?: { at: Date; title: string; sentAt?: Date }[]`, derived on read for the screens. The stored row needs only the release instant and the sent steps. The `alert JSON` column (v12) is reused to hold `{ sent: [isoInstants] }` for a remind snipe, so there is **no migration**; if review prefers a column, v13 adds `reminders_sent JSON`.
3. **`SiteSniperService`:**
   - **Default action:** `remind` for a links-only provider. Any other action is `VALIDATION` on `action` ("{shortName} only reminds you; WA Stay doesn't check or book there"), and `remind` on any other provider is `VALIDATION`.
   - **Create and update:** the stay must pass `stayRules.check` (RI2), and the release mode's `computeReleaseAt` must give an instant in the future (its own `VALIDATION`s, e.g. "already on sale").
   - **Arm:** compute `releaseAt` and the steps. Steps already past at create are skipped; if all are past, refuse ("The Open Day has passed").
   - **Run**, at each step's instant: send the step (below) and record it as sent. After the last step, set the status and result to REMINDED, make the snipe inactive and return `next: 'done'`.
   - **No** `availability` call, **no** `holds`, **no** night guard, **no** sign-in check, and no access gate.
   - **Re-arm:** a REMINDED snipe can be armed again for a later Open Day (when the person edits its stay).
   - **Release changes:** if a step's recomputed `releaseAt` changed (an Open Day moved), the remaining steps move with it, and the person is told once ("{shortName} moved its Open Day to {date}").
4. **Scheduler:** the per-snipe timer chain treats a remind snipe's steps as its instants. `start()`, `rescheduleAll()` and resume re-arm the next unsent step. A step missed while the computer slept is sent on resume, but only while it is still before `releaseAt + 30 min`; later, it is dropped and logged.
5. **Notifications** (`notification.service.ts`, `notifySnipeReminder`):
   - the title and body are the provider's step copy;
   - the desktop title is `{shortName} · {title}`;
   - **click:** opens the snipe (`app:navigate`), then the provider's booking link in the browser (R7's path). **Delivery itself opens nothing** (terms rule 2);
   - the email has "Search on {shortName}" with the link, plus the checklist.
   - **Grouping:** steps of the same provider due within the same minute are sent as **one** notification, "Open Day plans: 3 stays" with each stay listed, so three plans for one Open Day don't send nine notifications.
6. **Renderer, only what the new enum members break:** `statusPresets.ts` ("Reminder sent", `AlarmClock`), `snipeState.ts`, `NotificationItem.tsx`'s icons. The screens are RI7.
7. **§12.36:** the `remind` action and REMINDED; snipes without availability for links-only; `release.reminders` and `release.checklist`; delivery opens nothing.

## Non-goals

- The screens (RI7).
- Rottnest's steps and copy (RI10).
- Any change to `hold` or `alert` snipes.

## Completion criteria

- [ ] Registry tests: links-only with snipes and no `release.reminders` is refused; non-links snipes still need availability.
- [ ] `tests/unit/core/snipe-remind.test.ts` covers each of these:
  - the defaults and refusals per provider kind;
  - a refused stay at create;
  - "already on sale";
  - steps sent in order, then REMINDED and inactive;
  - no availability, holds or night-guard call (spies);
  - a past step skipped at create;
  - re-arming after REMINDED.
- [ ] `tests/unit/scheduler/snipe-runner.test.ts` (fake timers): a remind chain across sleep and resume (sent if still before release + 30 min, else dropped), and a moved Open Day.
- [ ] Notification tests:
  - grouping in one minute;
  - delivery calls no shell opener, and the click calls it once with the booking link;
  - the email carries the link and the checklist;
  - the desktop title prefix.
- [ ] The existing snipe tests (`sitesniper-parkstay`, `snipe-execute`, `snipe-create`, `snipe-alert`) pass unchanged.
- [ ] The full gate passes, including `build:e2e` and `test:e2e`.
