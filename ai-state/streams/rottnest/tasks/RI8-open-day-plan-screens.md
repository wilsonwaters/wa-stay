# RI8: Open Day plan screens

## Description

Site Sniper's screens for a `remind` snipe. Site Sniper keeps its "Soon" pill.

## Size

M.

## Depends on

- RI7, RI6.

## Scope

1. **Create flow:** "Plan for Open Day".
   - **Stay step:** the rules inline, with peak blocks offered as choices.
   - **Release preview:** "Opens Wed 4 Nov 2026 at 8:30 am · waiting room from 6 am".
   - **Plan step:** the reminder times, each with a switch; the checklist; and "WA Stay doesn't enter the waiting room or book for you. The queue order is random for everyone who joins before 8:30."
2. **Plan page:**
   - the countdown;
   - the stay and its notes;
   - the checklist and the timeline;
   - "Open Stay Rottnest";
   - once REMINDED: "Did you get it?", with "Watch for cancellations", which goes to `/watches/new` prefilled.
3. **List:** remind snipes grouped by Open Day.

## Completion criteria

- [ ] Renderer tests and axe scans.
- [ ] An e2e journey from Explore to a plan.
- [ ] The full gate passes.
