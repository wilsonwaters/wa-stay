# U1 design: Watches rebuilt provider-first (#35)

**Status:** for approval; no production code until approved; implementation starts after E1 merges (lane rebased). **Inputs:** the U1 spec and its addendum; the master plan; architecture-notes §8, §9, §12 (12.1, 12.4, 12.8–12.10, 12.15–12.20, 12.31–12.33); `docs/design/*`; D2 `components/ui`; contracts `watches`, `catalog`, `accounts`, `providers` at `d2aef63`; E1 on `lane/r` (`63799dd`).

**Overrides of the spec (§12 wins):** route `/watches/new` with `?provider=<id>&location=<externalId>&…` (§12.10, §12.19), not `/watches/create?location=<key>`; the provider filter and provider step are always shown (§12.9), not hidden for one provider; `CatalogQuery.text`, not `q` (§12.16); ParkStay is `account: 'optional'`, so auto-hold shows a soft sign-in hint, never a blocker (§12.32). Per the dispatch, the flow has five steps (Alerts is split out of Stay).

## 1. Files

### 1.1 Shared blocks (domain-generic, no "watch" wording; U2/U3 reuse)

| Path | Contents |
|---|---|
| `components/StepFlow.tsx` | Controlled scaffold: `steps: {id, title}[]`, `current`, `onStepChange`, `onContinue(): Promise<boolean>`, `finalLabel`, children = current panel. Renders `<nav aria-label="Steps"><ol>` (done steps are buttons back to them, current has `aria-current="step"`, later steps plain text), the panel `h2` (`tabIndex=-1`, VisuallyHidden "Step 3 of 5, " prefix) and the footer: Back (ghost), Continue / final (primary). D2's `Stepper` is a number input, so this is new (master-plan path). |
| `components/providers/ProviderPicker.tsx` | `RadioCardGroup` of `useProvidersWith(capability)`: name, description, `ProviderBadge` trailing. Pre-selects when exactly one qualifies (§12.9). Loading = skeleton cards + status text; error = Notice + Retry; none = caller's `emptyMessage`. |
| `components/LocationCombobox.tsx` | D2 `Combobox` (`filter={false}`, controlled text) over `useLocationSearch({ providerId, text })`: 250 ms debounce (E1's `SEARCH_DEBOUNCE_MS` value), ≥2 characters, option = `{ value: key, label: name, description: areaLine(l) }` (E1 `locationFormat`). Empty message: "Type at least 2 letters" / "Searching…" / `No locations match "{q}"`. Polite count via `useAnnounce` ("5 locations", "20 of 57 locations"). Search failure: danger `Notice` under the field + Retry (not `error`, which means invalid input). `catalog.status` syncing with count 0: info Notice "Locations from {shortName} are still loading". |
| `components/stay/ProviderStayFields.tsx` + `stayFields.ts` | Renders `StayFieldDescriptor[]` generically: select → `Select`, number → D2 `Stepper` (min/max), text → `TextField`, boolean → `Checkbox`; `help` as hint; RHF `Controller` at `stayParams.<key>`. `stayFieldsFor(manifest, uses, { except })` picks by `appliesTo`. |
| `components/stay/UnitPicker.tsx` | Units of `catalog.get(key).units`, grouped by `unitType`, in a `Disclosure` ("Choose sites (optional)", summary "Any site" / "4 sites"). Each group is a fieldset with an "All {type} (n)" checkbox (tri-state) and its unit checkboxes. Value = `unitIds`. U2 reuses it for target units. |
| `components/stay/stayFormat.ts` | `stayRangeLabel` ("Fri 12 – Sun 14 Dec"; "Fri 30 Oct – Mon 2 Nov"; year only when not this year), `partyLabel` (wraps D2 `guestsSummary`). |
| `components/timeFormat.ts` | `relativeTime(date, now)` ("just now", "12 min ago", "3 h ago", "yesterday", "Fri 3 Oct"), `timeInZone(date, tz)` ("3:15 pm AWST"). |
| `components/AvailabilityGrid.tsx` (+ `AvailabilityLegend.tsx`) | Rewritten (§4.1). |
| `renderer/hooks/useNow.ts` | `useNow(intervalMs)`: one shared ticker per interval (`useSyncExternalStore`). U1 uses 60 s; U2 adds `Countdown` on `useNow(1000)`. |
| `components/locationFormat.ts` (E1) | + `unitNoun(kind, count)` from its existing `UNIT_NOUNS` ("site"/"sites"). |
| `components/ui/statusPresets.ts` (D2) | + `watch.ended` (neutral, `CalendarX`, "Ended"). |

### 1.2 `features/watches/` (every file ≤ 250 lines)

```
WatchesPage.tsx            list/{WatchCard, WatchCardActions, WatchFilters}.tsx, list/listFilters.ts
create/NewWatchPage.tsx    create/WatchFlow.tsx, create/prefill.ts, create/steps/{Provider,Location,Stay,Alerts,Review}Step.tsx
detail/WatchDetailPage.tsx detail/{WatchSummary, HoldNotice}.tsx
edit/EditWatchPage.tsx
form/watchFormSchema.ts    form/watchFormMapping.ts, form/WatchStayFields.tsx, form/WatchAlertFields.tsx, form/AutoHoldField.tsx
shared/useWatchActions.ts  shared/{DeleteWatchDialog.tsx, watchState.ts, resultSummary.ts}
```
`WatchStayFields` + `WatchAlertFields` are the spec's `WatchPreferencesFields`, split along the step boundary and reused by Edit. `watchState(watch, manifest, today)` → `active | paused | ended | held | hold-expired | booked | unknown-provider`, the one source for pills, filters and which actions show.

### 1.3 API (`renderer/api/`, the only place `window.api` is used)

- `watches.ts`: `useWatches(filter?)` (one `watches.list()` cache entry; provider/status filter applied with `select`, so filter changes never refetch and the unfiltered list still drives filter options), `useWatch(id)`, `useCreateWatch`, `useUpdateWatch`, `useDeleteWatch` (removes the detail query), `useSetWatchActive`, `useRunWatchNow`, `useOpenWatchPayment`, `useWatchUpdates()`. Mutations invalidate `queryKeys.watches.all`.
- `catalog.ts` (E1, extended; E1's hooks untouched): `useLocationSearch({ providerId, text })` → `catalog.search({ text, providerIds: [id], limit: 20, sort: 'relevance' })` under `queryKeys.catalog.search`, `keepPreviousData`, enabled at ≥2 chars; `useLocationDetail(key)` → `catalog.get` (E2 reuses).
- `accounts.ts` (read half only): `useAccountStatus(providerId)` from `accounts.list()` (stored state, no provider probe), invalidated by `account:updated`. U2 adds `useSignIn()`.
- `events.ts`: `useInvalidateOn(event, key, { coalesceMs })` (trailing 500 ms). `queryKeys`: `watches.{all, list, detail}`, `accounts.{all, list}`. `app/routes.ts`: `ROUTES.settings(section?, query?)` for `?provider=`.

**E1 reuse:** U1 does not copy E1's `suggestions.ts`. E1's "Where" ranks regions, areas and places from the whole local catalogue, while U1 needs one provider's places, ranked by main's FTS5 (which also suits future `catalogMode: 'search'` providers). They share the D2 `Combobox`, `locationFormat` and the `catalog` query keys. If E2/E3 later want a place-only picker, they import `LocationCombobox`. No extraction is needed now.

### 1.4 Deleted

- **Files:** `features/watches/legacy/*`, `components/forms/WatchForm.tsx`, `shared/schemas/watch.schema.ts` + test + barrel export (the V4 contract replaces it), and the watch half of `components/forms/legacy-mapping.ts` + tests (snipe/booking halves stay for U2/U3).
- **Allow-lists:** `api-boundary.test.ts` drops 5 entries (WatchForm + 4 legacy), `LEGACY_ALLOW_LIST_MAX` 17 → 12; `token-guard.test.ts` drops 4, `LEGACY_FILES_MAX` 9 → 5, and gains `SCAN_FILE_PREFIXES` for the new shared files (`components/StepFlow`, `LocationCombobox`, `AvailabilityGrid`, `AvailabilityLegend`, `timeFormat`, `providers/`, `stay/`). `AppRoutes` mounts the four pages without `LegacyPageFrame`.

## 2. Create and edit flow

| # | Step (h2) | Fields | Continue when |
|---|---|---|---|
| 1 | Provider | `ProviderPicker capability="watches"` | a provider is chosen |
| 2 | Location | `LocationCombobox`, then a summary of the chosen place (name, area, kind, "24 sites") | a location is chosen; `useLocationDetail` is prefetched |
| 3 | Your stay | `DateRangeField` (`minDate = todayIn(manifest.timezone)`), `GuestsField` (adults ≥ 1), `ProviderStayFields` for `appliesTo: 'watch'`, `UnitPicker` (hidden when no units), Max price per night | dates + adults valid |
| 4 | Alerts | Check every (Select), "Alert on partial availability", "Stop watching after the first alert" (`notifyOnly`, default on), `AutoHoldField` | always (defaults) |
| 5 | Review | Summary list, each row with "Change" (goes to its step); Name (suggested), Notes | submit: "Create watch" |

- **Prefill** (`create/prefill.ts`, pure `parseWatchPrefill(search, manifests, today)` → `{ values, notices }`). `provider` must be known and have `watches`; `location` needs it and is resolved with `catalog.get(provider:location)` (skeleton while loading; dropped with a notice on failure). Dates are dropped together if malformed, `departure <= arrival` or `arrival < todayIn(manifest.timezone)`; `adults`/`children` are in-range integers; unknown parameters are ignored. Each drop shows one info `Notice`. The flow opens on the first of Provider/Location the prefill did not settle, else Stay: the criterion URL (rewritten per §12.19 as `?provider=parkstay&location=123&arrival=2026-12-12&departure=2026-12-14&adults=2`) opens on Stay, filled; `/watches/create?…` gets there through D3's redirect.
- **Form model.** One RHF form for the flow: `useForm<z.input<S>, unknown, z.output<S>>({ resolver: zodResolver(S) })`, where `S = watchFormSchema(manifest, units)` is built per provider because the stay-field rules come from its descriptors. RHF 7.65 and resolvers 5.2 type this without `as any`. Continue runs `trigger(stepFieldNames[step], { shouldFocus: true })`.
- **Legacy bug 1, no site type ticked:** there are no gear checkboxes any more. Gear is the provider's `select` stay field with its default ("Any"), and units are optional (none means any unit). Test: submit with no unit chosen.
- **Legacy bug 2, NaN max price:** a `TextField inputMode="decimal"` without `valueAsNumber`. The schema does `z.string().trim()` → `''` ⇒ undefined, else a positive number with 2 decimal places ("Enter a price in dollars, like 40, or leave it empty"). Hint: "Per night. Applied only when {shortName} shows a price for every night" (OQ11; true for any provider, since `priceCheck` skips unknown prices). Currency comes from `manifest.currency`.
- **Stay-field validation:** main's pure `problemWith` moves to `shared/utils/stay-fields.ts`. Main's `resolveStayParams` imports it (no behaviour change), and the renderer's `superRefine` uses it with the same messages and `stayParams.<key>` paths, so one validator cannot drift from the other. Defaults come from `descriptor.default`.
- **Intervals:** `WATCH_INTERVAL_OPTIONS` from the contract, filtered to `≥ providerLimits(manifest).minWatchIntervalMinutes`; default `DEFAULT_WATCH_INTERVAL`. Labels: "Every 15 minutes" … "Every hour", "Every 4 hours", "Every 12 hours", "Once a day".
- **Auto-hold** (`AutoHoldField`) is in the DOM only when `capabilities.holds` (the contract has `autoHold`). A Checkbox (saved later, not a Switch) labelled (§12.4) "Hold a {unitNoun} automatically when found" ("site" for campgrounds), described "When a {unit} is free for your whole stay, WA Stay places a temporary hold on it. You pay for it on {shortName} before the hold runs out." When ticked, the `appliesTo: 'hold'` stay fields not already shown appear below it (ParkStay: Vehicles, Postcode), since main then validates `['watch','hold']`. Hint (§12.32, from `useAccountStatus`): for `optional` and not signed in, a muted line "Optional: connect {shortName} in Settings so checkout is quicker", linked to `ROUTES.settings('accounts', { provider })`; for `required-for-holds`/`required` and not signed in, a warning Notice "{shortName} needs you signed in to hold a {unit}" with the same link; signed in, nothing.
- **Name:** suggested as `"{location} · {stayRangeLabel}"`, and kept in step with the location and dates until the person edits it (`dirtyFields.name`).
- **Submit.** Pure `toWatchInput(values, location)` → `{ providerId, name, location: { externalId, name, areaName }, stay: { arrival, departure, adults, children? }, unitIds?, stayParams? (empty values dropped), checkIntervalMinutes, autoHold, notifyOnly, allowPartialMatch, maxPrice?, notes? }`: calendar strings untouched, no `Date`, no `userId`. Success: navigate to `ROUTES.watchDetail(id)`, toast "Watch created". `VALIDATION` with `issues`: `setError` per path, jump to the step owning the first and focus it. Other errors: danger Notice on Review; the button stays.
- **Edit** (`/watches/:id/edit`, one page, not steps): PageHeader "Edit {name}"; Provider read-only (`ProviderBadge` + "A watch stays with its provider"); Location (`LocationCombobox`, same provider); `WatchStayFields`; `WatchAlertFields`; Name/Notes; "Save changes" (primary) and "Delete watch" (danger). `fromWatch(watch, detail)` pre-fills everything:
  - a select stay value that is not an option (legacy gear CSV `tent,caravan`) becomes the one listed value if exactly one matches, else the default, with a note ("Camping with was "Tent, Caravan"; {shortName} checks one, so it is now Any"), mirroring ParkStay's `gearTypeOf`;
  - `unitIds` match units by id or name (legacy rows stored names, as `wantedUnits` does); unmatched ones stay as "kept" chips.
  - `toWatchUpdate` sends only dirty fields, plus `stayParams` whenever it or `autoHold` is dirty (main re-validates then), so an untouched past stay or legacy value is never re-sent. A cleared max price is sent as `0` (OQ-1).

## 3. List page (`/watches`)

```
h1 Watches   "Get an alert when places free up for your dates."            [+ New watch]  (coral, the only one)
Provider  (All | ParkStay | Fake Stay)     Status  (All | Active | Paused)      (SegmentedControls, URL ?provider=&status=)
┌ [PS ParkStay]  Osprey Bay · Fri 12 – Sun 14 Dec (h2 link)                     ● Watching ┐
│ Cape Range National Park · 2 nights · 2 guests                                          │
│ 3 sites available · Checked 12 min ago · Next check 3:15 pm AWST · Found 4 times        │
│                                                      [Check now]  [⋯] More actions for… │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```
- **Primary action:** exactly one coral button, "New watch"; disabled with the visible reason "No provider supports watches yet" when none qualify.
- **Filters:** Provider = "All", every watch-capable provider, plus any other provider id in the list ("Unknown provider"); always shown once manifests load (§12.9). If `providers.list` fails it is hidden, and a Notice ("Provider details couldn't be loaded") + Retry shows while cards use fallback badges. Status: Active = `isActive` and not ended; Paused = inactive and not ended; ended watches show under All only. A filter change announces "3 watches"; invalid URL values are ignored.
- **Card:** `ProviderBadge`; the name as an `h2` link (visually truncated, full accessible name); "location · area"; stay; `StatusPill` from `watchState` (Watching / Paused / Ended / Site held / Booked). Result line (`resultSummary`): "Not checked yet", "{n} {units} available", "{k} of {N} nights available" (partial; clearer than the spec's "2 nights partly available"), "Nothing yet", "Last check failed". Then `relativeTime(lastCheckedAt)` on `useNow(60_000)`, next check in the provider's zone, and `foundCount`. Order: held first, then by arrival.
- **Actions:** one visible button per card, plus the `Menu` (IconButton "More actions for {name}"):

| State | Visible | Menu |
|---|---|---|
| active / paused | Check now (`loading` while pending, so a double-click makes one call) | Pause or Resume, Edit (href), Delete (danger) |
| held, unexpired | Pay now (secondary; the coral one stays "New watch") | Pause, Edit, Delete |
| hold expired | none; text "The hold expired at 3:42 pm. Create a new watch to look again." | Edit, Delete |
| booked | none; link "See it in Bookings" | Delete |
| ended | none | Edit, Delete |
| unknown provider | Check now (disabled) | Pause, Edit (both disabled), Delete |

- **Payment:** Resume is never offered for held or booked watches (main refuses). Pay now calls `watches.openPayment(id)`: `HOLD_EXPIRED` → error toast "This hold has expired, so it can no longer be paid for" and a refetch; `VALIDATION` → main's message (another payment window is open).
- **States:** loading = 3 skeleton cards in an `aria-busy` region + status text "Loading watches"; error = danger Notice + "Try again"; empty = `EmptyState size="md"` "No watches yet" → "Create your first watch"; filtered empty = "No watches match these filters" → "Clear filters" (clears the URL).

## 4. Detail page (`/watches/:id`)

- **Header.** `PageHeader` with back "Watches", the name as `h1`, a description with `ProviderBadge`, the location (linked to `ROUTES.placeDetail`, like E1's `LocationCard`; E2 fills the route) and the area. Actions: an "Updating…" indicator (Spinner `sm` + text, not live) while `isFetching && !isPending`, Check now (secondary), and the same Menu.
- **Hold notice** (`HoldNotice`): held and unexpired → warning "Site 12 is held until 3:42 pm AWST. Pay on {shortName} before then to keep it." with **Pay now** (the page's one coral); expired → neutral copy; booked → success "Booked on {shortName}" + "See it in Bookings". **`lastError`** → danger Notice "Last check failed" with the text.
- **Summaries:** three definition lists in one row (no cards in cards). Stay: dates, nights, party, stay fields by label. Preferences: units, max price, interval, alerts, auto-hold. Status: pill, last checked (relative, absolute in `title`), next check, found count. Then Notes.
- **No flicker.** The skeleton shows only on `isPending`. Refetches (`watch:updated`, Check now) keep everything rendered. `get` → `null` shows `EmptyState` "Watch not found" → "Back to watches".
- **Check now** (shared `useWatchActions`): a success toast built from `WatchExecutionResult` (the toast region is the polite live region): "3 sites available at Osprey Bay", "2 of 5 nights available at Osprey Bay", "Nothing available yet", "Site 12 held at Osprey Bay. Pay before 3:42 pm". `success: false` gives an error toast with `error`. The same hook serves the list.
- **Delete** (`DeleteWatchDialog`, D2 `ConfirmDialog`): title "Delete {name}?", message "This stops the watch and removes its results. You can't undo this.", confirm label "Delete watch". It returns the mutation promise, so a main refusal shows inside the dialog. Then a toast "Watch deleted"; the detail and edit pages navigate to `/watches`.

### 4.1 AvailabilityGrid (input `UnitAvailability[]` + `{ arrival, departure, currency, unitNoun }`)

- **Columns:** `eachNight(arrival, departure)` (shared, already tested across months and years): one column per night, none for checkout. A unit's missing night is `unknown`.
- **Semantics:** a `<table>` with a caption ("Availability for 3 sites, 21 nights"), `th scope="col"` per night ("Sat 13"), `th scope="row"` with unit name and type. Each cell has the state icon and price (`aria-hidden`) plus VisuallyHidden "Site 12, Sat 13 Dec: available, $35"; state is never colour alone.
- **Layout:** the table sits in `overflow-x-auto` inside `role="region"`, `tabIndex=0`, `aria-label="Availability"` (axe `scrollable-region-focusable`). The row-header column and header row are sticky; night columns are at least 3.5 rem, so 2 nights is compact and 21+ scrolls sideways with unit names visible. Prices use `tabular-nums`.
- **Order:** units with any available night first; units with none in a `Disclosure` "{n} sites with no free nights".
- **Legend** (`AvailabilityLegend`), icon + text, every pair already in `CONTRAST_PAIRS` (≥ 3:1): Available `Check` `available`/`available-subtle`; Booked `X` `fg-muted`/`surface-subtle`; Closed `Minus` `fg-secondary`/`surface-subtle`; Not released yet `Clock` `warning-fg`/`warning-subtle`; Unknown `CircleQuestionMark` `fg-muted`/`surface`.
- **Empty cases:** "No check yet. Check now to see availability." (`lastAvailability` undefined); "None of the chosen sites were in the last check" (empty). The two legacy input shapes are deleted and the legacy test rewritten.

## 5. Events and refresh

- `useWatchUpdates()` runs on the three watch pages: `watch:updated` → `invalidateQueries(queryKeys.watches.all)`, coalesced to one per 500 ms. The event carries a deleted watch once more, so a refetch, not `setQueryData`, gives the right answer (`get` → `null`).
- `account:updated` invalidates `queryKeys.accounts.all`, which re-renders the auto-hold hint. `catalog:updated` uses E1's `useCatalogUpdates()` in the Location step, which clears the "still loading" notice.
- React Query defaults (D3): no refetch on focus, `staleTime` 60 s. No polling: watches change only through events or our own mutations.

## 6. Accessibility

- **Focus:** a route change focuses the `h1` (D3 `useRouteFocus`); a step change focuses the new step's `h2` (not on first mount, so the h1 keeps route focus). Tab order: step list → fields → Back → Continue. "Change" on Review moves to that step's heading. A failed Continue or submit focuses the first invalid field (`trigger`/`setError` with `shouldFocus`); `Field` wires `aria-describedby` and `aria-invalid`.
- **Announcements (polite):** combobox counts; list counts after a filter change; Check now outcomes, through the toast region. The prefill notice is a Notice, not live. Mutation errors are `role="alert"` toasts. "Updating…" is not announced.
- **Patterns.** Combobox (D2, ARIA 1.2), `Menu` (`role="menu"`, Escape returns focus to the trigger), `RadioCardGroup`, `SegmentedControl` (radiogroups), and the grid table semantics.
- **Target:** axe 0 critical/serious on `/watches` (with held, booked, error and ended data), each create step, the detail page (21-night grid), the edit page and the open ConfirmDialog.

## 7. Test plan

**Fixtures:** `createMockApi` gains `FAKE_MANIFEST` (`fakestay`, "Fake Stay", watches on, holds off, `account: 'none'`, no stay fields); `PARKSTAY_MANIFEST` gains `currency`, `catalogMode` and `stayFields`, with a test pinning them to `parkstayManifest`; new `tests/fixtures/renderer/watches.ts` (`makeWatch()`, `makeUnits(nights)`, `makeLocationDetail()`).

**Completion criteria:**

| Criterion | Test (file › name) |
|---|---|
| h1 + one New watch; card content | `features/watches/WatchesPage.test.tsx › shows one h1 "Watches" and one "New watch"`; `list/WatchCard.test.tsx › shows provider, location, stay, last checked and result` |
| One button + "More actions for {name}" | `WatchCard.test.tsx › has exactly one visible button and a More actions menu with Pause, Edit, Delete` |
| Two-provider filter, URL state | `WatchesPage.test.tsx › filters by provider and status; ?provider=parkstay&status=active restores both` |
| Empty states | `WatchesPage.test.tsx › no watches: Create your first watch`, `› no matches: Clear filters` |
| Step 1 capability, single pre-select | `components/providers/ProviderPicker.test.tsx › lists only providers with the capability`; `create/NewWatchPage.test.tsx › a single watch provider is pre-selected and Continue is enabled` |
| Step 2 provider-scoped search, no results | `components/LocationCombobox.test.tsx › searches only the chosen provider after 2 letters`, `› says No locations match "{q}"` |
| Prefill opens Stay | `create/NewWatchPage.prefill.test.tsx › opens on Your stay with provider, location, dates and guests filled` |
| Holds toggle absent/present | `create/steps/AlertsStep.test.tsx › no auto-hold toggle when holds is false`, `› shows "Hold a site automatically when found" when holds is true` |
| Submit payload, navigate, toast | `create/NewWatchPage.test.tsx › Create watch sends providerId, location, YYYY-MM-DD stay and no userId, then opens the watch` |
| Edit pre-fill + update | `edit/EditWatchPage.test.tsx › shows the provider read-only and pre-fills every field (legacy gear CSV, unit names)`, `› Save changes sends the changed fields to watches.update` |
| Detail: no spinner on refetch | `detail/WatchDetailPage.test.tsx › keeps heading and summaries while watch:updated and Check now refetch` |
| Grid 2 / 21 columns, legend | `components/AvailabilityGrid.test.tsx › a 2-night stay has 2 night columns`, `› 21 nights render 21 columns in a scrollable region`, `› the legend lists all 5 states` |
| ConfirmDialog in list/detail/edit; no `window.confirm` | `WatchCard.test.tsx › Delete asks in a ConfirmDialog`; `WatchDetailPage.test.tsx › Delete confirms and returns to /watches`; `EditWatchPage.test.tsx › Delete watch confirms`; `tests/unit/renderer/watches-guards.test.ts › no window.confirm in src/renderer` |
| Legacy gone, ≤ 250 lines, no `window.api`/`userId` | `watches-guards.test.ts › legacy watch files are gone`, `› every features/watches file is ≤ 250 lines`, `› no window.api, userId or "as any" in features/watches` |
| A11y: combobox | `LocationCombobox.test.tsx › follows the combobox pattern with Up/Down/Enter/Escape`, `› announces "5 locations" politely` |
| A11y: step focus, `aria-current`, first invalid | `components/StepFlow.test.tsx › moves focus to the new step heading`, `› marks the current step aria-current="step"`; `NewWatchPage.test.tsx › Continue focuses the first invalid field, described by its error` |
| A11y: menu | `WatchCard.test.tsx › More actions is a menu; Escape closes it and focuses the trigger` |
| A11y: Check now announced | `WatchCard.test.tsx › Check now announces "3 sites available at Osprey Bay"`, `› …"Nothing available yet"` |
| A11y: cell names, legend contrast | `AvailabilityGrid.test.tsx › every cell has a text name like "Site 12, Sat 13 Dec: available, $35"`; legend pairs are covered by `tests/unit/design/contrast.test.ts` (no new pairs) |
| Gate | lint, format, type-check, `npm test` |

**Addendum:**

| Item | Evidence |
|---|---|
| axe 0 on `/watches` with data | Runtime axe (below) + screenshot; the legacy page is deleted |
| Allow-lists | `api-boundary.test.ts` and `token-guard.test.ts` with the lowered MAX constants |
| `/watches/new` + §12.10 | `NewWatchPage.prefill.test.tsx`; the existing `AppRoutes` redirect test |
| Legacy bugs | `NewWatchPage.test.tsx › creates a watch with no unit or unit type chosen`, `› creates a watch with an empty max price (no NaN)`; `form/watchFormSchema.test.ts › '' is no limit; "abc" and 0 are errors` |
| e2e | `tests/e2e/create-watch.spec.ts` |

**Unit tests (pure):** `create/prefill.test.ts` (valid, partial, malformed/unknown provider, provider without watches, past dates in Perth vs the host zone, departure ≤ arrival, unknown parameters); `list/listFilters.test.ts`; `shared/resultSummary.test.ts`; `shared/watchState.test.ts`; `form/watchFormMapping.test.ts` (`YYYY-MM-DD`, no `userId`, `unitIds`, compact `stayParams`, dirty-only update, legacy CSV); `stay/stayFormat.test.ts`; `timeFormat.test.ts`; `shared/utils/stay-fields.test.ts`; `api/events.test.tsx` (5 `watch:updated` in a burst → 1 invalidation); `api/watches.test.tsx` (`select` filters; a double-click makes one `runNow`). `nightsOf` is the shared `eachNight` (`tests/unit/shared/calendar-date.test.ts`).

**Edge-case component tests:** no watch provider; unknown provider (only Delete enabled); `providers.list` failure + retry; search failure + Retry; catalogue syncing; no units hides the picker; max-price hint; lastError text; Ended pill; HOLD_EXPIRED toast; soft hint vs `required-for-holds` warning; hold fields appear with auto-hold.

**Integration:** `tests/integration/renderer/create-watch-flow.test.tsx › creates a Fake Stay watch end to end` (two providers; provider → location → stay → alerts → review → detail).

**E2E** (`tests/e2e/create-watch.spec.ts`, fixture mode, `unexpectedRequests()` must be `[]`): Watches → New watch → ParkStay pre-selected → type "Bung", choose Bungarra (campground 20 is in the e2e catalogue) once the 5 s sync lands → dates, 2 adults → Alerts defaults → Review → Create watch → the detail `h1` is the suggested name and the toast shows. `fixtures/http/parkstay` gains `campsite_availablity_view/20/` (copied from the Jest fixture `campsite_availablity_view_20.json`; no query constraint), which serves `catalog.get` and the first check. Any other route the gate needs is added from the log, never live. The Bookings-h1 `test.fail` stays (U3 has not landed).

**Runtime (§6e)**, shots in `scratchpad/shots/U1/`. `npm run build`, Electron ABI, `_electron` under `xvfb-run -a` with a temp `WA_STAY_USER_DATA_DIR` and `WA_STAY_E2E_FIXTURES_DIR` (zero live provider calls). Held (unexpired and expired), booked, error, ended and 21-night `last_availability` watches are seeded rows in the temp DB: no hold is ever placed, and Pay now is clicked only on seeded rows in fixture mode (§12.33). Shots: list (data, empty, filtered-empty, menu open); each step (combobox open, prefill notice, auto-hold with hint); review; detail (2-night and scrolled 21-night grid, held, lastError, Updating…, Check now toast); edit (legacy gear note); ConfirmDialog. Each gets axe (scratchpad `axe.min.js` injected), and the main log and renderer console must be clean. Then the Node ABI is restored.

## 8. Risks and open questions (with recommendations)

| # | Issue | Recommendation |
|---|---|---|
| OQ-1 | `WatchUpdate.maxPrice` cannot be cleared: zod has no `null` and undefined is dropped over IPC | Send `0`, which `priceCheck` already treats as no limit, and read `0` as empty. Add a one-line repo change, `push('max_price', updates.maxPrice \|\| null)`, matching create, with a test. Approve this main-process touch. |
| OQ-2 | No contract field for "Unit type" | `UnitPicker` groups units by type with an "All {type}" checkbox, and sends `unitIds`. No new field. |
| OQ-3 | Five steps (dispatch) vs the spec's four | Five. Step 3 is still Stay, so the prefill criterion is unchanged. |
| OQ-4 | Spec note hides the provider filter for one provider; §12.9 shows it | Always show it (§12.9 is binding). |
| OQ-5 | The prefill criterion uses `?location=parkstay:123` | Accept only the §12.19 form. The test URL is rewritten. No composite-key fallback: E2 builds links with `ROUTES.watchNew`. |
| OQ-6 | Legacy label "Send Notifications" for `notifyOnly`; alerts are always sent, and the flag stops the watch after its first find | Relabel it "Stop watching after the first alert" (default on, as before). |
| OQ-7 | The location link targets E2's route, which is `NotFoundPage` until E2 | Link it anyway, as E1's `LocationCard` does. |
| OQ-8 | The master plan gives `useNow` and `api/accounts.ts` to U2, but U1 runs first and needs both | U1 creates `useNow(intervalMs)` and read-only `useAccountStatus`. U2 adds `Countdown` (1 s) and `useSignIn`. |
| OQ-9 | Two stay-field validators (main and renderer) would drift | Move the pure validator to `shared/utils/stay-fields.ts` (a main import change, no behaviour change, tests kept). |
| OQ-10 | Held "Pay now" vs one coral per view | Secondary on the list (where "New watch" is coral); the coral primary on the detail page. |
| R-1 | E1 is still in review: `api/catalog.ts` and `locationFormat.ts` may change | Rebase after E1 merges. U1 only adds hooks and one export. |
| R-2 | `catalog.get` costs one live ParkStay request per chosen location (V5 caches it 6 h) | Acceptable. Prefetch only on selection, never while typing. |
| R-3 | File-size cap (250) on WatchCard, StayStep and EditWatchPage | The splits in §1.2. The guard test enforces it. |
| R-4 | The e2e availability fixture has fixed dates, so the first check may read nights as unknown | The journey asserts only creation and navigation. Grid content is covered in Jest. |
