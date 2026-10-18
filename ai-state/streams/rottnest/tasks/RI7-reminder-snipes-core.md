# RI7: Reminder snipes: core ("Open Day plans")

## Description

At an Open Day, Queue-it gives everyone a random place before 8:30, so polling buys nothing, and the release is where RIA's defences are strongest (`rottnest-terms.md` §9.9). A third snipe action, `remind`, sends the provider's reminders around the release and never checks, holds or reserves a night.

## Size

L.

## Depends on

- RI4.

## Scope

1. **Types:**
   - `SnipeAction` adds `'remind'`;
   - `SnipeStatus.REMINDED` and `SnipeResult.REMINDED`;
   - `NotificationType.SNIPE_REMINDER`;
   - `ReleaseModeDescriptor.remindOnly`;
   - `ReleasePolicy.reminders?({ releaseAt, externalId, stay, now })` returns `{ at, title, body }[]`;
   - `ReleasePolicy.checklist?(externalId)` returns `string[]`.
2. **Registry:**
   - "snipes needs availability, unless every release mode is `remindOnly`";
   - a `remindOnly` mode needs `release.reminders`.
3. **`SiteSniperService`:**
   - a snipe in a `remindOnly` mode is `remind` (any other action is `VALIDATION`);
   - create checks `stayRules` and a future `releaseAt`;
   - the steps are sent in order, then the snipe is REMINDED and inactive;
   - no availability call, hold, night guard or sign-in;
   - re-armable; a moved Open Day moves the remaining steps.
   - The `alert` JSON column holds the sent steps, so there is no migration.
4. **Scheduler:** the steps are the chain's instants. A missed step is sent on resume only before `releaseAt` + 30 minutes.
5. **Notifications:**
   - the provider's copy, with the desktop title `{shortName} · {title}`;
   - a click opens the snipe, then the booking link, and delivery opens nothing;
   - the email has "Search on {shortName}" and the checklist;
   - steps of one provider in one minute are sent as one notification.

## Completion criteria

- [ ] Snipe, scheduler (fake timers) and notification tests.
- [ ] Existing snipe tests unchanged.
- [ ] The full gate passes.
