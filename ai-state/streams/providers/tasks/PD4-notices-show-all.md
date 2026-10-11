# PD4: "Show all notices" toggle

## Description
After PD2, a campground's notices sit above the About accordion. Bungarra's 11 notices take about 290 px. The stakeholder asked for less room (2026-10-11): show the most important few, and put the rest behind a "Show all notices" toggle.

## Size
S

## Scope
`src/renderer/features/place/PlaceSections.tsx` (`PlaceNotices`) and its tests.
1. **Order:** warning first, then caution, then info, keeping ParkStay's order within each level.
2. **Collapsed:** show the first few notices, chosen so the row takes at most about two lines at 1440×900 and at 960×640. A fixed count is fine, for example 4; pick one that looks right in the screenshots.
3. **The toggle:**
   - When there are more notices than that, a text button under the shown ones reads "Show all N notices", and becomes "Show fewer notices" when open.
   - It is a real `<button>` with `aria-expanded` and `aria-controls` pointing at the list.
   - Keyboard: Enter and Space. Focus stays on the button when toggled.
   - Use `components/ui` (Button, `variant` ghost or link-like) and design tokens only.
   - No toggle when everything fits.
4. **Unchanged:** each notice still shows its level without relying on colour (icon plus the visually hidden level word). A provider without notices shows nothing, as now.
5. **State:** local only. Nothing is remembered across visits.

## Completion Criteria
- [ ] Renderer tests:
  - [ ] the order;
  - [ ] the collapsed count;
  - [ ] the toggle's name, `aria-expanded` and `aria-controls`;
  - [ ] Enter and Space toggle it;
  - [ ] no toggle at or under the limit;
  - [ ] no notices shows nothing.

  Assert roles and names, never class names.
- [ ] The e2e launch journey (E2 in `tests/e2e/launch.spec.ts`), which checks Bungarra's notices, still passes: update it to expand first, or to check the shown ones plus the toggle.
- [ ] Runtime screenshots of Bungarra collapsed and expanded, at 1440×900 and 960×640.
- [ ] The gate passes on Node 24: lint, format, type-check, `npm test`, `test:tz`, and `build:e2e` + e2e.
