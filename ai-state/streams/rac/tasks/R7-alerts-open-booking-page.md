# R7: Alerts that open the booking page

## Description
When a watch finds a stay, the person should be one click from booking it. This task delivers two stakeholder decisions from 2026-10-16:
- **R6:** clicking an availability alert opens the provider's booking page for the matched stay in the browser, and the watch in WA Stay. This applies to every provider, ParkStay included.
- **R7:** the alert email carries "Book on {shortName}", a link to the provider's public, prefilled booking page, so the person can book from a phone. It is never a cart URL. An auto-hold email says the hold is in WA Stay on the computer, and still gives the public link as a fallback.

Today a desktop click only opens the watch (`notification.service.ts:391-401`). The email has no link at all: `actionUrl` is an in-app path, and `httpLink` drops it (`email-smtp.notifier.ts:289,469-477`).

## Size
M

## Depends on
R2 (lane order only: both edit `provider.types.ts`)

## Scope
1. **SDK** (additive and optional):
   - `UnitAvailability.bookingUrl?: string` (`provider.types.ts:269-283`): the booking page for this unit and the asked stay, prefilled where the provider can (place, dates, guests, unit or category).
   - `ProviderLinks.booking(externalId, stay?, unitId?)` (`sdk/provider.ts:311-318`): an optional `unitId`. Providers may ignore it; ParkStay does.
   - One rule in the doc comments of these and of `LocationAvailability.bookingUrl`:
     - an absolute https URL on the provider's own site;
     - a public page that works with no sign-in, no app session, on a phone;
     - never a URL that adds to a cart, holds or books when it is opened.
2. **Core:** a new `src/main/core/booking-link.ts`. R12 reuses it for snipe alerts.
   - `isProviderBookingLink(manifest, url)`:
     - https, with no username or password;
     - the host equals `new URL(manifest.website).host`, or is a subdomain of it with a leading `www.` dropped.
     - A cart URL cannot be recognised generically: the doc rule, the contract suite and each provider's tests cover it (R10 for RAC).
   - `firstBookingLink(manifest, candidates)`: the first candidate that passes. A refused one is skipped and logged once per call with `describeUrl` (the origin only), never the path or query. R12 calls it with its own candidates.
   - `matchedStayLink(provider, watch, match, units)` → `{ url, arrival, departure } | undefined`, with these candidates in order:
     1. for a full match, the matched unit's `bookingUrl`;
     2. `links.booking(externalId, matchedStay, match.unitId)`, where a partial match's stay has the run's dates.
   - `matching.ts`: export `longestRun(matches)` (the longest run, the first on a tie). `notifyWatchPartialFound` (`notification.service.ts:185-209`) uses it, so the message and the link name the same run.
3. **WatchService** (`watch.service.ts:274-318`):
   - **At alert time:** the link for `full[0]` (the unit an auto-hold takes), or for `longestRun(partial)` with the run's dates. It is passed to `notifyWatchFound`, `notifyWatchPartialFound` and `notifyWatchHeld`.
   - **On the watch:** `Watch.bookingLink?: { url: string; arrival: string; departure: string }` (`watch.types.ts`).
     - It is derived on read with the same functions from the stored `lastAvailability`, in `get`, `list`, and every `watch:updated` payload (`changed`, `emitChanged`).
     - Only when `lastResult` is FOUND or PARTIAL_FOUND, and the stored nights are the watch's current stay nights.
     - It is never stored: no column and no migration (master plan, Integration point 4).
4. **NotificationService:**
   - `notify`'s `dispatchMeta` gains `bookingUrl?` and `heldInApp?`. Neither is written to `notifications` or to `notification_delivery_logs`.
   - **Desktop click** (`openFromDesktop`, `:391-401`), when the alert carries a booking URL (a found or partial alert, or later R12's snipe alert):
     - the in-app page opens as today (`app:navigate`);
     - then `openExternal(url)` opens the browser. It is a new option, wired like `showMainWindow` (`container.ts:167,178,296-300`; `index.ts:86,166`) to `shell.openExternal`.
   - Held alerts open the watch only, because payment happens in the app.
   - When `showMainWindow()` returns false, the click opens nothing. A rejected `openExternal` is logged with the origin only.
5. **Email** (`email-smtp.notifier.ts`):
   - `NotificationMessage` (`notifier.types.ts:128-139`) gains `bookingUrl?: string` and `heldInApp?: boolean`. The dispatcher passes them through.
   - **HTML** (`buildHtmlEmail`, `:316-402`): after the message, the coral button "Book on {shortName}". Its `href` is the URL through `escapeHtml` (`:433-442`), so `&` becomes `&amp;`.
   - **Plain text** (`buildTextEmail`, `:407-428`): a line `Book on {shortName}: <url>` with the raw URL.
   - Only https URLs are used, through a new `httpsLink` that is stricter than `httpLink`. For a provider the registry does not know, the label reads "Book on the provider's site".
   - **With `heldInApp`**, both parts add, before the link: "This hold is in WA Stay on the computer that placed it. Open WA Stay there to pay before it expires. Away from that computer? You can book on {shortName} instead. What WA Stay held may show as taken there until the hold ends."
   - The subject and the other parts are unchanged.
6. **Watch page** (`watches/detail/WatchAvailability.tsx`):
   - when `watch.bookingLink` is set and the stay has not begun (`providerToday`): `ExternalLink` with `variant="primary"`, "Book on {shortName}", right after the result line;
   - for a partial match, the run's dates as text ("For 3–5 Nov", `stayRangeLabel`).
7. **Contract suite** (`tests/utils/provider-contract.ts`): every `bookingUrl` an `availability.check` returns (the location's and each unit's) passes `isProviderBookingLink`. The example providers, ParkStay and the scaffold's output must still pass.
8. **ParkStay:** no code change. Its link is the public search page with the campground and the dates (`parkstay/links.ts:19-39`), reached through `links.booking`.
9. **Docs and website:**
   - `docs/watches-and-notifications.md:78-80` (desktop click, email);
   - `docs/providers/adding-a-provider.md`: the Availability bullet (`:715-718`) and "Links and dispose" (`:1320-1324`);
   - CLAUDE.md: the NotificationService row and "Notification System";
   - `site/index.html`, "Booked out? Set a watch" (`:209-222`): one provider-neutral sentence saying that clicking an alert opens the provider's booking page for those dates, and that the email's link works from a phone. No screenshot changes.

## Non-goals
- RAC's `online_booking_url`, RAC's `links.booking` with `unitId`, and its tests against cart URLs (R10).
- Snipe notifications: held, booked and release alerts, and their emails (R12, reusing `booking-link.ts`).
- Noun copy such as "Sites available at…" (R9).
- Storing a link on a notification, or a bell click that opens the browser. The bell opens the watch, which shows the link.
- An in-app window for booking links. They open in the system browser (master plan, "Also decided"); only R19's cart uses the payment window.

## Completion Criteria
- [ ] `tests/unit/core/booking-link.test.ts`:
  - accepted: https on the site, and a subdomain when the website starts with `www.`;
  - refused: http, another host, a look-alike host (`parkstay.dbca.wa.gov.au.evil.test`), credentials, `javascript:`;
  - the unit link comes first; a partial match uses the run's dates and `unitId`; a refused candidate falls through; nothing valid gives `undefined`.
- [ ] `tests/unit/core/watch.service.test.ts`:
  - found, partial and held alerts receive the link;
  - `get` and `list` include `bookingLink` only for FOUND or PARTIAL_FOUND whose nights match the stay;
  - after the stay is edited, there is none.
- [ ] `tests/unit/core/notifications/notification-desktop.test.ts`:
  - clicking a found alert sends `app:navigate` to `/watches/<id>`, then calls `openExternal` with the URL once;
  - a held alert does not call it, and with no window nothing happens;
  - a rejection is logged with the origin only.
- [ ] `tests/unit/core/notifications/email-smtp-notifier.test.ts`:
  - the HTML has `<a href="https://…?a=1&amp;b=2"` with the text "Book on ParkStay";
  - the text part has `Book on ParkStay: https://…?a=1&b=2`;
  - a held email has the hold sentences and the link;
  - no link, or an http link, gives no "Book on".
- [ ] **The email contains the link, end to end** (`tests/integration/watch-parkstay.test.ts`, or `notification-dispatch.test.ts` with a fake nodemailer transport):
  - a ParkStay watch found through fixtures sends a mail;
  - its HTML and text both contain `https://parkstay.dbca.wa.gov.au/search-availability/information/?campground_id=<id>&arrival=<YYYY/MM/DD>&departure=<YYYY/MM/DD>`.
- [ ] Nothing new is stored: `connection.ts` is untouched, and the test above finds no booking URL in the `notifications` or `notification_delivery_logs` rows.
- [ ] Watch page tests: found shows the link "Book on ParkStay (opens in your browser)" with its href; partial adds "For 3–5 Nov"; held, not found and a stay that has begun show none.
- [ ] Contract suite: the new check, and a self-test in `tests/integration/provider-contract.test.ts` where a provider returning an off-site link fails it.
- [ ] Logs: no logged line carries a booking URL's path or query (assert on the mocked logger).
- [ ] Accessibility:
  - [ ] the link's accessible name is "Book on {shortName} (opens in your browser)";
  - [ ] it comes right after the result line in reading order;
  - [ ] a partial match's dates are visible text;
  - [ ] the email button is a text link, never an image alone.
- [ ] The full gate passes: `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`, then `npm run build:e2e && xvfb-run -a npm run test:e2e`.
- [ ] CLAUDE.md, the docs and the site are updated as in Scope 9; the site test passes.

## Edge Cases
- No link (`null`, off-site, http): no email button. A desktop click opens the watch only, and the watch page has no link.
- The provider is no longer registered when watches are listed: no `bookingLink`.
- Several full matches use `full[0]`; partial runs that tie use the first.
- `maxPrice` excludes a unit: the link is for the match that passed.
- A `notifyOnly` watch is paused after its alert: the link stays while the result is FOUND and the stay has not begun.
- The stay was edited after the check, or the stored nights are for other dates: no link until the next check.
- The arrival day passes at midnight in Perth (the provider's zone): the watch page hides the link. Emails already sent are unchanged.
- A click while quitting, or with no window, is ignored. `openExternal` rejects (no default browser): logged, and the watch still opens.
- More than 20 live desktop notifications: the oldest are dropped, as today.
- A URL with `&`, `'`, `"` or non-ASCII characters is escaped in HTML and raw in text, and can never break out of the `href` attribute.
- The email notifier is off or its settings are unreadable: nothing is sent, as today.
- An auto-hold that was not placed (a note) sends the found alert with its link, as usual.

## Test Strategy
- **Unit (~32):** booking links (12), `longestRun` (2), WatchService (6), desktop clicks (4), the email (6), the contract self-test (2).
- **Component (~5):** `WatchAvailability` and `WatchDetailPage`.
- **Integration (~2):**
  - a ParkStay watch sends an email containing the link;
  - in `two-providers.test.ts`, a fake provider's unit link is used for its watch, and ParkStay's for its own.
- **E2E:** existing journeys pass. R10's RAC journey checks "Book on RAC" on the watch page. OS notifications and SMTP are not driven in e2e.

## Context Files to Read First
- `ai-state/brief.md` (Project 2: R1, R6, R7), `ai-state/streams/rac/master-plan.md` (decision 2, "Also decided", Integration point 4, RS3)
- `src/main/core/notifications/notification.service.ts`, `notification-dispatcher.ts`, `notifiers/email-smtp.notifier.ts`
- `src/shared/types/notifier.types.ts`, `notification.types.ts`, `watch.types.ts`, `provider.types.ts`
- `src/main/providers/sdk/provider.ts`, `src/main/providers/sdk/url-patterns.ts` (`describeUrl`)
- `src/main/core/watches/watch.service.ts`, `matching.ts`
- `src/main/providers/parkstay/links.ts`, `availability.ts:314`
- `src/main/app/container.ts`, `src/main/index.ts`, `src/main/app/main-window.ts` (`guardNavigation`)
- `src/shared/utils/app-links.ts`
- `src/renderer/features/watches/detail/`, `src/renderer/components/ExternalLink.tsx`, `src/renderer/features/place/placeModel.ts` (`resolvePlaceLinks`)
- `tests/unit/core/notifications/`, `tests/unit/core/watch.service.test.ts`, `tests/utils/provider-contract.ts`
- `docs/watches-and-notifications.md`, `site/index.html`

## Notes
- **Derived, not stored.** The matching functions are pure, so the alert and the watch page compute the same link from the same units. That keeps "nothing new is stored" (Integration point 4).
- **Validated in core** because "a booking link must be https on the provider's own site" (master plan, "Also decided"). `describeUrl` keeps paths and queries out of the logs.
- **Mobile:** ParkStay's search page is public and needs no `Referer` (checked live on 11 Oct 2026, `parkstay/links.ts:5-11`). RAC's link is checked in R10.
- **Where the link goes:** the email is the only way it leaves the computer, to the person's own address through their own SMTP server.
- No live hold, booking or payment in any test (architecture-notes §12.33).

## Assumptions
- `links.booking` gains an optional third parameter, `unitId`. This is not in the master plan's contract table; it lets a partial run's link name the category (brief R7, "prefilled with … category").
- The website sentence lands here rather than in R20, because CLAUDE.md asks for the website change in the same change. R20 then only checks it.
- A held alert's desktop click opens the watch only. Opening the public page would invite booking the place the person already holds.
- The watch page shows the link only for FOUND and PARTIAL_FOUND, not HELD: at the computer, the person pays in the app.
