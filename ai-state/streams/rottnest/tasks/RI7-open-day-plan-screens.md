# RI7: Open Day plan screens

## Description

Site Sniper's screens for a `remind` snipe (RI6): how a person plans for a Rottnest Open Day. The flow should leave them **ready**:

- a stay RIA will accept, chosen before 8:30;
- the Open Day and its times known;
- reminders set;
- RIA's checklist in hand.

Then one click opens Stay Rottnest, where they do everything themselves. Site Sniper keeps its "Soon" pill (stakeholder decision D4).

## Size

M. Renderer only.

## Depends on

- RI6 (core), RI5 (the rules panel, reused).

## Scope

1. **The create flow** (`features/snipes/create/`), for a links-only provider:
   - **Title:** "Plan for Open Day" (not "New snipe").
   - **Steps:** provider → place → stay → plan.
   - **Stay step:** RI5's rules panel runs inline as dates change:
     - a refusal blocks Next with its reason;
     - a peak refusal offers its suggested blocks as chips;
     - **in a peak month the date picker offers the precinct's fixed blocks as choices** instead of free dates.
   - **Release preview:** "Opens Wed 4 Nov 2026 at 8:30 am · waiting room from 6 am", with "(expected)" past the confirmed calendar.
   - **Plan step:**
     - the reminder steps with their times (from the core's derived `reminders`), each with a switch: the evening before, 6:00, 8:15;
     - the checklist (`release.checklist`), shown as RIA's tips;
     - a plain note: "WA Stay doesn't enter the waiting room or book for you. The order in the queue is random for everyone who joins before 8:30."
   - **No** action choice (only `remind`), and no timing or window fields.
   - **Prefill:** RI5's "Plan for Open Day" prefill (provider, place, dates, party, stay types).
2. **The plan page** (`/site-sniper/:id`):
   - a countdown to 8:30, and to 6:00 when the next step is the waiting room;
   - the stay and its rules notes;
   - the checklist;
   - the reminder timeline (sent and next);
   - **"Open Stay Rottnest"**: `links.booking` for the stay, enabled at any time, because the person's click is allowed;
   - the Copy button for the dates and party while TQ1 is open;
   - **Ended (REMINDED):** "Reminders sent. Did you get it?" with **"I booked it"** (deletes nothing; marks the plan done in its notes) and **"Look for cancellations"**, which goes to `/watches/new` with the stay prefilled (RI9). Most people won't get their first choice, and a look reminder is the natural next step.
3. **The list** (`/site-sniper`): remind snipes are grouped under their Open Day ("Wed 4 Nov 2026 · 3 plans"), in time order, each showing its stay and the next reminder.
4. **Copy:**
   - provider-neutral templates;
   - no "snipe", "hold", "free" or "secured" for remind snipes (the copy guard from RI8 covers the strings);
   - no suggestion of extra devices or numbers (terms rule 9).
5. **Tests:**
   - renderer tests for each step's states (refused, peak blocks, expected, the past Open Day refusal);
   - the plan page states (armed, a step sent, REMINDED);
   - list grouping;
   - axe scans;
   - an e2e journey: from Explore (July 2027 dates at Geordie Bay, before 4 Nov 2026), "Plan for Open Day" → create → the plan page shows "Opens Wed 4 Nov 2026" and three reminders. The request log has no Stay Rottnest host.

## Non-goals

- Look reminders (RI9).
- Changing Site Sniper's "Soon" status.
- A plan with several ranked choices in one snipe: each choice is its own plan, grouped by Open Day (RI6 merges their notifications).

## Completion criteria

- [ ] The flows and pages above, with renderer tests and axe scans.
- [ ] The e2e journey passes.
- [ ] ParkStay and RAC snipe screens unchanged (their tests pass untouched).
- [ ] The full gate passes.
