# R11: RAC free counts on Explore

## Description
As a person planning a trip, I set dates on Explore and see how many places are free at each RAC park, beside ParkStay's campgrounds and filtered by stay type, before I open a park.

RAC has no all-parks query: it is one availability POST per park (`rac-booking-flow.md` §3, "Bulk"). This task adds RAC's bulk `availability.search`:
- eight POSTs, paced as interactive requests (brief R8: one at a time, a short gap, all eight in about 40–60 s);
- counted from the same category mapping as `availability.check` (R10), with counts per stay type (`byKind`, R1).

It also makes the `PREVIEW_PROVIDER=rac` preview pass (brief success criterion 8).

## Size
M

## Depends on
R4 (the Stay type chip reads `byKind`) and R10 (category mapping, booking links, recorded fixtures). It uses R2's paced client and fixture `form` routes, and R1's `byKind` shape.

## Scope
1. **Manifest** (`src/main/providers/rac/manifest.ts`):
   - `bulkAvailability: true`;
   - `bulkAvailabilityStayFields`: exactly the stay fields the POST sends. That is both dates, `adults`, `children` and `infants`, plus any RAC stay field R10 sends (for example pets). A party change asks again; nothing else does.
2. **`availability.search(stay, signal)`** (`src/main/providers/rac/bulk.ts`, beside R10's availability code):
   - **Requests:**
     - one POST per park in R5's seed (`parks.ts`), in seed order;
     - built by the same request builder as `availability.check` (headers, host allow-list, R5's client);
     - each POST uses R2's interactive priority, because Explore's dates are person-triggered (R8). Nothing else calls it.
   - **Counts:** each park's answer goes through R10's mapping. The counts come from the units it returns:
     - `availableUnits`: categories `fullyAvailable` for the stay (R10's rule);
     - `bookableUnits`: categories bookable online for these dates at all, free or not. A category does not count when it is closed (site code 2), beyond the window (code 9), or refused by every tariff for a special date or stop-sell (codes 4, 8, 11);
     - `byKind`: both counts per `UnitKind`, from each unit's `unitKind`. Every kind the park has appears, with zeros when none is free.
   - One entry per park that answered, keyed `makeLocationKey('rac', <slug>)`.
3. **Failures:**
   - **One park fails** (5xx such as the 520 seen live, timeout, network, or an unreadable body):
     - that park gets no entry, so Explore reads it as unknown;
     - one warning is logged, naming the park slug and the status, never the body;
     - the search goes on to the next park.
   - **Every park fails:** reject with the last error, so Explore shows its notice and Retry.
   - **A block** (Cloudflare challenge, 403, 429, or R5's cool-down):
     - the search stops at once and sends nothing more;
     - it rejects with R5's typed error;
     - Explore shows its existing "Couldn't check availability on RAC" notice with Retry. During the cool-down, Retry fails fast and sends nothing (terms rule 5).
   - **Abort** (`signal`): no further POST starts, and the search rejects with an `AbortError`.
   - **A newer search starts** (the person changed dates):
     - the older search sends no more POSTs and resolves with the parks it has;
     - only one RAC bulk search sends at a time (terms rule 4).
4. **Deadline:** R2 scales the core's availability deadline with the provider's spacing (`location-catalog.service.ts:208-217`). Check that it covers eight interactive POSTs at the slowest latency seen live (8 s). If it does not, fix R2's formula; add no RAC special case.
5. **Fixtures:**
   - **Jest** (`tests/fixtures/providers/rac/`): one trimmed availability response per park for one stay, routed by the `blog_id` form field (R2).
     - Reuse R10's recorded files.
     - Record any missing park once: anonymous, read-only, at least 10 s apart, eight POSTs at most.
     - Trim each to 2–5 categories. Redact `api_key`, cart ids and IPs. No photos or descriptions: R5's fixture guard must pass.
   - **E2E** (`tests/e2e/fixtures/http/rac/`): the same eight responses, routed by `blog_id`.
   - **Dated answers rot.** The e2e journey writes a temp copy of the fixture folder and launches with `WA_STAY_E2E_FIXTURES_DIR` pointing at it (`launchEnv` lets `env` override it, `tests/e2e/support/wa-stay.ts:127-150`). In the copy, the RAC night keys and dates are moved to the journey's stay (tomorrow plus two nights, Perth). Reuse R10's helper if it made one; otherwise add `tests/e2e/support/dated-fixtures.ts` for both journeys.
6. **E2E journey** (`tests/e2e/rac-explore.spec.ts`), launched with `providers: ['parkstay', 'rac']`:
   - dates and guests are set on Explore;
   - RAC park cards show free counts beside ParkStay's;
   - choosing Stay type → "Cabins & villas" changes Busselton's count to its cabin count;
   - fixture mode refuses no request, and the window logs no errors.
7. **Preview:** `xvfb-run -a npx cross-env PREVIEW_PROVIDER=rac PREVIEW_ARRIVAL=<recorded arrival> playwright test preview-provider` passes. Write the command and the dates in the e2e fixture folder's README.
8. **Docs:** update the journey count in CLAUDE.md ("Testing", "22 journeys in 11 specs" as R10 left it) and in `tests/README.md`.

## Non-goals
- `availability.check` and the place page (R10).
- Minimum stays (R8) and nouns (R9).
- The Stay type chip, and how Explore reads `byKind` (R4).
- Members-only tariffs and member prices (R16). Until then, a members-only tariff never makes a category free (R10).
- Showing each park's count as it arrives: the SDK gives one answer per provider. "Still checking RAC…" covers the wait (RS2).
- Docs, the providers README and the website row (R20).
- Any change to ParkStay's bulk availability.

## Completion Criteria
- [ ] `npx jest tests/integration/rac-provider.test.ts` passes, with the contract suite's bulk checks and `describe('RAC bulk availability')`.
- [ ] **Agreement:** for every fixture, test `bulk agrees with check` shows that `availableUnits`, `bookableUnits` and `byKind` equal the counts taken from `availability.check` on the same response.
- [ ] **Busselton 6–8 Nov 2026 fixture:** the powered site counts as free, and the ensuite site as bookable but not free.
- [ ] **Exmouth closed category** (site code 2): it counts in neither number.
- [ ] **Pacing** (`interactive pacing`), on a fake clock with R2's paced client and a fake 5 s latency:
  - eight POSTs, never two in flight;
  - each POST at least R2's interactive gap after the previous one ended;
  - done in 60 s or less;
  - every request carries the interactive priority.
- [ ] `block stops the search`:
  - a 403 on the third park rejects with R5's typed error after exactly three POSTs;
  - a second search within the cool-down sends nothing.
- [ ] A 503 for one park gives seven entries. A 503 for all eight rejects.
- [ ] An abort after two POSTs sends no third one.
- [ ] A superseded search stops sending and resolves with what it has.
- [ ] Through the IPC harness, with ParkStay and RAC registered:
  - `catalog.availability` returns both providers' entries;
  - a second call within 5 minutes sends no RAC request.
- [ ] A log spy over the bulk tests shows no request body, cart URL or `api_key` in the logs.
- [ ] `rac-explore.spec.ts` passes, and every existing journey passes unchanged.
- [ ] The preview command in item 7 passes.
- [ ] **Accessibility.** The journey asserts by role and accessible name only:
  - the RAC card's availability text names the count and the place;
  - the "Stay type" chip is a button with a name, and its menu items are checkable;
  - a fake slow provider shows "Still checking RAC…" in the notices region after 10 s (`SLOW_AVAILABILITY_MS`);
  - the error notice's button is named "Retry RAC availability".
- [ ] The full gate passes: `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`, then `npm run build:e2e && xvfb-run -a npm run test:e2e`.
- [ ] CLAUDE.md lines this task makes stale are updated (the journey count).
- [ ] The website (`site/`) needs no change: it makes no RAC claim until R20.

## Edge Cases
- A stay beyond the 364-day window: every night is code 9, so the counts are 0/0 and Explore reads "Not open".
- A stay overlapping a held-back school-holiday block: refused nights are not free. The category is bookable unless every tariff refuses the stay.
- Tariff code 6 (minimum nights) or 3 (too many guests) on every tariff: not free, but bookable. Explore reads "none free", not "not open".
- A night missing from a park's answer: that category is not free (R10 reads the night as unknown).
- A category the API lists and the page does not (Busselton 30): counted the way R10 lists it.
- A 200 HTML Cloudflare challenge page: R5's client treats it as a block. "No direct file access" (no `X-Requested-With`) is a parse error, so that park reads unknown and the error is logged.
- `success: "false"` in the body: a parse error for that park.
- Offline: Explore turns availability off and sends no POST.
- Sleep during a search: the POST in flight fails or times out. The deadline rejects, and Explore offers Retry.
- Quit during a search: the core's lifetime signal aborts it, and no POST starts after.
- Perth midnight during a search: no effect, since each search keeps its own dates.
- Fixture mode is unpaced (R2), so the journey and the preview stay fast.

## Test Strategy
- **Unit (~10):** counts from R10's units (free, sold out, closed, beyond the window, minimum stay, too many guests); `byKind` with zeros; entry keys; stay key fields; log redaction.
- **Component:** none new. R4 covers how the chip reads `byKind`.
- **Integration (~7):**
  - the contract suite with bulk;
  - `catalog.availability` through the IPC harness for two providers;
  - fake-clock pacing;
  - block and cool-down;
  - partial failure;
  - abort;
  - superseded search.
- **E2E:** 1 journey, plus the preview run (opt-in, documented).

## Context Files to Read First
- `CLAUDE.md` ("Adding a provider" steps 3–6; "Testing")
- `ai-state/streams/rac/master-plan.md` (design decisions 4 and 7; RS2; terms rules 2, 4, 5)
- `ai-state/brief.md` (Project 2: R8, RO3, RO5)
- `ai-state/research/rac-booking-flow.md` §3, §4, §10; `ai-state/research/rac-terms.md` (rules 2–7)
- `src/main/providers/rac/` (R5's client, seed and fixture guard; R10's availability mapping)
- `src/main/providers/parkstay/availability.ts` (`search`, `:318-360`, for the shape)
- `src/main/core/catalog/location-catalog.service.ts` (`availability` and `bulkFor`, `:974-1067`; timings, `:208-217`)
- `src/shared/types/provider.types.ts` (`BulkAvailabilityEntry`, `:302-315`; `bulkAvailabilityStayFields`, `:224-230`)
- `src/renderer/features/explore/ExplorePage.tsx` (notices, `:636-672`); `availability/deriveAvailability.ts`
- `src/main/testing/fixture-http-client.ts`; `tests/e2e/fixtures/http/README.md`
- `tests/e2e/preview-provider.spec.ts`; `tests/e2e/support/wa-stay.ts`; `tests/utils/provider-contract.ts`

## Notes
- **Timing.** One POST takes 4–8 s (research §3). Add R2's interactive gap and eight parks take about 40–60 s. Explore already shows "Still checking RAC…" after 10 s (`SLOW_AVAILABILITY_MS`, `ExplorePage.tsx:81`).
- **Caching.** The core reuses an answer for 5 minutes per stay key and the renderer for 15, so moving the map costs no request.
- **No live holds.** Nothing here opens `online_cart_url` or any cart (§12.33). Fixtures redact cart ids.

## Assumptions
1. **Counts are categories, not physical sites.** The place page's units are categories (R5, R10), and `bookableUnits` needs a total that RAC does not give for physical sites. So a card reads like "3 of 11 places available", not "51 sites free". *Needs a stakeholder decision* if they want site counts.
2. A superseded search resolves with what it has. For dates the person left, the unchecked parks read unknown for up to 15 minutes if they go back to those dates.
3. Shifting fixture night keys in a temp copy is acceptable test tooling. The committed files keep their recorded dates.
4. The party is in the bulk cache key, because RAC's answer depends on it.
