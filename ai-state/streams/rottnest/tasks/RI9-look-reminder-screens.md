# RI9: Look reminder screens

## Description

The Watches screens for a reminder watch (RI8): how a person asks WA Stay to remind them to look for a Rottnest cancellation, and how they tell it what they found. The screen must be honest that WA Stay doesn't check, and still feel like a watch, because it is the stakeholder's priority feature for Rottnest.

## Size

M. Renderer only.

## Depends on

- RI8 (core), RI5 (the rules panel, reused).

## Scope

1. **The create flow** (`features/watches/create/`), for a links-only provider:
   - **Title:** "Remind me to look".
   - **Steps:** provider → place → stay (RI5's rules panel inline; a not-yet-on-sale stay shows "These dates open on Wed 4 Nov 2026" with **"Plan for Open Day instead"**) → reminders.
   - **Reminders step:**
     - the cadence (**"Only when cancellations are likely"** (`hotspots`, the default), "Every morning" (`daily`), "Morning and evening" (`twice-daily`));
     - a preview of the next three or four reminders with their reasons (from `reminders.next`, through a read-only preview call: add `watches.previewReminders` or compute in RI8's create response; RI8 decides);
     - the note: "WA Stay can't check Stay Rottnest for you. It reminds you when cancellations are most likely, and opens the search when you click."
   - **Hidden:** auto-hold, notify-only, partial matches, maximum price, and the check interval's minute options.
2. **The watch page** (`/watches/:id`):
   - **Status:** "Next reminder: Tue 18 Nov, 7:00 am — bookings made on the 4 Nov Open Day leave their cooling-off period";
   - the reminder timeline (sent, with the person's answers);
   - **"Search on Stay Rottnest"** (the booking link), with the Copy button while TQ1 is open;
   - **"Nothing yet"** and **"I booked it"** (`watches.recordLook`). "I booked it" asks to confirm, then shows "You booked it" and stops;
   - **"Remind me now"** (`runNow`);
   - no night grid, and no found count.
3. **The list** (`/watches`): a reminder watch's row reads "Reminders · next Tue 18 Nov", not a result count. Filters treat REMINDED as active.
4. **Notifications panel:** `watch_reminder` items use the `AlarmClock` icon and the step's title, and clicking opens the watch and the link (RI8).
5. **Tests:**
   - renderer tests for each state (on sale; not yet on sale → plan; refused; each cadence's preview; the page before and after "I booked it");
   - axe scans;
   - an e2e journey: Geordie Bay, June 2027 dates (on sale), "Remind me to look" → the page shows the next reminder and its reason → "I booked it" stops it. The request log has no Stay Rottnest host.

## Non-goals

- Any automatic check.
- Bookings integration (RI12).

## Completion criteria

- [ ] The flows and pages above, with renderer tests and axe scans.
- [ ] The e2e journey passes.
- [ ] ParkStay and RAC watch screens unchanged.
- [ ] The copy guard covers the new strings.
- [ ] The full gate passes.
