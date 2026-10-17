# RAC: master plan

**Stream:** rac · **Label:** `stream:rac` · **Lanes:** S (shared types, core, IPC), U (renderer), P (RAC module), D (docs) · **Status:** ⬜ not started

## Goal

RAC Parks & Resorts becomes WA Stay's second provider (brief, Project 2), together with a provider-neutral **stay type**. When the stream is done:

- Explore shows the eight open RAC parks beside ParkStay, with free counts, prices and a night-by-night place page.
- RAC watches alert on a freed site or cabin (desktop and email). One click opens RAC's prefilled booking page (R1).
- RAC snipes are release **alerts**. They start at the release instant (rolling 364 days, or a school-holiday release, 48 h earlier for members) and poll gently for a bounded window (R3).
- One "Stay type" filter (Camping, Cabins & villas, Rooms, Dorms, Glamping) works in Explore, watches and snipes, for ParkStay and RAC (R4).
- A person can save, replace and remove their own RAC member number. It is encrypted, write-only over IPC, and never logged or sent (R5, RO4).
- Auto-cart exists behind an experimental switch that ships off. It is tested on fixtures and fakes only (R2, §12.33).
- Every terms rule that applies to what ships is enforced, with a test where testable. Docs and the website describe RAC.

## Task list

| ID | Task | Size | Depends on | Status |
|---|---|---|---|---|
| R1 (#48) | [Stay-type foundation](tasks/R1-stay-type-foundation.md): `UnitKind` and its five groups; `unitKind` on units, `unitKinds` on locations, `byKind` on bulk entries; v11 (add columns); catalogue filter and facet; ParkStay maps its units and places | M | — | ✅ |
| R2 (#49) | [Polite request pacing](tasks/R2-polite-request-pacing.md): `limits.minRequestIntervalMs`, a paced `HttpClient` (one in flight, priority for checks), catalogue deadlines that scale with it, unpaced fixture mode, fixture routes that match form fields | M | R1 | ⬜ |
| R3 (#50) | [Stay-type criteria for watches and snipes](tasks/R3-stay-type-criteria-core.md): `unitKinds` on watches and snipes (types, contracts, repositories); `wantedUnits` and the snipe's unit choice apply it; no automatic hold of "any unit" across mixed kinds | M | R1 | ⬜ |
| R4 (#51) | [Explore "Stay type" chip](tasks/R4-explore-stay-type-chip.md): replaces "Type"; `stay` URL param; facet counts; prefill `&stay=` into create flows; free counts follow the chosen types (`byKind`, else "Check dates" at mixed places) | M | R1 | ⬜ |
| R5 (#52) | [RAC catalogue on Explore](tasks/R5-rac-catalogue.md): scaffold (`npm run provider:new -- rac --api --name "RAC Parks & Resorts"`), manifest and limits, seed of eight parks, place detail with categories as units, links, the RAC client (host allow-list, headers, block cool-down), trimmed fixtures and their guard | M | R2 | ⬜ |
| R6 (#53) | [Stay type in watch and snipe flows](tasks/R6-stay-type-in-flows.md): stay-type chips on the stay steps, UnitPicker grouped by kind, Explore's prefill, a kind or unit required to hold at a mixed place | M | R3, R4 | ⬜ |
| R7 (#54) | [Alerts that open the booking page](tasks/R7-alerts-open-booking-page.md): `UnitAvailability.bookingUrl`; a watch alert carries the matched stay's link; desktop click opens it in the browser and the watch in the app; "Book on {shortName}" in emails and on the watch page | M | R2 | ⬜ |
| R8 (#55) | [Minimum stays and rate notes](tasks/R8-minimum-stays-rate-notes.md): `min-stay` night reason, `minNights`, `noArrival`/`noDeparture`, `priceNote`; matching drops runs the provider would refuse; night grid and stay steps explain | M | R3, R7 | ⬜ |
| R9 (#56) | [Unit nouns from stay types](tasks/R9-unit-nouns.md): one noun helper from unit kinds ("site", "cabin", "spot" for mixed kinds); no hard-coded "site" in notifications, services or flows | M | R6, R7, R8 | ⬜ |
| R10 (#57) | [RAC availability, prices and watches](tasks/R10-rac-availability-watches.md): `availability.check` per category (codes, stay-through count, tariffs, refusals, min stays, prices, booking links, never a cart URL, `online_booking_url` verified with at most 3 anonymous GETs), native parks' units, the `pets` stay field, `watches` on, an RAC watch e2e journey | M | R5, R6, R7, R8 | ⬜ |
| R11 (#58) | [RAC free counts on Explore](tasks/R11-rac-free-counts.md): bulk `availability.search` (one paced POST per park), free units with no total ("27 spots free", `bookableUnits` optional), `byKind`, e2e fixtures, the `PREVIEW_PROVIDER=rac` preview passing | M | R4, R9, R10 | ⬜ |
| R12 (#59) | [Release-alert snipes: core](tasks/R12-alert-snipes-core.md): `snipes` without `holds` (registry), per-snipe `action` and `alert`, plus `hold_expires_estimated` for R18 (v12), `ALERTED`, alert notification with the booking link, `maxWindowMinutes`, a 403/429 ends the snipe; creates architecture-notes §12.35 | L | R3, R7, R8, R9 | ⬜ |
| R13 (#60) | [Release-alert snipes: Site Sniper screens](tasks/R13-alert-snipes-screens.md): "Alert me" or "Hold it" choice, alerted state with "Book on {shortName}", window cap in Advanced timing | M | R12 | ⬜ |
| R14 (#61) | [RAC release policy and snipes](tasks/R14-rac-release-policy.md): `daily_rollover` (rolling instant or school-holiday release, member-aware) and `scheduled`; dated release calendar; `release.opensAt`; poll floor 10 s, window 30 min; `snipes` on; fake-clock tests | M | R10, R12 | ⬜ |
| R15 (#62) | [Credentials accounts](tasks/R15-credentials-accounts.md): the `credentials` sign-in kind; `accounts.saveCredentials` (write-only, with confirmations), `accounts.copyCredential` (main writes the clipboard); values in the provider's secret vault; a generic Settings → Accounts form | M | R12 | ⬜ |
| R16 (#63) | [RAC member number and member rates](tasks/R16-rac-member-number.md): RAC's `credentials` auth (`account: 'optional'`); members-only tariffs and pre-sale instants only with a saved number; member price with its note; copy button by "Book on RAC" | M | R11, R13, R14, R15 | ⬜ |
| R17 (#64) | [Experimental provider switches](tasks/R17-experimental-switches.md): `manifest.experiments`; state in `provider_state`; applied at registration; `providers.experiments` and `providers.setExperiment`; "Experimental" switch on the provider's Accounts row, after a restart | M | R15 | ⬜ |
| R18 (#65) | [Hold release hooks](tasks/R18-hold-release-hooks.md): `HoldsModule.release` (`released` or `gone`), `releaseOnPaymentClose`, `holdRelease`, `HoldSuccess.expiresAtEstimated`; the provider decides when the payment window closes or the person declines ("Let it go", `releaseHold`); holds at interactive pace | M | R12, R17 | ⬜ |
| R19 (#66) | [RAC auto-cart, off by default](tasks/R19-rac-auto-cart.md): the `autoCart` experiment turns on `holds`; cart from `online_cart_url` on the provider's partition, payment window, one cart at a time, release, synthetic fixtures from RAC's page code; no live cart | M | R13, R16, R18 | ⬜ |
| R20 (#67) | [Docs, website and release notes](tasks/R20-docs-website.md): `docs/providers/rac/` (README, endpoints with verification status, calendar upkeep), providers README, feature and security docs, CLAUDE.md, CHANGELOG, site row, colour and copy, screenshots; final gate | M | all | ⬜ |

Every task keeps the full gate green (CLAUDE.md "Adding a provider" step 6) and updates the CLAUDE.md lines its change makes stale (for example the migration list in R1 and R12, the IPC table in R15 and R17). No task weakens a test, a lint rule or a coverage threshold.

## Recommended order and lanes

`src/shared/types/provider.types.ts` and `src/main/providers/sdk/provider.ts` are the hot spots. Every task that edits them is in Lane S, in order, except R11's one optional field in `BulkAvailabilityEntry` (after R9, beside R12). `connection.ts` changes in R1 (v11) and R12 (v12) only. Explore's filter bar changes in R4 only.

- **Lane S (shared types, core, IPC):** R1 → R2 → R7 → R8 → R12 → R15 → R17 → R18. R3 runs beside R2 (its own files).
- **Lane U (renderer):** R4 (after R1) → R6 (after R3) → R9 (after R7, R8) → R13 (after R12).
- **Lane P (`src/main/providers/rac/`, its tests and fixtures):** R5 (after R2) → R10 (after R6, R7, R8) → R11 (after R4, R9) → R14 (after R12) → R16 (after R13, R15) → R19 (after R13, R17, R18).
- **Lane D:** R20 last.

Parallel windows: {R2, R3, R4}; {R5, R6, R7}; {R9, R10}; {R11, R12}; {R13, R14, R15}; {R16, R17}. R15 could also run beside R12 if the reviewer accepts a two-line merge in `provider.types.ts`; that shortens the critical path (R1 → R2 → R7 → R8 → R9 → R12 → R15 → R17 → R18 → R19 → R20). R12 (L) is the longest task on it.

Vertical slices: after R5 the parks are on the map; after R10 RAC watches work end to end; after R11 Explore shows RAC free counts; after R14 RAC release alerts work; after R16 member timing and prices work; R19 adds the switched-off cart.

## Design decisions

1. **Auto-cart shipped off (R2).** A manifest may declare `experiments` (id, label, description, the capabilities it turns on). The on/off state is kept main-side in `provider_state` (`('<id>', 'core.experiments')`). `registerBuiltInProviders` applies the enabled ones before the registry validates and freezes the manifest (`registry.ts:322-327,350`). Capability flags drive the UI, so the UI stays honest. The change takes effect after a restart. *Reason:* the manifest is frozen and read by the renderer, so a runtime gate would show options that then fail. RAC declares `autoCart`, which turns on `holds`. Its factory builds the holds module only when `ctx.manifest.capabilities.holds` is on (`context.ts:84-89`), so with the switch off no code path can reach a cart. The switch is on RAC's row in Settings → Accounts, under "Experimental", with a confirm dialog and "Takes effect when WA Stay restarts" (R17). Turning it off is refused while an RAC hold is unexpired. **The hold:** one GET of the chosen tariff's `online_cart_url` on `ctx.http`, the partition the payment window shares (`hold-payment.service.ts:1-9`). The payment URL is the park's `/booking/` cart page, and `paymentOrigins` is RAC's host. **Expiry:** the cart page's own countdown when it shows one (`earliest_hold_expires_when`). Otherwise a 10-minute estimate, flagged `expiresAtEstimated` so the copy says "about" (stored in v12's `hold_expires_estimated`, added by R12 and used by R18). Hold requests (`holds.create`, `holds.release`) run at interactive pace: the core sets the priority (R18). There is no `bookedReference` until the stakeholder's genuine booking shows the confirmation page (RQ2).
2. **Release-alert snipes (R3).** A snipe cannot run without holds today. `snipes` needs `holds` in both rule sets (`registry.ts:86-91,208-215`), `plan()` drops a provider without `snipes` (`snipe.service.ts:316`), and `execute` always ends in `holds.create` (`:447-516`). The minimal core change (R12):
   - `snipes` needs `availability` and a release policy; `holds` becomes optional. This amends §12.30.
   - A per-snipe `action: 'alert' | 'hold'` (v12: `site_snipes.action TEXT NOT NULL DEFAULT 'hold'`, plus `site_snipes.alert` JSON for what R13 shows, and `hold_expires_estimated INTEGER NOT NULL DEFAULT 0` on `watches` and `site_snipes` for R18), so every ParkStay snipe keeps holding. `hold` is refused for a provider without holds. A `hold` snipe whose provider lost holds (switch off) alerts instead, with a note.
   - On a match, an `alert` snipe notifies with the matched unit's booking link (R7) and ends `ALERTED`. It reserves no night.
   - The alert opens RAC's `online_booking_url` (no cart) or the prefilled book-now page (`links.booking`).
   - **Cadence:** RAC's `pollFloorMs.window` is 10 000 ms; the core already clamps to it (`snipe.service.ts:318-321,747`). A new `ReleaseModeDescriptor.maxWindowMinutes` (RAC: 30) clamps `windowDurationMs` (`:327`).
   - RAC declares no `cancellation` mode; watches cover cancellations at 15 minutes or more.
   - A 403, a 429 or a challenge ends the snipe FAILED and shows why. Today a 429 is retryable (`errors.ts:96-107`), so a snipe would poll on.
3. **Release modes.** RAC reuses the existing ids. *Reason:* no contract change; rac-sdk-gaps #13 waits.
   - `daily_rollover` ("When these dates open"): the later of two instants.
     - The rolling instant: 00:00 Australia/Perth on the day the stay's last night comes within 364 days. That day is departure − 365 days.
     - Any school-holiday release covering a night: the park's own time (7, 8 or 9 am Perth), 48 h earlier when a member number is saved and the park and category take part. Cable Beach and Margaret River dorms do not take part.
     - The core re-asks the instant at arm time (`snipe-runner.ts:300-307`), so a saved number or a calendar update is picked up.
   - `scheduled`: a time the person sets, for releases the calendar does not know (Cable Beach seasonal releases).
   - The calendar lives in `providers/rac/release-calendar.ts`. It holds announced periods with their pre-sale and public dates, plus WA school-holiday dates for 2027–2028.
   - A stay in a holiday period with no announced release is refused with a clear message (VALIDATION on `releaseAt`): "set a watch, or pick a time".
   - `availability.check` sets `release.opensAt` from the same policy for nights beyond the window (code 9).
4. **Stay type (R4).**
   - **Taxonomy:** `UnitKind = 'campsite' | 'cabin' | 'room' | 'dorm' | 'glamping' | 'other'`. Groups: Camping, Cabins & villas, Rooms, Dorms, Glamping; `other` never shows as a filter option. It suits Rottnest: villas → cabin, hotel → room, barracks → dorm.
   - **Where it lives:** `UnitSummary.unitKind?` and `UnitAvailability.unitKind?` (JSON, no column). `LocationSummary.unitKinds?`, which the catalogue always fills, derived from `kind` when a provider leaves it out (campground → campsite; holiday-park → campsite, cabin; hut → dorm…). Everything is optional, so the scaffold and the example providers still compile.
   - **v11:** three `ADD COLUMN … unit_kinds JSON NOT NULL DEFAULT '[]'` (`locations`, `watches`, `site_snipes`), tables listed in `applyMigration`, upgrade tests from v5 and v6. An empty cached row reads as the derived default until the next sync.
   - **Catalogue:** `CatalogQuery.unitKinds` (any of) and a facet, like `amenities`.
   - **Explore:** the "Stay type" chip replaces "Type" (`FilterRow.tsx:46-53`, `facets.ts:15-21`). It filters `unitKinds` client-side, as Explore filters today, and is hidden when the catalogue has one kind.
   - **Watches and snipes:** `unitKinds` filters `wantedUnits` (`matching.ts:24-35`) and the snipe's unit choice (`snipe.service.ts:447`). A unit without a kind counts as `other`, and `other` counts as a distinct kind when deciding whether a place is mixed (R3, R6). An automatic hold never takes "any unit" across several kinds: it alerts with a note instead.
   - **UnitPicker** groups by kind, then by `unitType` (`UnitPicker.tsx:36-43`).
   - **ParkStay:** gear-flagged sites → campsite; huts → dorm; cabins and cottages → cabin; eco tents → glamping. Every bookable campground → `['campsite']`.
   - **Free counts:** must not mislead. `BulkAvailabilityEntry.byKind?` gives counts per kind. Explore sums the chosen kinds; a mixed place without `byKind` reads "Check dates". A provider with no unit total (RAC) leaves `bookableUnits` out, and Explore reads "{n} free" instead of "N of M" (RS12, R11).
5. **Member number (R5, RO4).** Implement the declared `credentials` kind minimally (R15). *Reason:* it is already declared and validated (`sdk/provider.ts:292`, `registry.ts:138-142`), and only the service refuses it (`provider-account.service.ts:351-365`); a stay field would put the number in plain `stay_params`.
   - `CredentialsAuth` gains `confirmations?` (statements the person ticks). `ProviderAccount` gains `authKind`, `fields`, `confirmations` and `savedFields` (key names only).
   - `accounts.saveCredentials({ providerId, values, confirmed })` stores each value in the provider's `ScopedSecretVault` as `account.<key>` (via `registry.secretsOf`), after `auth.signIn` checks it. RAC's check is local format only: no request.
   - Saving again replaces the number; `accounts.signOut` removes it. Removing is never refused (no `ACCOUNT_BUSY`) and never clears the provider's session partition. `accounts.copyCredential` lets main write the clipboard, so the copy button never sends the value to the renderer.
   - The provider learns membership as a boolean: whether `ctx.secrets.get('account.memberNumber')` is set.
   - Never logged, never returned and never sent: each is a test (R15, R16).
6. **Minimum stays and member rates (RO6).** One M task (R8).
   - SDK: `NightReason` adds `min-stay` (`provider.types.ts:257`); `minNights?` on units; `noArrival`/`noDeparture` on nights; `UnitAvailability.priceNote?`.
   - Core: matching drops partial runs shorter than `minNights` or starting or ending on a refused day (`matching.ts:89-129`).
   - Renderer: the night grid explains the minimum, the stay steps warn, and the place page shows the price note.
   - RAC's refusals (tariff codes 2–11, stay-through codes) are never `fullyAvailable` (R10).
7. **Catalogue sourcing (terms rule 2).** No request per sync.
   - `listLocations` returns a seed in `providers/rac/parks.ts`: the eight parks' slug, `blog_id`, name, region, address, lat/lng, unit kinds, release time and pre-sale role. These are facts.
   - `getLocation` makes one request per park, cached by the core for 6 h. Widget parks: the book-now page (categories, guests, pets, equipment, photos, short descriptions, shown in-app only). Native parks: one availability POST for a near short stay.
   - Availability: one POST per park per stay. Bulk: eight POSTs, cached 5 min (core) and 15 min (renderer).
   - The core paces all of it at 10 s, one at a time (R2). Catalogue and availability deadlines grow with that spacing: today 60 s and 20 s (`location-catalog.service.ts:208-210`), too short for eight paced POSTs.
   - Fixture mode is unpaced, and fixture routes can match form fields (`fixture-http-client.ts:41-48` matches path and query only), so e2e tests and the preview stay fast.
8. **Copy and nouns.** R9 replaces `unitNoun(kind)` and `unitNounFor(manifest)` (`locationFormat.ts:26-42`, `snipeState.ts:179-181`, 38 call sites) with one helper over unit kinds. It also removes "Sites available at …", "Found N sites" (`notification.service.ts:162,171`) and the other hard-coded "site" copy in core and flows (rac-sdk-gaps I.1, I.2). Mixed kinds read "spot" / "spots" ("A spot is free at …", "27 spots free"), never "place", which is Explore's word for a location.
9. **Terms rules.** See the table below.
10. **Website and docs.** R20 updates `docs/providers/rac/` (README, endpoints with verification status, calendar upkeep), the providers README row, the watches, Site Sniper and security docs, CLAUDE.md, CHANGELOG `[Unreleased]` and the website:
    - an RAC row with `data-provider="rac"`, the manifest name and monogram;
    - `--provider-rac` and its badge rule;
    - copy for one-click alerts and the member number;
    - "Soon" labels unchanged.

    Screenshots move with R4's chip (`docs:screenshots`; `site:screenshots` needs a Mapbox token) and show no RAC photos. R11 makes `PREVIEW_PROVIDER=rac` pass. R20 runs it with the full gate.

Also decided:
- Booking links open in the system browser, as the place page's do today. Only R19's cart uses the in-app payment window.
- A booking link must be https on the provider's own site. The core checks only that (R7); refusing cart URLs is the provider's job (RAC's client refuses them; R10 and R19 test it).
- R10 verifies RAC's `online_booking_url` (the `/booking/?available_from=…&force_category_id=…` form, never `?cart&rest_api_data_id=`) with at most 3 anonymous, read-only GETs. If it does not show the stay without a cart, R5's book-now prefill link is used instead.
- A held alert's desktop click opens the watch only, not the booking page (R7).
- RAC's badge is a plain "RAC" text monogram in an original colour from the app's tokens (not a logo). RAC's parks use Explore's existing region names (R5).
- Website: R4, R7 and R13 update the sentences their changes make stale; R20 refines the copy and retakes screenshots rather than adding them again.
- RAC's client stops for 30 minutes after a challenge, 403 or 429. Requests fail fast with the same typed error and send nothing.

## Contract additions

All additive and optional unless marked. R12 creates architecture-notes §12.35, with one bullet for R1–R9's items and one for its own. Each later task that adds a contract item (R15, R17, R18, R19) appends its own bullet.

| Addition | Task | Reason |
|---|---|---|
| `UnitKind`, `unitKind` on units, `LocationSummary.unitKinds`, `BulkAvailabilityEntry.byKind`, `CatalogQuery.unitKinds` + facet; v11; `src/shared/utils/unit-kinds.ts` (`STAY_TYPES`, `deriveUnitKinds`, `unitKindsOf`) | R1 | R4 stay type |
| `Watch.unitKinds`, `SiteSnipe.unitKinds` (and their inputs) | R3 | Stay type in watches and snipes |
| Explore `stay` param; prefill `&stay=` (amends §12.10) | R4, R6 | Explore → create flows |
| `ProviderLimits.minRequestIntervalMs` (needs `maxConcurrentRequests: 1`); `HttpRequestOptions.priority` and the ambient `withRequestPriority`/`currentRequestPriority` (interactive or background); `pacedDeadlineMs`; fixture route `form` | R2 | Terms rule 2, brief R8; fast fixtures |
| `UnitAvailability.bookingUrl`; `links.booking(externalId, stay?, unitId?)`; `Watch.bookingLink` (derived, never stored); `NotificationMessage.bookingUrl`/`heldInApp`; the contract suite's booking-link check | R7 | R1's one click; brief R6, R7 |
| `NightReason 'min-stay'`; `minNights` per night (`NightStatus`), per unit and stay (`UnitAvailability`) and usual (`UnitSummary.minNights`); `NightStatus.noArrival/noDeparture`; `UnitAvailability.priceNote` | R8 | RO6, member rates |
| `src/shared/utils/unit-noun.ts` (`nounForKinds`; mixed kinds read "spot"); `WatchMatch.unitKind` | R9 | Unit nouns |
| RAC's `pets` stay field (0–2; RAC's manifest, no SDK change) | R10 | Terms rule 16 |
| `BulkAvailabilityEntry.bookableUnits` and `byKind`'s `bookableUnits` become optional (required today): left out when the provider has no unit total, 0 still means none open; Explore reads "{n} free" | R11 | RS12 |
| `snipes` without `holds` (amends §12.30); `SiteSnipe.action` and `SiteSnipe.alert` (v12 columns `action`, `alert`); `hold_expires_estimated` on `watches` and `site_snipes` (v12, used by R18); `SnipeStatus`/`SnipeResult` `ALERTED`; notification type `snipe_alert`; `ReleaseModeDescriptor.maxWindowMinutes`; `ReleaseComputeInput.unitIds/unitKinds`; `isProviderBlock` (a 403 or 429 ends a snipe) | R12 | R3, RO3 |
| `CredentialsAuth.confirmations`; `AccountFieldDescriptor.copyable`; `ProviderAccount.authKind/fields/confirmations/savedFields`; `accounts.saveCredentials`, `accounts.copyCredential` (a main-side `Clipboard` port); `registry.secretsOf`; `ProviderAccountServiceDeps.onCredentialsChanged` | R15 | R5, RO4 |
| `ProviderManifest.experiments`; `providers.experiments`, `providers.setExperiment`; `core.*` keys reserved in `ctx.state`; `ACCOUNT_BUSY` also refuses turning a holds experiment off while a hold is open | R17 | R2 switch |
| `HoldsModule.release` (outcome `released` or `gone`), `HoldsModule.releaseOnPaymentClose`; `HoldSuccess.expiresAtEstimated`; `ProviderManifest.holdRelease`; `watches.releaseHold`, `snipes.releaseHold`; the core runs `holds.create` and `holds.release` at interactive priority | R18 | Terms rule 15 |
| RAC's `autoCart` experiment; RAC's hold-only stay fields `equipmentType`, `equipmentLength`, `equipmentWidth` (`appliesTo: ['hold']`, already in the contract) | R19 | R2 auto-cart |

## Terms rules → task

| # | Rule (`rac-terms.md`) | Enforced by | Test |
|---|---|---|---|
| 1 | Personal use; only RAC's and NewBook's hosts | R5 | The RAC client refuses other hosts; a source guard |
| 2 | 10 s between background requests, one at a time | R2, R5 | Fake clock: no two RAC requests within 10 s |
| 3 | Watches every 15 minutes or more, never faster near a release | R5 (limits), R10 | The interval is clamped for RAC watches |
| 4 | One session | R2, R5 | One `persist:provider-rac` client, one request in flight |
| 5 | No evasion; a block stops the job, is shown, is not retried | R5, R12 | Challenge/403/429 → typed error and cool-down; a snipe ends FAILED |
| 6 | Show facts, link the rest | R5, R10 | Photos and descriptions are fetched live; links to RAC pages |
| 7 | Nothing of RAC's in public artefacts | R5, R20 | Fixture guard (no image URLs or marketing copy); site test |
| 8 | Payment and acceptance are human steps | R19 | Only a GET of `online_cart_url`; a guard: no checkout or card endpoint |
| 9 | Bookings are personal | Not applicable: no transfer or name feature | — |
| 10 | Never cancels or changes a booking | Not applicable: no `bookings` module (R5) | R5 asserts none |
| 11 | Member number: own, one, confirmed | R15, R16 | Save refused without the confirmations |
| 12 | Member number is a secret | R15, R16 | Not in logs, IPC responses or any RAC request |
| 13 | At most two member bookings per period | R19 (NightGuard, RO8) | A second overlapping RAC hold is refused |
| 14 | Pre-sale only for members | R14, R16 | No number: public instant, members-only tariffs not free |
| 15 | Holds: one cart, released, never "secured", no live hold | R18, R19 | Fakes only: release on close and decline, one cart |
| 16 | Respect minimum nights, arrival days, pets, 364 days | R8, R10, R14 | Refusals not free; short runs dropped; pets 0–2 |

## Brief success criteria → task

| # | Delivered by |
|---|---|
| 1 Explore, free counts, place page | R5, R10, R11 |
| 2 RAC watch with categories or stay types; one-click booking page | R3, R6, R7, R8, R10 |
| 3 Release-alert snipes, member-aware, fake-clock tests | R12, R13, R14, R16 |
| 4 Stay type across providers, ParkStay unchanged | R1, R3, R4, R6, R11 |
| 5 Member number saved, replaced, removed; never logged or returned | R15, R16 |
| 6 Auto-cart switched off, fixtures and fakes only | R17, R18, R19 |
| 7 Terms rules enforced | Table above |
| 8 Full gate and RAC preview | Every task; R11, R20 |
| 9 Docs, README, CLAUDE.md, website | R20 (and each task's CLAUDE.md lines) |

## Integration points

1. **ParkStay module:**
   - unit and place kinds and `byKind` (R1);
   - its booking link on alerts (R7);
   - its snipes keep `action: 'hold'` (R12).

   ParkStay's tests must pass unchanged, apart from the "Type" → "Stay type" chip.
2. **SDK guide, scaffold and contract suite:** new fields are optional, so `npm run provider:new` output and `tests/fixtures/providers/example-*` still pass. The guide's credentials and holds sections change in R15 and R18.
3. **E2E harness:** registers only ParkStay unless a launch passes `providers`. RAC journeys (R5, R10, R11, R16, R19) pass `['parkstay', 'rac']`; R10 and R11 share `tests/e2e/support/dated-fixtures.ts`. R4 updates Explore journeys for the new chip.
4. **Notifications and email:** the booking link travels with the alert (R7). The email gets a "Book on {shortName}" link; nothing new is stored.
5. **Settings → Accounts:** the credentials form (R15), RAC's row (R16) and the Experimental switch (R17), in that order.
6. **Research samples:** `ai-state/research/rac-samples/` become trimmed fixtures in R5, R10 and R11. Cart fixtures in R19 are synthetic, from RAC's page code, and labelled so.
7. **Architecture notes:** §12.30 (snipes ⇒ holds), §12.10 (prefill) and the "credentials not implemented" note are amended in §12.35. R12 creates it (with a bullet for R1–R9); R15, R17, R18 and R19 append theirs.

## Out of scope

- Rottnest Island, though the stay types and `LocationKind` must suit it. Adding `resort` and `hotel` is left to that project.
- RAC booking import, NewBook guest sign-in and "manage my booking" (links only).
- Any automated checkout, terms box, payment, cancellation or change on RAC.
- Asking RAC for permission or an API (RQ1).
- Release-mode generalisation (rac-sdk-gaps #13): `timing`, any mode id in the contract, rendered mode `fields`, `snipes.previewRelease`.
- `freeCount` ("3 left"), `holdRules.onePerNight` (RO8 keeps NightGuard), cross-provider dedupe, grouping the place page by stay type.
- Ningaloo and Rose Gardens (RO7). Cable Beach's monthly seasonal releases use `scheduled`.
- Any live cart, hold or booking, and any live verification of R19 (stakeholder only, RQ2).

## Open questions

| # | Question | Proposed default | Blocks |
|---|---|---|---|
| RS1 | Should every user see the Experimental auto-cart switch, or only a developer build? | **Decided 2026-10-16:** shown to everyone in Settings → Accounts → RAC row under "Experimental", off by default, with a warning and a confirm dialog; takes effect after a restart. | R17 |
| RS2 | Rule 2 makes Explore's RAC free counts take about 1.5 minutes after dates are chosen. | **Decided 2026-10-16 (brief R8):** what the person triggers is interactive (one at a time, short gap, about 40–60 s for eight parks); background work keeps 10 s. Explore still shows "Still checking RAC…" while counts arrive. | R2, R11 |
| RS3 | A desktop alert click now opens the booking page in the browser for every provider, ParkStay included. | **Decided 2026-10-16 (brief R6): yes, every provider.** Plus brief R7: the alert email carries a public, prefilled "Book on {shortName}" link (never a cart URL) so the person can book from a phone; an auto-hold email says the hold is in the app on the computer and gives the public link as a fallback. | R7 |
| RS4 | RAC checkout's top-level origins (NewBook card store, Stripe 3-D Secure) are unknown. | RAC's host only; blocked hosts logged; confirmed in RQ2 | R19 |
| RS5 | Cart expiry and the confirmation page are unseen, so a paid cart cannot be marked booked. | 10-minute estimate unless the cart page shows one; no `bookedReference`; the person checks RAC's email | R19 |
| RS6 | ParkStay lists "RAC Margaret River Nature Park" (id 116) as an external place, so it shows twice. | Keep both; the ParkStay one is info-only | R5 |
| RS7 | Who keeps the school-holiday calendar current? | Updated by hand at each announcement; documented in `docs/providers/rac/` | R14, R20 |
| RS8 | How pre-sale nights look is unseen (RQ3). | With a number, any free night counts; without, only non-member tariffs | R16 |
| RS9 | Offer "Alert me" for ParkStay snipes too? | Yes, provider-neutral (R13) | R13 |
| RS10 | Do Cable Beach's school-holiday nights follow the rolling window (it is not in the school-holiday list)? | **Decided 2026-10-16:** yes, only the rolling 364-day window. | R14 |
| RS11 | Does the member pre-sale open at the park's public release time, in AWST (rac-terms ambiguity 8)? | **Decided 2026-10-16:** yes, at the park's own public release time (7, 8 or 9 am, Australia/Perth), 48 h before the public release. | R14, R16 |
| RS12 | Explore counted RAC categories, not physical sites. Show site counts instead? | **Decided 2026-10-16, changed from the proposed category counts:** free units only, e.g. "27 free": the sum, over the park's categories (filtered by the chosen stay types), of units free for the whole stay, with no "of M" total, because RAC gives no physical-site totals. Explore reads "{n} free" when a provider gives no total and keeps "N of M" when it does (ParkStay unchanged); `bookableUnits` becomes optional. | R11 |
| RS13 | RAC member number format is unconfirmed. | **Decided 2026-10-16:** digits only, kept as a string so a leading zero survives; 4–16 digits once spaces and hyphens are removed. Tests, fixtures and docs use made-up numbers only (e.g. `1234567890123`, `012345678`). | R16 |

## Changelog

- **2026-10-16:** Created with R1–R20. Decisions answer the planning brief's ten questions. RS1–RS9 go to OPEN-QUESTIONS.md.
- 2026-10-16: stakeholder decisions R6–R8 (brief): alert clicks open the booking page for every provider; alert emails carry a public prefilled booking link for booking from a phone (R7 task); interactive pacing for person-triggered requests (R2, R11). RS2 and RS3 resolved.
- 2026-10-16: backlog reconciliation of the 20 specs against the orchestrator's decisions. v12 (R12) also adds `hold_expires_estimated` to `watches` and `site_snipes` for R18; removing a member number is never refused and clears no session (R16 aligned to R15); `other` counts as a kind when deciding "mixed" (R6 aligned to R3); cart-URL refusal is the provider's job, the core checks https and the provider's site only (R7, R12); mixed-kind noun "spot" (R9, R11, R12); R10 verifies `online_booking_url` with at most 3 anonymous GETs, else R5's book-now link; held alert click opens the watch only; R4, R7 and R13 own their website sentences and R20 refines; RAC badge is a text monogram in an app token colour, regions use Explore's names; holds at interactive pace (R18); R12 creates §12.35 and later tasks append. Sizes: R3 M, R12 L, R18 M. Dependencies: R10 + R6, R12 + R7, R16 + R11 and R13, R18 + R12. R13 now owns moving R6's snipe hold rule to "Hold it for me". Contract table completed (unit-noun helper, `links.booking` `unitId`, release outcomes, `holdRelease`, `releaseHold`, `copyable`, `onCredentialsChanged`, `providers.experiments`, the snipe `alert` column, RAC `pets` and hold stay fields, per-night and usual `minNights`, pacing priorities). RS10–RS13 added from spec assumptions. Issues filed: R1–R20 are #48–#67.
- 2026-10-16: stakeholder decisions on RS1 and RS10–RS13. RS1, RS10, RS11 and RS13 as proposed (RS13: digits only, a string, made-up numbers in tests). RS12 changed: RAC cards show free units with no total ("27 spots free"), so R11 makes `bookableUnits` optional, renders "{n} free" and now depends on R9; the category-count example removed (decision 8, R9, R11). Specs R9, R11, R14, R16 and R17 and their issues updated; resolved rows added to OPEN-QUESTIONS.md.
- 2026-10-17: R2 review notes forwarded. **R11:** each paced deadline counts only its own call's requests, so a place-page check queued behind a running 8-request Explore search (or a second date change behind the first) can miss its deadline; R11's deadline check must account for queued interactive work. **R15/R16:** the paced sign-in check keeps its 15 s `probeTimeoutMs` at background priority; decide whether to grow it with `pacedDeadlineMs`. **R4 → R11:** `deriveAvailability` turns a missing `bookableUnits` into 0; R11 must carry "unknown" through when it makes the total optional.
- 2026-10-17: R6 review notes forwarded to **R9** (copy pass): the hold-rule message says "on the Stay step" but the step and Edit section are titled "Your stay", and with two stay types chosen "Choose a stay type…" reads as if none was chosen (suggested: "{Place} has more than one stay type. Choose one stay type or a {noun} under "Your stay" to hold one automatically."); UnitPicker nests an inner "Other" heading under each stay-type group when units have no `unitType` ("Dorms › Other › All other sites (2)" calls huts sites); `stay=cabin,bogus` keeps Cabins but the notice still says the link's stay types "couldn't be used".
- 2026-10-17: R5 review notes forwarded. **R10:** the client's 30-minute block cool-down ignores `Retry-After` and never lengthens on repeated blocks, so with watches a persistent block becomes one request every 30 min indefinitely: honour a longer `Retry-After` (capped) and lengthen the cool-down or pause RAC watches after consecutive blocks; harden the fixture guard (bare `instances_<32 hex>` keys, photo `alt` text, IPs, Cloudflare cookies/`cf-ray`, descriptions in any tag) before adding availability fixtures; add the missing "Wheelchair accessible" amenity test (`catalog.ts:372-379`); "Seasonal dates" is more exact than "Peak-season dates" for Cable Beach. **R9 (copy):** the renderer's empty states blame the provider for what WA Stay doesn't show ("RAC hasn't published a description.", "Availability not shared by RAC", "RAC doesn't share availability with WA Stay"); reword provider-neutrally and truthfully (R10/R11 also make availability real).
- 2026-10-17: R10 follow-up (unowned, small shared change): number stay fields accept fractions in shared validation (`pets: 1.5` passes the core; RAC refuses it with a `ProviderError` and sends nothing). Proposed owner: R16 (it touches RAC's stay fields) or R20's final sweep — an integer rule on `StayFieldSpec` number fields.
- 2026-10-17: R15 follow-ups for **R16**: `ConnectAccountPrompt` in the snipe flows opens the sign-in window, which answers `NOT_IMPLEMENTED` for a credentials provider — link to Settings → Accounts instead; `accountPurpose` still says "Connect {name}…" for an optional credentials provider; the remove message says "it" even when a provider has several fields. §12.35 now exists ("RAC stream contract additions", created by R15); R12 adds to it.
- 2026-10-17: R9 review notes routed. **R13:** five Site Sniper intro strings are marked `unit-noun-ok: R13 rewrites` (four the R9 spec lists plus `NewSnipePage`'s page description); rewrite them with the noun helper and remove the markers. **R20:** Settings copy still says "site" (`features/settings/notifications/DesktopSwitches.tsx:30-31`, `email/EmailNotifierCard.tsx:110`); fix it or widen the noun guard to cover settings. **R12:** the "A spot is free at …" alert title is R12's (the noun helper is ready).
