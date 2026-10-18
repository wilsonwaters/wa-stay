# RI9: Rottnest Open Day reminders

## Description

Rottnest's content for RI7, and `snipes` turned on with the `open_day` mode (`remindOnly`).

## Size

S.

## Depends on

- RI5, RI7.

## Scope

1. **Steps** (Perth time):
   - 18:00 the day before: "Open Day tomorrow", with the waiting room and booking times, the phone for the passcode, the card, and the plan;
   - 06:00: "The waiting room is open", with the random place before 8:30;
   - 08:15: "15 minutes to Open Day".
2. **Checklist:** choices in order, flexible dates, the party within the type's limit, a Stay Rottnest profile, your own mobile, Visa or Mastercard, a keyholder for a second unit, and only book what you need.
3. **Copy guard:** no "free", "found", "held" or "secured"; no suggestion of more devices, numbers or browsers.

## Completion criteria

- [x] Fake-clock tests, including across an Open Day move.
- [x] The copy guard.
- [x] The full gate passes.

## Notes from the build

- The steps and checklist are in the manifest's `open_day` mode; `release-policy.ts` times the plan (the stay's Open Day at 8:30 am Perth, the 5/3 rule included) and refuses a stay the rules refuse or one on sale (`ALREADY_ON_SALE`).
- The copy guard is `tests/unit/providers/rottnest/manifest.test.ts`: none of "free", "found", "held", "hold", "secured", "guaranteed", nor "devices", "browsers", "tabs", "phones", "several" or "more numbers".
- The contract suite takes `releaseSample` (300 days ahead), as the policy refuses the default sample, on sale.
