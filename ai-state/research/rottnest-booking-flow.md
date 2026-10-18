# Stay Rottnest (stayrottnest.com): how the booking site works (research)

Planning research for a possible WA Stay "Rottnest" provider. Date: 17 October 2026 (AWST 18 October). No app code.

**Evidence labels** used on every fact:

- **[live]**: verified by one of my own logged live requests (3 in total, see the request log).
- **[CC]**: from a Common Crawl archive record (WARC fetched from `data.commoncrawl.org`; the site itself was not contacted).
- **[doc]**: from an official Stay Rottnest or RIA PDF (booking T&Cs, FAQ, booking guides, maps), as downloaded into `../terms/` and `../ria/` by the parallel tasks, and read here as data.
- **[search]**: from the web-search index (search-engine snippets and summaries of the indexed page). The wording is the search tool's quotation and is **not verified against the page**.
- **[3rd]**: from a third-party page (P3's case study, trade press, news, RottoWatch).
- **[inferred]**: my inference from the above.

**Wayback Machine:** unavailable for the whole session. Every connection to `web.archive.org`, `wayback.archive.org` and the CDX API was reset by the egress tunnel (`ws_closed_mid_exchange`, 23:32–23:50 UTC, about 12 attempts). The `archive.org/wayback/available` API answered but returned empty for every URL, including `google.com`, so its backend was down too. WebFetch refuses `web.archive.org`. Other archives were tried as fallbacks: `archive.ph` answered 429 (rate limit for this egress), the NLA Australian Web Archive sits behind an Anubis proof-of-work challenge (not attempted), and Arquivo.pt answered 403. Common Crawl was reachable, but it holds only `robots.txt` fetches for both hosts: CCBot never got a page.

---

## Summary

- **Platform.** The site is a custom booking engine built by **P3 Hotel Software** (Dublin and Denver), live since the first week of December 2022 **[3rd]**. It is built on P3's "Essential" base, which is designed to work with **Oracle OPERA**, so OPERA is the likely PMS behind it **[inferred]**. There are two hosts:
  - `www.stayrottnest.com` is the marketing CMS: Laravel (`laravel_session` and `XSRF-TOKEN` cookies), with PDFs under `/cms/stayrottnest/pdfs/` **[live]**.
  - `bookings.stayrottnest.com` is the booking engine: `/search-rates`, `/login`, `/offer(s)` **[search][CC]**.

  Both hosts are behind **Cloudflare**, with the Bot Management cookie `__cf_bm` **[live][CC]**. The origin is on Google Cloud: `via: 1.1 google`, apex IP 34.49.166.218, and nginx reporting `server: p3-web02` **[CC]**.
- **Blocked on the third request.** `robots.txt` (200) and `sitemap.xml` (200) loaded, then `GET https://www.stayrottnest.com/` with curl's default User-Agent got a **Cloudflare managed challenge** (HTTP 403, "Just a moment...", `cType: 'managed'`) **[live]**. As instructed, I stopped all live requests at that point. That meant **0 headless loads, 0 search-page loads, and nothing on `bookings.stayrottnest.com`**. `bookings.` also served a managed challenge to Common Crawl in September 2025 **[CC]**.
- **robots.txt:**
  - `www` has `Allow: /` and lists a sitemap of only 4 URLs **[live]**.
  - `bookings` has `Disallow: /`, with exceptions for `/search-rates`, `/offer` and `/offers` (Last-Modified 2 March 2023) **[CC, Aug 2026]**.
- **Terms.** Clause 4 of the booking T&Cs ("Use of Automated Software") forbids bookings "made or assisted by" automated software, including "web scraping, data mining, rate shopping, booking". It allows RIA to cancel such bookings without refund and to block users and IP addresses **[doc]**. The search page says the T&Cs cover "using this site and booking accommodation" **[search]**. I could not retrieve the separate Disclaimer, Privacy Statement or Terms of Use pages, because of the challenge and the Wayback outage.
- **Catalogue.** There are 69 room types across seven locations **[3rd]**. Unit-number blocks per precinct are known from the map PDFs **[doc]**. A booking is for a **room type at a location**, not a specific unit: unit numbers are assigned about 3 weeks before arrival **[doc]**. There are no per-property web pages and no coordinates: the sitemap lists only the home page, FAQ, accommodation maps and Open Days **[live]**.
- **Search.** You choose a month calendar, "How many bookings?" (up to two units per transaction), adults (18+), children (0–17), locations and location type **[search][doc]**. A "rooms and rates" page shows what is sold out, with an alternative-dates calendar **[3rd]**. **The deep-link URL parameters and the availability API are unknown**: nothing was loaded and no archive copy was reachable.
- **Releases.** Months open 9 months ahead, on the first Wednesday of each month at 8:30 am AWST. On Open Days there is a waiting room (**Queue-it**, from the RIA launch notice **[search]**) that opens at 6 am, gives random positions, requires an **SMS one-time passcode**, and allows 30 minutes to enter the site **[doc]**.
- **Accounts.** Accounts are optional: email and password at `bookings.stayrottnest.com/login`, used for autofill and to see past and future bookings **[search][3rd]**. There is no official waitlist or alert feature **[search][doc]**. A third-party paid monitor, RottoWatch, exists **[3rd]**.
- **Implication for WA Stay [inferred].** Clause 4, the Cloudflare managed challenge, the restrictive `bookings` robots.txt and RIA's stated power to cancel bookings and block IPs all point the same way. By the repo's own rule ("If they forbid automated access, the provider gets links only"), a Rottnest provider should be **links-only**: no catalogue fetching, no availability checks, no watches and no holds.

---

## 1 Platform

| Fact | Evidence |
| --- | --- |
| The booking engine is **P3 Hotel Software's "P3 Custom Booking Engine"**: "We went live on the first week of December 2022 with the P3 Custom Booking Engine", "building on the base of the P3 Essential database". | [3rd] p3hotels.com/rottnest-island-booking-engine-p3; Hotel Online and Hospitality Net, 29 August 2023 |
| P3 Essential "is designed to work exclusively with Oracle Hospitality Opera"; P3 "provides a deep integration with Oracle Hospitality OPERA". **The PMS is probably OPERA.** | [3rd] for P3 in general, [inferred] for RIA |
| RIA needed "data security issues, PCI-DSS and so forth because it's a state-agency". | [3rd] Hotel Online |
| The previous engine (on rottnestisland.com) was retired at the end of 2022. The new site "will retain the Queue-it online 'waiting room'". | [search] RIA news, December 2022 |
| **Two hosts.** `www.stayrottnest.com` is the CMS and marketing site, with the booking widget and PDFs. `bookings.stayrottnest.com` is the engine (`/search-rates`, `/login`, `/offer`, `/offers`). The apex `stayrottnest.com` 301-redirects to `www`. | [live] www; [CC] apex 301 and bookings robots; [search] page URLs |
| `www` is a **Laravel** app: it sets `XSRF-TOKEN` (2 h) and `laravel_session` cookies, and returns an `x-request-id` header. | [live] robots.txt response headers |
| The CMS file path is `/cms/stayrottnest/pdfs/<name>.pdf` (T&Cs, FAQ, booking guides, maps, inventories, hire items). | [doc] PDF link annotations; [search] |
| **CDN and WAF: Cloudflare** on both hosts. Evidence: `server: cloudflare`, `cf-ray`, `cf-cache-status`, the `__cf_bm` cookie (Cloudflare Bot Management, `Domain=stayrottnest.com`, 30 min), and managed challenges. Cloudflare IPs 104.22.71.162 (www, 2025) and 104.20.21.73 / 2606:4700:10::6814:1549 (bookings). | [live]; [CC] |
| **Origin on Google Cloud.** `via: 1.1 google`. The apex answers from 34.49.166.218 with nginx `server: p3-web02`, and permissive CORS headers (`access-control-allow-methods: GET, POST`, `allow-credentials: true`). In 2024–25, `www` and `bookings` robots.txt returned 503 "upstream connect error or disconnect/reset before headers", an Envoy / Google load-balancer message. | [CC] |
| Security headers on `www`: `strict-transport-security: max-age=31536000; includeSubDomains`, `x-frame-options: SAMEORIGIN`, `content-security-policy: upgrade-insecure-requests`, `referrer-policy: strict-origin-when-cross-origin`, `x-content-type-options: nosniff`. **`X-Frame-Options: SAMEORIGIN` means the site cannot be framed**, so an app would have to open it in its own window or the system browser. | [live] |
| The JS framework of the booking engine, its script names and its API host are **unknown**: nothing on `bookings.` was loaded. | — |
| Meta tags and analytics: unknown, because the home page HTML was never received. | — |

## 2 Website terms (verbatim quotes)

### 2.1 Booking T&Cs PDF: the operative "automated software" clause

`https://www.stayrottnest.com/cms/stayrottnest/pdfs/stay_rottnest_bookings_terms_and_conditions.pdf`, "Effective for all new bookings made from 4 March 2026", RIA4555 – March 2026 **[doc]**. Verbatim:

> **4. Use of Automated Software**
> The primary guest acknowledges it is RIA policy that:
> a) bookings may not be made or assisted by the use of automated software or any system designed to perform tasks on the internet that would normally require human intervention. This includes, but is not limited to, automated programs or scripts used for web scraping, data mining, rate shopping, booking, and any other activities that mimic human behaviour to gain unauthorized access or perform excessive interactions with our website.
> b) where a booking is reasonably suspected by RIA to have been made by or with the assistance of automated software or system as described in paragraph (a), RIA may cancel the booking without refund. RIA may block website users or specific IP addresses that have exhibited behaviour consistent with the use of automated software or system as described in paragraph (a).

Related clauses (verbatim, **[doc]**):

> 1. c) The primary guest may not transfer, assign or sell the booking to another person.
>
> 8. a) Primary guests may apply for alterations to booking information in writing or by email. b) Bookings must be cancelled in writing or by email.

### 2.2 How the terms are presented and accepted

- The search page (`bookings.stayrottnest.com/search-rates`) carries a notice: "Stay Rottnest has updated its Terms and Conditions for using this site and booking accommodation. Please review here before making a booking." **[search]**, wording as quoted by the search tool. **This makes the booking T&Cs (and so clause 4) the terms of use of the site itself, not only of a booking [inferred].**
- The footer of the login page lists "Privacy Statement", "Terms & Conditions" and "Disclaimer", with "© Rottnest Island Authority" **[search]**.
- The search tool reported a sign-up checkbox, "agree to the Privacy Statement and Terms of Use of Rottnest Island Authority". It attributed this to "a related Rottnest Island page", so the source is uncertain **[search, unverified]**.
- The FAQ PDF links the T&Cs PDF ("Further details on how to cancel or alter your booking can be found in the Stay Rottnest Terms and Conditions") **[doc]**. Each monthly booking guide reprints the T&Cs ("View the terms and conditions on page 7") **[doc]**.
- **Acceptance mechanism.** For browsing it is browsewrap: a banner and footer links. For booking, the T&Cs speak of what "the primary guest acknowledges", which suggests a checkout acknowledgement (clickwrap). **I did not see checkout, so the checkbox wording is unverified [inferred].**

### 2.3 Disclaimer, privacy and copyright pages

- `https://www.stayrottnest.com/disclaimer` exists **[search]**. The search tool's summary, which is not verbatim: Rottnest Island Authority trading as Stay Rottnest operates the site; it aims for accurate, current and reliable information but does not guarantee it; it limits liability for loss from reliance "to the fullest extent the law allows"; external sites are the user's own judgement (including their privacy practices); some activities may be physically unsuitable or risky.
- **Not retrieved:** the Privacy Statement, any "Terms of Use" page, and any copyright, linking, framing or robots clause. These need the Wayback Machine once it is reachable again, or a person reading the pages in a browser. The pages on rottnestisland.com and ria.wa.gov.au are also Cloudflare-challenged: WebFetch got 403, and the parallel task got a "Just a moment..." page from ria.wa.gov.au.

### 2.4 Booking Guide and FAQ

All **[doc]**:

- `stay_rottnest_booking_guide.pdf`, "Tips to booking your next Stay Rottnest accommodation":
  - "Lock in key dates for Open Days to book reservations nine (9) months ahead. Open Days occur the first Wednesday of each month."
  - It lists Open Days through 6 October 2027 (for June 2028).
  - It links the monthly guides `https://www.stayrottnest.com/cms/stayrottnest/pdfs/open_day_booking_guide_<month>_<yyyy>.pdf` (July 2026 to June 2027).
- The monthly Open Day booking guides are the "applicable Booking Guide" that the T&Cs refer to, for example for exceptions to the 5/3 rule.
- `stay_rottnest_faqs_2026.pdf` (RIA4644 – August 2026). FAQ HTML page: `https://www.stayrottnest.com/faq` **[live, sitemap]**.

## 3 Catalogue

- **Size.** "69 different room types spanning seven locations" **[3rd]**, Hotel Online, August 2023, quoting P3 and RIA.
- **Locations and unit-number blocks**, from the accommodation map PDFs `accommodation_map_*.pdf` **[doc]**:

| Location (map) | Unit numbers | What |
| --- | --- | --- |
| Kingstown (`accommodation_map_kingstown_barracks.pdf`) | 101–109 | Governor Circle (9, 13 or 18 beds, group, mostly bunks) |
| | 111–128 | Kingstown Barracks dormitories (17 rooms; 114, 119 and 124 have an ensuite) |
| | 150, 152, 153 | Commanders Cottages (6 beds) |
| | 154–183 | Rottnest Hostel (bunks in shared rooms, plus family rooms 166–183) |
| Thomson Bay South (`accommodation_map_thomson_bay_south.pdf`) | 201–248 | Standard (small living room) and units with and without views |
| Thomson Bay North (`accommodation_map_thomson_bay_north.pdf`) | 301–450 (not contiguous) | Premium, Premium View, Heritage cottages (Nyi Nyi Bidi), North Heritage Bungalows; 450 is the Chalet |
| Bathurst (`accommodation_map_bathurst_caroline_thomson_cabins.pdf`) | 501–548 | Standard, Premium, Premium View, Heritage View (bunks as singles) |
| Campground (`accommodation_map_campground.pdf`) | 601–643 | 43 tent sites, up to 6 people or 2 tents each |
| Caroline Thomson Cabins (same map as Bathurst) | 701–728 | 28 cabins, 6 beds each (1 double and 2 bunks) |
| Longreach Bay (`accommodation_map_longreach_fay_geordie_bay.pdf`) | 801–836 | Ocean View, Premium View |
| Fay's Bay (same map) | 850–865 | Premium, Premium View |
| Geordie Bay (same map) | 901–952 | Premium, Premium View, Ocean View (refurbished 2024) |

- **Rough size [inferred from the number blocks]:** about 250–300 self-contained units, plus 43 campsites, 28 cabins, 9 Governor Circle cottages, 17–18 dormitories and the hostel. That is roughly 400 bookable units, which collapse into 69 sellable room types.
- **Booking-widget location list.** The search index shows these options: "All Locations", "Bathurst Self-contained", "Campground", "Caroline Thomson …", "Geordie Bay Self-contained", "Kingstown Hostel", "North Thomson Bay Self-contained", and a separate "Select Location Type" field **[search]**. The exact option values and IDs are unknown.
- **Room types** (booking guides, **[doc]**):
  - Self-contained: Standard, Ocean View, Chalet, Premium, Premium View, Heritage Cottages, Heritage View Cottages, North Heritage Bungalows, Accessible (8 units).
  - Group and budget: Caroline Thomson Cabins, Kingstown Dormitories, Governor Circle, Rottnest Hostel (single bunk in a shared room, or a family room), Campground.
  - Configurations are 2, 4, 6 or 8 beds (1 to 4 bedrooms). Occupancy is 1 per fixed bed + 50% for select self-contained units, and 1 per bed for group, hostel and cabins (T&Cs 12).
- **Not on Stay Rottnest [inferred]:** "eco tents" and glamping are **Discovery Rottnest Island**, and Hotel Rottnest, Samphire and Lontara are private operators. "Allison" (the old Allison Tentland campground) does not appear in current Stay Rottnest material: its campground is "Campground" (601–643) near Caroline Thomson.
- **Identification:** unit numbers are public (maps), but **a booking is for a room type at a location. "Your accommodation number will be emailed to you approximately three weeks prior to your arrival date"**, and specific unit numbers can only be requested **[doc]**. The internal room-type and location codes in URLs and the API are unknown.
- **Per-property pages:** none. `sitemap.xml` lists only `/`, `/faq`, `/accommodation-maps` and `/open-days` **[live]**. `/deals` and `/disclaimer` also exist **[search]**. There are no addresses or coordinates; location comes only from the PDF maps **[doc][inferred]**. Inclusions are in the `inventory_*.pdf` documents **[doc]**.

## 4 Search and availability

- **Search inputs.** Dates (a month calendar, with months shown for example as "June 2026 … September 2026" at crawl time), "How many bookings?" (numbered bookings, up to **two units per transaction**), adults (18+), children (0–17), "Select locations" and "Select Location Type" **[search][doc]**. The FAQ says: "To check prices for all available accommodation, select your preferred dates, location, number of guests and accommodation features." **[doc]**
- **Results.** "When they move to the rooms and rates page, they are able to see what is sold out and what is available." "This calendar shows users the available dates for all room types." "If what they want is sold out, they can flick through the calendar and find an alternative date." "The P3 booking system shows the availability gaps in specific units." **[3rd]**, P3 case study. Prices vary by type, season and availability **[doc]**.
- **Stay rules the results enforce** **[doc]**:
  - Saturdays need at least 2 nights ("you'll need to add either a Friday or Sunday to see any availability when you're searching online").
  - No arrivals or departures on WA public holidays.
  - Fixed arrival and departure dates in peak periods (December, summer and Easter school holidays).
  - At most 14 nights per booking.
  - The 5/3 rule into an unreleased month.
  - "Online bookings cannot be made for same day accommodation" (WA.gov.au page).
- **Sign-in.** Search does not need sign-in: the search page is indexed anonymously, and the account is optional **[search][inferred]**.
- **Deep link: unknown.** I did not load `search-rates`, because the live budget stopped after the challenge. No archive copy was reachable, and no public page or code quotes a parameterised URL. `bookings.stayrottnest.com/search-rates` with no parameters is the only confirmed entry point.
- **Network calls and availability endpoint: unknown.** I found no JS bundle, no XHR and no JSON endpoint, so none is documented. Per the brief, none would have been replayed anyway.

## 5 Booking window and releases

All **[doc]** unless marked:

- **Open Days** are on the first Wednesday of each month. Bookings open at **8:30 am AWST** for the month **nine months ahead**: 7 October 2026 opened June 2027, 4 November 2026 opens July 2027, and so on to 6 October 2027 for June 2028.
- **Virtual waiting room** from 6 am. Anyone in it before 8:30 gets a random position; later arrivals join the back. When it is your turn, "you'll have 30 minutes to enter the booking site".
- **SMS one-time passcode** to enter the waiting room: enter a mobile number and country code, then type the code within 10 minutes. From the December 2026 guide on: "temporary or virtual phone numbers cannot be used".
- **5/3 rule:** to straddle into a closed month you must book at least 5 nights in the open month to book at most 3 nights in the closed month. It does not apply on every Open Day; for example, the June 2027 Open Day allows no bookings into July 2027.
- **Locations closed per month** are listed in each guide (for example "Bathurst is unavailable for booking in June 2027 due to planned works"; Fay's Bay closed in October 2025).
- **How unreleased months look in the search page:** unknown. The indexed page showed a list of months **[search]**, so unreleased months are probably not offered **[inferred]**.
- **Demand context.** 15,000 people were queued for 1,500 bookings on a January Open Day **[3rd]** (ABC, November 2022); 500 bookings went in 15 minutes **[3rd]** (6PR, 2021). There is a "14-day cooling off period" **[doc]**, and returned bookings go back on sale **[3rd]**. So availability does reappear after Open Days.

## 6 Accounts

- **URL:** `https://bookings.stayrottnest.com/login` **[search]**. It shows a "My Booking" section with email and password, "Forgot Password?" and a sign-up option ("Save your details for faster booking") **[search]**.
- The search page promotes it: "Create your customer profile to enjoy a faster, more personalised booking experience. Your secure profile saves preferred contact details, shows past and future bookings, and makes rebooking simple." **[search]**
- P3: "Guests can create a personal profile with their details to autofill this information into all future bookings … they can view past bookings and retrieve future bookings to resend booking confirmations or cancel." "P3 is also building a guest profile module based around their loyalty system." **[3rd]**
- **Identity provider:** native P3 email and password on the same host. There is no sign of Auth0, Azure B2C or social login **[inferred]**; this is not verified.
- **Needed for:** nothing mandatory. Booking is possible without a profile, and the profile is for convenience and managing bookings **[inferred]**. Note that the T&Cs still require alterations and cancellations "in writing or by email" **[doc]**.
- **Discount rates:** the T&Cs (7f) mention "proof of eligibility for a discounted rate and/or special rate" at check-in **[doc]**. Which rates exist, and whether they need an account, is unknown. Seasonal deals appear on `/deals`, for example 30% off 3+ nights in winter 2026 **[search]**.

## 7 Cart, hold and payment

Page text only; nothing was exercised.

- **Confirmation:** "Places fill fast and your booking is not confirmed until payment details have been authorised." **[doc]** An RIA spokesperson in 2022: "bookings not being held until a deposit has been paid" **[3rd]**, ABC.
- **Cart, hold or timer:** none is documented. The duration of any basket hold is **unknown**. (A 2022 complaint about the *old* system wanted to "hold items in the check-out basket for longer" **[3rd]**.)
- **Payment:**
  - Visa and Mastercard only **[doc]**.
  - Self-contained bookings pay a **25% deposit** at booking, and the balance is charged automatically 30 days before arrival ("the primary guest approves RIA to charge the credit card provided"). Campground and Hostel are **paid in full** **[doc]**.
  - A card pre-authorisation is taken in person at check-in **[doc]**.
  - The card is kept for the later balance charge, so it is tokenised for PCI-DSS **[inferred]**.
  - The **payment gateway host is unknown**.
- **Limits:** at most **two units per transaction**, and the second needs a nominated keyholder **[doc]**. Bookings cannot be transferred **[doc]**.

## 8 Waitlist and alerts

- **No official waitlist, "notify me" or cancellation list** was found in the FAQ, the booking guides, the T&Cs or the search index **[doc][search]**. The only official contact channels are phone (1800 111 111, weekdays 8:30–5) and email for ACROD (accessible) requests **[doc]**.
- **Third party:** **RottoWatch** (`rottowatch.com.au`) says "We watch StayRottnest around the clock and email you the instant your sold-out dates open up". Free users get one check a day; paid users every 4 hours. It "does not book or hold", and says "All interaction with the StayRottnest booking site is your own responsibility". It states no affiliation **[3rd]**. Its method is not stated beyond "gathers publicly available information". It sits squarely within clause 4's "data mining, rate shopping" **[inferred]**.

## 9 Bot protection and waiting room

| Control | Detail | Evidence |
| --- | --- | --- |
| Cloudflare Bot Management | `__cf_bm` cookie on every response | [live] |
| Cloudflare managed challenge on `www` | `GET /` with curl's default UA answered **403 "Just a moment..."**, `cType: 'managed'`, `cZone: 'www.stayrottnest.com'`, Turnstile (`challenges.cloudflare.com`) CSP. robots.txt and sitemap.xml were not challenged. | [live] 23:42:01 UTC |
| Cloudflare managed challenge on `bookings` | `robots.txt` answered 403 `cf-mitigated: challenge` to CCBot on 11 September 2025, with Client Hints requested (`accept-ch`, `critical-ch`); 200 in August 2026 | [CC] |
| Waiting room (Open Days) | Queue-it ("will retain the Queue-it online 'waiting room'"). Random allocation for pre-8:30 arrivals, 30-minute entry window. The current guides do not name the vendor. The Queue-it host and customer id are unknown. | [search] RIA news, December 2022; [doc] |
| SMS OTP before the waiting room | One-time passcode, valid 10 minutes; virtual or temporary numbers rejected | [doc] |
| "New security platform" | RIA Annual Report 2024–25, ICT: "Additional accommodation booking system security features including implementation of a new security platform and improved booking process" | [doc] |
| reCAPTCHA, hCaptcha, DataDome, Akamai, Imperva | No evidence of any; Cloudflare Turnstile is used in the challenge. Checkout CAPTCHAs unknown. | [live][inferred] |
| robots.txt | `www`: `User-agent: * / Allow: /`, `Sitemap: https://www.stayrottnest.com/sitemap.xml`. `bookings`: `User-Agent: * / Disallow: / / Allow: /search-rates / Allow: /offer / Allow: /offers` | [live]; [CC] |
| Policy | T&Cs clause 4(b): RIA may cancel without refund and "block website users or specific IP addresses" | [doc] |

Raw robots.txt files.

`www` **[live]**:

```text
User-agent: *
Allow: /
Sitemap: https://www.stayrottnest.com/sitemap.xml
```

`bookings` **[CC, 7 August 2026]**:

```text
User-Agent: *
Disallow: /
Allow: /search-rates
Allow: /offer
Allow: /offers
```

## 10 Links the app could open for a person

| Purpose | URL | Status |
| --- | --- | --- |
| Home (booking widget) | `https://www.stayrottnest.com/` | [live] exists; challenged for curl, fine in a real browser |
| Search (no prefill) | `https://bookings.stayrottnest.com/search-rates` | [search][CC] robots Allow |
| Prefilled search for dates and guests | **Unknown.** Parameter names and date format not found | — |
| Sign in / My Booking (manage booking) | `https://bookings.stayrottnest.com/login` | [search] |
| Offers | `https://bookings.stayrottnest.com/offers` (and `/offer…`) | [CC] robots only; content unknown |
| Deals | `https://www.stayrottnest.com/deals` | [search] |
| Open Days page | `https://www.stayrottnest.com/open-days` | [live] sitemap |
| Accommodation maps page | `https://www.stayrottnest.com/accommodation-maps` | [live] sitemap |
| FAQ page | `https://www.stayrottnest.com/faq` | [live] sitemap |
| Disclaimer | `https://www.stayrottnest.com/disclaimer` | [search] |
| Booking Guide (Open Day dates) | `https://www.stayrottnest.com/cms/stayrottnest/pdfs/stay_rottnest_booking_guide.pdf` | [doc] filename; URL pattern [inferred] |
| Monthly Open Day guide | `https://www.stayrottnest.com/cms/stayrottnest/pdfs/open_day_booking_guide_<month>_<yyyy>.pdf` (for example `…june_2027.pdf`) | [doc] link annotations |
| Booking T&Cs | `https://www.stayrottnest.com/cms/stayrottnest/pdfs/stay_rottnest_bookings_terms_and_conditions.pdf` | [doc] |
| FAQ PDF | `https://www.stayrottnest.com/cms/stayrottnest/pdfs/stay_rottnest_faqs_2026.pdf` | [doc] (the 2024 version is indexed [search]) |
| Precinct map: Thomson Bay North | `…/pdfs/accommodation_map_thomson_bay_north.pdf` | [doc] |
| Precinct map: Thomson Bay South | `…/pdfs/accommodation_map_thomson_bay_south.pdf` | [doc] |
| Precinct map: Bathurst and Caroline Thomson Cabins | `…/pdfs/accommodation_map_bathurst_caroline_thomson_cabins.pdf` | [doc] |
| Precinct map: Longreach, Fay's and Geordie Bays | `…/pdfs/accommodation_map_longreach_fay_geordie_bay.pdf` | [doc] |
| Precinct map: Campground | `…/pdfs/accommodation_map_campground.pdf` | [doc] |
| Precinct map: Kingstown | `…/pdfs/accommodation_map_kingstown_barracks.pdf` | [doc] |
| Settlement street map | `…/pdfs/accommodation_map_street_map.pdf` | [doc] |
| Inclusions | `…/pdfs/inventory_{4,6,8}_bed_heritage_cottages.pdf`, `inventory_commanders_cottages.pdf`, `inventory_self_contained_premium_premiumview.pdf`, `inventory_self_contained_oceanview_rooms.pdf`, `inventory_governor_circle.pdf`, `inventory_bungalows_cabin_chalet.pdf` | [doc] |
| Hire items | `…/pdfs/accommodation_hire_items_2026.pdf` | [doc] |
| Arrival info | `…/pdfs/stay_rottnest_arrival_information.pdf` | [search] |
| Phone / email | `tel:+611800111111`, `mailto:stay@rottnestisland.com` | [doc] |

Note: the PDF filenames change with each edition (`faqs_2024` → `faqs_2026`, `hire_items_2025` → `_2026`), so a links-only provider should prefer the HTML pages (`/faq`, `/open-days`, `/accommodation-maps`) over PDF links **[inferred]**.

---

## Endpoint table

| Name | Method | URL | Params | Auth | Verified? |
| --- | --- | --- | --- | --- | --- |
| www robots | GET | `https://www.stayrottnest.com/robots.txt` | — | none | **live 200** |
| www sitemap | GET | `https://www.stayrottnest.com/sitemap.xml` | — | none | **live 200** (4 URLs) |
| www home | GET | `https://www.stayrottnest.com/` | — | Cloudflare managed challenge for non-browser clients | **live 403 challenge** |
| CMS pages | GET | `https://www.stayrottnest.com/{faq,open-days,accommodation-maps,deals,disclaimer}` | — | none (Cloudflare) | sitemap [live] / [search]; not fetched |
| CMS documents | GET | `https://www.stayrottnest.com/cms/stayrottnest/pdfs/<file>.pdf` | — | none | [doc] |
| bookings robots | GET | `https://bookings.stayrottnest.com/robots.txt` | — | Cloudflare (challenged in September 2025) | [CC] 200 August 2026 |
| Search rates (page) | GET | `https://bookings.stayrottnest.com/search-rates` | **unknown** (dates, adults, children, locations, type expected) | anonymous | [search]; not fetched |
| Rooms and rates (page) | GET | unknown path | unknown | anonymous | [3rd] described only |
| Login / My Booking | GET (form POST) | `https://bookings.stayrottnest.com/login` | email, password | P3 native account | [search]; not fetched |
| Offers | GET | `https://bookings.stayrottnest.com/offer`, `/offers` | unknown | unknown | [CC] robots only |
| Availability / calendar API | ? | **not discovered** | — | — | no |
| Cart / checkout / payment | ? | **not discovered** (gateway unknown) | — | — | no |
| Waiting room | ? | Queue-it (host and customer id unknown) plus an SMS OTP step | mobile number, OTP | — | [search][doc] |

## Risks and unknowns

**Risks**

1. **Terms forbid what a WA Stay provider would do.** Clause 4 bans software that assists bookings, explicitly naming "web scraping, data mining, rate shopping". Any app-side availability check, watch, catalogue scrape or hold falls inside it. The sanction is cancelling the *person's* booking without refund and blocking IPs. The search page says the T&Cs govern "using this site", so this is not only a booking condition **[doc][search]**.
2. **Technical blocking.** Cloudflare Bot Management and managed challenges hit plain HTTP clients on the home page (and, in 2025, even `bookings` robots.txt). An Electron `net.request` HttpClient would be challenged the same way **[live][inferred]**. The OTP and waiting room make Open Days explicitly human-only **[doc]**.
3. **robots.txt on `bookings`** disallows everything but `/search-rates` and `/offer(s)` **[CC]**.
4. **Reputational and political:** RIA is a state agency that has publicly fought bulk booking and resale (no-transfer rule, OTP, "new security platform") **[doc][3rd]**.
5. **Recommendation [inferred]:** follow the repo checklist ("If they forbid automated access, the provider gets links only"). That means:
   - manifest capabilities all false except `links`, with `account: 'none'`;
   - links to the home page, search page, login, Open Days, maps, FAQ and the current booking guide;
   - optionally a static, hand-maintained Open Day calendar, taken from the booking guide PDF by a person rather than fetched by the app.

   Also open the pages in the person's browser or a provider window. They cannot be framed (`X-Frame-Options: SAMEORIGIN`).

**Unknowns** (need the Wayback Machine, or a person looking in a normal browser):

- Deep-link query parameters and date format for `search-rates`, and whether the www widget submits a GET.
- The booking engine's JS bundles, API host and paths, response shapes, and whether calendar availability is fetched as JSON.
- The cart hold duration, checkout steps, the T&C checkbox wording, and the payment gateway host.
- The exact Privacy Statement, Terms of Use and Disclaimer text, including any copyright, linking or framing clauses.
- The current Queue-it customer id and domain, and whether Queue-it is still the vendor.
- Location and room-type codes, and how unreleased months render.
- Member or discount rates.
- Whether the old `rottnestisland.com` stay pages deep-link to `bookings.` with parameters (those pages are also Cloudflare-protected).

## Request log summary

**Live requests to `*.stayrottnest.com` (mine)** — 3 of the 25 allowed, all curl with the default UA, spaced at least 5 s apart. Log file: `site/requests-log.tsv`.

| Time (UTC) | Method | URL | Status |
| --- | --- | --- | --- |
| 2026-10-17T23:41:49Z | GET | `https://www.stayrottnest.com/robots.txt` | 200 |
| 2026-10-17T23:41:56Z | GET | `https://www.stayrottnest.com/sitemap.xml` | 200 |
| 2026-10-17T23:42:01Z | GET | `https://www.stayrottnest.com/` | **403 Cloudflare managed challenge, so all live requests stopped** (the `site/STOP` file records it) |

Totals by host:

| Host | Requests |
| --- | --- |
| `www.stayrottnest.com` | 3 |
| `bookings.stayrottnest.com` | 0 |
| Headless page loads | 0 of 2 |
| Search or results page loads | 0 of 2 |
| Forms, cart, sign-in, checkout, CAPTCHA | none |

**Note on concurrent traffic.** In the same window (about 23:32–23:42 UTC), the parallel RIA-documents task downloaded PDFs from `www.stayrottnest.com/cms/stayrottnest/pdfs/` (the maps at 23:42). Those requests are not in my log. The challenge may reflect this environment's combined traffic, so the caller should count that task's requests separately.

**Non-site requests** (archives and third parties; not counted against the budget):

| Host | Requests | Result |
| --- | --- | --- |
| `data.commoncrawl.org` | about 900 small HTTP range reads | cluster.idx binary search over 44 crawl indexes from 2023–2026, plus 4 WARC records |
| `web.archive.org` and `wayback.archive.org` | about 12 | all reset by the tunnel |
| `archive.org/wayback/available` | about 8 | empty |
| `archive.ph` | 2 | 429 |
| `webarchive.nla.gov.au` | 2 | Anubis redirect, not followed |
| `arquivo.pt` | 1 | 403 |
| `index.commoncrawl.org` | 1 | reset |
| `timetravel.mementoweb.org` | 1 | 502 from the proxy |
| WebFetch: hospitalitynet.org, p3hotels.com, rottowatch.com.au | 3 | 200 |
| WebFetch: ria.wa.gov.au, rottnestisland.com | 2 | 403 |
| WebSearch | about 14 queries | — |
| GitHub code and repo search | 3 | nothing relevant |

**Saved captures** (trimmed; cookies redacted; challenge tokens removed), under `/tmp/claude-0/-home-user/ad6929c6-e464-57e2-adce-3cdda806854a/scratchpad/rottnest/site/`:

- `live/www-robots.{headers,body}`, `live/www-sitemap.{headers,body}`, `live/www-home.headers`, `live/www-home.challenge-trimmed.txt`
- `cc/warc-robots-www-503-20250206.txt`, `cc/warc-robots-apex-301-20250206.txt`, `cc/warc-bookings-robots.txt` (September 2025 challenge and August 2026 robots), and the `cc/*.txt` CDX lookups
- `docs-text/` (text extracted from the July 2026 booking guide and the RIA annual reports)
- `requests-log.tsv`, `STOP`

Scripts are in `/tmp/claude-0/-home-user/ad6929c6-e464-57e2-adce-3cdda806854a/scratchpad/rottnest/site-scripts/`: `live_get.sh` (logged, rate-limited, stop on challenge), `cc_lookup.py`, `cc_debug.py`, `pdf_links.py`.

---

## 11 The results page (from the stakeholder's browser capture, 18 Oct 2026)

The stakeholder ran one search in their own browser and exported it as a HAR (Chrome's sanitised export: **no cookies**). Nothing below was requested by an agent.

**The request:**
- `GET https://bookings.stayrottnest.com/rates-room1?hotel=62607&arrival=2027-06-28&departure=2027-07-01&rooms=1&adults[1]=1&children[1]=0&roomCategories[]=39&type[]=campground&type[]=hostel-dorms&type[]=self-contained`.
- It was sent anonymously (no cookie) and answered 200 `text/html`, about 1.48 MB gzipped on the wire as about 1.5 MB of HTML, in 3.3 s.
- Response headers: `cache-control: no-store, no-cache, must-revalidate, private`, `server: cloudflare`, `x-frame-options: SAMEORIGIN`.
- The page then loads its scripts (jQuery, Vue 2.7, `ibe-core.min.js`, `rooms-calendar.min.js`) and `GET /api/hotel-occupancys`: a JSON list of the adult counts 1–18 with each one's most children, the party picker's limits.
- It runs Cloudflare's script detections (`/cdn-cgi/challenge-platform/.../precursor`) and analytics (Google, Meta, Yahoo, Sitefinity Insight).

**What the page holds.** Every room type on the island is rendered server-side, whatever the filters, as a card:

```html
<div class="card-style room-and-rates [unavailable]" room-calendar-root="GPV04" data-group="39"
     data-location-type="self-contained" data-sleeps="6" data-bedrooms="2" data-features=""
     data-filtered-reasons="">
```

- **`room-calendar-root`:** the room type's code: precinct letter(s), type, beds. `GPV04` is Geordie Premium View, 4 beds.
- **`data-group`:** the precinct:

  | Group | Precinct | Group | Precinct |
  | --- | --- | --- | --- |
  | 36 | Caroline Thomson Cabins | 41 | North Thomson Bay |
  | 37 | Kingstown (hostel, dorms, Governor Circle, heritage cottages) | 42 | South Thomson Bay |
  | 38 | Fay's Bay | 43 | Bathurst |
  | 39 | Geordie Bay | 44 | Campground |
  | 40 | Longreach Bay | | |

- **`data-location-type`:** `self-contained`, `hostel-dorms` or `campground` (the `type[]` filter). `data-sleeps` is the most people; `data-bedrooms` is the bedrooms (0 for the campground, cabins and hostel bed).
- **`data-filtered-reasons`:** what the person's filters hide in the browser (`group` for another precinct). Filtering is the browser's: **one search covers all 68 room types**, so `roomCategories[]` and `type[]` only change what is shown.
- **A free type:**
  - `<h2 class="icon-header-info">Geordie Bay Premium View - 4 Beds</h2>`;
  - "from `<span class="currency-symbol"> &#36;1,074.00</span>` for 3 nights" (the whole stay, the cheapest rate);
  - a rate block per rate (`data-target="#RIA25-GPV04"`), with its name ("Best Available Rate (25% Deposit Required)"), price and a "Book" button whose `formaction` is the booking step, `/details/hotel/62607/arrival/…/RIA25/GPV04`. **WA Stay never requests or links to `/details/`.**
- **An unavailable type:** the card has the class `unavailable` and "Unavailable on your dates", with no price and no rate.
- **Rates seen:** `RIA25` (self-contained and family rooms, 25% deposit), `CAMPING` (campground), `HOSTS` (hostel bed). Campground and hostel bookings are paid in full (T&Cs 7(c)).
- **In this sample** (28 Jun–1 Jul 2027, one adult), 33 types were free and 35 unavailable.
- **No per-night detail.** The page answers for the whole stay. The calendar component can show nights, but only after a script call the page makes when the person asks for "Flexible Dates?", which was not captured.

**The 68 room types**, by code (from the capture; names in RIA's words are kept in the seed):

`CG06`; `CTC06`; `KYB01`, `KYF03`, `KDM02`, `KDM04`, `KDM04B`, `KDM08`, `KDM12`, `KDM12B`, `KDM14`, `KDM18`, `KGC09`, `KGC13`, `KGC18`, `KHV06`, `KHSV06`, `KHOV06`; `FPR04`, `FPR06`, `FPV04`, `FPV06`; `GPR06`, `GPV04`, `GPV06`, `GPV08`, `GOV04`, `GOV06`; `LOV04`, `LOV06`, `LOV08`, `LPV04`, `LPV06`, `LPV08`; `NBU04`, `NBU06`, `NBV04`, `NCH04`, `NHC04`, `NHC06`, `NHC08`, `NHP08`, `NHSV08`, `NHV04`, `NHV06`, `NHV08`, `NOV04`, `NOV06`, `NOV08`, `NPR04`, `NPR06`, `NPV04`, `NPV06`, `NSD06`; `SOV04`, `SOV06`, `SPR04`, `SPR06`, `SSD04`; `BHV04`, `BHV06`, `BOV06`, `BOV08`, `BPR04`, `BPR06`, `BPV04`, `BPV06`, `BSD04`.

**Still unknown:**
- how a month not yet released answers (all unavailable, or a message);
- whether a party larger than a type's `data-sleeps` hides it (`data-filtered-reasons`) or marks it unavailable;
- what a minimum-stay or fixed-block refusal looks like.

The parser treats anything it can't read as unknown, never free, and refuses a party larger than `data-sleeps` itself.
