# RI5: Place page and Explore for links-only providers

## Description

Today a provider without availability gets one line on the place page: "WA Stay can't check availability here. Check dates on {shortName}'s website." (`PlaceDetailPage.tsx:301`). Explore shows its cards as `not-supported`.

For Rottnest that undersells what WA Stay does know, and what the person needs:

- whether the dates are on sale or which Open Day opens them;
- the rules that apply to the stay;
- a one-click path to search on Stay Rottnest.

This task shows that for any provider with `stayRules` (RI2), without availability.

## Size

M. Renderer, plus a small batched IPC read for Explore.

## Depends on

- RI2 (`catalog.stayRules`), RI4 (Rottnest's rules, to see it real).

## Scope

1. **Place page** (`features/place/`), for a provider with `stayRules` and no `availability`, once dates are set. A "Your stay" panel shows:
   - **The release status:** "On sale" or "Opens Wed 4 Nov 2026, 8:30 am · waiting room from 6 am", with "(expected)" when so;
   - **The verdict:** "RIA's rules allow this stay", or the refusal reason with its suggestions as chips that change the dates;
   - **The notes**, as a list.

   **Actions, chosen by the release status:**
   - **Search on {shortName}:** the provider's `links.booking` for the stay. A Copy button for the dates and party sits beside it while TQ1 is open, because the bare search page needs them typed.
   - **Plan for Open Day:** when not yet on sale. Goes to `/site-sniper/new` with the prefill (RI7).
   - **Remind me to look:** when on sale. Goes to `/watches/new` with the prefill (RI9).
   - The booking guide link for the stay's month, when published.

   Without dates, the panel shows the provider's `release.describe()`.
2. **Unit types:** the existing unit list shows beds and occupancy from the catalogue. There is no night grid, and no "free".
3. **Explore cards** (`features/explore/availability/deriveAvailability.ts`): for a provider with `stayRules` and no `bulkAvailability`, with dates set, a card reads:
   - "Opens Wed 4 Nov" when the stay is not yet on sale;
   - "On sale · check on {shortName}" when it is;
   - "Not bookable: {short reason}" when refused.

   **Data:** a new `catalog.stayRulesMany({ providerId, keys, stay })` (or batching RI2's method), answering per key. Pure, so no pacing. The renderer calls it once per date change for that provider's visible places. The map pins follow the same states (not "free").
4. **Accessibility and copy:**
   - every new control has a role and an accessible name;
   - the copy never says free, available or found for a links-only provider (terms rule 5);
   - the strings sit with the provider-neutral copy, as `{shortName}` templates.
5. **Tests:**
   - renderer tests for each state (no dates; on sale; opens; refused with suggestions; expected);
   - the prefill links;
   - the copy guard additions;
   - RI3's e2e journey extended: set June 2027 dates at Geordie Bay → "On sale"; set July 2027 dates before 4 Nov 2026 → "Opens Wed 4 Nov 2026". The fixture mode clock is fixed, as the harness does.

## Non-goals

- The create flows themselves (RI7, RI9).
- Any availability for links-only providers.

## Completion criteria

- [ ] The place page and Explore show the states above for Rottnest, and nothing changes for ParkStay or RAC (their tests unchanged).
- [ ] The e2e journey passes with an empty Stay Rottnest request log.
- [ ] axe scans of the new panel find no violations.
- [ ] The full gate passes. Screenshots are retaken in RI11 if Explore's hero shows a Rottnest card.
