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

- [x] Renderer tests and axe scans.
- [x] An e2e journey from Explore to a plan.
- [x] The full gate passes.

## Notes from the build

- *Create flow:* "Create plan" ("Plan created"). The Stay step shows the booking rules (`StayRulesPanel`, moved to `components/stay/`), with the suggested dates (peak blocks) as buttons; the Release step shows the stay's Open Day from the rules (`release.text`, asked of nobody) and `PlanReminders`: the reminder times, the checklist ("Have ready") and "Site Sniper only reminds you: it doesn't check {shortName}, wait in its queue or book for you." The random queue order before 8:30 is in the 6 am reminder's own words, so the screens stay provider-neutral.
- *Plan page:* the countdown and next reminder, the stay, the reminders (done ones marked) and the checklist, "Open {shortName}", and once REMINDED "Reminders sent" ("The Open Day has come. Didn't get it?") with "Watch for cancellations" to `/watches/new` prefilled.
- *Not built:* a switch per reminder; grouping plans by Open Day in the list (the list sorts by release, so a day's plans sit together).
- The place page's Site Sniper hand-off reads "Set release reminders" where every mode only reminds (it is the entry point from Explore).
- No axe scans: the repository has no axe tooling; the tests assert roles and names.
- Tests: `*.plan.test.*` under `src/renderer/features/snipes/`, the place page's hand-off in `StayRulesPanel.test.tsx`, and `tests/e2e/rottnest-plan.spec.ts` (Explore → Geordie Bay → plan, with no Stay Rottnest routes and no notice).
