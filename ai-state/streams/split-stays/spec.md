# Split stays: design spec and task plan

**Stream:** split-stays · **Status:** approved 2026-10-23 (SQ1: no limit on moves; SQ2: a split alert pauses a "stop after the first alert" watch) · **Tasks:** SS1–SS4 (below)
**Inputs:** the stakeholder's RAC finding (1–6 July 2027, RAC Busselton Holiday Park, "Powered Site") and request; the dispatch's decisions D1–D6; CLAUDE.md; architecture-notes §12 (12.4, 12.17, 12.31, 12.33, 12.35); `docs/providers/rac/README.md`; the code at this lane's head; RAC's saved contact pages (research of 16 Oct 2026).

## 1. Goal

A stay that is free every night, but only by moving between units, is shown for what it is, never as "available":

- **Explore** shows a muted "Free if you move" on a place whose only option is a split stay (where the provider can tell), after the places free on one unit.
- **A place's page** has a separate block under the night grid: free across how many units (when known), the parts, and how to book: contact the place (RAC), or book each part yourself (ParkStay).
- **Watches** get an opt-in setting, off by default: "Alert on stays that move between sites". With it on and nothing free on one unit, a split stay is a result of its own, `SPLIT_FOUND`, below `FOUND` and above `PARTIAL_FOUND`. Its alert and email say how to book. Auto-hold never acts on one.
- It is generic. A provider reports a split stay on a unit that stands for several (RAC's category, ParkStay's site class). The core derives one across units that are one place each (ParkStay's sites). A provider that can't tell reports nothing, and nothing changes for it.

Site Sniper is out of scope (D5): a snipe takes one unit free for the whole stay (`freeForStay`), and a split stay never satisfies it.

## 2. What exists (verified)

| Area | Where | What it does today |
| --- | --- | --- |
| `NightReason` | `src/shared/types/provider.types.ts:356-368` | `'split' \| 'min-stay'`. A night with a reason is `unknown`, and matching never counts it (`isFreeNight`, `src/main/core/watches/matching.ts`). |
| RAC mapping | `src/main/providers/rac/mapping.ts:51-65` (header, "The stay"), `verdictOf` `:411-427`, `categoryAvailability` `:444-535` | When every night has free sites (`sites_code` 0, `sites_available` > 0) but `fullyAvailable` is false, the verdict runs in this order: (1) `min-stay` (the stay rules refuse); (2) `split` (`noSiteForStay`: stay-through code 3 or 5, or code 0 with no site); (3) tariff refusals; and so on. A `split` verdict turns every free night into `{ state: 'unknown', reason: 'split' }` **and drops its price**. `freeCount` is 0. Split is decided before the tariffs: the fixtures show a tariff can succeed with no site (`availability-busselton-2026-11-06-2n.json`, Ensuite Site: stay-through code 3, `tariff_success: "true"`, code 0), which matches what the stakeholder saw ("Standard Rate $450 for 5 nights, Booked"). |
| RAC bulk | `src/main/providers/rac/bulk.ts` `parkEntry` | Builds each park's entry from the same units `check` gives (`unitsOf`), so it can tell a split per park and per kind. Today a split category adds 0 and reads "None free". |
| RAC links | `src/main/providers/rac/links.ts` | `location` → `/<slug>/`, `booking` → `/<slug>/booking/…` or `/<slug>/book-now/…`. No contact link. |
| RAC contact pages | `docs/providers/rac/endpoints.md` ("Pages WA Stay opens or links to": `/<slug>/contact-us/`, "Not opened by the app") | All eight seeded parks have one at `https://parksandresorts.rac.com.au/<slug>/contact-us/`; the canonical URL of each saved page is exactly that, with the same layout at widget and native parks. Each shows the park's address, RAC's free-call number, the park's phone, a reservations email, reception hours (8 am–6 pm daily; Cable Beach "during the peak season"; Monkey Mia 8 am–8 pm), and a question form ("we'll respond within three days"). It also says: "For all new bookings please book online or call us directly." WA Stay links the page and copies none of its details. |
| ParkStay split | `src/main/providers/parkstay/availability.ts:151-176` `classNights`, `site-classes.ts` `bookableClassNights` | **Only at a campground listed by site class** (`site_type` 1 or 2, e.g. Lucky Bay, `class:117`), **only when no site of the class is free for the whole stay** (ParkStay then sends a per-site `breakdown`, aligned with the nights). `bookableClassNights` picks runs of nights, each on one site, never two runs side by side: most nights first, then longest runs. Those nights are `available`. A night with a free site that is not picked is `unknown`/`split`, **with its price kept**. A night with no free site is booked or not released. The recorded Lucky Bay fixture (`tests/fixtures/parkstay/campsite_availablity_view_43_classes.json`, 6–9 Nov 2026) is a real split stay: site 21 is free on the 6th, site 23 on the 7th, and five sites on the 8th. At campgrounds listed by site, nights come per site and nothing is marked `split`. |
| ParkStay bulk | `availability.ts` `search`; `types.ts` `RawBulkAvailability` | `campground_available.{id}` has only `sites`, `total_available` and `total_bookable`, with no nights, so **ParkStay's bulk cannot tell a split stay**. |
| Night grid | `src/renderer/components/nightGridModel.ts`, `NightGrid.tsx` | `isSplitNight`; `UnitStanding` `'split'`; cell "Free on another {site}"; summary note "Free on some nights, but not on one {site} for the whole stay." |
| Free counts | `src/shared/utils/free-units.ts` | `freeUnitsOf` counts only free units (`freeCount` when set). A split is never counted, and stays that way. |
| Explore | `src/renderer/features/explore/availability/deriveAvailability.ts` | States `available` / `full` / `none-open` / …; `RANK` orders them; `availabilityLabel` gives the pill and card text; `MUTED_STATES` in `map/layers.ts`; "Available only" keeps `available` only (`ExplorePage.tsx:346`). |
| Watches | `src/main/core/watches/watch.service.ts` `execute`, `bookingLinkOf`; `matching.ts` | Full matches, else partial runs (when `allowPartialMatch`); `recordRun` stores the wanted units as `last_availability`; `bookingLink` is derived on read for `FOUND` and `PARTIAL_FOUND`; `notifyOnly` pauses after a found or partial alert; auto-hold acts on full matches only. `WatchResult` (`common.types.ts:9`) has no CHECK constraint (`connection.ts`); `lastResult` is read unvalidated. |
| Watch IPC | `src/shared/contracts/watches.ts` | `watchInputSchema` with `assertTypeEquals` against `WatchInput`. The preload passes the input through whole (`src/preload/index.ts:58`, `create: (input) => input`). |
| Alerts | `notification.service.ts` `notifyWatchFound`, `notifyWatchPartialFound`; `email-smtp.notifier.ts` `buildEmail` | One `bookingUrl` per alert, checked against the provider's site. The desktop click opens the watch, then that link. The email has one "Book on {shortName}" button. |

## 3. Decisions, and what I changed

Each of D1–D6 holds, with these refinements:

- **D2, which units the core derives across.** The core derives a split stay only across entries with **no `freeCount`**. The SDK already says such an entry "is one unit", and its runs of free nights are what partial matching books. An entry with a `freeCount` (RAC's category) counts free sites per night, not one site, so a run on it is not a stay on one place. The core never combines such entries; their provider reports its own split (RAC does). ParkStay's site classes have no `freeCount`, and their `available` runs each lie on one site (`bookableClassNights`), so derivation may use them too. A class's own split stay (moving between its sites) comes from ParkStay, which has the breakdown.
- **D2, how it is booked.** `booking: 'contact' | 'separate'` on the split stay, from the provider. For a derived split it is always `separate`: each part is a run the provider's own page books.
- **D3, RAC prices.** RAC reports a split stay only when a tariff counts for the person (`priceTariffOf`). It then **keeps each split night's price**, the category's nightly rate, which is the same whichever site. So a watch's price rule applies, and the block can say "About $450 for the 5 nights". When no tariff counts, the nights stay `split` as today, but no split stay is reported: RAC refuses the stay for another reason, and staff may refuse it too. A split stay's price always reads "about", because separate bookings may add fees or be priced by staff.
- **D4, the IPC.** Adding `allowSplitStay` needs the schema and the types. `assertTypeEquals` forces both. It needs **no preload change and no parity-test change**: no channel is added, and the preload passes the watch input through whole. One response type changes: `catalog.checkLocation` answers `LocationCheck` (§4.3), which adds `splitStays`.
- **D4, precedence.** `FOUND` > `SPLIT_FOUND` > `PARTIAL_FOUND` > `NOT_FOUND`. A split stay covers every night asked for; a partial run doesn't. Nothing changes unless the person turns the option on, so the people who "won't want it" never see it. Both kept: the watch page still shows the partial runs in the night grid.
- **D3, Explore order.** After places free on one unit, and **before** "None free" and "Not open": a split stay is more than nothing. "Available only" hides it, since it is never "available" (D1).
- **D1, the contact copy.** "Contact {place} to book" links the park's contact page. RAC's page asks for new bookings by phone and lists the numbers, so WA Stay neither copies a number nor promises a reply time.

## 4. The model

All new fields are optional and additive, except `Watch.allowSplitStay`. The scaffold, the example providers and every provider that reports nothing compile and behave as before.

### 4.1 Shared types (`src/shared/types/provider.types.ts`)

```ts
/**
 * How a split stay is booked:
 * - `contact`: the place's own staff book it, as separate stays; the person contacts the
 *   place (`ProviderLinks.contact`). RAC: a category with a free site every night but no one
 *   site free for all of them.
 * - `separate`: the person books each part online, as a booking of its own, on the provider's
 *   booking page for that part's dates (ParkStay).
 */
export type SplitStayBooking = 'contact' | 'separate';

/**
 * What a provider reports on a unit that stands for several (a category or class of sites)
 * whose stay is free every night only by moving between them. Set it only when the unit is not
 * `fullyAvailable`, its `freeCount` (if any) is 0, and every night of the stay is free
 * (`available`, no reason) or `split`, at least one of them `split`. Leave it out when you
 * can't tell how it would be booked. Never counted as free.
 */
export interface UnitSplitStay {
  booking: SplitStayBooking;
  /**
   * The parts in date order, when the provider knows where the moves fall: each a run of nights
   * on one of the places this unit stands for. The first arrives on the stay's arrival, each
   * departs the morning the next arrives, and the last departs on the stay's departure; at
   * least 2. Left out when the provider can't tell (RAC counts free sites per night, not which).
   */
  parts?: Array<{ arrival: string; departure: string }>;
  /** How many places it moves across, when known: a whole number of at least 2. */
  units?: number;
}

export interface UnitAvailability {
  // … existing fields …
  /** A split stay on this unit, which stands for several (`UnitSplitStay`). */
  splitStay?: UnitSplitStay;
}

export interface BulkAvailabilityEntry {
  // … existing fields …
  /**
   * No unit is free for the whole stay (`availableUnits` 0), but the stay is free every night
   * by moving between units: a split stay. Set only with `availableUnits` 0, and only when the
   * provider can tell. Never counted. Per kind in `byKind` likewise.
   */
  splitStay?: true;
  byKind?: Partial<
    Record<UnitKind, { availableUnits: number; bookableUnits?: number; splitStay?: true }>
  >;
}

/** One part of a split stay: consecutive nights on one unit, booked on its own. */
export interface SplitStayPart {
  /**
   * The unit the part is on: one place (a derived split), or the unit standing for several
   * that the provider reported the split on (ParkStay's class: the provider picks the site).
   */
  unitId: string;
  unitName: string;
  /** Calendar dates; `departure` is the morning after the part's last night. */
  arrival: string;
  departure: string;
  /** The part's price, when every one of its nights has one. */
  total?: number;
  /**
   * `separate`: this part's booking page, `links.booking(externalId, partStay, unitId)`, kept
   * only when it is a booking link of the provider (`firstBookingLink`).
   */
  bookingUrl?: string;
}

/**
 * A stay free every night only by moving between units of one kind: a split stay. Never free:
 * not in `fullyAvailable`, `freeCount`, Explore's counts or a watch's full match. Built by the
 * core (`splitStaysOf`, `src/main/core/split-stays.ts`) from a check's units; never sent by a
 * provider.
 */
export interface SplitStay {
  /** The kind of every unit it uses; it never crosses stay types. Absent when the units give none. */
  unitKind?: UnitKind;
  booking: SplitStayBooking;
  /** The unit the provider reported it on (RAC's category), when it did; absent when derived. */
  unitId?: string;
  unitName?: string;
  /** How many units it moves across, when known: the derived parts' distinct units, or the provider's count. */
  units?: number;
  /** The parts in date order, when known; `parts.length` is how many bookings it takes. */
  parts?: SplitStayPart[];
  /** The whole stay's price, the sum of its nights' prices, when every night has one. Shown as "about". */
  total?: number;
  /**
   * `contact`: the place's contact page (`links.contact`, else `links.location`), kept only
   * when https on the provider's own site; absent otherwise (the copy names the place
   * without a link).
   */
  contactUrl?: string;
}

/** `catalog.checkLocation`'s answer: the provider's availability, and the split stays in it. */
export interface LocationCheck extends LocationAvailability {
  /**
   * Best first (§5.4): every unit's reported split stay, and per kind the derived one when no
   * unit of that kind is free for the whole stay. Empty when there is none.
   */
  splitStays: SplitStay[];
}
```

`SplitStay` lives with the provider types so that the watch, catalog and notifier types all reach it without a cycle. It is serialisable.

### 4.2 SDK (`src/main/providers/sdk/provider.ts`)

```ts
export interface ProviderLinks {
  // … location, booking, manageBooking …
  /**
   * The place's contact page, where a person asks its staff to book what WA Stay can't (a
   * split stay with `booking: 'contact'`): an absolute https URL on the provider's own site,
   * a public page that needs no sign-in. Needed by a provider that reports `contact` split
   * stays (the contract suite checks); null when the place has none.
   */
  contact?(externalId: string): string | null;
}
```

There is no manifest flag and no registry rule. Whether a check holds a split stay is decided per answer, and the contract suite checks the answers (§5.5).

### 4.3 Watches (`src/shared/types/watch.types.ts`, `common.types.ts`)

```ts
export enum WatchResult {
  // …
  /** No unit is free for the whole stay, but it is free every night by moving between units (`allowSplitStay`). */
  SPLIT_FOUND = 'split_found',
}

export interface Watch {
  // …
  /** Also alert on a split stay: every night free, but only by moving between units. Off by default. */
  allowSplitStay: boolean;
  /**
   * The split stays the last check found, best first, with how to book them: set only while
   * `lastResult` is split-found and the stored nights are the stay's. Main derives it from
   * `lastAvailability` on every read (as `bookingLink`); it is never stored.
   */
  splitStays?: SplitStay[];
}
export interface WatchInput { /* … */ allowSplitStay?: boolean; }
export interface WatchExecutionResult { /* … */ splitStays?: SplitStay[]; }
```

`watchInputSchema` gains `allowSplitStay: z.boolean().optional()`; the update schema follows through `.partial()`. `catalog.checkLocation.response` becomes `LocationCheck`.

### 4.4 Notifier message (`src/shared/types/notifier.types.ts`)

```ts
export interface NotificationMessage {
  // … bookingUrl, heldInApp …
  /**
   * How to book a split stay an alert found (never stored): the place's contact page, or each
   * part's booking page. Every URL is https on the provider's own site, checked again by
   * `notify`; one that isn't is dropped.
   */
  splitStay?: {
    contact?: { label: string; url: string };
    parts?: Array<{ label: string; url?: string }>;
  };
}
```

### 4.5 Database: migration v13

`watches.allow_split_stay INTEGER NOT NULL DEFAULT 0`, added in place with `addColumns`, as v12 adds its columns (`V13_TABLES = ['watches']`, `applyMigration(database, 13, …)`). `LATEST_SCHEMA_VERSION` = 13. `WatchResult.SPLIT_FOUND` needs no migration: `last_result` has no CHECK constraint. A database from a newer app already fails to open (`DatabaseTooNewError`), so an older app never reads `split_found`. `WatchRepository`: `create` and `update` write the column; `toWatch` reads `Boolean(row.allow_split_stay)`.

## 5. Behaviour

### 5.1 Provider responsibilities

**Every provider.** Report a split stay only when you know it can be booked, and how. Otherwise leave it out: the nights stay `split` (or whatever they are), and nothing else changes. `availability.check` stays one request; nothing here may cost a request.

**RAC** (`src/main/providers/rac/`):
- `mapping.ts` `categoryAvailability`: when the verdict is `split` **and a tariff counts** (`priceTariff`), set `splitStay: { booking: 'contact' }`, with no parts and no count. Keep each split night's `price` (`nightPriceOf(priceTariff, date)`, never the 999 placeholder) and its closed days. `fullyAvailable` stays false and `freeCount` 0. With no counting tariff, the nights stay `split` with no price, and there is no `splitStay`. The verdict order is unchanged: `min-stay` still comes first, so a stay RAC's rules refuse is never a split stay. Update the header's "The stay" list to match.
- `bulk.ts` `parkEntry`: for the park and for each kind, add `splitStay: true` when its free tally is 0 and a unit of it has a `splitStay`.
- `links.ts`: `contact: (externalId) => parkPage(externalId, 'contact-us/')`: `/<slug>/contact-us/` on RAC's host, null for a park the seed lacks. `createRacLinks` and `racLinks` both get it.
- Parts and counts are unknown, by design. Finding them would take an availability POST per sub-stay at 10 s each (terms rule 4), well past the place page's 2-request deadline, for staff who book it themselves anyway.
- The cart guard is unaffected: the contact page is a link the browser opens and RAC's client never requests it. `endpoints.md`'s row for `/<slug>/contact-us/` changes to "Contact {park}" for split stays (`links.contact`), still "Verified live 2026-10-16".

**ParkStay** (`src/main/providers/parkstay/`):
- `availability.ts` `classNights` (or a sibling `classSplitStay` in `site-classes.ts`): when the breakdown is aligned, every night of the stay has a free site of the class, and no site is free for all of them (always true when there is a breakdown), set the class unit's `splitStay` to `{ booking: 'separate', parts }`. The parts come from the breakdown with `fewestParts` (§5.2), over the class's site rows; each part is a class booking for its dates (ParkStay holds the first site of the class free for them, `utils.py:186-202`). There is no count, because ParkStay picks the sites. Lucky Bay's recording gives three one-night parts: 6, 7 and 8 Nov.
- Site-listed campgrounds report nothing: the core derives across their sites.
- `links.booking(externalId, partStay)` already gives the search page with a part's dates; ParkStay ignores the unit, so the part names the site to choose.
- Bulk can't tell (§2), so Explore reads ParkStay as today.
- DBCA's terms allow it: parts never share a night ("one booking per night"), and the person books each part on ParkStay.

### 5.2 The shared cover (`src/shared/utils/split-parts.ts`)

```ts
/**
 * The fewest consecutive parts that cover nights 0..nights-1, each part [from, to) on one row
 * for which `fits(row, from, to)` holds; undefined when no cover exists. Ties go to the longest
 * parts (the largest sum of squared lengths), then the earliest row, then the earliest boundary,
 * so the answer is stable. Pure; no node or electron imports.
 */
export function fewestParts(
  rows: number,
  nights: number,
  fits: (row: number, from: number, to: number) => boolean
): Array<{ row: number; from: number; to: number }> | undefined;
```

It is a dynamic programme over nights: `best[i]` is the best cover of nights `0..i-1`, extended from each `j < i` by the first row that fits `[j, i)`. The order is lexicographic: (fewest parts, largest Σ length², first row in the given order). `fits` is called O(nights² × rows) times at most. The core passes a `fits` that first reads a precomputed "longest free run from each night" per row, so the full stay-rule and price check runs only on candidates. 30 nights × 300 units must finish well within a test's default timeout (no timing assertion). Both the core (§5.3) and ParkStay's classes (§5.1) use it.

### 5.3 The core derivation (`src/main/core/split-stays.ts`)

`splitStaysOf(units, arrival, departure, { maxPrice }?) → SplitStay[]` is pure: no links yet, and logging at debug level only. Here `units` is the check's units (the place page) or a watch's wanted units (`wantedUnits`). It returns nothing for a stay of one night. Otherwise:

1. **Group by kind** (`unitKindOfUnit`: a unit with no kind is `other`, as matching counts it). The groups go in `UNIT_KINDS` order, and a split stay never crosses kinds, even across units the watch named.
2. **Reported split stays.** Each unit in the group with a valid `splitStay` gives one `SplitStay`: `{ unitKind?, booking, unitId, unitName, units?, parts?, total? }`. The parts take the unit's id and name, and each part's total is the sum of its nights' prices. The report is valid when the unit is not `fullyAvailable`, every stay night is free or `split` with at least one `split`, `units` (if set) is a whole number of at least 2, and `parts` (if set) has at least 2 parts that cover the stay exactly, in order, with no gap or overlap. An invalid report is ignored, with one debug line naming the provider and unit id. The contract suite catches it in tests. The price rule applies per night when every night has a price (`priceCheck(unit.nights, maxPrice)`); a report that fails it is dropped. Reported split stays are listed whether or not another unit of the kind is free, because a reported unit is a type (a Powered Site is not an Unpowered Site). A watch only reaches split stays when none of its wanted units is free (§5.6).
3. **Derived split stay**, only when no unit of the group is a full match (`fullMatches({ maxPrice }, group)` is empty). It derives across the group's units with no `freeCount`, through `fewestParts`, where `fits(u, from, to)` holds when:
   - every night in `[from, to)` on `u` is free: `available` with no reason (`min-stay` and `split` nights never count, as in matching);
   - the run passes the price rule (`priceCheck(run, maxPrice).passes`; a run with an unpriced night passes);
   - the run meets `u`'s stay rules (`meetsStayRules(u, run, nightAfter(u, last))`): long enough for the first night's `minNights` (else the unit's), its first night takes arrivals, and the morning it leaves takes departures. So a move is never planned for a morning the old unit takes no departures or a day the new one takes no arrivals.

   A cover of at least 2 parts gives `{ unitKind, booking: 'separate', units: distinct unit ids in the parts, parts, total? }`. A cover of one part is a full match, which step 3's guard has already ruled out.
4. **Totals.** A part's total is the sum of its nights' prices when every night has one. The split stay's total is the sum of its parts' totals, or, for a reported split stay with no parts, of the unit's nights. Otherwise there is none.

`withSplitStayLinks(provider, externalId, stay, splitStays, { quiet })` adds the links, and is the only code that calls the provider's links for this:
- **`contact`:** `contactUrl` is the first of `links.contact(externalId)`, then `links.location(externalId)`, that passes `firstBookingLink(manifest, …)` (https on the provider's own site). A link off the site is logged by origin only, unless `quiet`. A throw from `links` is caught and logged by error name.
- **`separate`:** each part's `bookingUrl` is `links.booking(externalId, { ...stay, arrival, departure }, part.unitId)`, kept by the same rule.

`matching.ts` exports `isFreeNight` and `nightAfter` for this module; their behaviour is unchanged.

### 5.4 Order of split stays

Fewest bookings first (`parts.length`; a split stay with no parts but a `units` count sorts by that; one with neither sorts after every counted one). Then reported before derived. Then the provider's unit order, so ties keep RAC's category order. The best is first; an alert and Check now name it.

### 5.5 Contract suite (`tests/utils/provider-contract.ts`)

- `links`: `contact(sample)`, when the provider has `contact`, is an absolute https URL or `null` (in "builds absolute https links").
- `splitStayViolations(manifest, provider, stay, result)`: every unit with `splitStay` satisfies the §4.1 rule (not `fullyAvailable`; `freeCount` 0 or absent; nights free or `split`, at least one `split`; `booking` is one of the two values; `units` a whole number of at least 2; `parts` covering the stay exactly, at least 2). A `contact` report needs `links.contact`, giving a booking-link-valid URL for the place (`isProviderBookingLink`).
- `bulkSplitViolations(entries)`: `splitStay` only with `availableUnits` 0, at the top level and per kind.
- Self-tests in `tests/integration/provider-contract.test.ts`: one bad sample per rule, so a check that can no longer fail is caught.
- Run on RAC with an edited Busselton answer (the Powered Site with stay-through 0 and code 3), and on ParkStay with Lucky Bay's recording.

### 5.6 Watches

**Create and edit.** `allowSplitStay` defaults to false and is stored by v13. Turning it on or off makes the watch due at once (`update`'s reschedule list), so its result follows the setting. It is not part of `checkedKey`: the provider's answer does not depend on it.

**`execute`**, after `full = fullMatches(watch, units)`:
```
full.length > 0                          → FOUND (unchanged; auto-hold as today)
else watch.allowSplitStay and
     (split = splitStaysOf(units, stay, { maxPrice })).length > 0
                                         → SPLIT_FOUND
else watch.allowPartialMatch and partial → PARTIAL_FOUND (unchanged)
else                                     → NOT_FOUND
```
- `recordRun` stores `result: SPLIT_FOUND`, `found: true` (the found count goes up, as for a partial), and the wanted units as `last_availability`; the units carry any reported `splitStay`.
- The alert is `notifyWatchSplitFound(watch, withSplitStayLinks(…split))`.
- `notifyOnly` pauses the watch after a split alert, as after a partial alert (SQ2).
- **Auto-hold never runs** for a split stay: no night guard reservation and no `holds.create`. Turning auto-hold on for such a watch is allowed: it acts on whole-stay matches only. The split alert adds "WA Stay doesn't hold these automatically." when the watch has `autoHold`.
- `WatchExecutionResult.splitStays` is set, and `matches` is `[]`.
- A check whose watch was edited meanwhile keeps nothing, as today.

**Read (`present`).** `Watch.splitStays` comes from `lastAvailability`, quietly, like `bookingLinkOf`: only for `SPLIT_FOUND`, only when `coversStayNights`, using `wantedUnits` and `maxPrice`, with links when the provider is registered. A row it cannot read gives none and never fails the read. `bookingLink` is absent for `SPLIT_FOUND`, since the block carries the links instead. Moving a watch to another place forgets its last check (`forgetLastCheck`), split result included.

**Kinds.** A watch with no units named at a place of several kinds (`kindsAmbiguous`) can find split stays of more than one kind. Each stays within its kind, and the alert names the best. Nothing is held either way.

### 5.7 The place page (`catalog.checkLocation`)

`LocationCatalogService.checkLocation` answers `LocationCheck`. It caches the provider's `LocationAvailability` as today, and on every return adds `splitStays: withSplitStayLinks(provider, externalId, stay, splitStaysOf(units, arrival, departure), { quiet: false })`. That is pure and cheap, and RAC's links read the member flag at that moment. It adds no request and no deadline change.

### 5.8 Explore

- `deriveAvailability` gains the state `{ state: 'split'; kinds: UnitKind[] }`. When the counts that answer (`chosenCounts`) have 0 available and the entry, or a chosen kind in `byKind`, has `splitStay`, the state is `split`. `kinds` are the counted kinds with a split, else the counted kinds. A place with any unit free stays `available`, so a split never hides availability.
- `RANK`: `available` 0, `split` 1, `full` 2, `none-open` 3, and the rest move down one. `sortByAvailability` keeps the given order within the group.
- Label (`availabilityLabel`): pill "Free if you move", card "Free if you move {sites}", tone `neutral`.
- `MUTED_STATES` (`map/layers.ts`) gains `'split'`: the sand pill, muted text and muted pin of "None free". The text carries the state, as the layer doc requires.
- `COUNTED` (`ExplorePage.tsx`) gains `split`, for the noun. The "N available for {range}" note does not count it.
- "Available only" hides it. The empty state reads: "Places that are full, free only if you move, or not open for these dates are hidden."
- The map key's muted entry reads "None free, not open, or only if you move".
- ParkStay places never get the state (§2), and read "None free" as today.

### 5.9 Notifications and email

`NotificationService.notifyWatchSplitFound(watch, splitStays, note?)`:
- **Type** `WATCH_FOUND`, as a partial alert. The stored title has no provider prefix; the desktop title is `{shortName} · {title}`.
- **No `bookingUrl` in the dispatch**, so a desktop click opens the watch only (the person reads the parts first). The email gets `splitStay` with the contact link, or each part's label and link. `notify` checks every URL against the provider's manifest (`checkedBookingLink`, applied to each) and drops the rest. The links are never stored in `notifications` or the delivery log, and logs name only origins.
- **Noun:** `nounFor(watch, units of the split stay)`, from the parts' units, else the reporting unit, else the watch's stay types, else the provider's default.
- **Email** (`email-smtp.notifier.ts`): after the message, a "How to book" block. For `contact`, one coral button "Contact {place}". For `separate`, an ordered list, one line per part ("CAMPSITE 03, Tue 10 Nov, 1 night"), each with a "Book on {shortName}" text link, https only and escaped. The text email gets the same as plain lines. The subject rule is unchanged.

## 6. Copy

`{site}`/`{sites}` is the noun from `unitNounFrom` (`src/shared/utils/unit-noun.ts`): "site", "cabin" or "spot". There is never a literal "site" in the core, components or unit features (`unit-noun-guard`). `{place}` is the location's name, `{shortName}` the provider's, `{range}` is `stayRangeLabel` ("6–9 Nov"), and dates in alerts use `formatCalendarDate`, as the other alerts do. The voice is the design language's: plain and calm, never "available" without the qualifier.

| Surface | Text |
| --- | --- |
| Explore pill | `Free if you move` |
| Explore card | `Free if you move {sites}` |
| Explore map key (muted) | `None free, not open, or only if you move` |
| Explore empty state, "Available only" | `Places that are full, free only if you move, or not open for these dates are hidden.` |
| Night grid note, a unit with `splitStay` | `Free every night, but not on one {site} for the whole stay.` (other split units keep "Free on some nights, but not on one {site} for the whole stay.") |
| Place / watch block heading (h3) | `Free if you move {sites}` |
| Block intro | `No {site} is free for all {n} nights, but every night is free if you move between {sites}. It takes more than one booking.` |
| Item heading, reported | `{unitName}` (e.g. "Powered Site") |
| Item heading, derived | `Across {units} {sites}` |
| `contact` body | `{place} can book this for you as separate stays.` then link `Contact {place}` (opens in the browser), with `Copy {label}` beside it while a copyable detail is saved (`CopyCredentialButton`) |
| `separate` body | ordered list: `{unitName} · {range} · {k} night(s){ · price}` each with link `Book {range} on {shortName}`; then `Book each part on {shortName}: {p} bookings in all.` |
| Price, when known | `About {total} for the {n} nights` |
| Watch form checkbox | label `Alert on stays that move between {sites}`; description `Also tell me when every night is free, but not on one {site}. You'd move during your stay, and book more than once or through the place.` With holds offered: ` WA Stay never holds these automatically.` |
| Review "Alert me" / summary "Alerts" | adds `; also when it's free only if you move {sites}` |
| Watch result pill (`statusPresets.watchResult.split_found`) | tone `warning`, icon `ArrowLeftRight`, label `Free if you move` |
| Watch card result line | `Free across {units} {sites}`, else `Free if you move {sites}` |
| Check now toast | the result line + ` at {place}` |
| Alert title | `Free if you move {sites} at {place}` |
| Alert message, `contact` | `Every night from {arrival} - {departure} is free at {place} ({unitNames}), but not on one {site}. Contact {place} to book it as separate stays.` |
| Alert message, `separate` | `Free across {units} {sites} at {place} for {arrival} - {departure}: {unit1} for {k1} night(s), then {unit2} for {k2} night(s). Book each part on {shortName}.` (the first 4 parts, then `, and {m} more`) |
| Alert note, `autoHold` | `WA Stay doesn't hold these automatically.` |
| Email button / lines | `Contact {place}`; `Book on {shortName}` per part |

`{unitNames}` lists up to three reporting units' names, joined with commas and "and" (RAC's categories).

## 7. When a provider can't tell

| Case | Shows |
| --- | --- |
| RAC: where the moves fall, how many sites | "Free if you move {sites}" with no count, the contact link, and the price when a tariff counts |
| RAC: no tariff counts | Nothing new; the night grid shows `split` nights as today |
| RAC park not in the seed (cannot happen today) | "Contact {place}" without a link |
| ParkStay on Explore | "None free", as today; the place page and watches can find the split |
| ParkStay class with a misaligned breakdown | Nothing (no `splitStay`); nights as today |
| A provider whose units carry `freeCount` and report nothing | Nothing anywhere |
| One unit at a place, or a one-night stay | Nothing (a split needs two parts) |

## 8. Edge cases

- **Minimum stays on parts.** Derived parts meet each unit's rules: a 1-night part where the night's `minNights` (else the unit's) is 2 does not fit, and `fewestParts` finds another cover or none. The unit's own `minNights` is about the asked arrival, so applying it to a later part is conservative. RAC can't split, so its parts' rules are the staff's; RAC reports a split only when the whole stay meets its rules (`min-stay` comes first). ParkStay has no minimums.
- **`min-stay` nights** (refused for the asked stay, for example as too long) never count toward a part: the provider refused them for the asked stay, and a shorter one is unknown.
- **No-arrival and no-departure at a move.** A part may not depart on a morning its unit marks `noDeparture`, and the next may not arrive on a night its unit marks `noArrival`. `meetsStayRules` checks both, so the cover moves the boundary or gives none.
- **Mixed kinds.** Each kind separately, never across. A named cabin and a named site never make one split stay. Explore's noun is from the kinds that have a split.
- **Named units vs any unit.** With `unitIds`, only those units, reported or derived. A split stay using an unnamed unit is not offered. A reported split on a named category counts. With `unitKinds`, only those kinds.
- **Split plus partial runs.** Split wins, and both stay visible in the grid. With split off, partial behaves as today.
- **Price rule.** Per night, per part, and only when every night of the part has a price, as for partial runs. RAC's split nights now carry prices, so a maximum applies to them.
- **Price shown.** Summed per part when known; "about" always; none when any night lacks one.
- **A part reuses a unit** (A, then B, then A). That is three bookings across two sites: "Across 2 sites", with three parts listed.
- **Many moves.** No limit (SQ1). The count and the parts are always shown.
- **The stay is edited.** The derived `splitStays` vanish until the next check (`coversStayNights`), as `bookingLink` does.
- **The member number changes** (RAC). The availability cache drops (existing), and the next check decides afresh; the contact link carries no number.
- **The provider stops being registered.** The watch's `splitStays` come with no links; the copy names the place.
- **Old rows.** `last_availability` without `splitStay` derives as today (ParkStay sites only); an old watch reads `allowSplitStay: false`.
- **Explore with a stay type.** The chosen kinds' `byKind.splitStay` decides; a chosen kind the provider doesn't count reads "Check dates", as today.
- **A one-night stay.** No split, ever.
- **Site Sniper.** Unchanged: `freeForStay` never takes a split unit (D5).

## 9. Tests

Each task keeps the full gate green: `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`, then `npm run build:e2e && xvfb-run -a npm run test:e2e`. No test, lint rule or threshold is weakened. An expectation that encodes the old behaviour on purpose (RAC split nights without a price) is updated in the same commit, and the commit says so.

**Shared and core (SS1)**
- `src/shared/utils/split-parts.test.ts`: no cover → undefined; one row covering → one part; greedy-furthest beaten by the DP when a `fits` rule bites; ties → longest parts, then earliest row, then earliest boundary; 30 × 300 completes.
- `tests/unit/core/split-stays.test.ts`:
  - two sites (A nights 1–2, B 3–5) → two parts, `units` 2, links per part;
  - three options → fewest parts;
  - never across kinds;
  - `freeCount` units never derived from;
  - a kind with a free unit → no derived split, but a reported one is still listed;
  - `min-stay` and `split` nights don't count;
  - `noArrival` and `noDeparture` move the boundary or leave no split;
  - a `minNights` too long for a part;
  - the price rule per part, with unpriced nights passing;
  - totals;
  - a valid report → a `SplitStay` with its unit; invalid reports (fully available, a booked night, parts with a gap or overlap, `units` 1) ignored;
  - order;
  - the contact link: contact, else location, else none, with off-site links refused and logged by origin;
  - a `links` that throws.
- `tests/unit/core/watch-matching.test.ts`: `isFreeNight` and `nightAfter` exports keep their behaviour (existing tests unedited).
- `tests/unit/core/watch.service.test.ts`, a new `describe('split stays')`:
  - off → unchanged (NOT_FOUND or PARTIAL_FOUND);
  - on: FOUND beats split, split beats partial, SPLIT_FOUND recorded with `found` true;
  - `notifyWatchSplitFound` called with linked split stays;
  - `holds.create` never called with `autoHold`, and the note added;
  - `notifyOnly` pauses;
  - `splitStays` derived on `get`, `list` and `watch:updated` only for SPLIT_FOUND and the stay's nights, quietly;
  - `bookingLink` absent;
  - toggling the option reschedules;
  - an edit during the check keeps nothing.
- Repository and migration: `allow_split_stay` round trip; v13 upgrade tests from the v5 and v6 fixtures (`tests/fixtures/db/`) and from v12 (the column is 0, data intact, `foreign_key_check` clean); the latest-version assertions bumped.
- IPC: `watches.create` and `watches.update` accept `allowSplitStay` and refuse a non-boolean (`VALIDATION`), through the IPC harness; `catalog.checkLocation` answers `splitStays`. The contract `assertTypeEquals` covers the schema.
- Notifications: `tests/unit/core/notifications/`: title and message for `contact` (one and three categories) and `separate` (2 and 6 parts); nouns "sites", "cabins", "spots"; no `bookingUrl` on the desktop path (the click opens the watch only); an off-site link dropped. The email notifier renders the contact button, the part lines and links, HTML-escaped and https only, in HTML and text. `tests/unit/core/unit-noun-messages.test.ts` gains the split messages.
- `tests/integration/two-providers.test.ts`: a fake provider (extended to report `splitStay` and `links.contact`) gives a watch SPLIT_FOUND, while ParkStay's watch is unaffected.
- `tests/integration/credentials-leak.test.ts` and `rac-member-number.test.ts` still pass, with a split alert in their paths (no number in the contact link, alert or email).

**Providers and contract suite (SS2)**
- `tests/utils/provider-contract.ts`: `splitStayViolations`, `bulkSplitViolations`, `links.contact`. Self-tests in `tests/integration/provider-contract.test.ts`, one bad sample per rule.
- RAC, `tests/integration/rac-availability.test.ts`:
  - a split verdict with a counting tariff → `splitStay: { booking: 'contact' }`, prices kept, `freeCount` 0, no `total`;
  - no counting tariff → no `splitStay`, no price;
  - min-stay precedence → no `splitStay`.

  The existing split test's expectation gains the prices, an intended change.
- RAC, `tests/unit/providers/rac/free-count.test.ts`: `parkEntry` sets `splitStay` per park and per kind only at 0 free, and not when another category is free.
- RAC links: `contact` for all eight parks and null for an unknown one. `rac-fixtures` and `rac-endpoints-doc` guards pass.
- ParkStay, `tests/unit/providers/parkstay/site-classes.test.ts`: Lucky Bay's recording gives `splitStay: { booking: 'separate', parts: 6–7, 7–8, 8–9 Nov }`; no `splitStay` while a site is free for the whole stay (`luckyBayView(330)`); no `splitStay` when a night has no free site.
- `tests/integration/catalog.test.ts` (or `tests/unit/core/catalog/location-catalog.service.test.ts`): `checkLocation` on ParkStay with an edited site view (CAMPSITE 03 free night 1, CAMPSITE 04 free night 2) answers a derived split with ParkStay search-page links per part; on RAC, the contact link.
- The contract suites of both providers pass with the new checks.

**Renderer (SS3)**
- `deriveAvailability.test.ts`: the split state (top level and `byKind`, with stay types), `RANK` order, the label, and "Available only" excluding it.
- `layers.test.ts`: `split` is muted.
- `components/SplitStays.test.tsx`:
  - `contact` with and without a link;
  - `separate` with links and unique accessible names;
  - an unknown count;
  - the price;
  - `CopyCredentialButton` shown only with a saved detail;
  - roles and names only.
- `nightGridModel.test.ts`: the new note for units with `splitStay`.
- `PlaceDetailPage.test.tsx`: the block appears under the grid only when `splitStays` is non-empty, its h3 is announced, and it never says "available".
- Watches:
  - the checkbox in create and Edit, with mapping both ways (`watchFormMapping.test.ts`);
  - ReviewStep and WatchSummary lines;
  - WatchCard result line and pill (the `statusPresets` enum-coverage test);
  - WatchAvailability: the block instead of "Book on", and the grid showing every row;
  - `runResultMessage`;
  - `tests/integration/renderer/create-watch-flow.test.tsx` sends `allowSplitStay: true` when ticked.
- Guards: `unit-noun-guard`, `token-guard` (`components/SplitStays` added to `SCAN_FILE_PREFIXES`), `api-boundary`.
- Accessibility:
  - the block is a `section` with an h3;
  - parts are an `ol`;
  - every link's accessible name is unique and says where it goes;
  - the pill text carries the state, not only its colour;
  - the new copy meets AA with existing tokens.

**E2E (SS4)**: `tests/e2e/split-stays.spec.ts`, two journeys, network-free, no request refused.
1. **RAC, contact.** `writeDatedFixtures`, then edit the copy's Busselton answer so every category free on every night has `stay_through_sites_available` 0 and code 3, and none is free for the stay. Then:
   - with ParkStay and RAC and dates set, Busselton's card reads "Free if you move …", after the places with something free and before "None free";
   - its page shows "Free if you move sites", the "Powered Site" item, and "Contact RAC Busselton Holiday Park" with href `https://parksandresorts.rac.com.au/busselton/contact-us/` (never followed);
   - a prefilled watch with "Alert on stays that move between sites" ticked, after Check now, shows the "Free if you move" pill, the same block and link, and the bell has "Free if you move sites at RAC Busselton Holiday Park".
2. **ParkStay, separate.** Edit the copy's `campsite_availablity_view_20.json`: CAMPSITE 03 free on night 1 only, CAMPSITE 04 on night 2 only, CAMPSITE 05 on neither. The place page's Check availability shows "Free if you move sites", "Across 2 sites", two parts, and "Book {range} on ParkStay" links whose hrefs carry each part's `arrival` and `departure` (`YYYY/MM/DD`).

Existing journeys keep passing unchanged: their fixtures have no split, which the SS4 task checks before relying on it.

## 10. Docs and website (SS4, plus each task's own CLAUDE.md lines)

- **architecture-notes §12.36 "Split stays"** (SS1): the binding summary of §4–§5 (types, `links.contact`, derivation scope and order, precedence, v13, the IPC response type, no auto-hold, Site Sniper out of scope).
- **CLAUDE.md:**
  - migrations: v13 and "currently 13";
  - Provider SDK: `splitStay`, `links.contact`, the contract suite's new checks;
  - Key Services: a WatchService sentence, a "Split stays" row for `src/main/core/split-stays.ts` and `src/shared/utils/split-parts.ts`, the RAC row (contact split stays, kept prices, `links.contact`), the ParkStay row (class split stays), the NotificationService row (split alerts open the watch only);
  - Notification System: booking links, split alerts;
  - IPC table: `allowSplitStay`, `splitStays`, `LocationCheck`;
  - UI Status: Explore's "Free if you move";
  - Testing: journeys "31 journeys in 18 specs".
- **`docs/providers/adding-a-provider.md`:**
  - Availability: a "Split stays (optional)" bullet, in prose with no code block (the guide's blocks must equal source regions): when to set `splitStay`, `booking`, `parts` and `units`, what the core derives across one-place units (and never across `freeCount` units), and `links.contact`;
  - Links and dispose: `contact`;
  - the contract-suite table: the `links` and `availability` rows.

  No internal references (`provider-guide.test.ts`).
- **`docs/providers/rac/README.md`**: the Split stays bullet (contact the park, prices, why there are no parts or count), the Explore paragraph, the links. **`endpoints.md`**: the contact-us row.
- **`docs/providers/parkstay/README.md` and `endpoints.md`**: class split stays (parts, booked as class bookings); site-listed campgrounds derived by the core; bulk can't tell.
- **`docs/watches-and-notifications.md`**:
  - the Alerts option;
  - "What a check does": split stays and precedence;
  - Results;
  - Notifications: the split alert, the click opening the watch, the email's "How to book";
  - The booking link: split alerts carry the contact or part links.
- **`docs/site-sniper.md`**: one line, Site Sniper never takes a split stay. **`docs/design/map.md`**: the muted states and the key. **`docs/architecture/overview.md`**: v13 in the table, "brings the copy to v13". **`tests/README.md`, `docs/development.md`**: journey counts and the new spec.
- **CHANGELOG `[Unreleased]` → Added:** "**Split stays**: when every night is free but only by moving between sites, Explore says 'Free if you move' (RAC parks), a place's page explains how to book it (contact the park, or book each part on ParkStay), and a watch can alert on it if you ask (off by default). Never counted as free, and never held automatically."
- **Website (`site/index.html`, "Booked out? Set a watch")**: add one provider-neutral sentence, because the alert's click claim changes for this case: "Ask it to, and it also tells you when every night is free but only if you move between sites, with how to book that." No other section's claim changes, since Explore's "what's free for your whole stay" stays true. No screenshot changes.

## 11. Tasks

| ID | Task | Size | Depends on |
| --- | --- | --- | --- |
| SS1 | Model, core, migration, IPC and alerts | L | — |
| SS2 | Providers and contract suite | M | SS1 |
| SS3 | Renderer and copy | M | SS1 (SS2 for real data; mocks suffice) |
| SS4 | E2E, docs and website | M | SS2, SS3 |

SS2 and SS3 can run side by side: SS2 touches only `src/main/providers/`, `tests/utils/provider-contract.ts` and provider tests; SS3 only `src/renderer/`.

### SS1: Model, core, migration, IPC and alerts

**Files:**
- `src/shared/types/provider.types.ts` (§4.1), `watch.types.ts`, `common.types.ts` (`SPLIT_FOUND`), `notifier.types.ts`;
- `src/shared/contracts/watches.ts`, `catalog.ts` (response type);
- `src/shared/utils/split-parts.ts` (new);
- `src/main/providers/sdk/provider.ts` (`links.contact`);
- `src/main/core/split-stays.ts` (new), `core/watches/matching.ts` (exports), `watch.service.ts`, `core/catalog/location-catalog.service.ts`;
- `core/notifications/notification.service.ts`, `notifiers/email-smtp.notifier.ts`;
- `src/main/database/connection.ts` (v13), `repositories/watch.repository.ts`;
- `src/renderer/components/ui/statusPresets.ts` (the `SPLIT_FOUND` preset, which type-check requires) and `src/renderer/api/catalog.ts` (the `LocationCheck` type only);
- `tests/utils/fake-provider.ts` (report `splitStay`, `links.contact`), fixtures (`tests/fixtures/watches.ts`, `tests/fixtures/renderer/watches.ts`: `allowSplitStay: false`);
- architecture-notes §12.36; CLAUDE.md lines for these.

**Done when:**
- §9 SS1's tests pass;
- with the option off, every existing watch test passes unedited;
- no request is added to any check;
- the gate is green.

### SS2: Providers and contract suite

**Files:**
- `src/main/providers/rac/mapping.ts`, `bulk.ts`, `links.ts`;
- `src/main/providers/parkstay/availability.ts`, `site-classes.ts`;
- `tests/utils/provider-contract.ts`, `tests/integration/provider-contract.test.ts`;
- RAC and ParkStay tests (§9);
- `docs/providers/rac/endpoints.md` (the contact row, which the endpoints doc test reads);
- CLAUDE.md's RAC and ParkStay rows.

Fixtures: edited variants inside tests (as `rac-availability.test.ts` already does with `edited(…)`), no new recorded file. If a recorded RAC answer is wanted for the stakeholder's own case, one anonymous POST for Busselton, 1–6 Jul 2027, trimmed by the fixture rules, with `_fixture` saying where and when. That is optional and needs no cart.

**Done when:**
- RAC's split categories report `contact` with prices;
- RAC's bulk flags 0-free parks and kinds;
- ParkStay's Lucky Bay reports three parts;
- both providers' contract suites pass with the new checks, and the self-tests fail on bad samples;
- the `rac-fixtures`, `no-checkout`, `no-live-cart` and `rac-endpoints-doc` guards pass;
- the gate is green.

### SS3: Renderer and copy

**Files:**
- `src/renderer/components/SplitStays.tsx` (+ test), `nightGridModel.ts`;
- `features/place/AvailabilitySection.tsx`;
- `features/explore/availability/deriveAvailability.ts`, `map/layers.ts`, `ExplorePage.tsx`, `results/ResultsList.tsx`, and the map key;
- `features/watches/form/WatchAlertFields.tsx`, `watchFormSchema.ts`, `watchFormMapping.ts`, `create/steps/ReviewStep.tsx`, `detail/WatchSummary.tsx`, `detail/WatchAvailability.tsx`, `shared/resultSummary.ts`;
- `statusPresets.ts` (final label and icon);
- `tests/unit/design/token-guard.test.ts` (scan prefix);
- CLAUDE.md UI Status.

**Done when:**
- every §6 string is in place, with nouns;
- tests assert roles and names only;
- the AA and token guards pass;
- with no split anywhere, every existing renderer test passes unedited;
- the gate is green.

### SS4: E2E, docs and website

**Files:**
- `tests/e2e/split-stays.spec.ts` (and a small `support/` helper to edit a dated fixture copy, if the two journeys share it);
- the docs in §10;
- `site/index.html`;
- `CHANGELOG.md`;
- `tests/README.md`, `docs/development.md`;
- CLAUDE.md's Testing line.

**Done when:**
- both journeys pass on the built app, with no request refused and no link followed;
- the docs tests pass (links, backticked paths, guide regions, no internal references);
- `site.test.ts` passes, and the page reads true against the feature;
- the full gate is green, e2e included;
- no live hold, booking, payment or cart.

## 12. Questions for the stakeholder

- **SQ1. How many moves is too many?** A stay free only by moving every night (for example 5 sites for 5 nights) is still a split stay. **Recommendation:** no limit; every view says how many bookings it takes, and the person decides. The alternative is a cap, for example at most one move or no one-night parts, which could hide the RAC case the stakeholder found (3 sites for 5 nights).
- **SQ2. Should a split-stay alert pause a watch set to "Stop watching after the first alert"** (the default)? **Recommendation:** yes, as a partial alert does, so the person isn't alerted every check. "Resume" keeps looking for a stay on one site. The alternative, keep watching after a split alert, would repeat that alert at every check until a one-site stay turns up.

## 13. Assumptions and risks

- RAC's staff book a split stay the way the stakeholder's email describes (separate bookings), at RAC's nightly rates. The copy promises neither a booking nor a price, only "about" and "can book".
- RAC tariffs succeed while no site is free for the stay. This rests on one recorded category (Busselton's Ensuite Site, 6–8 Nov 2026) and the stakeholder's screen. If a split answer ever comes with no counting tariff, nothing new shows (§5.1), which is safe.
- ParkStay's class bookings of a part succeed when a site of the class is free for it, as `create_booking`'s code says (`utils.py:186-202`). WA Stay never places them; the person books on ParkStay.
- Derivation relies on what partial matching already relies on: a run of `available` nights on an entry with no `freeCount` is one booking on one place.
