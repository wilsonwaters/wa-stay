# U3 — Bookings rebuilt provider-first ("Soon")

**Stream:** provider-ux · **Depends on:** D3, V4

## Description

As a traveller, I can see all my trips across providers in one place, styled like Airbnb's Trips, with tabs for upcoming, past and cancelled. I can open a trip to see its details and go straight to the provider to manage it. I can add a booking manually, or import one where the provider supports it, and both start by choosing the provider.

Problems in today's Bookings pages:

- **Fake "Cancel Booking".** It calls `booking.update(id, {})` and then marks the booking cancelled locally (`BookingDetail.tsx:50-71`, fake at `:57-60`). Nothing is cancelled at ParkStay.
- **Unreachable delete.** The list's delete dialog can never open, because `deleteConfirm` is only ever reset (`BookingsList.tsx:27-30,82,347`).
- **Not real tabs.** The filter "tabs" are plain buttons (`:185-204`).
- **Upcoming filter is wrong.** It requires `confirmed` and compares `Date` objects against now (`:92-95`), so a trip that is under way disappears.
- **Inaccessible modals.** Modals are hand-rolled overlays with no dialog semantics (`:312-335`).
- **ParkStay hard-coded.** The import copy is hard-coded to ParkStay (`ImportBookingForm.tsx:61,75`). The reference is forced to uppercase (`:30,54`) and validated with `^[A-Z0-9]+$` (`booking.schema.ts:9`). The import back end is a placeholder (`BookingService.ts:186+`).

Bookings keeps its **"Soon"** pill and a restyled `ComingSoonBanner` (stakeholder decision D4), but the page must be fully usable.

## Size

M. Multi-file, single concern (the bookings feature).

## Scope

- **In scope**
  - `features/bookings/` for `/bookings` (Trips list) and `/bookings/:id` (detail).
  - `renderer/api/bookings.ts` hooks, if D3 did not create them: list, get, create, delete, import. `booking:updated` invalidates them.
  - **Restyle `components/ComingSoonBanner.tsx`** (U3 owns this, being first in lane order):
    - tokens and a lucide icon instead of emoji;
    - a labelled dismiss button;
    - the existing localStorage key format (`comingSoonDismissed_<Feature>`, `ComingSoonBanner.tsx:14-20`), so earlier dismissals persist.
  - **Trips list:**
    - `PageHeader` "Bookings" with the subtitle "Your trips across every provider".
    - `Tabs`: Upcoming · Past · Cancelled, each with a count.
    - The provider filter follows the same visibility rule as U1. Search covers location, area and reference.
    - Tab, provider and search are stored in the URL (`?tab=&provider=&q=`).
  - **Bucketing uses calendar dates in the provider's timezone:**

    | Tab | Bookings included | Sort |
    |---|---|---|
    | Upcoming | `departure >= today`, not cancelled | arrival ascending |
    | Past | `departure < today`, not cancelled | arrival descending |
    | Cancelled | status cancelled | — |

    In Upcoming, a trip already under way gets the badge "Happening now", and pending trips show a "Pending" badge.
  - **`BookingCard`:**
    - `ProviderBadge`, location name and area, dates ("Fri 12 – Sun 14 Dec 2026 · 2 nights"), guests, unit, reference and status.
    - A photo when the location key resolves in the catalogue (`catalog.get(key).imageUrls[0]`, cached), otherwise a neutral placeholder.
    - A "More actions for {location}" menu with "Remove from WA Stay".
  - **Detail page:**
    - Header: `ProviderBadge`, location (linked to E2 detail when the key is known) and status.
    - Sections: Stay, Unit, Guests, Cost (AUD-formatted, or the booking's currency), and the Reference with a copy button, then Notes.
    - Primary link: **"Manage on {shortName}"** to `booking.manageUrl ?? manifest.website` (OQ4). It is an anchor that opens in the system browser.
    - "Remove from WA Stay" opens a ConfirmDialog: "This removes the booking from WA Stay only. It does not cancel it on {provider}."
  - **Add booking** opens a `Dialog`:
    - **Step 1: Provider.** All registered providers, because adding manually needs no capability. If there is only one, it is pre-selected and still shown.
    - **Step 2: Details.**
      - Location: `LocationCombobox` when the provider has `catalog`, otherwise free text. Area is optional free text.
      - `DateRangeField`, `GuestsField`, unit, reference, total cost, notes.
    - Submits through `bookings.create`.
  - **Import booking:**
    - The button is rendered only if at least one provider has `bookingImport`.
    - Its dialog lists only those providers, then asks for a reference, with the help text "Find it in your {shortName} confirmation email".
    - If the provider's account is required and signed out, link to `/settings/accounts?provider=<id>`.
    - Submits through `bookings.import(providerId, reference)`.
  - **Split** `ManualBookingForm` and `ImportBookingForm` into `features/bookings/add/*`. Reuse U1's `ProviderPicker`, `LocationCombobox` and `StepFlow`.
  - **Delete legacy files:** `pages/Bookings/*`, `components/forms/{ManualBookingForm,ImportBookingForm}.tsx`, and `pages/Dashboard.tsx` if it still exists (Explore replaced it, decision O5; its upcoming-bookings content is now the Upcoming tab).
- **Out of scope**
  - Booking sync, import back end and provider booking lists (V4/V-provider modules).
  - Cancelling or modifying bookings at the provider.

## Non-goals

- No in-app cancellation, modification or payment. "Manage on {provider}" hands off to the provider's website.
- No editing of existing bookings. The fake `update(id, {})` path goes away, and editing can be added later.
- No booking sync or refresh button (`booking.sync`/`syncAll` are unused placeholders).
- No calendar view or export.

## Completion Criteria

- [ ] `/bookings` shows the restyled ComingSoonBanner, `h1` "Bookings", an "Add booking" button, and tabs Upcoming / Past / Cancelled as `role="tab"`, each with a count. Upcoming is selected by default.
- [ ] Tab bucketing, with the fixture's clock set to 2026-12-13:
  - a booking 12–14 Dec is in Upcoming, badged "Happening now";
  - a booking that departed 10 Dec is in Past;
  - a cancelled future booking is only in Cancelled.
- [ ] Every BookingCard shows a ProviderBadge, the location, dates and reference.
- [ ] The provider filter and search narrow the list. `?tab=past&q=karijini` restores that state on load.
- [ ] Detail shows "Manage on ParkStay" as an `<a>` with the manage URL, `target="_blank"` and `rel="noopener noreferrer"`. No "Cancel booking" control exists: `grep -rni "cancel booking" src/renderer/features/bookings` → 0 results.
- [ ] "Remove from WA Stay" is reachable from the card menu and the detail page. The ConfirmDialog says it does not cancel on the provider. Confirming calls `bookings.delete(id)`, the item disappears and a toast confirms.
- [ ] Add booking:
  - the dialog opens on the provider step;
  - a provider with `catalog` shows the location combobox, and one without shows a text field;
  - submit calls `bookings.create` with `providerId`, `YYYY-MM-DD` dates and no `userId`.
- [ ] Import booking:
  - with no `bookingImport` provider, there is no "Import booking" button;
  - with a fixture provider that supports it, the dialog lists only that provider;
  - a duplicate reference shows "Already in your bookings" with a link to it.
- [ ] Legacy files deleted. In `features/bookings`: every file is 250 lines or fewer, and `grep -rn "window.api\|userId"` → 0 results.
- **Accessibility**
  - [ ] Tabs follow the ARIA tabs pattern: `tablist` / `tab` / `tabpanel`, `aria-selected`, Left/Right arrow keys and Home/End.
  - [ ] The add, import and confirm dialogs have `role="dialog"`, `aria-modal` and a title label. Focus is trapped inside, Escape closes, and focus returns to the opening button.
  - [ ] The copy button is named "Copy reference {ref}". After copying, "Reference copied" is announced politely.
  - [ ] The "Manage on {provider}" accessible name includes "(opens in your browser)", and a visible external-link icon is shown.
- [ ] `npm run lint` (0 errors), `npm run format:check`, `npm run type-check` and `npm test` all pass.

## Edge Cases

- **No bookings at all:** EmptyState "No trips yet" with "Add booking" (and "Import booking" when available).
- **Tab or search empty:** "No upcoming trips" or "No trips match "{q}"" with "Clear search".
- **Unregistered `providerId`:** fallback badge "Unknown provider", and the manage link is hidden.
- **No manage link:** if neither `manageUrl` nor `manifest.website` exists, there is no manage link and the reference copy remains.
- **Cost:**
  - missing → no Cost row;
  - non-AUD currency → format with `Intl.NumberFormat('en-AU', { currency })`.
- **Nights:** counted from calendar dates. Do not use millisecond maths, which `ManualBookingForm.tsx:64-70` uses and which is off by one across DST.
- **Timezone boundary:** a booking whose departure is today counts as Upcoming until the provider's local midnight.
- **Legacy v6 bookings** (V2 maps them to `provider_id = 'parkstay'`): location comes from the campground name and area from the park name. They display correctly with no photo when the key is unknown.
- **Non-ParkStay references** with lowercase letters or dashes are accepted. Validation is trim plus 1–50 characters, unless the provider contract says otherwise. Never force uppercase.
- **Import failures:** provider error, signed-out account or network failure show an inline error in the dialog, and the dialog stays open with its input kept.
- **Delete failure:** error toast, and the item stays.
- **Clipboard API unavailable:** the reference text gets selected instead, with the message "Press Ctrl+C to copy".

## Test Strategy

- **Unit (~5):**
  - trip bucketing and sorting (today boundary, provider timezone, pending, cancelled);
  - nights between calendar dates;
  - URL state parse/serialise;
  - manage-link resolver (manageUrl → website → none).
- **Component (~10):**
  - list page (tabs keyboard, counts, filters, empty states);
  - BookingCard (badge, photo fallback, menu);
  - BookingDetail (manage link attributes, no cancel control, remove confirm flow);
  - AddBookingDialog (provider step, combobox vs text field, payload, focus return);
  - ImportBookingDialog (gating, provider filter, duplicate error);
  - ComingSoonBanner (dismiss persists, labelled button).
- **Integration (~1):** add a manual booking → it appears in Upcoming → open detail → remove → it is gone. Uses the fake api.

## Context Files to Read First

- `CLAUDE.md`; `ai-state/architecture-notes.md` §2, §3, §4, §5 (bookings unique on `(provider_id, booking_reference)`), §8; `ai-state/streams/provider-ux/master-plan.md`
- `ai-state/research/ui-review.md` (#1, #3, #6, #7, #8) and `ai-state/research/tech-review.md` (entities: bookings; dead code: BookingService placeholders)
- U1 outputs: `components/providers/ProviderPicker.tsx`, `components/LocationCombobox.tsx`, `components/StepFlow.tsx`
- `src/shared/contracts/{bookings,providers,catalog}*` (V4/V5), `src/renderer/components/ui/*` (D2), `src/renderer/app/*` (D3)
- Current code to replace: `src/renderer/pages/Bookings/*`, `src/renderer/components/forms/{ManualBookingForm,ImportBookingForm}.tsx`, `src/renderer/components/ComingSoonBanner.tsx`, `src/renderer/pages/Dashboard.tsx`, `src/shared/schemas/booking.schema.ts`, `src/shared/types/booking.types.ts`

## Notes

- **Page title.** The nav label stays "Bookings" (architecture §8). The Trips idea shows up in the tabs and layout, not in renaming the page.
- **ParkStay import.** It is a placeholder today, so V3/V4 will most likely report `bookingImport: false` for ParkStay, and the Import button will be absent in the shipped app. That is correct behaviour. Tests cover it with a fake provider fixture.
- **External links.** Use plain anchors. P4's `setWindowOpenHandler` routes them to `shell.openExternal` (ui-review #10). Never call `window.open`.
- **Soft dependency on U1.** U1 lands first in lane order. If U3 starts before U1 merges, create the shared blocks at the master-plan paths and have U1 reuse them.
