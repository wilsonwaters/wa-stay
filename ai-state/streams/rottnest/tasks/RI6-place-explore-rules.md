# RI6: Rules and release status on the place page and Explore

## Description

For a provider with `stayRules`, show the person what the rules say about their dates, before and beside a check.

## Size

M.

## Depends on

- RI4, RI5.

## Scope

1. **Place page:** a "Your stay" panel for chosen dates:
   - the release status ("On sale", or "Opens Wed 4 Nov 2026, 8:30 am · waiting room from 6 am", with "(expected)" past the confirmed calendar);
   - the verdict ("Stay Rottnest's rules allow this stay", or the reason with suggested blocks as chips that change the dates);
   - the notes.

   When the stay isn't released, "Plan for Open Day" replaces the check.
2. **Explore:** a card for dates not yet released reads "Opens Wed 4 Nov", and a refused stay reads "Not bookable: {short reason}". Both are pure computations, with no request.
3. **Copy:** templates with `{shortName}`, roles and accessible names, axe-clean.

## Completion criteria

- [x] Renderer tests for each state.
- [x] An e2e step (July 2027 dates before 4 Nov 2026 read "Opens Wed 4 Nov 2026").
- [x] The full gate passes.

## Notes from the build

- The place page's panel is in the "Check your dates" card (`StayRulesPanel`); a check of a stay not on sale already said when it opens.
- Explore reads `BulkAvailabilityEntry.opensAt` and `refused` (states `opens`, `refused`); a refused card reads "Not bookable for these dates" rather than a short reason, since the reasons are sentences.
- *Moved to RI8:* "Plan for Open Day" replacing the check, with the plan screens.
- No axe scans: the repository has no axe tooling; the tests assert roles and names.
