# RAC Parks & Resorts: SDK, core and renderer gaps

_2026-10-16, on `4bd5d62` (v2.0.0). Research only: no code was changed._

**Question:** what do the provider SDK, the core services and the renderer already support for an
RAC Parks & Resorts provider (NewBook holiday parks: sites and cabins), and what is the smallest
set of changes for the stakeholder's six requirements? Rottnest Island (villas, cottages, lodges,
hotel rooms, camping) follows soon, so the proposals must suit it too.

## Summary

- An RAC provider with watches (notify only) needs **no SDK, core or renderer change**. RAC's
  categories ("Powered site", "2 bedroom chalet") map to units the way ParkStay's site classes do
  (`class:<id>`). `accessGate: false` is fully supported.
- A rolling booking window (arrival minus 364 days, at a daily time) is **provider-only**: RAC
  writes its own `ReleasePolicy` behind the generic `daily_rollover` mode id.
- Member early access is **provider-only in a clunky form** (stay fields for the number and a
  toggle). Doing it well needs the declared-but-unbuilt `credentials` sign-in, so the member number
  is stored once in the provider's secret vault (M).
- The **accommodation-type filter is the main gap**. Today there is one location `kind` per place
  and a free-text `unitType` per unit. Nothing says "this place has cabins and sites". It needs a
  small shared enum, a v11 migration (three `ADD COLUMN`s), a catalogue filter and an Explore chip.
- Smaller gaps: minimum stays (no night reason), member vs public price (one price per night),
  "site" copy hard-coded in core and renderer, an unconditional DBCA one-booking-per-night rule,
  and snipe release-mode ids locked to ParkStay's three by the IPC contract.
- Biggest risk: the **no-live-holds rule** (§12.33) plus closed-source NewBook. A hold or checkout
  response cannot be recorded without placing a real hold. Ship RAC watches first; add holds and
  snipes after the stakeholder captures a genuine booking of their own.

## A. Requirements 1–6

| # | Requirement | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | RAC like ParkStay, irrelevant parts off | Supported as-is (provider-only) | Every capability is a manifest flag (`provider.types.ts:75-93`); the registry ties flags to modules (`registry.ts:85-109`, `151-258`). ParkStay's own flags: `parkstay/index.ts:57-71`. |
| 2 | Watches that notify, optional auto-hold | Notify: provider-only. Auto-hold: provider-only holds, but blocked in practice by §12.33 (F) | `WatchService.execute` is generic: one `availability.check`, then `wantedUnits`, `fullMatches`, `partialMatches` (`watch.service.ts:275-292`); auto-hold uses `provider.holds` (`watch.service.ts:426-498`). |
| 3 | Snipes on a rolling window; member early access | Rolling window: provider-only. Early access: provider-only with stay fields, SDK/core change to do it properly (C, D) | Release time is entirely the provider's `computeReleaseAt` (`sdk/provider.ts:175-198`); ParkStay's rollover is `arrival − max_advance` at the campground's time (`release-policy.ts:175-181`). |
| 4 | Accommodation-type filter across providers | **Needs SDK + core + renderer + DB migration** (B) | Location has one `kind` (`catalog.types.ts:26`); units have free-text `unitType` (`catalog.types.ts:45`); Explore's "Type" chip filters location kind (`facets.ts:15-21,43`; `FilterRow.tsx:46-53`). |
| 5 | Availability per category | Supported with provider-only code (E) | ParkStay already shows a class as one unit `class:<id>` and holds it as a class (`site-classes.ts:24-26,40-45`; `holds.ts:115-128`); `HoldRequest.unitGroupId` exists (`sdk/provider.ts:200-206`). |
| 6 | Member vs public price, min stay, max guests | Max guests: supported. Price: partly (one price per night). Min stay: needs SDK + core (G) | `UnitSummary.minPeople/maxPeople` (`catalog.types.ts:46-48`); `NightStatus.price` only (`provider.types.ts:259-267`); `NightReason = 'split'` only (`provider.types.ts:257`). |

## B. Location and unit taxonomy

**Today.**

- `LocationKind` (`provider.types.ts:28-49`) is one value per place: `campground`, `caravan-park`,
  `holiday-park`, `cabin`, `hut`, `glamping`, `farm-stay`, `home`, `other`. It names the place,
  not what you can sleep in. ParkStay sets `campground` for every campground it books and guesses
  the rest from the name (`parkstay/catalog.ts:135-144,226`).
- The manifest's `locationKinds` (`provider.types.ts:212`) is only used for the unit noun
  (`watchState.ts:53-55`, `snipeState.ts:179-181`: the first kind).
- A unit (`UnitSummary`, `catalog.types.ts:42-54`) has free-text `unitType` (ParkStay: the site
  class name), `equipment` (ParkStay: tent/campervan/caravan flags), `minPeople`, `maxPeople`.
- The `locations` table has `kind TEXT` and `amenities JSON` (`connection.ts:792-822`). Facets
  count `l.kind` (`location.repository.ts:104-107,365`).
- Explore filters client-side over `LocationSummary` items (`facets.ts:37-51`). The UnitPicker
  groups units by `unitType` text (`UnitPicker.tsx:37-47`).
- So there is **no notion of accommodation type**. A holiday park with sites and chalets is one
  `holiday-park`, and its unit noun is "site" (`locationFormat.ts:26-36`).

**Proposal: `UnitKind`**, a parallel to `LocationKind` (vocabulary §2: a unit is the bookable
thing). Coarse, so a person can say "camping" or "a roof":

```ts
// shared/types/provider.types.ts
export type UnitKind = 'campsite' | 'cabin' | 'room' | 'dorm' | 'glamping' | 'other';
```

| `UnitKind` | Covers | ParkStay | RAC | Rottnest |
| --- | --- | --- | --- | --- |
| `campsite` | tent, caravan, campervan, camper-trailer sites, powered or not, ensuite sites | every campsite and site class | powered, unpowered, ensuite sites | the campground |
| `cabin` | self-contained cabin, chalet, cottage, villa, bungalow, park home, apartment | type-2 places named cabin/cottage/chalet | cabins, chalets, villas, studios | villas, cottages |
| `room` | hotel, motel or lodge room, suite | — | resort rooms, if any | Hotel Rottnest, lodge rooms |
| `dorm` | a bed or bunk in a shared room or hut | huts (Yeagarup Hut) | bunkhouse, if any | Kingstown Barracks |
| `glamping` | safari, eco or bell tents | eco retreats (by name) | glamping tents | Discovery Rottnest |
| `other` | anything else | — | — | — |

"Camping vs other accommodation" is then `campsite` vs the rest. Finer camping detail (tent,
caravan, campervan) already has a home in `UnitSummary.equipment`; a `powered?: boolean` can
come later.

**Where it lives.**

1. **Unit:** `UnitSummary.unitKind?` and `UnitAvailability.unitKind?`. No migration: units live
   in the `detail` JSON cache and in `watches.last_availability` JSON.
2. **Location:** `LocationSummary.unitKinds: UnitKind[]` (multi-valued, like `amenities`). The
   provider sets it; when it does not, the core derives it from `kind` (campground and
   caravan-park → `campsite`; holiday-park → `campsite`, `cabin`; cabin → `cabin`; hut → `dorm`;
   glamping → `glamping`; others → `[]`). Existing and scaffolded providers keep working.
3. **Manifest:** optional `unitKinds?: UnitKind[]`, what the provider offers. It lets the
   provider step say which providers have cabins. Not required.
4. **Catalogue:** `CatalogQuery.unitKinds?` (any of), a `json_each` filter and a facet, as
   `amenities` has (`location.repository.ts:370-377`). FTS is not needed.

**How each feature uses it.**

- **Explore:** a "Stay type" chip (Campsites, Cabins & villas, Rooms, Dorms & bunks, Glamping),
  OR within the chip like the others. It should **replace** the location-kind "Type" chip
  (`FilterRow.tsx:46-53`): people choose what they sleep in, not what the place is called. The
  choice goes into the create-flow prefill (`?kinds=campsite`).
- **Watches and snipes:** `unitKinds: UnitKind[]` (empty means any). The core applies it in
  `wantedUnits` (`matching.ts:24-35`) and in the snipe's unit choice (`snipe.service.ts:447`).
  The stay step shows the kinds as chips above the UnitPicker, which groups by kind first.
  Without it, a snipe or auto-hold that may take "any unit" at a mixed park could hold a dorm bed
  or a three-bedroom villa (I.5).
- **Unit noun:** "site" when every unit is a campsite, "cabin" when every unit is a cabin, else
  "place" or "unit". This replaces `unitNoun(kind)` and `unitNounFor(manifest)`.

**ParkStay mapping (provider-only).** Units: `campsite` when a site's `gearType` allows tent,
campervan or caravan (`site-classes.ts:62-82`), else by class or site name (cabin, hut, eco
tent). Locations: the map's `campsites[]` carry the same gear flags, so `listLocations` can set
`['campsite']` for every bookable campground; type-2 places map from `kindFromName`.

**Migration v11** (rules in CLAUDE.md "Adding a new migration"): one step, three
`ALTER TABLE … ADD COLUMN … JSON NOT NULL DEFAULT '[]'` on `locations` (`unit_kinds`), `watches`
and `site_snipes` (`unit_kinds`). No rebuild is needed; v2, v5 and v9 also added columns. Bump
`LATEST_SCHEMA_VERSION` to 11 (`connection.ts:24`) and add upgrade tests from the v5 and v6
fixtures. `locations` is a cache: read an empty `unit_kinds` as the kind-derived default until
the next 24 h sync refills it, so no forced re-sync is needed.

## C. Release modes

**Today.**

- The manifest lists `releaseModes: ReleaseModeDescriptor[]` with `id`, `label`, `description`,
  `usesAccessGate` and optional `fields` (`provider.types.ts:173-181`). The registry requires at
  least one when `snipes` is on, and `release.supports()` must accept each (`registry.ts:93-99`,
  `217-232`).
- `ReleasePolicy` (`sdk/provider.ts:188-198`): `computeReleaseAt({ mode, externalId, stay,
  params, requestedAt, now })`, `describe`, optional `suggestScheduledAt`, and `pollFloorMs`.
- ParkStay: `daily_rollover` = `arrival − max_advance_booking` days at the campground's own
  release time, read from the availability view (`release-policy.ts:175-181`); `scheduled` = the
  time the person enters (`:167-174`); `cancellation` = `null`, poll continuously (`:165-166`).
- The core keys behaviour off **three fixed ids**: continuous when `cancellation`
  (`snipe.service.ts:318,746`), refresh the instant when `daily_rollover`
  (`snipe.service.ts:350`; `snipe-runner.ts:300`), "release before check-in" when `scheduled`
  (`snipe.service.ts:736-744`). So does the renderer (`useReleasePreview.ts:11-12`;
  `snipeForm.ts:141,156`; `snipeState.ts:167`; `SnipeSummary.tsx:48`).
- The IPC contract accepts only those three: `z.enum(SnipeReleaseMode)`
  (`contracts/snipes.ts:31,40`), and `SiteSnipe.releaseMode` is the enum
  (`site-sniper.types.ts:25,64`). The DB column has had no CHECK since v8.
- `ReleaseModeDescriptor.fields` is declared but **never rendered**; `computeReleaseAt` gets the
  stay params as `params` (`snipe.service.ts:723`). `suggestScheduledAt` is **not wired** to any
  IPC or UI (only ParkStay implements it, `release-policy.ts:209-211`).

**Can RAC be expressed?**

- **Rolling 364-day window at a daily time:** yes, provider-only. RAC declares `daily_rollover`
  with its own label ("When new dates open") and computes `arrival − 364 days` at its release
  time, Perth. Its `availability.check` marks nights past the horizon `not-released` and sets
  `release.opensAt`, which the snipe form's preview reads (`useReleasePreview.ts:39-46`). The
  runner re-asks the instant at arm time, so a changed rule is picked up.
- **School-holiday block releases:** `scheduled` works today if the person enters the time. If
  RAC publishes the dates, RAC's `daily_rollover` policy can return the block's release instant
  for stays inside it. The id then means "the provider works it out", which is a naming wart, not
  a blocker.
- **Member early access (48 h earlier for members, school holidays):** provider-only today with
  a boolean stay field (`memberEarlyAccess`, `appliesTo: ['snipe']`). `computeReleaseAt` and
  `availability.check` subtract 48 h when it is on, a member number is known (D) and the arrival
  is in a school-holiday release. The toggle shows on the stay step, not the release step.
  RAC must also keep a school-holiday calendar (maintenance).

**What to add (optional, S–M):**

1. `ReleaseModeDescriptor.timing: 'computed' | 'scheduled' | 'continuous'`. Core and renderer
   test `timing` instead of the three ids. ParkStay's modes map one to one.
2. Accept any declared mode id in the snipe contract (`z.string()`; `SiteSnipeService.prepare`
   already checks `release.supports`, `snipe.service.ts:699-705`). RAC could then declare
   `member_early_access` ("When RAC members' early access opens") as a computed mode. No
   migration.
3. Render `ReleaseModeDescriptor.fields` under the chosen mode in `ReleaseStep.tsx`, so a
   mode-specific toggle sits with the mode.
4. A `snipes.previewRelease` IPC that calls `computeReleaseAt` (and `suggestScheduledAt`) for the
   chosen mode, so the preview is right for any mode, not just the one `availability.check`
   reports.

## D. Member number

**Today.**

- `ProviderAuthKind` is `browser-session | credentials | automation` (`provider.types.ts:131`).
  `CredentialsAuth` has `fields: AccountFieldDescriptor[]` (with a `secret` flag) and
  `signIn(values, http)` (`sdk/provider.ts:292-301`). The registry validates it
  (`registry.ts:138-142`).
- The account service implements **only** `browser-session`; anything else is
  `NOT_IMPLEMENTED` (`provider-account.service.ts:351-362`).
- The renderer cannot see account fields: `providers.list` returns manifests
  (`contracts/providers.ts:30`), and `auth` is not in the manifest. `ProviderAccount` has no
  fields (`provider.types.ts:342-352`). Settings → Accounts only has Connect (a sign-in window),
  sign out and a pasted sign-in link (`AccountsSection.tsx`, `AccountRow.tsx`).
- Providers already have encrypted storage: `ctx.secrets` (`context.ts:49-50`;
  `sdk/secrets.ts`), sealed per provider and key.

**Options.**

| Option | Change | For | Against |
| --- | --- | --- | --- |
| Stay field `memberNumber` (text, pattern) | none | works today for watches, snipes and holds | plain text in every row's `stay_params`; retyped per watch and snipe; Explore and the place page send no stay params, so no member prices there; shown in summaries |
| **`credentials` auth** (recommended) | SDK + core + IPC + renderer, M | entered once in Settings → Accounts; encrypted; every module (availability, release, holds) reads it, so member prices show everywhere | new IPC method and form |
| `browser-session` (myRAC sign-in) | none | if RAC grants early access to a signed-in website account, this already works | only if RAC works that way (the other agent is confirming) |

**Minimal `credentials` change.**

1. `ProviderAccount` gains `authKind` and `fields?: AccountFieldDescriptor[]`, plus
   `savedFields?: string[]` (keys with a stored value; never the value).
2. New write-only IPC `accounts.saveCredentials({ providerId, values })`, like the SMTP password.
   Channel, contract, handler and preload, so the parity tests agree.
3. `ProviderAccountService` stores each value in the provider's `ScopedSecretVault` as
   `account.<key>` (the registry exposes it, like `httpOf`), calls `auth.signIn(values, http)`
   to check the format (or verify it with RAC), stores the status, and deletes the values on
   sign-out.
4. RAC reads `await ctx.secrets.get('account.memberNumber')` wherever it needs it.
5. Settings → Accounts renders the fields generically (password-style when `secret`), with
   wording such as "Add your RAC member number". Account `optional`, so nothing waits on it.

Logs must never carry the number (CLAUDE.md "Secrets"). RAC's member terms should be checked
before an app stores the number.

## E. Category-level inventory

- Watches and snipes target units by `unit_ids` JSON (`watch.types.ts:21`,
  `site-sniper.types.ts:22`); empty means any unit.
- Matching picks wanted units by id, name or alias (`matching.ts:24-35`), then needs every night
  `available` on one unit (`:71-82`). A category is one unit: "available" on a night means at
  least one of its units is free. This copes.
- If NewBook's free units differ by night inside a category, RAC marks the gap nights
  `unknown` + `reason: 'split'`, as ParkStay does for classes (`availability.ts:150-170`).
- **NightGuard** reserves nights per provider and user, not units (`night-guard.ts:69-94`), so
  categories do not matter to it.
- **UnitPicker** groups by `unitType` and lists one-unit-per-type locations flat
  (`UnitPicker.tsx:37-47`). RAC sets `unitType` to a group ("Cabins", "Powered sites"), so the
  picker offers "All Cabins (5)".
- **Holds:** RAC posts the category, as ParkStay posts `campsite_class` for `class:<id>`
  (`holds.ts:115-128`). `HoldSuccess.unitId` may be the assigned site.
- Gaps (optional, S): no free count per category (`UnitAvailability.freeCount?` would show "3
  left"); Explore's bulk counts read "2 of 5 sites" (`deriveAvailability.ts:136-160`), so RAC
  should count physical units, not categories.

## F. Holds

- `HoldsModule` (`sdk/provider.ts:226-240`): `create(request)` → `{ ok, reference, expiresAt,
  unitId? }` or a `HoldFailure` reason (`taken`, `in-progress`, `auth-required`, `closed`,
  `invalid`, `error`); `paymentUrl(hold)`; `paymentOrigins`; optional `bookedReference(hold,
  page)` that reads the confirmation page's URL and text (`PaymentPage`, `:243-251`).
- The payment window runs on the provider's partition, the same cookies as `ctx.http`
  (`hold-payment.service.ts:1-35`). One payment window per provider.
- **A NewBook cart with an expiry fits.** Reference = the cart or booking id; `expiresAt` = the
  cart timer; `paymentUrl` = the checkout page (encode the cart token in the reference or keep it
  in `ctx.state`); `paymentOrigins` = RAC's booking host (card frames are subframes and are not
  restricted); `bookedReference` = the confirmation URL plus the booking number on the page.
- **The blocker is not the model.** §12.33 forbids any live hold, and NewBook is closed source
  (ParkStay's holds were built from DBCA's public source). Recording a hold, cart or confirmation
  response means placing a real hold. Ship RAC with `holds: false` and `snipes: false`, and add
  them after the stakeholder records their own genuine booking (§12.33 allows real holds "only in
  the stakeholder's own manual checklist, with genuine intent").

## G. Pricing, minimum stays, guests

- **Price:** one `price` per night (`provider.types.ts:259-267`), `total` per unit
  (`:269-283`), one currency per provider (`:216`). `maxPrice` compares per night
  (`matching.ts:38-50`). Member vs public: RAC returns the price that applies (member when a
  number is stored) and says so in `label`. Add `UnitAvailability.priceNote?` ("RAC member rate")
  so the place page and notifications can say which (S). No tax or fees model (noted in
  `provider-dx-review.md`).
- **Minimum stay:** not modelled. `NightReason` is only `'split'` (`provider.types.ts:257`). A
  provider can only fake it as `closed` nights with a label; the night grid then reads "taken"
  (`nightGridModel.ts:52-58`), and partial matches shorter than the minimum are still offered
  (`matching.ts:89-129`). Add `NightReason 'min-stay'`, `UnitAvailability.minNights?` and
  `UnitSummary.minNights?`; drop partial runs shorter than `minNights`; explain it in the night
  grid and warn in the watch and snipe stay steps (S–M).
- **Max guests:** supported. `UnitSummary.minPeople/maxPeople` (`catalog.types.ts:46-48`); the
  snipe stay step warns when the party exceeds the chosen units (`snipes/create/steps/
  StayStep.tsx:11-18,51`). RAC's availability request takes the party, so full units drop out.

## H. Access gate

Optional per provider, and nothing assumes the DBCA queue:

- Flag and rules: `capabilities.accessGate` (`provider.types.ts:90-91`); a mode with
  `usesAccessGate` needs the flag (`registry.ts:100-108`); the flag needs `access`
  (`registry.ts:233-239`).
- Core: a snipe uses the gate only when asked, the flag is on and the mode uses it
  (`snipe.service.ts:676-682`); watches never queue (`watch.service.ts:336`); payment passes the
  gate only "for a provider with an access gate" (`hold-payment.service.ts:10-13`).
- Renderer: the queue toggle, summary line, Explore and place-page messages and the tray chip are
  all behind the flag (`snipeFormMapping.ts:45-46,82-85`; `SnipeSummary.tsx:78`;
  `ExplorePage.tsx:641,667`; `placeModel.ts:188`; `AccessStatusChip.tsx:140`).
- If RAC turns out to run a waiting room at peak releases (Queue-it or similar), the SDK supports
  it, but there is no shared gate helper (ParkStay's queue is its own code).

## I. Other things a second provider trips on

1. **Unit noun from the location kind.** `unitNoun(kind)` (`locationFormat.ts:26-42`) and
   `unitNounFor(manifest)` (first `locationKinds`) say "site" for a holiday park's chalets.
2. **"Site" copy in core and flows:** notification title "Sites available at …" and "Found N
   sites" (`notification.service.ts:162,171`); "cannot hold sites automatically"
   (`watch.service.ts:435`); "This snipe already holds a site" (`snipe.service.ts:241`); "When are
   the sites released?" (`ReleaseStep.tsx:55`); "Whose sites to snipe" (`ProviderStep.tsx:17-18`).
3. **Explore's "Type" chip filters location kind**, and appears as soon as a second kind exists:
   ParkStay's campgrounds plus RAC's holiday parks would show "Campground / Holiday park", which
   is not the stakeholder's filter.
4. **Bulk counts are per place, not per unit kind** (`provider.types.ts:302-315`). With a
   "Cabins" filter, "8 available" may be eight campsites. Optional fix:
   `BulkAvailabilityEntry.byKind?` and Explore reads the chosen kinds (M).
5. **"Any unit" holds the first free unit.** Snipes take `units.find(fullyAvailable)`
   (`snipe.service.ts:447,508`); auto-hold takes `full[0]` (`watch.service.ts:303-305`). At a
   mixed park that can be the wrong kind. With unit kinds (B), require a kind or a unit for a
   snipe or auto-hold at a mixed location.
6. **NightGuard is unconditional** (`night-guard.ts:1-17`). One booking per night is DBCA's rule.
   RAC may allow a family two cabins on the same nights. Add a manifest rule
   (`holdRules.onePerNight`, default true) (S).
7. **Explore and the place page send no stay params** (`explore/availability/stay.ts:28-45`;
   CLAUDE.md "Adding a provider" rules). RAC's availability must work without a member number and
   answer public prices then, unless the number comes from the account (D).
8. **Snipe mode ids** (C): RAC must reuse ParkStay's three ids until the contract changes.
9. **`LocationKind` lacks resort and hotel** for Rottnest (Hotel Rottnest, Karma, Samphire). Add
   `resort` and `hotel` with labels and nouns (S). The DB `kind` column has no CHECK.
10. **Per-night data.** If NewBook answers "available for the whole stay" without nights, RAC must
    build nights itself; partial matches and the night grid get weaker.
11. **Website and docs:** a providers row in `site/index.html` and `--provider-rac` once it
    ships; `docs/providers/README.md:13` already lists RAC as planned.

Not found: no ParkStay id, name or URL is hard-coded in core, IPC or the scheduler. Renderer
mentions are comments and the dev-only design gallery.

## Proposed changes

Ranked by what the stakeholder needs first. "Provider-only" means `src/main/providers/rac/`, its
tests and fixtures, plus the registration line.

| # | Change | Layer | Size | Why |
| --- | --- | --- | --- | --- |
| 1 | RAC module: manifest (`accessGate: false`, `account: 'optional'`, `catalogMode: 'full'`, `holds`/`snipes` off at first), catalogue, categories as units (`cat:<id>`, `unitType` group), per-night availability with prices and party, bulk counts of physical units, links, conservative limits | provider-only | L | Req 1, 2, 5. Watches with no other change |
| 2 | `UnitKind` enum; `UnitSummary.unitKind?`, `UnitAvailability.unitKind?`, `LocationSummary.unitKinds`, manifest `unitKinds?`; kind-derived default | SDK (shared types) | S | Req 4 |
| 3 | v11: `ADD COLUMN unit_kinds JSON NOT NULL DEFAULT '[]'` on `locations`, `watches`, `site_snipes`; upgrade tests from v5 and v6 | DB migration | S | Req 4 |
| 4 | Catalogue stores and reads `unit_kinds`; `CatalogQuery.unitKinds` filter and facet | core | S–M | Req 4 |
| 5 | Explore "Stay type" chip over `unitKinds`, replacing the location-kind "Type" chip; URL param; prefill into create flows | renderer | M | Req 4 |
| 6 | Watch and snipe `unitKinds` filter: input, contract, repository, `wantedUnits` and snipe unit choice; stay-step chips; UnitPicker grouped by kind; require a kind or unit for snipes and auto-hold at mixed places | core + IPC + renderer | M | Req 2, 3, 4; I.5 |
| 7 | ParkStay sets unit kinds (gear flags, names) and location kinds | provider-only | S | Req 4 |
| 8 | Unit noun from unit kinds; replace hard-coded "site" copy | core + renderer | S | I.1, I.2 |
| 9 | Minimum stay: `NightReason 'min-stay'`, `minNights?` on units; matching drops short partial runs; night grid and forms explain | SDK + core + renderer | S–M | Req 6 |
| 10 | `credentials` auth: fields on `ProviderAccount`, write-only `accounts.saveCredentials`, values in the provider's secret vault, Settings → Accounts form | SDK + core + IPC + renderer | M | Req 3 (member number), member prices |
| 11 | `UnitAvailability.priceNote?` (member rate) | SDK + renderer | S | Req 6 |
| 12 | `holdRules.onePerNight` in the manifest (default true) | SDK + core | S | I.6 |
| 13 | Release modes: `timing` on descriptors, any declared id in the snipe contract, render mode `fields`, `snipes.previewRelease` | SDK + core + IPC + renderer | S–M | Req 3 (optional; cleaner member-early mode) |
| 14 | `BulkAvailabilityEntry.byKind?` and Explore counts for chosen kinds | SDK + core + renderer | M | Req 4 (optional polish) |
| 15 | `UnitAvailability.freeCount?` ("3 left") | SDK + renderer | S | Req 5 (optional) |
| 16 | `LocationKind` adds `resort`, `hotel` | SDK + renderer | S | Rottnest |
| 17 | RAC holds and snipes (rolling window via `daily_rollover`, early access via stay field or #10/#13), after a stakeholder-recorded genuine booking | provider-only | M | Req 2 auto-hold, Req 3 |
| 18 | Website providers row, brand colour, copy; providers README | site + docs | S | CLAUDE.md "Website" |

**Smallest path to the stakeholder's top priority (watches):** #1 alone. **To the type filter:**
#2–#5 and #7–#8. **To member early-access snipes:** #10, #17 (and #13 for a clean mode).

## Risks

- **No live holds (§12.33) and closed-source NewBook.** Hold, cart and confirmation responses
  cannot be recorded or verified without a real hold. Holds, auto-hold and snipes for RAC wait
  for a stakeholder-recorded genuine booking.
- **Terms of use.** RAC's or NewBook's terms may forbid automated access (checklist step 1). If
  so, RAC gets links only, and none of the above applies.
- **Bot protection.** A CDN challenge on RAC's booking host would push RAC to browser
  automation (`integration: 'browser'`), which fixture mode does not serve in the app preview.
- **Early-access rules are unconfirmed** (member number vs a myRAC sign-in; rolling vs block
  release; the 364 days). D and C each have a path for both; pick after the RAC research.
- **School-holiday calendar** must be kept current inside the RAC module.
- **Member number privacy.** Encrypted at rest with #10; check RAC's member terms.
- **Migration v11** touches three tables; it must pass the v5 and v6 upgrade tests and
  `test:tz`. Read-time defaults avoid a forced re-sync.
- **Replacing the "Type" chip** changes Explore's filters: unit tests, e2e journeys (role and
  name selectors), docs screenshots, the website screenshots and copy all move with it.
- **ParkStay unit kinds are heuristics.** A wrong kind hides a place from a filter; default to
  `campsite` for every bookable campground.
- **Generalising release-mode ids** touches every comparison listed in C; ParkStay snipe
  regressions are possible (lower impact while Site Sniper is "Soon").
- **NightGuard default** must stay on for ParkStay; only a provider that declares otherwise
  relaxes it.
- **Rate limits.** RAC's tolerance is unknown; start with a long `minWatchIntervalMinutes` and
  low `maxConcurrentRequests` (no core backoff for HTTP 429 exists).
