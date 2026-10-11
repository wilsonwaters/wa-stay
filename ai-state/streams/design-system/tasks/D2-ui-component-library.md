# D2 — UI component library (accessible primitives)

**Stream:** design-system · **Depends on:** D1

## Description

The renderer currently has 4 copies of status badges, 4 error alerts, 5 modal overlays and 7 or more spinners. There are about 40 hand-rolled label+input+error blocks. Modals lack `role="dialog"`, focus traps and Escape, and icon buttons are unlabelled (ui-review #6, #7). Toast timers reset on every parent re-render because the effect depends on `onRemove` (`Toast.tsx:48`), so toasts on the Site Sniper page never dismiss.

This task builds the design-system primitives in `src/renderer/components/ui/` on D1 tokens. Each one is accessible by construction, and tests assert roles, names and behaviour, never class names. It also replaces the legacy LoadingSpinner, ConfirmDialog and Toast at their call sites. The list includes everything architecture-notes §12.8 requires (Combobox, Menu, Popover, Switch, Disclosure, RadioCard and Stepper).

As a keyboard or screen-reader user, I can operate every control, dialog, menu and date picker in WA Stay, so I can plan and book without a mouse.

## Size

L. This is complex UI with about 30 primitives. Deliver it as two commits: (a) form and feedback, (b) overlays and composite. See master-plan DQ1 for the split option.

## Scope

**In scope.** Everything lives in `src/renderer/components/ui/`, one file per component (plus a `*.test.tsx`), with a barrel `index.ts`.

- **Actions:**
  - `Button`: variants `primary` (accent), `secondary` (ink outline), `ghost`, `danger`. Sizes `sm`/`md`/`lg` (32/40/48 px). Props `loading` (spinner, `aria-busy`, disabled, label kept), `leadingIcon`/`trailingIcon`. Polymorphic `as="a"` for links.
  - `IconButton`: requires `label: string`, which becomes `aria-label`. It shows a `Tooltip` with the same text and does not reference it via `aria-describedby`.
- **Form:**
  - `TextField`, `Textarea` and `Select` (native `<select>`).
  - `Checkbox`, `Radio` + `RadioGroup` and `Switch` (a native `input type=checkbox role="switch"`).
  - `Field`, which takes `label`, `hint`, `error`, `required` and `optional` and passes `id`, `aria-describedby` (hint and error ids), `aria-invalid` and `aria-required` to its child control. The error text is preceded by a `CircleAlert` icon.
  - All inputs use `forwardRef` (react-hook-form `register`).
- **Display:**
  - `Card`: `as`, `padding`, and `interactive` (hover elevation, focus ring).
  - `Badge`: tones `neutral|brand|accent|available|warning|danger|sun`.
  - `StatusPill`: icon + label + tone, with an optional `live` pulsing dot that is static under reduced motion. Exports `statusPresets` covering the current watch, snipe and booking status enums in `src/shared/types`.
  - `ProviderBadge`: see Notes.
  - `Spinner`: `role="status"` with a visually hidden `label` (default "Loading"). It has no `fullScreen` prop.
  - `Skeleton`: `aria-hidden` and shimmers.
  - `EmptyState`: icon, Fraunces title, description, actions, optional brush accent.
  - `PageHeader`: one `h1`, description, actions slot, optional back link.
  - `Notice`: inline banner with tones `info|success|warning|danger`. Uses `role="status"`, or `role="alert"` for danger, and can be dismissible.
  - `VisuallyHidden`.
- **Navigation and choice:**
  - `Tabs`: `tablist`/`tab`/`tabpanel`, roving tabindex, ←/→/Home/End, automatic activation, `aria-controls` and `aria-labelledby`.
  - `SegmentedControl`: `radiogroup`/`radio` with arrow keys.
  - `RadioCard` + `RadioCardGroup`: a `radiogroup` of card-style native radios, each with a title, description, optional icon and optional trailing slot (for example a ProviderBadge or a "Soon" badge). Arrow keys move the selection. Used by the U1/U2 provider step.
  - `Disclosure`: a button with `aria-expanded`/`aria-controls` that shows and hides a region. Built on `useDisclosure`, with a `ChevronDown` that rotates when open (no rotation under reduced motion).
- **Overlays.** All are portalled to `document.body`, set `inert` on `#root` while modal, and lock scroll.
  - `Dialog`: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` (title), `aria-describedby`. It traps focus with `useFocusTrap`, closes on Esc and overlay click (configurable), returns focus to the opener, and has sizes `sm|md|lg|full`.
  - `ConfirmDialog`: built on `Dialog`. Props `title`, `message`, `confirmLabel`, `tone: 'danger'|'primary'`, `onConfirm` (may return a Promise, which shows loading) and `onCancel`. Initial focus goes to **Cancel** for danger.
  - `Sheet`: a right-side Dialog variant.
  - `Menu`: trigger has `aria-haspopup="menu"` and `aria-expanded`. Items are `menuitem`s, navigated with ↑/↓/Home/End. Enter or Space activates. Esc closes and refocuses the trigger. Supports link items.
  - `Popover`: a non-modal `role="dialog"` anchored to a trigger with `aria-expanded`/`aria-controls`. Focus moves in on open. Esc or outside click closes and returns focus. Positioned by a small `usePosition` hook (below, flips above, clamps to the viewport, recomputes on resize and scroll), with no positioning dependency.
  - `Tooltip`: `role="tooltip"`. Opens on hover after 400 ms and on focus immediately, closes on Esc, blur or leave, and sets `aria-describedby` on its trigger.
- **Feedback:**
  - `ToastProvider` + `useToast()` + `ToastViewport`. The API is `toast.success|info|warning|error(message, { action?, duration? })`, which returns an id, plus `toast.dismiss(id)`.
  - Durations: success and info 5 s, warning 8 s, error persists until dismissed.
  - At most 3 toasts are visible and the rest queue in FIFO order. Each timer starts once per toast id, pauses on hover or focus, and never resets on re-render.
  - Containment: the viewport is `role="region" aria-label="Notifications"`. Each toast is `role="status"`, or `role="alert"` for errors, with a Close `IconButton`.
  - `ToastViewport` renders where it is placed. D3 puts it in the tray. D2 temporarily mounts it in `main.tsx`.
- **Search fields.** Each has `appearance: 'field' | 'segment'`, where `segment` renders inside E1's search pill with a small label above the value.
  - `Combobox`: ARIA 1.2 pattern. The input is `role="combobox"` with `aria-expanded`, `aria-controls`, `aria-activedescendant` and `aria-autocomplete="list"`. The listbox holds options, optionally grouped (`role="group"` + label). ↑/↓ move, Enter selects, Esc closes (a second Esc clears), Tab closes. Options come from props (controlled). It shows a "No matches" row.
  - `DateRangeField` + `RangeCalendar`: value `{ arrival?: string; departure?: string }` as `YYYY-MM-DD`, never `Date`. Props `minDate`, `maxDate` and `maxNights`.
    - The Popover shows two months at 640 px or wider and one month below that. Weeks start on Monday.
    - It follows the WAI-ARIA date-picker grid: ←/→ day, ↑/↓ week, PgUp/PgDn month, Home/End week.
    - The first selection sets arrival and the second sets departure. Picking a date on or before arrival restarts the range.
    - The summary reads "Fri 3 Oct – Sun 5 Oct · 2 nights", with Clear and Done buttons.
    - Day cells are named like "Friday 3 October 2026", with ", check-in" or ", check-out" when selected. Disabled days are `aria-disabled`.
    - Date maths uses date-fns on local calendar dates.
  - `Stepper` (standalone, also used inside GuestsField and provider stay fields): a numeric −/+ control in a `role="group"` named by its label. Props `min`, `max` and `step`. The value is shown in an `<output aria-live="polite">`.
  - `GuestsField`: value `{ adults; children; infants }` with `limits` defaults (adults 1–16, children 0–10, infants 0–5) and hint defaults "18 or over", "6–17", "Under 6". Steppers use `IconButton` labelled "Decrease adults" and "Increase adults", disabled at the limits. The trigger summary reads "2 adults, 1 child" or "Add guests".
- **Hooks:** `useFocusTrap`, `usePosition`, `useAnnounce()` (a polite or assertive live-region announcer, with `AnnouncerProvider`) and `useDisclosure`.
- **Migration:**
  - Delete `components/LoadingSpinner.tsx`, `ConfirmDialog.tsx`, `Toast.tsx` and their tests.
  - Update the call sites in `App.tsx`, `pages/Dashboard.tsx`, `pages/Watches/index.tsx`, `pages/SiteSniper/index.tsx`, `pages/Bookings/BookingsList.tsx` and `pages/Bookings/BookingDetail.tsx`: `Spinner`, `ui/ConfirmDialog`, and the global `useToast()` (remove each page's `<ToastContainer>`). Update `components/index.ts`.
- Add a `/__design` gallery section per component showing every variant and state, and write `docs/design/components.md` (when to use each primitive, with one do/don't each).

**Out of scope:** domain composites such as LocationCard, NightGrid, search pill and filter chips (E1/E2), the app shell (D3), and restyling legacy pages.

## Non-goals

- No new dependencies: no Radix, floating-ui, focus-trap or jest-axe (architecture-notes §10).
- No virtualised list or data-table component.
- `ComingSoonBanner`, `AboutDialog`, `QueueStatus`, `UpdateNotification` and `NotificationBell` are not rebuilt (U5). `ErrorBoundary` is not rebuilt (D3).
- Concessions, equipment and party-size rules are not in `GuestsField`. They are provider-specific and handled in U1/U2 forms.

## Completion Criteria

- [ ] Every component listed in Scope exists in `components/ui/`, is exported from `components/ui/index.ts`, and appears on `#/__design` with all its variants.
- [ ] `Button loading` keeps its label, sets `aria-busy="true"` and is disabled. `Button as="a"` renders a link.
- [ ] `IconButton` fails type-check without `label`.
- [ ] `Field` with an `error` gives its control `aria-invalid="true"` and an `aria-describedby` that includes the error text id. With a `hint`, the hint id is included too.
- [ ] `Dialog`:
  - [ ] Open: focus moves inside, Tab and Shift+Tab cycle within it, and `#root` has `inert`.
  - [ ] Esc closes, and focus returns to the opener.
  - [ ] The title gives it its accessible name.
- [ ] `ConfirmDialog` with `tone="danger"` focuses Cancel first. An async `onConfirm` shows loading until it resolves.
- [ ] `Menu` is fully operable by keyboard (↑/↓/Home/End/Enter/Esc), and the trigger's `aria-expanded` reflects state.
- [ ] `Tabs`: arrow keys move selection and `aria-selected` follows. Only the selected tab is in the tab order.
- [ ] `Toast`:
  - [ ] Timers survive re-renders: a toast shown while the parent re-renders every 1 s still auto-dismisses at 5 s (the regression test for `Toast.tsx:48`).
  - [ ] Error toasts persist until dismissed.
  - [ ] A fourth toast queues until one closes.
- [ ] `DateRangeField` keyboard flow: arrow to a date, Enter, arrow 2 days, Enter. The value becomes `{arrival, departure}` strings, and the summary shows "2 nights". Dates before `minDate` cannot be chosen.
- [ ] `GuestsField`: "Increase adults" increments, and "Decrease adults" is disabled at 1.
- [ ] `Combobox`: typing filters the options, ↓ and Enter select, and `aria-activedescendant` tracks the highlighted option.
- [ ] `RadioCardGroup`: arrow keys move the checked card, and each card's accessible name is its title, with the description wired as its description. `Disclosure` toggles `aria-expanded` and hides its region when collapsed. `Stepper` respects `min`/`max`.
- [ ] `ProviderBadge`: the full variant shows monogram and shortName. The compact variant's accessible name is the provider name. An unknown provider shows its id with the name "Unknown provider".
- [ ] The legacy pages compile against the new primitives. `components/LoadingSpinner.tsx`, `ConfirmDialog.tsx` and `Toast.tsx` no longer exist, and `grep -r "ToastContainer" src/renderer` is empty.
- [ ] The token guard (D1) passes for `components/ui/**`, with no raw palette classes, hex or emoji.
- [ ] **Accessibility:**
  - [ ] Every interactive primitive shows the D1 `focus` ring on `:focus-visible`. Checked on `#/__design` by tabbing through the gallery.
  - [ ] Live regions work: toasts are announced (`status`/`alert`), and `useAnnounce('3 results')` updates a polite live region.
  - [ ] Every icon-only control in the gallery has an accessible name. axe on `#/__design` reports 0 critical/serious issues.
  - [ ] Information is never carried by colour alone: StatusPill, Badge tones and Field errors include text or an icon.
- [ ] The 4-check gate passes: `npm run lint` (0 errors), `npm run format:check`, `npm run type-check`, `npm test`.

## Edge Cases

- A Dialog opened from a Menu item returns focus to the Menu trigger, because the item no longer exists.
- Nested overlays: a Popover inside a Dialog closes on Esc without closing the Dialog, and stacked Dialogs handle Esc innermost-first.
- `inert` is removed when the last open modal unmounts, even if it unmounted without closing (route change).
- Popover near the right or bottom edge flips and clamps, with no horizontal page scroll at 960 px width.
- DateRangeField:
  - Month-boundary navigation (31 Oct → 1 Nov).
  - AU DST irrelevance: values are plain calendar dates.
  - Leap day 2028-02-29.
  - `maxNights` exceeded: the departure cell is disabled and the reason is shown in a hint.
  - Clearing resets both values.
- Toast with an identical message fired twice in under 1 s is deduplicated. Dismissing a queued toast before it shows removes it silently.
- `ProviderBadge` brand colour may be any hex: the monogram text uses white or ink-900, whichever has the higher contrast. If neither reaches 4.5:1 (for example `#777777` gives 4.48 and 3.97), use the outlined variant (surface background, brand-colour border, ink text).
- Stepper values arriving from props outside `limits` are clamped, and a dev warning is logged.

## Test Strategy

- **Unit:** about 12 tests. Cover `useFocusTrap` cycling, `usePosition` flip and clamp maths (pure function), the calendar date helpers (month grid, range selection, `maxNights`, `minDate`), the `readableTextOn(hex)` badge contrast picker (including `#777777` falling back to outlined), and `statusPresets` coverage of every status enum value.
- **Component:** about 70 tests across about 28 files, using Testing Library role and name queries plus `user-event`.
  - Keyboard flows for Dialog, Menu, Tabs, SegmentedControl, Combobox, DateRangeField and GuestsField.
  - The Toast timer regression with fake timers and a re-rendering parent.
  - Field ARIA wiring.
  - Button loading.
  - ProviderBadge variants.
  - The existing ConfirmDialog, LoadingSpinner and Toast tests are rewritten against the new components without `toHaveClass` assertions.
- **Integration:** none. Runtime verification on `#/__design`: axe, a keyboard pass through every overlay, and screenshots for the human reviewer.

## Context Files to Read First

- `ai-state/streams/design-system/master-plan.md` and the D1 spec. Read `docs/design/design-language.md` and `src/renderer/styles/tokens.css` once D1 has landed.
- `ai-state/architecture-notes.md`: §3 (`ProviderManifest.brand`, `StayQuery`), §8 renderer conventions.
- `ai-state/research/ui-review.md`: Components, top UX problems #5–#7.
- `src/renderer/components/{Toast,ConfirmDialog,LoadingSpinner}.tsx` and their tests, plus `src/renderer/pages/SiteSniper/index.tsx` (the 1 s re-render that breaks toasts).
- `src/shared/types/` (watch, snipe and booking status enums) and `src/renderer/components/forms/WatchForm.tsx` (react-hook-form usage).
- WAI-ARIA APG patterns: dialog-modal, menu-button, tabs, combobox (list autocomplete), date picker dialog, switch.

## Notes

- **Stepper** in §12.8 means the numeric −/+ control. The multi-step create-flow scaffold is U1's `StepFlow` (provider-ux master plan), not a D2 primitive.
- **ProviderBadge** props are `{ providerId: string; info?: ProviderBadgeInfo; variant?: 'full'|'compact'; size?: 'sm'|'md' }`.
  - `ProviderBadgeInfo = { id; name; shortName; brand: { color; monogram } }` is structurally assignable from V1's `ProviderManifest`, so D2 does not wait for V1.
  - If `info` is omitted, the badge reads `ProviderManifestsContext`. D2 exports the context and `ProviderManifestsProvider`, and D3 fills it from `useProviders()`. This keeps `ui/` free of `window.api` and React Query.
- `inert` is supported in Electron 28 (Chromium 120). `HTMLElement.inert` does not exist in jsdom, so assert the attribute.
- jsdom lacks `matchMedia`, `ResizeObserver` and layout. Polyfill `matchMedia` in the test file, and test `usePosition` as a pure function that takes rects.
- Popover and Dialog share one overlay stack (`OverlayStackContext`) so Esc ordering and `inert` are handled in one place.
