# Stay Rottnest (RIA): prior art and how the site is protected (research)

Researched 17 October 2026, for a possible Rottnest Island provider in WA Stay.

**Scope.** Nothing here came from the stayrottnest.com booking engine, search or availability pages: none of them were opened. The sources were:

- web search, and third-party pages fetched directly;
- public DNS (dns.google) and certificate-transparency logs (crt.sh) for stayrottnest.com;
- RIA PDFs that another agent had already saved in this scratchpad (`rottnest/ria/`, `rottnest/terms/`): the booking guides, the FAQs and the T&Cs. I only searched those files;
- the RIA annual reports 2023–24 and 2024–25, fetched from ria.wa.gov.au (`/docs/` PDF path) and converted to text in `rottnest/prior-art-dl/`.

**Evidence labels:**

- **[V]** verified: I read the source itself.
- **[S]** search-engine excerpt: the source blocked fetching (WA Hansard, ABC, some ria.wa.gov.au pages returned 403), so the wording comes from the search tool's quote of it.
- **[I]** inference: my reading of the evidence, not a stated fact.

Reddit could not be searched (the search tool refuses reddit.com). Wayback Machine snapshots could not be fetched (the fetch tool refuses web.archive.org, and the sandbox denied curl).

## Summary

1. **Two commercial alert services already watch Stay Rottnest, and both are notify-only.**
   - **RottoWatch** (rottowatch.com.au, Kokoro Software, since February 2026): checks every 4 hours on the paid plans and daily on the free one, alerts by email, and also offers a REST API and an MCP server. On the day of research its guide page read "availability last checked 17 Oct, 7:17 am AWST", so it works today [V].
   - **Quokka Watch** (quokkawatch.com, RESUMES FOR DUDES PTY LTD): one-off plans from $15 to $69, alerts by email with optional SMS, and "periodically checks the publicly available Rottnest Island accommodation pages" [V].
   - Neither books, holds or explains its technique. I found no report of either being blocked, warned or shut down.
2. **There is no open-source prior art.** GitHub code and repository search finds nothing that mentions `stayrottnest` or automates Rottnest accommodation. I also found no Chrome extension, Telegram or Discord bot, Apify actor or app-store app. Campnab and similar services do not cover Rottnest [V].
3. **The platform is a custom P3 Hotel Software booking engine**, live in the first week of December 2022 at `bookings.stayrottnest.com` [V].
   - stayrottnest.com's SPF record includes `spf.ireshotels.com`, a domain registered to p3 Hotels [V].
   - P3 builds only on Oracle Hospitality OPERA, and Oracle recommended P3 to RIA, so the PMS is almost certainly OPERA [I].
   - The previous engine appears to have been Oracle/MICROS-hosted (`riawh.webhotel.microsapdc.com`), retired at the end of 2022 [I].
4. **The "locked down" claim is accurate, and it is layered.** All of these apply at once:
   - **Cloudflare** in front of `www.` and `bookings.stayrottnest.com` [V, DNS].
   - **Bot protection** stated in Parliament in May 2023: known bot data-centre sources are blocked outright, and suspicious traffic gets a CAPTCHA [S].
   - **A "new security platform"** in 2024–25 [V, annual report].
   - **A Queue-it waiting room** on Open Days [V].
   - **An SMS one-time passcode and "unique ID restrictions"** to enter the waiting room; temporary or virtual numbers are refused [V].
5. **The terms ban automation outright** [V]: "automated programs or scripts used for web scraping, data mining, rate shopping, booking". RIA may cancel such bookings without refund and block users or IP addresses. The clause is in the guide for the 7 May 2025 Open Day (January 2026 stays) and every guide since, and in T&Cs RIA4555, effective 4 March 2026. It is not in the guide for the 5 February 2025 Open Day; the March and April 2025 guides could not be fetched (404), so it arrived between February and May 2025.
6. **The history explains the defences:**
   - scalpers bulk-booking and reselling, and a Facebook group for on-selling;
   - about 15,000 people competing for about 1,500 places;
   - crashes on booking days in 2019, April 2021 and June 2022;
   - since 4 January 2023, bookings cannot be transferred (anti-resale).
7. **Release timing:** Open Days are the first Wednesday of each month at 8:30 AWST and release dates nine months ahead. The waiting room opens at 6:00, everyone there before 8:30 gets a random place, and each person then has 30 minutes. Peak periods sell only fixed arrival and departure windows. Cancellations "go straight back on sale, usually with no announcement" (RottoWatch) [V].
8. **Site Sniper and auto-hold are not viable for Rottnest.** An Open Day release needs a real person's mobile number for the passcode, a randomised queue and a 30-minute window, and automated booking is a stated ground for cancellation without refund [I].
9. **A notify-only watch is technically what others do, but the terms appear to forbid it.** WA Stay's own provider checklist ("If they forbid automated access, the provider gets links only") points to links only, unless RIA gives permission. The terms review decides this [I].
10. **Gaps:**
    - whether ordinary off-Open-Day searches are challenged by Cloudflare;
    - whether an anonymous JSON endpoint exists;
    - whether sign-in is needed to search (excerpts suggest it is optional).

    These are for the agent cleared to look at the site.

## Platform/vendor

| Fact | Evidence | Label |
| --- | --- | --- |
| A custom booking engine by **P3 Hotel Software** (Dublin), "based on the P3 Essential database", live in the first week of December 2022. It covers 69 room types across 7 locations and has an alternative-dates calendar and a guest-profile module ("resend confirmations or cancel future stays") | p3hotels.com case study; Hospitality Net and eHotelier (29–30 Aug 2023) | V |
| "Oracle Hospitality recommended P3 when we mentioned the customisation level that we required" | p3hotels.com case study | V (fetch summary) |
| P3's booking engines integrate with **Oracle Hospitality OPERA** (OPERA 5.5+ through OWS, OPERA Cloud through OWS and OHIP); P3 is "designed to work exclusively with Oracle Hospitality OPERA" | P3 / Oracle OPN pages; Hospitality Upgrade | S |
| So RIA's PMS is OPERA. RottoWatch's API takes "Comma-separated room codes" and "locations", which fits OPERA room-type codes | inference from the above and RottoWatch's OpenAPI | I |
| RIA's reasons: "The previous provider announced plans to phase out its booking engine at the end of 2022." Deborah Taylor (Director of Visitor Services): "We had to cover data security issues, PCI-DSS and so forth because it's a state-agency, not a private entity." | eHotelier / Hospitality Net | V |
| The old engine: a page titled "Rottnest Island Authority - Terms & Conditions" is indexed at `riawh.webhotel.microsapdc.com/custserv/terms.jsp` (MICROS/Oracle "webhotel", APAC data centre). It returns 503 today | search index; fetch gave 503 | S + I |
| Hosts: `www.stayrottnest.com` (CMS, PDFs under `/cms/stayrottnest/pdfs/`) and `bookings.stayrottnest.com` (engine: `/search-rates`, `/login`). The login page offers a sign-up to "save your details for faster booking", which suggests an account is optional | search excerpts; Quokka Watch links to `https://bookings.stayrottnest.com/search-rates` | S |
| Email: SPF `include:spf.ireshotels.com`. `ireshotels.com` is P3's iRes platform (registrant "p3 Hotels"), and `spf.ireshotels.com` allows one SendGrid-range IP | dns.google TXT; who.is excerpt | V (DNS) / S |
| DNS on Azure DNS (`ns1-06.azure-dns.com`, …). `www` and `bookings` are CNAMEs to `*.stayrottnest.com.cdn.cloudflare.net` (Cloudflare CNAME, or "partial", setup, which is offered on Business and Enterprise plans). The apex A record is `34.49.166.218`, a Google-owned range | dns.google | V (records) / I (plan, Google) |
| Certificates: GTS CA 1P5 (Google-managed) and Let's Encrypt and Sectigo from November 2022 to mid-2024. Then Google Trust Services WE1/WR1, Cloudflare's usual issuers, for `www` and `bookings` from 11 December 2024. A `www-test.stayrottnest.com` existed from December 2024 to June 2025 | crt.sh | V (logs) / I (what they mean) |
| Stay Rottnest is also listed on OTAs: Booking.com (`/hotel/au/rottnest-island-authority.html`), Expedia (h9072660), Hotels.com (ho474978), Wotif. So a channel or distribution interface exists | search results | S |
| There is no public API, iCal or open data feed from RIA for accommodation. data.gov.au and data.wa.gov.au searches found none | search | S (absence) |
| Aside: RIA **moorings** are booked on a DBCA system (`mooring-ria.dbca.wa.gov.au`, code `dbca-wa/moorings`, a ParkStay relative). It is not accommodation | GitHub; search | V |

## Protection observed

Layers, from the network edge inward:

1. **Cloudflare at the edge** [V, DNS; I, how it is configured]. Both `www` and `bookings` sit behind Cloudflare, probably since about November–December 2024, judging by the certificate change. The 2024–25 annual report lists "implementation of a new security platform and improved booking process" [V]. That fits Cloudflare, but it is not named [I]. RIA's corporate site (ria.wa.gov.au) shows a Cloudflare **managed challenge** ("Just a moment... Enable JavaScript and cookies to continue", `cType: 'managed'`) to scripted fetches, as seen in `ria/open-days.html`, and our fetches got 403 [V].
2. **Bot rules stated to Parliament** [S]. WA Legislative Assembly, Estimates Committee A, 25 May 2023, Mr R.H. Cook (then Minister for Tourism), as the search tool quoted the Hansard PDF (A41 S1 20230525 p30b–32a):
   - the booking system "has to be able to guard against bot purchasing";
   - "a lot of work has been done to build in an appropriate level of cybersecurity and bot protection to ensure that people do not continue to game the booking system";
   - "the effectiveness of that can be seen over the last two days as more bots are targeting the system";
   - "If the source is a known bot data centre, it is immediately blocked. If the source appears suspicious to the user, the user is asked to complete a CAPTCHA response."
3. **Queue-it virtual waiting room on Open Days** [V/S]. RIA, 4 December 2022: "The new website will retain the Queue-it online 'waiting room' which randomly allocates a position in the online queue when bookings open." The current guides add:
   - the waiting room opens at 6:00 and bookings at 8:30;
   - everyone waiting before 8:30 gets a random place;
   - "you'll have 30 minutes to enter the booking site. If you exceed the time, you'll have to join the back of the queue."

   Queue-it's own documentation describes signed enqueue tokens, server-side or edge enforcement, Proof-of-Work and CAPTCHA challenges, "2FA" invite-only rooms and enforced unique visitor keys [V]. That matches what RIA describes [I].
4. **SMS one-time passcode and unique IDs** [V].
   - Annual Report 2023–24 (to 30 June 2024): "One-time password implemented for Stay Rottnest Open Day accommodation booking to improve fairness" and "Unique ID restrictions for Stay Rottnest Open Days to improve fairness".
   - The guides first describe it in the guide for the 5 February 2025 Open Day: "a one-time-use passcode is now required for access to the virtual waiting room … you will be prompted to enter your mobile number … entered on the next screen within 10 minutes".
   - Later guides add "Note that temporary or virtual phone numbers cannot be used."
   - The guide for 4 December 2024 does not mention it, so it may have been introduced in stages [I].
5. **Terms** [V] (T&Cs RIA4555, effective 4 March 2026; the same text is in the guides from the 7 May 2025 Open Day). §4 "Use of Automated Software":
   - "bookings may not be made or assisted by the use of automated software or any system designed to perform tasks on the internet that would normally require human intervention. This includes, but is not limited to, automated programs or scripts used for web scraping, data mining, rate shopping, booking, and any other activities that mimic human behaviour to gain unauthorized access or perform excessive interactions with our website."
   - "RIA may cancel the booking without refund. RIA may block website users or specific IP addresses that have exhibited behaviour consistent with the use of automated software."
6. **Booking rules that limit scalping** [V]:
   - the booking cannot be transferred, assigned or sold (since 4 January 2023);
   - the primary guest shows photo ID and a credit card at check-in, or names a keyholder who does;
   - at most 2 units per transaction, and a second unit needs a nominated keyholder;
   - at most 14 nights;
   - the 5/3 rule (at least 5 nights in the open month to book up to 3 in the next, closed one);
   - no arrivals or departures on public holidays, and Saturdays need a minimum of 2 nights;
   - peak periods (December, and Easter or summer school holidays) are fixed arrival and departure windows;
   - no online booking for the same day.
7. **Not seen:** Akamai, Imperva, DataDome or PerimeterX; reCAPTCHA or hCaptcha brand names (the CAPTCHA vendor is not named); and any one-booking-per-account rule other than "max two units per transaction" and "one fixed date booking per ACROD Card".

**Timeline of the defences:**

| When | Change | Source |
| --- | --- | --- |
| ~1980s–2013 | A school-holiday ballot; "three-decades-old ballot system has just been scratched" (2013) | Australian Geographic (2013) [S]; ExplorOz (2008) [S] |
| 2019–2022 | An older engine with Queue-it already in use; several booking-day crashes | The West Australian [V] |
| 4 Dec 2022 | stayrottnest.com on P3; Queue-it kept | RIA [S]; P3 [V] |
| 4 Jan 2023 | Bookings can no longer be transferred (anti-resale) | WA government media statement, 29 Dec 2022 [V] |
| 1 Mar 2023 | In-person bookings stopped (Open Days online or by phone) | RIA, 23 Feb 2023 [S] |
| May 2023 | Data-centre blocks and CAPTCHA described to Parliament | Hansard [S] |
| FY 2023–24 | SMS one-time password and unique-ID restrictions on Open Days | Annual Report 2023–24 [V] |
| FY 2024–25 (likely Nov–Dec 2024) | A "new security platform", probably Cloudflare in front of the engine | Annual Report 2024–25 [V]; crt.sh and DNS [I] |
| Feb–May 2025 | The automated-software clause in the T&Cs (absent from the 5 Feb 2025 guide, present from the 7 May 2025 guide) | booking guides [V] |
| 4 Mar 2026 | T&Cs RIA4555 (automation clause kept) | T&C PDF [V] |

## Prior tools

| Tool | URL | Who | Dates | Notify / book | Technique (stated, or [I]) | Frequency and limits | Status | What it reveals |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **RottoWatch** | https://www.rottowatch.com.au/ | Kokoro Software, ABN 71 322 548 721 (WA law). Hosted on Vercel; Supabase, Resend, Stripe | "Watching Rottnest since February 2026"; privacy 19 Feb 2026, terms 23 Feb 2026 | **Notify only**: "RottoWatch does not book accommodation on your behalf. All interaction with the StayRottnest booking site is your own responsibility." | "We gather publicly available information"; its tables say "Live from the StayRottnest booking system". Method not disclosed. Checks only watched dates ("Untracked dates return `cached:false`") [V] | Free: 1 watch, daily check, 7-day window. $5 a month: 5 watches, every 4 h. $10 a month: 10 watches, every 4 h, 270 days ahead, "Availability and Price Explorer" | **Working**: "availability last checked 17 Oct, 7:17 am AWST" on 17 Oct 2026 | Models peak **fixed windows** (`GET /api/v1/peak-slots`: "Peak periods only allow fixed arrival/departure windows per area"); filters by room codes and locations; email only; REST `/api/v1/availability?checkIn&checkOut&adults&children&roomTypes&locations` and an MCP server at `/api/mcp` (tools `check_rottnest_availability`, `list_rottnest_room_types`, `list_rottnest_peak_slots`, `create_rottnest_watch`); 429 says "create a watch instead of polling" |
| **Quokka Watch** | https://www.quokkawatch.com/ | RESUMES FOR DUDES PTY LTD, ABN 60 162 288 459; "Perth-based and independent"; Stripe | Terms and privacy updated 17 Oct 2026; launch date unknown | **Notify only**: "We do not hold, reserve, or book accommodation on your behalf"; "Not affiliated with Rottnest Island Authority" | "periodically checks the publicly available Rottnest Island accommodation pages"; "Same live check that powers your Quokka Watch alerts" [V]. Method not disclosed | One-off payments: Starter $15 (1 watch, 1 area, up to 60 days); Flexible $39; Power $69 (4 watches, 4 areas, 30-day travel window, up to 90 days); "continuously checks" | Apparently live ("Currently monitoring stays through June 2027") | Nine areas (North Thomson, South Thomson, Caroline Thomson, Geordie Bay, Longreach, Fay's Bay, Bathurst, Kingstown, Campground); deep link `https://bookings.stayrottnest.com/search-rates`; SMS needs a verified AU mobile |
| Unnamed "other Rottnest alert services" | rottowatch.com.au/compare | — | "as of June 2026" | Notify only | — | "From $9 one-off", 1–4 watches, up to 90 days, "Continuous (stated)", email plus some SMS | — | Probably Quokka Watch at an earlier price [I] |
| Resale group (people, not software) | — (ABC, 12 Nov 2022) | A Facebook group | 2022 | Bulk-booked to on-sell | Manual | — | Ended by the no-transfer rule from 4 Jan 2023 | Taylor said RIA "did not condone" the group [S] |
| Campnab, Camply, Outdoorithm and similar | campnab.com, … | — | — | Notify | — | — | Do not cover Rottnest or any Australian parks [S] | — |
| GitHub, Chrome Web Store, app stores, Apify | — | — | — | — | — | — | **Nothing found** for stayrottnest, Rottnest booking, availability or bot (code and repository search; 0 hits for `stayrottnest`) [V] | — |

Neither service mentions Cloudflare, the queue, SMS passcodes, Open-Day automation or sign-in. Neither says it uses a Stay Rottnest account. RottoWatch's own terms forbid others to "Create automated systems (bots, scrapers) that access the Service beyond normal use".

## News and community reports

- **ExplorOz trip report, 2008** [S]: for school holidays "you must enter the ballot"; other bookings could be made up to 12 months ahead.
- **Australian Geographic, Dec 2013** [S]: "the island's three-decades-old ballot system has just been scratched".
- **The West Australian (via bdtimes.com.au), 6 Apr 2021, Will Yeoman and Natalie Richards** [V]. https://www.bdtimes.com.au/travel/wa/christmas-holiday-bookings-glitch-on-rotto-website-ng-b881839429z
  - Christmas Open Day: a 30-minute outage, which a spokesperson put down to a "small issue at the entry point".
  - The queue was 2,812 at 9:10am and about 30 by 10am. A traveller reported "Queue is paused due to high demand."
  - There were also outages in 2019 "leaving visitors queuing for hours".
- **The West Australian, 7 Apr 2021, Kate Purnell** [V]: 1,444 bookings on the day, "a three-fold increase on last Christmas"; December was almost fully booked. https://www.bdtimes.com.au/news/travel/rottnest-island-accommodation-sells-out-over-christmas-after-frenzy-over-online-bookings-ng-b881841169z
- **The West Australian (via Geraldton Guardian), 1 Jun 2022, Michael Traill** [V]. https://www.geraldtonguardian.com.au/news/rottnest/rottnest-island-authoritys-booking-system-crashes-on-first-day-february-2023-reservations-open-c-7013477
  - The booking system "suffered an incident overnight and unfortunately, the issue is unable to be resolved at this time".
  - The Open Day moved to 8 June. RIA was "working with our IT supplier"; the cause was not disclosed.
- **ABC News, 12 Nov 2022** ("booking system to get overhaul amid school holiday online frenzy") [S]. https://www.abc.net.au/news/2022-11-12/rottnest-island-booking-system-gets-overhaul/101578166
  - "We had 15,000 people queued online for that open day in January, and only 1,500 bookings available".
  - "Just 10 per cent of those trying to get Rottnest accommodation in the Christmas school holidays were successful on open day".
  - Some people had accommodation in their basket and then, when they went to pay, it was gone.
  - A Facebook group let people book "specifically for the purpose of on-selling", which RIA "did not condone".
  - There were calls to bring back the random ballot.
- **RIA, 4 Dec 2022, "New booking website for RIA accommodation"** [S]: stayrottnest.com replaces the rottnestisland.com booking system and retains Queue-it. Taylor: "At peaks periods more than 15,000 people can be seeking to book one of 1500 available places". https://www.ria.wa.gov.au/news-and-media/new-booking-website-for-ria-accommodation
- **WA Government media statement, 29 Dec 2022, Roger Cook** [V]: no transfer of ownership for bookings made from 4 January 2023, in response to feedback that "online reselling … to unknown third parties" was unfair. https://www.wa.gov.au/government/media-statements/McGowan%20Labor%20Government/New-transfer-of-ownership-booking-changes-for-Rottnest-Island-20221229
- **RIA, 23 Feb 2023** [S]: in-person bookings stop from 1 March 2023; "a virtual queuing system is used to ensure a smooth experience for everyone". https://www.ria.wa.gov.au/news-and-media/changes-to-stay-rottnest-booking-system
- **Grantourismo, Lara Dunston, 25 Mar 2023** [V]. https://grantourismotravels.com/easiest-way-to-book-rottnest-island-accommodation
  - Before the reforms, insiders "would bulk book accommodation, and, operating like concert ticket scalpers, re-sell booked stays on other platforms for far higher prices".
  - The fix: "new booking contracts that prevent re-sales".
  - Booking.com "seemed to have the most Rottnest Island accommodation on the dates I checked".
- **WA Hansard, Estimates Committee A, 25 May 2023** [S]: the bot quotes above. https://www.parliament.wa.gov.au/Hansard/hansard.nsf/0/73b1c86114903c91482589c80007beb4/$FILE/A41+S1+20230525+p30b-32a.pdf (403 to fetch)
- **P3 case study, 29–30 Aug 2023** [V]: "Within the first 24 hours of launching the new system, we sold double the amount of bookings"; "We now have a huge demand for short-lead time bookings, which didn't happen before". https://www.hospitalitynet.org/news/4117937.html, https://www.p3hotels.com/rottnest-island-booking-engine-p3
- **RIA Annual Reports 2023–24 and 2024–25** [V]: the passcode, unique ID and "new security platform" items quoted above.
- **2025–2026:** I found no news coverage of bots, the passcode or the automation clause. RottoWatch and Quokka Watch launched in 2026 with no reported pushback.
- **Reddit (r/perth, r/westernaustralia), Whirlpool and Facebook:** Reddit could not be searched with our tools. Whirlpool has only old travel threads with nothing on bots. No indexed Facebook posts were found.

## Lessons for our design

1. **The terms come first, and they point to links only.**
   - §4 bans "automated programs or scripts used for web scraping, data mining, rate shopping". It does not distinguish read-only polling, and the stated remedy is RIA cancelling **the user's** booking without refund and blocking IPs.
   - A desktop app polls from the user's own IP and may share a session with their Stay Rottnest account, so the risk falls on the person, not on us [I].
   - Under the provider checklist in CLAUDE.md ("If they forbid automated access, the provider gets links only"), the safe default is a **links-only** Rottnest provider: catalogue, place pages, deep links to `bookings.stayrottnest.com/search-rates`, and an Open Day calendar.
   - Watches would need RIA's written permission or an API. P3 and OPERA have OWS and OHIP, and RIA already distributes to OTAs, so a sanctioned channel exists [I].
2. **Do not build Site Sniper or auto-hold for Rottnest.** Releases happen only on Open Days, through Queue-it, a random draw, an SMS passcode to a real (not virtual) mobile, a 30-minute window and unique-ID limits. Automated booking is a stated ground for cancellation, so the manifest should say `snipes: false, holds: false`. What we can offer is an **Open Day helper**:
   - the schedule (first Wednesday each month; waiting room at 6:00, bookings at 8:30 AWST);
   - a reminder;
   - the guide's checklist (top four choices, dates, guests);
   - a one-click "open the waiting room" link.

   The person does the rest.
3. **If watches are ever allowed, copy the commercial tools' restraint:**
   - every 4 hours (RottoWatch), not every few minutes;
   - only the dates someone watches, and cached;
   - notify only, with a deep link to the public booking page (fits issue #54, R7);
   - one request at a time per user;
   - immediate back-off on a challenge or 403, with no retry loop.

   Also:
   - Never solve a CAPTCHA, never fetch Cloudflare clearance cookies from a hidden window to get past a challenge, and never use proxies. A challenge means "open it in your browser" [I].
   - Data-centre IPs are blocked. A user's home IP is not, but Cloudflare may still challenge a non-browser client [I].
4. **Model fixed peak windows.** In December and other peak periods only predefined arrival and departure windows per area can be booked. RottoWatch has a dedicated peak-slots endpoint. A watch that does not line up with a window can never match, so the stay form should warn [V/I].
5. **When cancellations appear (from the T&Cs and guides)** [V/I]:
   - The 14-day cooling-off after a booking (full refund when more than 30 days out) makes returns likely in the two weeks after each Open Day.
   - The balance falls due 30 days before arrival, and non-payment cancels the booking, so space likely returns around 30 days out.
   - Fee steps fall at 30 days and at 48 hours before the 2 pm check-in.
   - Returns "go straight back on sale … with no announcement", and RottoWatch claims they are "typically re-booked within hours" (unsourced).
   - Same-day stays cannot be booked online.
6. **Catalogue facts for a links-only provider:**
   - 7 locations and 69 room types (P3); nine areas as listed by Quokka Watch;
   - the campground (43 non-powered sites, at most 6 people and 2 tents per site), hostel and Kingstown dormitories;
   - prices and photos come from RIA pages, so check the reuse terms.
7. **Do not touch ria.wa.gov.au or rottnestisland.com HTML programmatically.** They also sit behind Cloudflare managed challenges (403 to our fetches). The booking-guide PDFs on stayrottnest.com's CMS are where the rules are published, but the other agent's terms review should decide whether to read them automatically.
8. **Open questions for the agent cleared to look at the live site:**
   - Is anonymous `search-rates` reachable without a challenge outside Open Days?
   - Does it render server-side, or call a JSON API?
   - Can its URL take query parameters to prefill dates?
   - Is Queue-it active outside Open Days?
   - What does `robots.txt` say?

## Sources

- RottoWatch: https://www.rottowatch.com.au/ ; /terms (updated 23 Feb 2026) ; /privacy (19 Feb 2026) ; /developers ; /api/v1/openapi.json ; /compare ; /guides/rottnest-peak-booking-windows ; /guides/get-rottnest-accommodation-when-booked-out
- Quokka Watch: https://www.quokkawatch.com/ ; /stays ; /billing ; /terms (17 Oct 2026) ; /privacy (17 Oct 2026) ; /support
- P3 case study: https://www.p3hotels.com/rottnest-island-booking-engine-p3 ; https://www.hospitalitynet.org/news/4117937.html ; https://insights.ehotelier.com/?p=102763 ; https://www.hotel-online.com/news/australias-rottnest-island-authority-deploys-p3s-custom-booking-engine-to-address-unique-property-and-guest-needs
- P3 and Oracle: https://www.p3hotels.com/booking-engine-oracle-validated-integration ; https://oracle.com/opn/gtm/resources/ds-p3-hotel-hospitality-7457100.pdf (excerpts)
- iRes / P3: https://who.is/rdap/ireshotels.com (excerpt) ; DNS TXT for `stayrottnest.com` and `spf.ireshotels.com` via https://dns.google/resolve
- DNS: https://dns.google/resolve?name=bookings.stayrottnest.com&type=A ; …name=www.stayrottnest.com ; …type=NS ; apex A
- Certificate transparency: https://crt.sh/?q=stayrottnest.com&output=json
- Queue-it: https://queue-it.com/developers/bots-abuse-management/
- WA Hansard, 25 May 2023: https://www.parliament.wa.gov.au/Hansard/hansard.nsf/0/73b1c86114903c91482589c80007beb4/$FILE/A41+S1+20230525+p30b-32a.pdf (search excerpt only)
- WA Government media statement, 29 Dec 2022: https://www.wa.gov.au/government/media-statements/McGowan%20Labor%20Government/New-transfer-of-ownership-booking-changes-for-Rottnest-Island-20221229
- wa.gov.au, "Book Rottnest Island accommodation" (22 May 2023): https://www.wa.gov.au/service/sport-and-recreation/community-recreation/book-rottnest-island-accommodation
- RIA news (excerpts): https://www.ria.wa.gov.au/news-and-media/new-booking-website-for-ria-accommodation ; https://www.ria.wa.gov.au/news-and-media/changes-to-stay-rottnest-booking-system ; https://www.ria.wa.gov.au/news-and-media/updated-accommodation-booking-t-c-s-to-commence-in-january-2023 ; https://www.ria.wa.gov.au/managing-the-island/visitor-experience/stay-rottnest-accommodation-open-days
- RIA Annual Report 2023–24: https://www.ria.wa.gov.au/docs/default-source/reports/annual-reports/annual-report-2023-24.pdf (text: `rottnest/prior-art-dl/ria-annual-report-2023-24.txt`)
- RIA Annual Report 2024–25: https://www.ria.wa.gov.au/docs/default-source/reports/annual-reports/annual-report-2024-25.pdf (text: `rottnest/prior-art-dl/ria-annual-report-2024-25.txt`)
- Booking guides, FAQs and T&Cs, saved by another agent: `rottnest/ria/open_day_booking_guide_*.clean.txt` (August 2024 to June 2027), `rottnest/terms/tcs.txt` (RIA4555, effective 4 Mar 2026). Originals at https://www.stayrottnest.com/cms/stayrottnest/pdfs/ and https://www.rottnestisland.com/docs/default-source/open-day/
- News: https://www.bdtimes.com.au/travel/wa/christmas-holiday-bookings-glitch-on-rotto-website-ng-b881839429z ; https://www.bdtimes.com.au/news/travel/rottnest-island-accommodation-sells-out-over-christmas-after-frenzy-over-online-bookings-ng-b881841169z ; https://www.geraldtonguardian.com.au/news/rottnest/rottnest-island-authoritys-booking-system-crashes-on-first-day-february-2023-reservations-open-c-7013477 ; https://www.abc.net.au/news/2022-11-12/rottnest-island-booking-system-gets-overhaul/101578166 (excerpts) ; https://grantourismotravels.com/easiest-way-to-book-rottnest-island-accommodation ; https://www.australiangeographic.com.au/news/2013/12/rottnest-island-perths-playground-1/ (excerpt)
- Old engine (indexed title only): https://riawh.webhotel.microsapdc.com/custserv/terms.jsp
- GitHub searches (MCP): code `stayrottnest`, `"stayrottnest.com"`, `"ireshotels.com"`, `rottnest scrape/selenium/playwright/puppeteer`; repositories `rottnest`, `rotto booking …`. No relevant hits. `dbca-wa/moorings` (RIA moorings on a DBCA system)
- Campnab coverage (US and Canada only): https://campnab.com/ (excerpt)
