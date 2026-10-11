# ParkStay WA endpoints

What the ParkStay provider (`src/main/providers/parkstay/`) sends to ParkStay and to the DBCA
queue, and what it reads back. The code is the source of truth: every request goes through
`ParkStayClient` (`client.ts`), and the paths below are the ones its callers pass. The
`file.py:line` references are to DBCA's open-source backend,
[`dbca-wa/parkstay_bs_v2`](https://github.com/dbca-wa/parkstay_bs_v2) (checked at commit
`a3df126`, 10 Sep 2026), as the module's own comments cite them. The recorded responses the
tests use are in `tests/fixtures/parkstay/`.

This page replaces the old `docs/parkstay-api/ENDPOINTS.md`, which was largely guesswork: most
of its routes do not exist in the DBCA backend. They are listed under
[Not real routes](#not-real-routes) so nobody builds on them again.

## Contents

- [Status legend](#status-legend)
- [Rules every request follows](#rules-every-request-follows)
- [API endpoints WA Stay calls](#api-endpoints-wa-stay-calls)
- [Pages WA Stay opens or links to](#pages-wa-stay-opens-or-links-to)
- [In the DBCA backend, not used](#in-the-dbca-backend-not-used)
- [Not real routes](#not-real-routes)
- [The availability tuple](#the-availability-tuple)
- [The DBCA queue](#the-dbca-queue)
- [Holds and payment](#holds-and-payment)

## Status legend

| Status | Meaning |
| --- | --- |
| Verified live 2026-10-02 | Requested from the live site on 2 Oct 2026 (read-only, anonymous); the response shape is recorded in `tests/fixtures/parkstay/`. |
| Verified live 2026-10-10 | Requested once from the live site on 10 Oct 2026, anonymously. |
| Verified live 2026-10-11 | Requested from the live site on 11 Oct 2026 (Perth time), anonymously and read-only: pages loaded in a headless browser without a `Referer`, and single API requests. Its `file.py:line` references are at the backend's commit `6fb9108` (8 Oct 2026). |
| Verified live 2026-04-06 | Checked against the live queue on 6 Apr 2026 (the response fields in `types.ts` `QueueApiResponse`). |
| In DBCA source, not probed | The route is in the DBCA backend (`urls.py`, or a template); WA Stay's behaviour follows the source and the tests' fixtures, not a live capture. |
| Not a real route | Not in the DBCA backend. WA Stay never calls it; `tests/unit/docs/endpoints-doc.test.ts` checks that the provider's code does not name it. |

## Rules every request follows

- **Hosts.** The API is `https://parkstay.dbca.wa.gov.au/api` and the queue
  `https://queue.dbca.wa.gov.au` (`constants.ts`). Tests point both at a loopback fixture
  server (`ParkStayEndpoints`).
- **A browser user agent.** DBCA's queue middleware answers library user agents (axios,
  python, curl, java, httpclient…) with its queue redirect page (`queue_middleware.py:16-28`).
  Every request presents the desktop Chrome user agent and matching client hints
  (`headers.ts`); in the app the major version is Electron's own Chromium.
- **The ParkStay `Referer`.** `campsite_availablity_view` answers HTTP 500 without
  `Referer: https://parkstay.dbca.wa.gov.au/` (`api.py:1224-1240`), and the campground page
  redirects away. A POST also carries `Origin`. No `Sec-Fetch-*` headers: Chromium sets them
  itself.
- **Dates are `YYYY/MM/DD`.** ParkStay's serialisers read only that form
  (`serialisers.py:56-57`); `YYYY-MM-DD` is HTTP 500. `toParkStayDate` converts the app's
  calendar dates with a string replace, never a `Date`, so no time zone can shift them.
- **The paths are misspelt** by ParkStay: `campground_availabilty_view` and
  `campsite_availablity_view`. Copy them exactly.
- **At most 4 requests in flight** to ParkStay and the queue together (the manifest's
  `limits.maxConcurrentRequests`).
- **The DBCA queue can answer instead.** See [The DBCA queue](#the-dbca-queue).
- **No retries on "too many requests".** A 429 (or 408) is a `ProviderHttpError`, which IPC
  reports as `RATE_LIMITED`; nothing retries it at once.

## API endpoints WA Stay calls

| Method | Path | Status | Called by | What WA Stay reads |
| --- | --- | --- | --- | --- |
| GET | `/api/campground_map/` | Verified live 2026-10-02 | `catalog.ts` `listLocations` | A pre-generated GeoJSON FeatureCollection of every campground (169, about 1.2 MB). Per feature: id, `[lng, lat]`, name, `campground_type` (0 online, 1 not online, 2 another operator, 4 by application → `bookingMode`), `max_advance_booking`, features, site-relative images, `info_url`, park → district → region, campsites. `description` is empty for every campground. Synced at most once a day. |
| GET | `/api/campsite_availablity_view/{id}/` | Verified live 2026-10-02 | `availability.ts` `check`, `catalog.ts` `getLocation`, `release-policy.ts` | Query: `arrival`, `departure` (`YYYY/MM/DD`), `num_adult`, `num_concession`, `num_child`, `num_infant`, `gear_type`. One campground's sites with a tuple per night ([below](#the-availability-tuple)), each site's `short_description` (plain text, may be null; `description` is always the placeholder `"x"` and is never read), `min_people`, `max_people` and `max_vehicles`, `long_description` (items it marks `<span class="disable">` get "(not available)", then it is sanitised in main), `release_date`, `booking_time_open`, `release_time_friendly` (the daily release time, e.g. Bungarra `02:00 AM`, `api.py:1358-1372`), `site_type`, `classes`, and `map` (the campground map PDF's site-relative path, or null, `api.py:1346`: the detail's "Campground map" document, below). Campgrounds listed by site class (Lucky Bay, `site_type` 1 or 2, `api.py:1375-1527`) were re-checked live on 9 Oct 2026 (`site-classes.ts`). Not available for `campground_type` 2 and 4 (HTTP 400). |
| GET | `/search-availability/campground/?site_id=…` | Verified live 2026-10-11 | `campground-page.ts` (from `catalog.ts` `getLocation`) | ParkStay's campground page (`urls.py:112`, `views.py:1264-1551`), an HTML page, not JSON: no JSON endpoint serves its "MORE DETAILS". One GET with only `site_id`, beside the availability view, for online and offline campgrounds; it shares the 6-hour detail cache. **Sections:** `#campground-details` holds an `h1` (the name), a photo carousel, the intro (`about`) and one `h5` per section (Booking, Campsites, Facilities, Campground Rules, Fees, Your safety and health, Location; `search_availabilty_campground_details.html`); the intro becomes "Overview", the name and photos are left out, and each section is sanitised in main with its headings from `h4`. **Notices:** each `.round-box` `div` with a `bi-exclamation-diamond-fill` (warning), `bi-exclamation-triangle-fill` (caution) or `bi-info-circle-fill` (info) icon; the text is its `span` (`CampgroundNotice`, plain text). **Not the page:** the queue's waiting room (a 200 `text/html` whose script goes to `…/waiting-room/…`; the page's own scripts also call `window.location.replace`, so only the waiting room counts), a redirect away (it refuses a `Referer` that is not ParkStay's, `views.py:1322-1338`, with a 302 to `/` and on to `/search-availability/information/`: the final URL is checked), the "Oops!" page shown instead while a hold is in the session, and a page without `#campground-details` or without sections (a closure message, or a new layout). Then the sections stored last are kept, or with none the About shows `long_description`; the reason is logged without the query. With sections, `long_description` is left out. Reading it does not disturb a hold (`middleware.py:54`). |
| GET | `/api/campground_availabilty_view/` | Verified live 2026-10-02 | `availability.ts` `search` | Query: `format=json`, `arrival`, `departure`, `gear_type`, `features=[]`, `featurescs=[]`. Every campground's counts in one call, for Explore's pins: `campground_available.{id}.total_available` is the campground's **site count** and `total_bookable` the sites **free on every night** (the names read the other way round, `api.py:1100-1169`; checked against 106 live campgrounds). Both are 0 past the 180-day horizon and for stays over 28 nights. No prices. A request ParkStay rejects is answered 200 with no campgrounds (`api.py:1062-1075`), so an empty answer is logged as a warning. |
| POST | `/api/create_booking` | In DBCA source, not probed | `holds.ts` `create` | A 30-minute hold ([below](#holds-and-payment)). Never called live by any test or agent run. |
| GET | `/api/profile` | Verified live 2026-10-10 | `auth.ts` `isSignedIn` | No trailing slash (`urls.py:58`); `IsAuthenticated` (`api.py:4720-4731`). Without a session: 403 `{"detail":"Authentication credentials were not provided."}` (probed). With one: 200 JSON whose `email`, `first_name` and `last_name` are read (from the source; a real signed-in answer is on the [release checklist](../../release-checklist-2.0.md)). |
| GET | `queue.dbca.wa.gov.au/api/check-create-session/` | Verified live 2026-04-06 | `queue/queue-api.ts` | Query: `session_key`, `queue_group=parkstayv2`. `status` (`Active` or `Waiting`), `queue_position`, `wait_time`, `expiry_seconds`, `session_key`. |

## Pages WA Stay opens or links to

The sign-in and payment windows show these pages on the provider's session partition; links
open in the system browser.

| Method | Path | Status | Used for |
| --- | --- | --- | --- |
| GET | `/ssologin` | In DBCA source, not probed | Where the sign-in window starts (`templates/ps/base.html:69`). |
| GET | `/login-success/` | In DBCA source, not probed | The page that ends sign-in (`urls.py:107`). |
| GET | `/booking/` | In DBCA source, not probed | The payment window: the hold is in the session as `ps_booking` (`api.py:3373-3376`, `urls.py:134`). |
| GET | `/success/?checkouthash=…` | In DBCA source, not probed | Where the payment ledger returns (`utils.py:1766`, `urls.py:137`); read to record a paid hold ([below](#holds-and-payment)). |
| GET | `/search-availability/information/?campground_id=…` | Verified live 2026-10-11 | "View on ParkStay" and "Book on ParkStay" (`links.ts`, `views.py:1209-1258`); with a stay it adds `arrival` and `departure` (`YYYY/MM/DD`). ParkStay's search page: no `Referer` check, so it opens from the system browser. It preselects the campground and the dates (without dates it fills in tomorrow), and its "See availability" opens ParkStay's campground page with ParkStay as the `Referer`. It ignores guest counts (it assumes 2 adults), so the links send none. |
| GET | `/mybookings/` | In DBCA source, not probed | "Manage on ParkStay" for a booking (`urls.py:136`). |
| GET | `/media/parkstay/campground_images/…` | Verified live 2026-10-02 | Campground photos, hot-linked from the map's site-relative image paths, never redistributed. |
| GET | `/media/parkstay/campground_maps/<id>/<name>.pdf` | Verified live 2026-10-10 | The campground map (`catalog.ts` `campgroundMapDocument`), from the availability view's `map`, taken as given (never built) and refused unless it is https on ParkStay's own origin. The address stays in main; "Campground map" on the place page opens it in a document window (`src/main/app/document-windows.ts`) on an in-memory partition of its own, not the provider's. Public, `application/pdf`, one A4 page (Bungarra 86 KB), `X-Frame-Options: DENY` (so never an iframe). A missing file may answer 200 `text/plain` "ERROR opening file" (not probed): any answer that is not a PDF closes the window with `PROVIDER_ERROR`. |

## In the DBCA backend, not used

| Method | Path | Status | Why WA Stay does not use it |
| --- | --- | --- | --- |
| GET | `/api/search_suggest` | Verified live 2026-10-02 | It mixes parks and promotional areas in with campgrounds (258 items for 169 campgrounds). Explore searches the synced catalogue offline instead. |
| GET | `/api/campsites/{id}/` | Verified live 2026-10-11 | One site: name, gear flags, `min_people`, `max_people`, `max_vehicles`, closure, and `description`, always the placeholder `"x"`. The availability view carries the same limits for every site, plus the real paragraph (`short_description`), so per-site lookups were removed. |
| GET | `/api/booking/` | In DBCA source, not probed | The signed-in person's bookings (`BookingViewSet`). Booking import is not built (`bookingImport: false`). |
| GET | `/api/complete_booking/{hash}/{id}/` | In DBCA source, not probed | Payment stays a human step on ParkStay's own pages. |
| GET | `/api/booking_pricing/` | In DBCA source, not probed | Prices come per night with availability. |
| GET | `/api/get_confirmation/{id}/` | In DBCA source, not probed | Not needed: the payment window reads the success page. |
| GET | `/api/campgrounds/{id}/` | Verified live 2026-10-11 | One campground: contact address, `check_in` and `check_out`, `campground_map` (the map PDF's URL), legacy HTML (`area_activities`, `driving_directions`) and flags. Never take dog or campfire facts from it: `dog_permitted` and `campfires_allowed` are true unless a legacy `NO DOGS` or `NO CAMPFIRES` feature is attached, so Bungarra reads true for both, which is wrong. Everything Explore needs is in `campground_map` and the availability view. |
| GET | `/api/parks/`, `/api/regions/`, `/api/districts/`, `/api/features/`, `/api/promo_areas/`, `/api/campsite_classes/`, `/api/places/`, `/api/campground_map_filter/` | In DBCA source, not probed | Everything Explore needs is in `campground_map` and the availability view. |

## Not real routes

These were in the old guesswork docs or the v1.x code. None is in the DBCA backend's
`urls.py`; what exists instead is on the right.

| Method | Path | Status | What exists instead |
| --- | --- | --- | --- |
| POST | `/auth/login` | Not a real route | Sign-in is ParkStay's own pages: `/ssologin` → DBCA SSO → Azure AD B2C ([authentication](authentication.md)). |
| GET | `/api/account/` | Not a real route | `/api/profile`. |
| GET | `/api/account/profile/` | Not a real route | `/api/profile`. |
| POST | `/api/accounts/logout/` | Not a real route | Signing out clears the app's session partition; the app never calls a logout route. |
| GET | `/api/campground/{id}/` | Not a real route | `/api/campgrounds/{id}/` (unused) or the map. |
| GET | `/api/campground_availability/{id}/` | Not a real route | `/api/campsite_availablity_view/{id}/`. |
| GET | `/api/campsite_availability/{id}/` | Not a real route | `/api/campsite_availablity_view/{id}/`. |
| GET, POST | `/api/bookings/` | Not a real route | `/api/create_booking` for a hold; `/api/booking/` lists bookings. |
| GET, PUT | `/api/bookings/{reference}/` | Not a real route | `/booking/change/{id}/` and `/booking/cancel/{id}/` are ParkStay's own pages. |
| GET | `/api/queue/status/` | Not a real route | `queue.dbca.wa.gov.au/api/check-create-session/`. |
| POST | `/api/queue/exit/` | Not a real route | The queue session simply expires. |
| POST | `/api/payments/initiate/` | Not a real route | Payment happens on ParkStay's `/booking/` page and DBCA's payment ledger. |
| GET | `/api/site-types/` | Not a real route | Gear types are a fixed list (`all`, `tent`, `campervan`, `caravan`; `serialisers.py`). |

## The availability tuple

Each site in `campsite_availablity_view` has `availability`: one tuple per night,
`[bookable, label, price, _, _, date]` (`api.py:1550`), with `date` already `YYYY-MM-DD`.
`toNightStatus` (`availability.ts`) maps it to the SDK's `NightStatus`:

| Tuple | `NightState` |
| --- | --- |
| `bookable` is `true` | `available`, with `price` |
| label `Booked` | `booked` |
| label starting `Closed`, or `Closures/Bookings` | `closed` |
| label `Unavailable`, date released | `booked` (ParkStay folds booked, closed and not-released nights into one label for the public, `api.py:1578-1588`; booked is the usual reason) |
| label `Unavailable`, date past the release horizon | `not-released` |
| anything else | `unknown` |

The label is kept for display. Only the stay's own nights are returned.

At a campground listed by site class, each class is one unit, `class:<class id>`, whose
nights come from the class's own tuples and its per-site `breakdown`; a night that is free
but not on the same site as the nights around it is `unknown` with the reason `split`
(`site-classes.ts`).

## The DBCA queue

ParkStay sits behind DBCA's virtual queue. The provider models it as an SDK access gate,
`ParkStayAccessGate` (`queue/access-gate.ts`, manifest `capabilities.accessGate`):

1. **Recognising it.** While the queue is on, an `/api/` request without an active queue
   session is answered with a 200 `text/html` page whose script sends the browser to the
   waiting room (`queue_middleware.py:99,116`), or with a redirect to
   `https://queue.dbca.wa.gov.au` or `/site-queue/…`. `ParkStayClient` turns either into an
   `AccessGateError` (state `waiting`; IPC code `ACCESS_GATE`), never a JSON parse error.
2. **The session.** The key is the `sitequeuesession` cookie on `dbca.wa.gov.au` in the
   provider's session partition (`persist:provider-parkstay`). Without one, the key of an
   unexpired session saved in the provider state (`queue.session`) is reused, so a restart
   keeps the place in the queue; else a new 52-character `A-Z0-9` key is made. The key is a
   credential: it is never logged or sent to the renderer.
3. **`ensure()`** calls `check-create-session` and resolves once the answer is `Active`. It
   polls every 5 s while `Waiting`, retries a failing queue API with backoff (2 s doubling to
   30 s), shares one loop between concurrent callers, and refreshes a session that ends within
   120 s.
4. **`holdOpen()`** keeps the session alive, refreshing it every 20 s (the ParkStay page's own
   cadence), while anything holds it: a snipe run that uses the queue holds it from joining
   until the run ends (`scheduler/snipe-runner.ts`). The payment window only waits for an
   active session (`ensure`, at most 60 s) before it opens.
5. **Status** (`idle`, `waiting` with position and wait, `active` until `expiresAt`,
   `expired`, `error`) reaches the renderer only as `providers.accessStatus('parkstay')` and
   the `provider:access-status` event. The sign-in and payment windows treat
   `https://queue.dbca.wa.gov.au` as a waiting room (`access.waitingRoomOrigins`) and go back
   to the page they were opened for once it lets them through.

Joining a queue early gives no advantage: for scheduled releases DBCA re-allocates queue
positions at random at the release time. WA Stay joins genuinely and keeps the session
refreshed, as the ParkStay page does; it never fakes activity.

## Holds and payment

`POST /api/create_booking` is CSRF-exempt and form-encoded (`api.py:2938-3380`). It needs no
sign-in (`api.py:2938-2947`), which is why ParkStay's account is optional in WA Stay.

- **Form** (`createBookingForm`, `api.py:2986-3003`): `arrival`, `departure` (`YYYY/MM/DD`),
  `num_adult`, `num_concession`, `num_child`, `num_infant`, `num_vehicle` (the snipe's
  Vehicles), `num_campervan`, `num_caravan`, `num_motorcycle` and `num_trailer` (0),
  `campground`, an empty `change_booking_id` (ParkStay fails without it), `postcode` when
  given, and either `campsite` (a site) or `campsite_class`. A campground listed by class
  refuses a site ("Campground doesn't support per-site bookings.", `api.py:3112-3123`); given a
  class, ParkStay itself holds the first site of the class free for the whole stay
  (`utils.py:186-202`).
- **Answers:** `{"status":"success","pk":…}` is a hold for 30 minutes; 400
  `{"inprogress_booking":true}` means the session already has one; 400 "The system is
  currently closed for bookings."; any other 400 is almost always the site going between the
  check and the hold. 408 and 429 are errors, not refusals.
- **Payment.** The hold lives in the session (`ps_booking`), so the payment window must use
  the provider's partition; it opens `/booking/` after passing the queue (at most 60 s).
  `create_booking` also stores `checkouthash = sha256(str(pk))` (`api.py:3375`), and the
  payment ledger returns to `/success/?checkouthash=<that hash>`. The URL alone proves
  nothing: `/success/` also serves an expired-session page and the previous booking
  (`views.py:880-912`). WA Stay records a booking only for ParkStay's `/success/` with this
  hold's hash **and** the page showing this hold's number, `PB<pk>` (`success.html`), found
  with the browser's find-in-page. Card details are typed only into DBCA's pages.
