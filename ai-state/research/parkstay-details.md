# ParkStay: per-site details, campground information, map PDF, and the "View on ParkStay" link

_2026-10-11. The research for the stakeholder's Windows-testing findings._

**Sources**
- DBCA backend `dbca-wa/parkstay_bs_v2` at commit `6fb9108` (8 Oct 2026); line numbers are at that commit.
- Anonymous live checks, 10 Oct 2026 23:16–23:20 UTC. All GET: 3 headless-Chromium page loads, 2 PDF requests and 2 API requests. No sign-in, hold, basket or payment, and no queue wait.

## Findings in short

1. **Per-site details need no new request.** ParkStay's site cards come from the same `campsite_availablity_view` the app already fetches. Each `sites[]` entry has:

   | Field | What ParkStay shows | Example (Bungarra) |
   | --- | --- | --- |
   | `min_people`, `max_people` | the people icon | "1 to 6" |
   | `max_vehicles` | the parking icon | "3" |
   | `short_description` | the card's paragraph | "12m x 7m reverse-in compacted gravel site." |
   | `features` | | `[{id, name, description, type}]` |
   | `warning` | "Only N left!", class listings only | |

   - `short_description` is plain text, at most 310 characters, and may be null. ParkStay inserts it unescaped, so render it as text.
   - `description` is always the placeholder `"x"`: never show it.
   - A class entry carries the class's values. Lucky Bay is 1–8 people and 2 vehicles.
   - The app already copies `maxPeople`, `maxVehicles` and `description` (from the wrong field) into `LocationDetail.units`. `UnitAvailability` and the night grid show only the name.

2. **The About section is wrong today.** It shows `long_description`, a legacy field ParkStay's own page no longer renders.
   - That field marks what a campground lacks with `<span class="disable">`, struck through by an inline `<style>`.
   - `sanitizeProviderHtml` drops both the class and the style. So at Bungarra the app lists "Campfires permitted", "Pets permitted", "Generators permitted", "Drinking water", "Showers", "Dump station", "Picnic tables", "Gas barbecues" and "Powered sites" as if available. All are unavailable.
   - It is also out of date (refund and set-up rules).
   - The live text equals `tests/fixtures/parkstay/campsite_availablity_view_20.json`.

3. **The real campground detail is in no JSON endpoint.** ParkStay's "MORE DETAILS" is server-rendered (`SearchAvailablityByCampground`, `views.py:1264-1551`; template `search_availabilty_campground_details.html`). Summernote rich text rendered with `|safe`:

   | Heading | Field (`models.py:196-204`) |
   | --- | --- |
   | (intro) | `about` |
   | Booking | `booking_information` |
   | Campsites | `campsite_information` |
   | Facilities | `facilities_information` |
   | Campground Rules | `campground_rules` |
   | Fees | `fee_information` |
   | Your safety and health | `health_and_safety_information` |
   | Location (includes the contact link) | `location_information` |

   The page also has:
   - **Notices** (`CampgroundNotice`, at most 70 characters, red, orange or blue). Bungarra's include "Drinking water not supplied: bring your own", "No dogs or other domestic animals", "No campfires at any time" and "SEASONAL CLOSURE FROM 1 NOVEMBER 2026, REOPENING ON 15 MARCH 2027".
   - A park alerts count linking to alerts.dbca.wa.gov.au.
   - The "Campground map" link.

   Getting this means one GET per campground: `https://parkstay.dbca.wa.gov.au/search-availability/campground/?site_id=<id>` with the ParkStay `Referer` (about 63 KB).
   - **Where things are:**
     - Sections: in `#campground-details`, an `h1`, the `about` paragraphs, then one `h5` per section.
     - Notices: `.round-box`. The icon gives the level: `bi-exclamation-diamond-fill` is red, `bi-exclamation-triangle-fill` orange, `bi-info-circle-fill` blue. The text is in the `span`.
   - **Caveats:**
     - **Queue-gated.** A queue redirect comes back as a 200 `text/html` page holding `window.location.replace('…/site-queue/waiting-room/…')`.
     - **Without the `Referer`:** a 302 to `/` and then to `/search-availability/information/`. This looks like success after following redirects, so check the final URL and that `#campground-details` is present.
     - **While a hold is in the session** (the provider partition holds the `ps_booking` cookie): only an "Oops!" block renders. A site closure does the same. Fall back to the cached copy.
     - **The GET doesn't disturb a hold.** `BookingTimerMiddleware` skips this path (`middleware.py:54`).
     - **Scraping is brittle** against template changes. DBCA's terms for reusing page content are unknown; this is a stakeholder decision.
   - Never take dog or campfire facts from `/api/campgrounds/{id}/`. Its `dog_permitted` and `campfires_allowed` are true unless a legacy `NO DOGS`/`NO CAMPFIRES` feature is attached, so Bungarra reads true for both, which is wrong.

4. **The map PDF** is the availability view's `map`, a site-relative path or null (`api.py:1346`), which the app drops today.
   - **URL:** `https://parkstay.dbca.wa.gov.au/media/parkstay/campground_maps/<id>/<uploaded name>.pdf`. Take the name from `map`; never build it.
   - **Format:** `application/pdf`, one A4 page. Bungarra's is 86 KB and Lucky Bay's 383 KB.
   - **Access:** public, with no cookie, `Referer` or queue session needed; `/media` is not queue-gated.
   - **Headers:** `Cache-Control: public, max-age=3600`, `X-Frame-Options: DENY` (no iframe) and `Referrer-Policy: same-origin`.
   - **Coverage:** the field can be null, and no list endpoint carries it.
   - **A missing file** may answer 200 `text/plain` "ERROR opening file" (django-media-serv, not probed), so check the content type.

5. **Why the "View on ParkStay" link fails.** The app's URL, `/search-availability/campground/?site_id=<id>[&arrival&departure&num_adult]`, is ParkStay's own form. But the view refuses any request whose `Referer` is not one it accepts (`views.py:1322-1338`): 302 to `/`, then to `/search-availability/information/` with "A error occured accessing the system, please try again".
   - `shell.openExternal` sends no `Referer`, so "View on ParkStay", "Book on ParkStay" and the dated link always fail.
   - **What works from the system browser:** `https://parkstay.dbca.wa.gov.au/search-availability/information/?campground_id=<id>&arrival=YYYY/MM/DD&departure=YYYY/MM/DD`.
     - It has no `Referer` check (`views.py:1209-1258`).
     - It preselects the campground and dates. Without dates it fills in tomorrow.
     - Its "See availability" opens the campground page, sending ParkStay as the `Referer`.
     - It ignores guest counts (2 adults).
   - The campground page itself works only with a ParkStay `Referer`, so only from an in-app window, for example `loadURL(url, { httpReferrer })`. It shows "Oops!" while a hold is in progress.
   - Its guest parameters are `num_children` and `num_infants`, not the API's `num_child` and `num_infant`.

6. **Side note:** ParkStay's live page now calls the queue at `queue-endpoint.dbca.wa.gov.au`. The app uses `queue.dbca.wa.gov.au` (last verified 2026-04-06). Worth a separate read-only check.

The evidence (screenshots, network logs, trimmed JSON, HTML snippets and the two PDFs) was kept in the orchestrator's scratchpad, `parkstay-details/`.
