# RAC Parks & Resorts: booking flow and data (research)

Date: 2026-10-16 (evening, Perth time). Method: anonymous, read-only requests to the live site with curl (default User-Agent) and one page load in headless Chromium (no clicks). No cart, hold, booking, sign-in or member number was used. Raw captures and scripts are in the session scratchpad; trimmed samples are listed at the end.

Confidence labels: **verified live** (seen in a live response), **from JS** (read in the site's JavaScript, not exercised), **inferred** (reasoned from evidence, not seen directly).

## Summary

- The site is a WordPress multisite on WP Engine behind Cloudflare. Each park is a sub-site (`/<slug>/`) with a numeric WordPress `blog_id`. The booking engine behind it is **NewBook** (version `2025.03.12`), one NewBook instance per park, proxied through the RAC domain.
- **Catalogue:** 9 RAC parks, plus Rose Gardens Holiday Park, which RAC lists among its locations but runs on its own domain. 8 RAC parks are bookable online (Ningaloo is closed for redevelopment). The park list, `blog_id`, categories and NewBook category ids come from each park's `/<slug>/book-now/` HTML; address and lat/lng come from `/<slug>/contact-us/`.
- **Availability:** one anonymous `POST` to `availability-ajax.php` with `blog_id`, dates and guests returns every category of that park, per night: free site count, a status code, and every rate (Standard and RAC Member) with per-night prices. Plain HTTP works. It needs `X-Requested-With: XMLHttpRequest` (otherwise `No direct file access`). No cookie, nonce or CSRF token is needed.
- **Bulk:** one request covers all categories of one park for a date range. There is no all-parks query: one request per park.
- **Inventory is per category**, not per site. Site selection is off (`site_selection_allowed: false`). The engine reports a count of free sites per night and a count of sites free for the whole stay.
- **Booking window:** 364 days. The last bookable night is today + 364 days (Perth). Later nights return site code 9 "Maximum Advance Days has been exceeded". See section 4 for the midnight roll-over test.
- **Member early access:** school-holiday periods are released on fixed dates, 48 h early for RAC members, at 7, 8 or 9 am depending on the park. Members prove membership by entering their RAC member number in NewBook's checkout ("Existing RAC member" → "Member Number" → "Verify member details"). Member prices are visible anonymously as the "RAC Member Rate" tariff.
- **Cart and checkout** run on the RAC domain (`/<slug>/booking/`, the NewBook online engine rendered server-side). "Book now" navigates to an `online_cart_url` that the availability response already contains. Card details go straight to `apiau.newbook.cloud/cc_secure/<id>`. NewBook's JS supports timed holds with an "Extend" link; whether RAC turns them on, and for how long, is unknown.
- **Accounts:** an optional NewBook guest account per park (`/<slug>/booking/?login`, email and password, CSRF token, reCAPTCHA). It is also the only "manage booking" route found. There is no public lookup by reference and surname.
- **Queue and bot protection:** no Queue-it or waiting room found. Cloudflare bot management is active (`__cf_bm`, JS detections, a challenge for some User-Agents). `robots.txt` asks for `Crawl-delay: 10`. No 429 or rate-limit headers were seen.

## 1. Catalogue

**Findings (verified live).**

The home page location picker lists the parks and links each to its book-now page (`data-path`). The `blog_id` is on the book-now page's search button (`<button id="availability__search" data-blog-id="6">`) for the five parks that use RAC's own widget. For the three parks that embed NewBook's native engine on book-now, the `blog_id` comes from the upload path (`/<slug>/wp-content/uploads/sites/<blog_id>/`) and was confirmed by a successful availability query (Exmouth 3, Monkey Mia 2). Karri Valley (7) is confirmed in section 4.

| Park | Slug | blog_id | Book-now widget | NewBook `cc_secure` id | Address | Lat, lng |
| --- | --- | --- | --- | --- | --- | --- |
| RAC Busselton Holiday Park | `busselton` | 6 | RAC widget | 1230 | 97 Caves Road, Abbey, WA 6280 | -33.6611769, 115.2487607 |
| RAC Cable Beach Holiday Park | `cable-beach` | 9 | RAC widget | (not fetched) | 1 Murray Road, Cable Beach, WA 6726 | -17.9356448, 122.2141982 |
| RAC Cervantes Holiday Park | `cervantes` | 5 | RAC widget | (not fetched) | 35 Aragon Street, Cervantes, WA 6511 | -30.4979022, 115.0669404 |
| RAC Esperance Holiday Park | `esperance` | 10 | RAC widget | (not fetched) | Goldfields Road, Esperance, WA 6450 | -33.8448715, 121.9017562 |
| RAC Exmouth Cape Holiday Park | `exmouth` | 3 | NewBook native | 1048 | 3 Truscott Cres, Exmouth, WA 6707 | -21.9385751, 114.1323242 |
| RAC Karri Valley Resort | `karri-valley` | 7 | NewBook native | 1686 | 11342 Vasse Highway, Beedelup, WA 6260 | -34.4205734, 115.850881 |
| RAC Margaret River Nature Park | `margaret-river` | 8 | RAC widget | (not fetched) | Lot 352 McQueen Road, Margaret River, WA 6285 | -33.9346726, 115.077829 |
| RAC Monkey Mia Dolphin Resort | `monkey-mia` | 2 | NewBook native | 1042 | 1 Monkey Mia Road, Monkey Mia, WA 6537 | -25.7936732, 113.7183656 |
| RAC Ningaloo Reef Resort | `ningaloo` | 4 | NewBook native, closed | 1041 | (not fetched) | (not fetched) |

- Region names ("South West, Western Australia", "Coral Coast, …") are in `<span class="page-banner__location">` on each park page and on `/locations/`.
- Ningaloo's book-now page says "Bookings for RAC Ningaloo Reef Resort are not yet open" (redevelopment).
- "Rose Gardens Holiday Park" (`https://rosegardensholidaypark.com.au/book-now/`) is in the same multisite, the same location picker and the footer's "Our locations", but is not RAC-branded and is excluded from the school-holiday process. Not researched further.
- **Ids.** A park's stable id for us is its slug (or `blog_id`). The NewBook instance is not exposed by a single id: each park has its own NewBook proxy file (`/<slug>/wp-content/themes/parks-and-resorts/inc/newbook/api/rac-<park-name>.php`) and its own `cc_secure/<id>` number, which is probably the NewBook instance id (inferred). Category ids repeat across parks, so a category key must be `(park, category_id)`. Example: category 3 is "Studio Room" at Busselton and "Powered Tent Site" at Cervantes; category type 2 means cabins at Cable Beach and Margaret River but sites at Busselton.
- **Address and coordinates:** `/<slug>/contact-us/` has "Address: …", phone, a reservations email and a "View on Google Maps" link `https://www.google.com/maps/search/?api=1&query=<lat>,<lng>`. Verified for the 8 open parks.
- **Photos:** NewBook-hosted images, `https://driveau.newbook.cloud/crop_800_450/instances_d895bd707965db25abb932aba767878f_<id>.jpg`, with `alt` text, in each category's gallery on the book-now page. The hash is shared by all parks.
- **Descriptions:** the book-now page has a short description excerpt and a feature list per category, plus a link to the category page `/<slug>/accommodation/<post-slug>/` (`data-post-link`). The WordPress REST API also lists the category posts: `GET /<slug>/wp-json/wp/v2/accommodation?per_page=50` returned 11 posts for Busselton (`x-wp-total: 11`), with feature taxonomy terms (`newbook_features`, slugs like `power`, `water`, `sullage_point`, `bathroom`, `wheelchair_accessible` in `class_list`) but no NewBook category id and an empty `content`.

Evidence: `GET https://parksandresorts.rac.com.au/busselton/contact-us/` → `Address: 97 Caves Road, Abbey, WA 6280` and `…/maps/search/?api=1&query=-33.6611769,115.2487607`.

## 2. Accommodation types

**Findings (verified live).** Each category on a book-now page (RAC widget parks) is a `<div class="accommodation-item">` with:

```html
<div id="accommodation_item_765" class="accommodation-item" data-title="Powered Site"
  data-cat-id="4" data-cat-type-id="2" data-max-guests="6" data-bedrooms="0" data-bathrooms="false"
  data-max-animals="2" data-accessible="false" data-features="…" data-menu-order="12" data-active="true"
  data-allowed-equipment="2,1,15,12,6,5,4,10,3,14,11,13,7,9">
```

- `data-cat-id` is the NewBook category id. `data-cat-type-id` is the NewBook category type (per park: Busselton 5 = Cabins, 2 = Sites; Cervantes 1 = Cabins, 2 = Sites; Margaret River 2 = Cabins, 4 = Dorm, 5 = Sites; Monkey Mia uses 1, 2 and 7 = dorms). The type filter on the page lists the types with their ids.
- `data-max-guests`, `data-max-animals` (0 = no pets), `data-bedrooms`, `data-accessible`.
- `data-allowed-equipment`: equipment type ids the site category accepts, or `false` for cabins. Equipment ids are the same list in every park: 1 Caravan with Awning, 2 Caravan Without Awning, 3 Campervan, 4/5/6 Camper Trailer small/medium/large, 7 Car and Multiroom Tent, 8 5th Wheeler, 9 Bus, 10 Motorhome, 11 Car & Swag (with trailer), 12 Rooftop Tent, 13 Car and Single Room Tent, 14 Car & Swag (no trailer), 15 Caravan with Slideout.
- Sites need equipment details to book: the "Book now" button on a site opens an equipment modal (type, length, width, unit `m` or feet) and re-checks availability with them. Searching itself does not need them.
- Counts seen: Busselton 11 categories (7 cabins/studio, 4 sites, plus "Pet Friendly Powered Site" 30 in the API only), Cable Beach 6, Cervantes 9, Esperance 18, Margaret River 7 (with dorms of 5, 14 and 26 beds), Exmouth 17 and Monkey Mia 16 (from the API).
- The API can return categories that the page does not list (Busselton 30 "Pet Friendly Powered Site"), and categories that are permanently closed (Exmouth "This Site is closed as of Tue 9 Jun 2026", site code 2).
- **Per-site inventory: no.** Every tariff seen has `site_selection_allowed: false` and `site_selection_type: null`. The API gives a count of free sites per night (`sites_available`) and a count of sites free for the whole stay (`stay_through_sites_available`). The whole-stay count can be lower than every per-night count (Busselton powered site, 6–8 Nov 2026: 53 and 55 free per night, 51 for the stay), so a stay can in principle fail while every night shows free sites. The page checks both.

Sample: `samples/book-now-busselton-excerpt.html`, `samples/catalog-book-now-pages-derived.json`.

## 3. Availability search

**Request (verified live).**

```
POST https://parksandresorts.rac.com.au/wp-content/themes/parks-and-resorts/template-parts/components/booking-engine/availability-ajax.php
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
X-Requested-With: XMLHttpRequest
Origin: https://parksandresorts.rac.com.au
Referer: https://parksandresorts.rac.com.au/busselton/book-now/

blog_id=6&available_from=6+Nov+2026&available_to=8+Nov+2026&adults=2&children=0&infants=0&animals=0
&equipment_type_ids=all&equipment_measurement_unit=m&equipment_length=&equipment_width=
```

- The path is at the site root, not under `/<slug>/`. The park is chosen by `blog_id`. It works for the RAC-widget parks and for the NewBook-native parks (verified for blog 6, 3 and 2).
- Dates: the page sends `D MMM YYYY` (`6 Nov 2026`). The calendar code sends `DD-MM-YYYY` (from JS). `available_to` is the departure date; nights are `available_from` … `available_to - 1`.
- Guests: `adults` (18+), `children` (4–17), `infants` (0–3), `animals`. The page caps each at 10 (the NewBook engine at 6).
- Optional: `category_id` (one category, used by the calendar and "next available" code, from JS), `equipment_type_ids` with `equipment_length`/`equipment_width` (site fit).
- There is no member or promo parameter. The response always carries every tariff, Standard and Member. The page's "Membership type" select (`membership_type=member|non-member`) only chooses which tariff to show.
- **Headers needed (verified live):** without `X-Requested-With` the server answers `200` with the text `No direct file access`. With `X-Requested-With` it answers JSON (one transient `520`, section 10). No cookies, nonce or CSRF token are needed. The browser's own request carried only Cloudflare cookies (`__cf_bm`, `_cfuvid`).
- Latency: 4–8 s per request (the server calls NewBook). Size: 150–400 KB for all categories over 2–7 nights. `Content-Type: text/html` although the body is JSON. `cache-control: no-store`. The response sets a `PHPSESSID` cookie.

**Response (verified live, trimmed).**

```json
{"success":"true","message":"","timestamp":"2026-10-16 23:35:15","timezone":"Australia/West",
 "newbook_version":"2025.03.12-6acd5eef54202","api_key":"<redacted>",
 "data":{"4":{"category_id":4,"category_type_id":"2","category_name":"Powered Site",
   "sites_available":{"2026-11-06":53,"2026-11-07":55},
   "sites_code":{"2026-11-06":0,"2026-11-07":0},"sites_message":{"2026-11-06":"","2026-11-07":""},
   "stay_through_sites_available":51,"stay_through_sites_code":0,"stay_through_sites_message":"",
   "online_booking_url":"https://parksandresorts.rac.com.au/busselton/booking/?available_from=2026-11-06&available_to=2026-11-08&force_category_id=4&adults=2&children=0&infants=0&animals=0",
   "tariffs_available":[
    {"tariff_label":"Standard Rate","tariff_short_description":"Our most flexible rate","tariff_success":"true",
     "tariff_code":0,"tariff_message":"","tariff_total":150,"average_nightly_tariff":75,
     "tariffs_quoted":{"2026-11-06":{"amount":75,"tariff_name":"Powered Site ALPHA","minimum_periods":"1",
        "tariffs_period_name":"Mid Season","max_days_in_advance":"0","close_arrival":"0","close_departure":"0"}, "…"},
     "deposits":[{"amount":"75.00","due_date":"19 Oct 2026","due_date_text":"3 Days After Booking Placed"}],
     "adjustment_fees":[{"template_name":"Cancellation LESS THAN 72 Hours","computed_amount":75}],
     "membership_discount_pricing":[{"membership_id":"2","membership_name":"RAC","service_class":"Membership_Service_RAC","discount_name":"Applied in Rate","discount_amount":0}],
     "tariff_inclusions":[{"dates":"6 Nov 2026 to 7 Nov 2026","html":"<p><strong>Rate inclusions</strong>…"}],
     "site_selection_allowed":false,"special_deal":"0",
     "online_cart_url":"https://parksandresorts.rac.com.au/busselton/booking/?cart&rest_api_data_id=<32 hex>&rand=<n>"},
    {"tariff_label":"RAC Member Rate","tariff_short_description":"Exclusive to RAC WA members","tariff_total":136, "…"},
    {"tariff_label":"Stay & Save This Spring","tariff_success":"false","tariff_code":6,
     "tariff_message":"This Rate has a 3 Night Minimum","tariff_extra_info":"3","special_deal":"3", "…"}]}}}
```

- **Free or not:** the page treats a category as bookable for a tariff when `tariff_success == "true"`, every night's `sites_available > 0` and `stay_through_sites_available > 0`. `online_cart_url` is present only then (verified: present on bookable tariffs, absent on sold-out ones).
- **Per-night prices:** `tariffs_quoted[date].amount`. Total: `tariff_total`. Member price: the "RAC Member Rate" tariff (Busselton powered site 2 nights: $150 standard, $136 member; studio: $630 and $547). Promotions appear as more tariffs, with member variants ("Stay & Save This Spring - RAC Member").
- **Minimum stay and arrival rules:** per night in `tariffs_quoted` (`minimum_periods`, `close_arrival`, `close_departure`) and as refusals: tariff code 6 with a message, e.g. "This Rate has a 3 Night Minimum; Bookings are not allowed to Arrive on 25 Sep 2027 using this Rate".
- **Sold out vs closed vs not yet open:** site codes per night (`sites_code`): 0 ok, 2 closed ("This Site is closed as of …"), 3 no availability, 9 beyond the booking window. Stay-through code 4: special date ("Bookings are not allowed to Arrive on <strong>20 Nov 2027</strong> - School leavers 2027"). Tariff codes: 0 ok, 5 beyond the tariff's advance limit, 6 minimum nights, 8 special date, 11 stop sold ("This Rate is Stop Sold"). Messages can join several reasons with `; ` and contain HTML (`<strong>`). The full code lists are in the JS (below).
- When `tariff_success` is `"false"`, `tariff_total` can be a placeholder (`999` for the blocked Leavers date), so ignore prices on refused tariffs.
- **Deposit and cancellation** terms per tariff (`deposits`, `adjustment_fees`, `tariff_inclusions` HTML).
- `api_key`: the response echoes a 42-character key. It is presumably RAC's NewBook API key. It is redacted from every sample. WA Stay must never read, store or use it.

Code lists, from `availability-filters.js` comments (from JS):

| Tariff code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Invalid parameters |
| 2 / 3 | Minimum / maximum occupants not met / exceeded |
| 4 / 5 | Minimum / maximum days in advance not met / exceeded |
| 6 / 7 | Minimum / maximum nights not met / exceeded |
| 8 | Special date blocking |
| 9 / 10 | Closed to arrival / departure |
| 11 | Stop sold |

| Site code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Invalid parameters |
| 2 | Site not yet open or already closed |
| 3 | No availability |
| 4 | Special date blocking |
| 5 | An allotment takes the last availability |
| 6 | Dirty site (same-day arrivals) |
| 7 | Daily stop-sell time passed (same-day arrivals) |
| 8 / 9 | Instance minimum / maximum advance days for online bookings |

**Bulk:** one request returns all categories of one park. The calendar code asks for one category from the first of a month to the end of the next month (about 60 nights) in one request (from JS); the longest range tested live was 7 nights. There is no all-parks request.

Samples: `samples/availability-busselton-2026-11-06-2n.json`, `samples/availability-busselton-schoolhol-min-stay-2027-09-25-2n.json`, `samples/availability-exmouth-stop-sold-closed-2027-10-13-7n.json`, `samples/availability-ajax-without-x-requested-with.txt`.

Confidence: verified live (request, headers, fields, codes 0/2/3/5/6/9/11); from JS (code meanings, `category_id`, `DD-MM-YYYY`, long ranges).

## 4. Booking window

**Stated rules.**

- JS message for tariff code 5: "We open bookings 364 days in advance and have release dates for key periods such as the WA school holidays." (from JS)
- Booking policy 6.5 mentions "within 364 days of your Departure Date" for Anytime Repeat Bookings.
- The NewBook engine's date picker on `/busselton/booking/` had `"minDate":"17 Oct 2026"`, `"maxDate":"15 Oct 2027"` at 23:39 AWST on 16 Oct 2026 (today + 364). The cached native book-now pages showed Karri Valley `15 Oct 2027`, Monkey Mia `16 Oct 2027` and Exmouth `Mon 18 Oct 2027`. These picker limits do not match the data exactly, so trust the per-night codes, not the picker.
- The book-now widget's own picker allows today + 1 year (`maxDate: moment().add(1, "years")`).

**Live boundary tests (verified live).** Today is 2026-10-16. Arrival offsets: 362 d = 2027-10-13, 363 d = 10-14, 364 d = 10-15, 365 d = 10-16, 366 d = 10-17, 400 d = 2027-11-20.

| Time (AWST) | Park | Range | Result |
| --- | --- | --- | --- |
| 16 Oct 23:36 | Busselton (6) | nights 13–18 Oct 2027 | 13, 14, 15 Oct open (code 0); 16, 17, 18 Oct code 9 "Maximum Advance Days has been exceeded, so there are no Sites available" in all 12 categories |
| 16 Oct 23:41 | Exmouth (3) | nights 13–19 Oct 2027 | same boundary: last open night 15 Oct |
| 16 Oct 23:42 | Monkey Mia (2) | nights 14–17 Oct 2027 | same boundary in 15 of 16 categories. "Budget Room Shared Bathroom" had sites on 16 Oct, but both tariffs refused with code 5 "This Rate must be Booked at most 364 days in advance" |
| 16 Oct 23:49 | Busselton (6) | night 20 Nov 2027 (400 d) | site code 9 in all categories; also stay-through code 4 and tariff code 8 "Bookings are not allowed to Arrive on 20 Nov 2027 - School leavers 2027" (a special date already set beyond the window) |
| MIDNIGHT_ROWS |

So: the last bookable night is today + 364 days in Perth time. It is enforced twice: by the instance setting (site code 9) and by each tariff's `max_days_in_advance: "364"` (tariff code 5).

MIDNIGHT_FINDINGS

**Fixed releases.** Some periods inside the window are held back and released on a fixed date and time (section 5). Before release those nights must be blocked by a rule in NewBook (probably tariff code 8 "special date" or 11 "stop sold"). This was not observed: no held-back period is inside the window today (the Sept/Oct 2027 holidays went on public sale today; the next release covers Dec 2027, which is beyond the window). Other blocks seen on book-now pages, by date range: per-park notices with `data-date-from`/`data-date-to` (e.g. Busselton Leavers week 21–28 Nov 2026: "does not accept Leavers attendees", phone bookings only).

Sample: `samples/availability-busselton-window-edge-2027-10-13-6n.json`.

## 5. RAC member early access

**Source:** `https://parksandresorts.rac.com.au/school-holiday-bookings/` (verified live), booking policy sections 8 and 9.

- "If you're an RAC member, you will have access to book via priority pre-sale for 48 hours before bookings will be open to the general public. You will need to enter your RAC member number when making your booking."
- Order: repeat bookings first (in person at reception, before 5 pm the day before pre-sale), then the member pre-sale, then the public release.
- Upcoming releases:

| WA holiday period | Member pre-sale | Public release |
| --- | --- | --- |
| 24 Sep 2027 – 9 Oct 2027 | 14 Oct 2026 | 16 Oct 2026 |
| 17 Dec 2027 – 31 Jan 2028 | 3 Feb 2027 | 5 Feb 2027 |
| 7 Apr 2028 – 24 Apr 2028 | 28 Apr 2027 | 30 Apr 2027 |

- Release times (the page gives no time zone; Perth time assumed): 7 am Esperance and Margaret River (online only, phones from 8 am); 8 am Monkey Mia, Busselton, Karri Valley; 9 am Cervantes and Exmouth. Cable Beach, Ningaloo and Rose Gardens are not in the pre-sale. Margaret River dorms are excluded. Booking rules (minimum nights, arrival days) are published a week before each release, per park.
- **How membership is proven:** in NewBook's checkout. The engine's language strings (from page data, not exercised): "Existing ##MEMBERSHIP_TYPE## member", "Member Number", "Verify member details", "Please validate your Membership to proceed with this Members-Only ##TARIFF##", "Unable to find a matching membership based on the provided membership number". The availability response's member text says: "please enter your RAC member number via the 'Existing RAC member' button below". RAC's script `nbo-scripts.js` strips `-` from `#membership_number`. The membership service is `service_class: "Membership_Service_RAC"`, `membership_id: "2"`. No myRAC sign-in is used.
- **Discount:** the member price is its own tariff ("RAC Member Rate", "Exclusive to RAC WA members", `discount_name: "Applied in Rate"`), so it shows in anonymous availability. The old JS note says the discount is applied after verifying membership in step 2 of checkout.
- **Pre-sale mechanism (inferred):** during the 48 h only members-only tariffs are open, and checkout requires member validation. Not observed live (no pre-sale is running now; the next is 3 Feb 2027).

## 6. Cart, hold and checkout

All of this is **from JS** or page markup. Nothing was added to a cart.

- **Book now:** `setOnlineCartUrl` sets `window.location` to the chosen tariff's `online_cart_url`: `https://parksandresorts.rac.com.au/<slug>/booking/?cart&rest_api_data_id=<32 hex>&rand=<n>`. The id refers to data the availability call stored server-side. For sites the equipment modal runs first and a new availability call returns a cart URL for that equipment. WA Stay must not open or prefetch this URL: it adds the stay to a cart.
- A second endpoint exists but its call is commented out: `POST /wp-content/themes/parks-and-resorts/template-parts/components/booking-engine/get-online-cart-url-ajax.php` (`blog_id`, `category_id`, dates, guests). Not called.
- **Checkout host:** the RAC domain. `/<slug>/booking/` is the NewBook online engine rendered by WordPress. Its form `#newbook_online_main_form` posts to `/<slug>/booking/?cart=Booking` with `newbook_api_action=cart`. Its AJAX goes to the park's proxy `newbook_api_path` = `/<slug>/wp-content/themes/parks-and-resorts/inc/newbook/api/rac-<park>.php?newbook_api_action=data&query=…` (`remove_item_from_cart`, `modify_booking_guests`, `online_checkout_membership_fields`, `extend_multiple_holds`, `state`, `location`).
- **Payment:** card fields (`card_number`, `card_expiry`, `card_cvv`, `card_name`, `online_cart_id`) are posted by the browser straight to `https://apiau.newbook.cloud/cc_secure/<id>` (Busselton 1230), which returns a `secure_store_id`. A Stripe flow also exists in the code. Page flags: `cc_gateway = true`, `gateway_redirect_payment = false`, `online_bookings_preauth_only = false`. So payment is a NewBook-handled card form inside the RAC page, not a redirect.
- **Deposit:** per tariff in the availability response (e.g. one night due 3 days after booking, the rest 3 days before arrival). Booking policy: deposit up to the full cost; balance charged 3 days before arrival; full payment for arrivals within 7 days.
- **Holds (from JS, `nb_common.min.js`):** NewBook's engine supports timed holds. A cart page can carry `hold_ids[]`, `earliest_hold_expires_when` (seconds) and `default_hold_duration` (minutes). A countdown shows "Booking hold lasts for mm:ss minutes". With 5 minutes or less left an "Extend" link calls `POST newbook_api_path + 'newbook_api_action=data'` with `query=extend_multiple_holds&hold_ids=…`. On expiry: "Booking session expired. Bookings hold a site for a period of N minutes. You may continue with your booking without the guarantee of availability, or you can restart the booking process." Whether RAC enables holds and the duration are unknown: the fields only appear on a cart page. The school-holiday FAQ says: "Accommodation is only secured once you have completed your booking and received a booking confirmation."
- **Account at checkout:** strings "Already registered?", "Register account", "Don't have an account?" suggest guest checkout with an optional account (inferred). reCAPTCHA is loaded on the engine pages (login page: "This site is protected by reCAPTCHA"); where it is enforced in checkout is unknown.
- **Booking reference:** NewBook's numeric booking id ("your booking reference is ###BOOKING_ID##").

## 7. Accounts and sign-in

- **NewBook guest account, per park** (verified live page, not used): `GET /<slug>/booking/?login` shows "Account login" with `username` (email), `password`, hidden `csrf_token`, `login_2fa_token`, `redirect_action`, `redirect_params`; links "Create account" and `?password_reset`. The header "Log in" button on every park sub-site page points there (not on the root home page). reCAPTCHA protects it.
- Whether one account works across parks is unknown (each park is its own NewBook instance, so probably not).
- **Not needed to search.** Probably not needed to book (guest checkout, inferred).
- **RAC membership** is a member number typed at checkout, not a sign-in. myRAC (rac.com.au) is only mentioned as where to find the number.

## 8. Manage booking and import

- No public lookup by reference plus surname or email was found. The login page's breadcrumb reads "Manage Booking", so managing a booking means signing in to the park's NewBook guest account.
- NewBook's chatbot strings mention "What is your booking number?" and "the booking number or last name you gave were incorrect", but no chatbot was seen on the pages fetched.
- Import would need the person's NewBook session per park (a `browser-session` sign-in on `persist:provider-<id>`). The account pages after sign-in were not seen. Unknown whether bookings made without an account appear there.

## 9. Waiting room and queue

- No Queue-it, Cloudflare Waiting Room or other queue markup, script or cookie in any page or script fetched (searched for `queue-it`, `queueit`, `waitingroom`, `waiting room`, `cfwaitingroom`).
- The school-holiday FAQ asks people not to book on several devices "as this puts strain on our website and will impact load times", and warns of long phone queues. That suggests no queue, but a Cloudflare waiting room could be switched on for release mornings without any trace today.
- NewBook pages contain a hidden `<div id="newbook_spider_check">` (bot check, purpose unknown).

## 10. Rate limits and bot protection

- **Cloudflare** on every response (`server: cloudflare`, `cf-ray`, `__cf_bm` cookie with 30-min expiry, `_cfuvid`). Pages load Cloudflare's JavaScript detections (`/cdn-cgi/challenge-platform/scripts/jsd/main.js`), whose `oneshot` POST set a `cf_clearance` cookie in the headless browser. The orchestrator saw a Cloudflare challenge for `User-Agent: Mozilla/5.0`. In this run curl's default User-Agent and headless Chromium (`HeadlessChrome/141`) were never challenged. Nothing was done to evade Cloudflare.
- **Origin:** WP Engine (`x-powered-by: WP Engine`). Pages are cached (`x-cache: HIT`, `cache-control: max-age=600`); availability is `no-store`.
- **Availability header test (verified live):**

| Request headers | Result |
| --- | --- |
| none (curl default) | `200` text `No direct file access` |
| `X-Requested-With` only (16 Oct 23:33) | `520` Cloudflare "Web server is returning an unknown error" |
| `X-Requested-With` + `Origin` + `Referer` | `200` JSON |
| `X-Requested-With` only (16 Oct 23:49) | `200` JSON |

  So the only header the endpoint needs is `X-Requested-With: XMLHttpRequest`. The first 520 was a transient origin error (cause unknown). Sending `Origin` and `Referer` as the page does costs nothing and is closer to the browser.

- No `429`, `Retry-After` or rate-limit headers in 60+ requests at 1–1.5 s spacing.
- `robots.txt`: `Crawl-delay: 10`, nothing disallowed, a sitemap per park.
- **Terms:** the RAC website disclaimer (`https://rac.com.au/about-rac/site-info/disclaimer`) allows material to be downloaded only "for your own personal non-commercial home use" and forbids derivative works. It does not mention automated access. A personal desktop app checking availability for its own user fits the personal-use wording best; republishing photos or descriptions does not.

## 11. Links

Stable links for the system browser:

- Park home: `https://parksandresorts.rac.com.au/<slug>/`
- Contact (address, map): `https://parksandresorts.rac.com.au/<slug>/contact-us/`
- Book-now with search prefilled (verified live for Busselton: the page rendered 6 Nov 2026 – 8 Nov 2026 and searched): `https://parksandresorts.rac.com.au/<slug>/book-now/?available_from=YYYY-MM-DD&available_to=YYYY-MM-DD&adults=2&children=0&infants=0&pets=0&membership_type=non-member|member`. For the NewBook-native parks the same parameters are untested.
- Category page: `https://parksandresorts.rac.com.au/<slug>/accommodation/<post-slug>/?available_from=YYYY-MM-DD&available_to=YYYY-MM-DD&adults=…&children=…&infants=…&animals=…` (the page JS builds this link).
- NewBook engine with dates and one category, no cart (`online_booking_url` in each availability response): `https://parksandresorts.rac.com.au/<slug>/booking/?available_from=YYYY-MM-DD&available_to=YYYY-MM-DD&force_category_id=<id>&adults=…&children=…&infants=…&animals=…`. The URL comes from the live response; opening it was not tested.
- School-holiday release page: `https://parksandresorts.rac.com.au/school-holiday-bookings/`.
- Never link to `online_cart_url` (`/<slug>/booking/?cart&rest_api_data_id=…`).

## Endpoint table

| Name | Method | URL | Params | Auth / headers | Verified? |
| --- | --- | --- | --- | --- | --- |
| Park list | GET | `/` (location picker), `/locations/` | – | none | live |
| Book-now page (catalogue) | GET | `/<slug>/book-now/` | optional `available_from`, `available_to` (YYYY-MM-DD), `adults`, `children`, `infants`, `pets`, `membership_type` | none | live |
| Contact page (address, lat/lng) | GET | `/<slug>/contact-us/` | – | none | live |
| Category posts | GET | `/<slug>/wp-json/wp/v2/accommodation?per_page=50` | – | none | live |
| Availability | POST | `/wp-content/themes/parks-and-resorts/template-parts/components/booking-engine/availability-ajax.php` | `blog_id`, `available_from`, `available_to`, `adults`, `children`, `infants`, `animals`, `equipment_type_ids`, `equipment_measurement_unit`, `equipment_length`, `equipment_width`, optional `category_id` | `X-Requested-With: XMLHttpRequest` required; `Origin`, `Referer` optional; no cookies | live |
| Cart URL | POST | `/wp-content/themes/parks-and-resorts/template-parts/components/booking-engine/get-online-cart-url-ajax.php` | `blog_id`, `category_id`, dates, guests | as availability | from JS (unused by the page; not called) |
| Add to cart | GET | `online_cart_url` = `/<slug>/booking/?cart&rest_api_data_id=…&rand=…` | – | session cookie | from JS, not exercised (creates a cart) |
| NewBook engine | GET/POST | `/<slug>/booking/` (`?cart=Booking`, `?login`, `?password_reset`) | form `newbook_online_main_form` | `PHPSESSID`, CSRF on login | page GET live; posts not exercised |
| NewBook proxy | POST | `/<slug>/wp-content/themes/parks-and-resorts/inc/newbook/api/rac-<park>.php?newbook_api_action=data&query=…` | `extend_multiple_holds`, `remove_item_from_cart`, `modify_booking_guests`, `online_checkout_membership_fields`, … | session | from JS, not exercised |
| Card store | POST | `https://apiau.newbook.cloud/cc_secure/<id>` | `online_cart_id`, card fields | session | from JS, not exercised |
| Images | GET | `https://driveau.newbook.cloud/crop_800_450/instances_<hash>_<id>.jpg` | – | none | seen in pages |

## Risks and unknowns

1. **Bot protection.** Cloudflare challenged one User-Agent and runs JS detections. Electron's `net.request` on a provider partition sends a Chrome User-Agent and keeps cookies, so it will probably pass like the headless browser did, but this is untested from the app. A challenge must be treated as "unavailable", never solved or evaded. Release mornings are the most likely time for stricter rules or a waiting room.
2. **Undocumented endpoint.** `availability-ajax.php` is a theme file, not a public API. It can change with any theme update (`ver=2.0.9`). Its guard (`X-Requested-With`) shows it is meant for the page only. It is slow (4–8 s), heavy (up to 400 KB) and returned one transient 520, so watches should poll gently (robots.txt asks for 10 s between requests) and treat 5xx as "try later".
3. **Holds and member pre-sale unseen.** Whether adding to the cart holds a site (and for how long), and how pre-sale nights look in the API before and during release, could not be observed anonymously or today. Site Sniper for RAC needs both. The next chance to observe a release is 3 Feb 2027 (member pre-sale) and 5 Feb 2027 (public), read-only.
4. The response contains an `api_key`. Never store, log or use it; samples have it redacted.
5. Terms: "personal non-commercial home use" only. Confirm with the stakeholder that a desktop app used by one person fits, and do not ship RAC photos or descriptions in fixtures or the website.
6. Each park is a separate NewBook instance: separate accounts, separate category ids, and possibly different rules (picker limits differed by park).
7. Rose Gardens Holiday Park (other domain, same multisite) was not researched.

## Samples

Folder: `/tmp/claude-0/-home-user/e72a82ef-d2a5-54f7-81bf-ebe78d68796c/scratchpad/rac-research/samples/` (copy into `tests/fixtures/providers/<id>/` when the provider is built).

- `availability-busselton-2026-11-06-2n.json`: two categories (bookable powered site with Standard, Member and promo tariffs; sold-out ensuite site).
- `availability-busselton-window-edge-2027-10-13-6n.json`: nights 13–18 Oct 2027, code 9 from 16 Oct.
- `availability-busselton-schoolhol-min-stay-2027-09-25-2n.json`: tariff code 6 with minimum-stay and closed-to-arrival message.
- `availability-exmouth-stop-sold-closed-2027-10-13-7n.json`: closed category (site code 2) with stop-sold tariffs (code 11).
- `availability-busselton-leavers-special-date-2027-11-20-1n.json`: 400 days ahead; site code 9, stay-through code 4 and tariff code 8 (special date), placeholder total 999.
- `availability-ajax-without-x-requested-with.txt`: the guard response.
- `book-now-busselton-excerpt.html`: widget markup (blog id, types, equipment), one notice, two category items.
- `catalog-book-now-pages-derived.json`, `parks-catalogue-derived.json`: derived park and category lists.
- `contact-us-busselton-excerpt.txt`, `wp-json-busselton-accommodation-trimmed.json`, `booking-page-busselton-newbook-config-excerpt.txt` (client IP redacted).

All trimmed; `api_key`, cart ids and the client IP are redacted. No personal data.

## Request count used

REQUEST_COUNT
