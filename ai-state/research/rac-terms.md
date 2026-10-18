# RAC Parks & Resorts: terms review for a WA Stay provider

_2026-10-16. Step 1 ("Terms first") of adding the RAC Parks & Resorts provider._

This is a plain reading of RAC's published text. It is not legal advice. Where the text is unclear, it says so.

**Sources.** 31 anonymous GET requests on 16 Oct 2026, about 15:20–15:40 UTC, with curl's default User-Agent and a 10 s gap (robots.txt asks for it). No sign-in, cart, hold, booking or payment. The raw text of every page is saved in `/tmp/claude-0/-home-user/e72a82ef-d2a5-54f7-81bf-ebe78d68796c/scratchpad/rac-terms/` (`<name>.txt`, with `<name>.url`; raw HTML in `raw/`). The pages are listed at the end.

Short URLs below are relative to `https://parksandresorts.rac.com.au`.

## Verdicts

| Use | Verdict | Why, in one line |
| --- | --- | --- |
| (a) Read the catalogue and availability automatically | **Automated read access not addressed (permitted), with conditions** | No term mentions bots, scraping or automated access. robots.txt allows every path. The site terms limit use to "personal non-commercial home use" and ask for a 10 s crawl delay. |
| (b) Periodic watches | **Restricted (with conditions)** | Not forbidden. But RAC asks people not to strain the site, and the site terms forbid use that inhibits other people's use. Polling must be slow and single-session. |
| (c) Automatic holds ("Site Sniper") | **Restricted (with conditions), highest risk** | Not forbidden. But there is no "hold" in the terms: a place is secured only by a completed, paid booking. The person must accept the terms at checkout. The booking pages run Cloudflare bot detection. RAC may cancel bookings that "cause disruption". Needs a stakeholder decision. |
| (d) Member early access through the app | **Restricted (with conditions)** | Allowed for a member booking for themselves: their own number, they stay, the booking is in their name, at most two bookings for the period. The number is checked against the name at checkout. |

Nothing found says "links only". Nothing found expressly permits automated booking either.

## 1. Automated access

- **No clause on automated access.** The booking terms, payment-plan terms, pet policy, offer terms, FAQs and the site terms never mention bots, scripts, scraping, crawling, monitoring or third-party tools. Plain reading: not addressed.
- **robots.txt allows everything, with a crawl delay.** `/robots.txt`: `Crawl-delay: 10`, then `User-agent: *` / `Disallow:` (empty). Booking paths (`/<park>/book-now/`, `/<park>/booking/`) are not disallowed. The `Crawl-delay` line sits above the `User-agent` line, so strict parsers ignore it; read plainly, RAC asks for 10 s between requests.
- **NewBook host.** The booking engine is NewBook's "online" module, served on RAC's own domain ("Powered by Newbook", `/busselton/booking/`), with scripts and images from `driveau.newbook.cloud`. `https://driveau.newbook.cloud/robots.txt` returns 404. RAC's terms never point to NewBook's terms, so they were not read.
- **The site terms ("Disclaimer", linked from every Parks & Resorts page footer)**, `https://rac.com.au/about-rac/site-info/disclaimer`:
  - "Use of this site constitutes your acceptance of these terms and conditions".
  - "Material may not be copied, reproduced, republished, downloaded, posted, broadcasted or transmitted in any way except for your own personal non-commercial home use."
  - "You agree not to adapt, alter or create a derivative work from any of the material contained in this site or use it for any other purpose other than for your personal non-commercial use."
  - "You agree to use this site only for lawful purposes, and in a manner that does not infringe the rights of, or restrict or inhibit the use and enjoyment of this site by any third party."
  - "The names, images and logos identifying the RAC ... are proprietary marks of the RAC".
- **A request about load**, `/school-holiday-bookings/`: "Please refrain from using multiple devices when booking, as this puts strain on our website and will impact load times."
- **Technical controls (not terms).** `/busselton/book-now/` and `/busselton/booking/` load Cloudflare's bot-detection script (`/cdn-cgi/challenge-platform/scripts/jsd/main.js`). A "Mozilla/5.0" User-Agent got a Cloudflare challenge earlier in this project. This signals that RAC watches for bots, even though no term says so.

## 2. Booking for someone else

- **Personal and not transferable.** `/terms-conditions-and-policies/booking-policy/` 4.1: the Booking "is provided to you in your personal capacity (and any other guests named on the Booking in theirs)" and "cannot be transferred, resold, or otherwise changed into the name of another person."
- **Adult booker.** Same page, 12.6: "You confirm you are over 18 years of age".
- **Member rates need the member to stay.** 8.3.4: the member must "be an Occupant of the accommodation set out in the booking". 8.5: rates are "only available if your Booking is made in the same name as the RAC Member card shown on the Arrival Date."
- **Third parties and member rates.** 8.6: "Third party bookings will not be eligible to receive the RAC Member Rates." The FAQs: "The RAC member discount is only available when booking direct." (`/busselton/park-info/faqs/`). The privacy policy shows RAC takes reservations through "third-party accommodation booking platforms" (`https://rac.com.au/about-rac/site-info/privacy`), so third-party booking channels exist; they just get no member rate.
- **Groups.** "Our website does not currently allow you to make group bookings." Each family books its own site, then a representative emails the booking numbers (`/busselton/park-info/faqs/`).
- **Does the booker have to stay?** For member rates, yes (8.3.4). For other bookings, not stated: the booking is personal and non-transferable, but nothing says the booker must be an occupant.

## 3. Booking limits

- **Per member:** booking-policy 8.5.1: "An RAC member booking may include up to two Bookings, meaning one Additional Booking is permitted for guests of the RAC Member for the same period." The Additional Booking has "the same arrival date and booking length" (definition), carries the member's name (8.5.2), and the member pays for it and answers for its guests (8.5.3–8.5.4).
- **Per person or per night in general:** not addressed. There is no DBCA-style "one booking per night" rule.
- **Units per booking:** not addressed. The website books one unit per booking (groups are refused online, above). Guests per unit are shown per unit ("Max. 4 guests", `/busselton/book-now/`).
- **Pets:** "A maximum of two pets are permitted per site", and pets "must be booked in advance" with approval at the manager's discretion (`/terms-conditions-and-policies/pet-policy/`).
- **Maximum nights:** not addressed in the booking terms. Offers may set one: Summer Stay 3, Pay 2 has "Minimum Length of Stay: 3-nights" and "Maximum Length of Stay: 89-nights" (`/terms-conditions-and-policies/summer-stay-3-pay-2-2026/`). Offers are "not valid for group bookings of 10 or more".
- **Minimum stays and arrival days (peak periods).** Set per park and period, published on the school holiday page and each park's book-now page, and "subject to change without notice". Examples:
  - Sept/Oct 2027 school holidays, most parks: "3 night minimum stay on all categories with arrivals only permitted on 24/09", then 2 nights; some sites 1 night (`/school-holiday-bookings/`).
  - Busselton summer 2026–27: "No arrivals permitted on Christmas Day or New Years Day"; "19/12 – 15/01: 7-night minimum stay with Saturday arrivals and departure only on sites" (`/busselton/book-now/`).
  - Busselton Easter 2027: "26/03 – 28/03: 3-night minimum stay", no arrivals or departures on 27/03 or 28/03.
  - Cable Beach: "bookings for all sites during the peak travel season (June to August annually) have a minimum 3-night stay and must arrive and depart on a Monday or Friday" (`/cable-beach/park-info/faqs/`); the seasonal page says "31/05 – 30/08: arrivals and departures only permitted on Monday and Friday for sites" (`/cable-beach/seasonal-bookings/`).
  - RAC says it confirms these "a week in advance of each school holiday booking release".

## 4. Booking window and releases

- **Rolling window: 364 days.** "We open bookings to all other guests 364 days in advance" (`/anytime-repeat-bookings/`). Also "guests cannot book more than one year in advance". The time of day a new date opens is not stated.
- **Repeat bookings take stock first.**
  - School holidays: past guests rebook in person at reception before the release; "Once the repeat booking process is complete, we then offer priority pre-sale to RAC members before releasing remaining bookings to the general public" (`/school-holiday-bookings/`).
  - Anytime repeat (Busselton, Esperance, Exmouth Cape, Monkey Mia): rebook "upon arrival", ahead of the 364-day public window (`/anytime-repeat-bookings/`).
  - Cable Beach, 15 May – 15 October: seasonal guests request a rebooking "within 7 days of arrival"; others wait for monthly public release dates, for example "1 October – 15 October 2027 · Mon 9 November 2026" (`/cable-beach/seasonal-bookings/`).
- **School holiday releases (the scarce stock).** `/school-holiday-bookings/` lists:

  | Holiday period | Member pre-sale | Public release |
  | --- | --- | --- |
  | 24 Sep – 9 Oct 2027 | 14 Oct 2026 | 16 Oct 2026 |
  | 17 Dec 2027 – 31 Jan 2028 | 3 Feb 2027 | 5 Feb 2027 |
  | 7 Apr – 24 Apr 2028 | 28 Apr 2027 | 30 Apr 2027 |

  Release times per park: "7am: RAC Esperance Holiday Park and RAC Margaret River Nature Park (online only – phones open at 8am)"; "8am: RAC Monkey Mia Dolphin Resort, RAC Busselton Holiday Park and RAC Karri Valley Resort"; "9am: RAC Cervantes Holiday Park and RAC Exmouth Holiday Park". The time zone is not stated (the Black Friday terms use "9am AWST"). Cable Beach, Ningaloo and Rose Gardens are not in the pre-sale; Margaret River dorms are excluded.

## 5. RAC member early access

- **The window:** "If you're an RAC member, you will have access to book via priority pre-sale for 48 hours before bookings will be open to the general public." (`/school-holiday-bookings/`). Booking-policy 9.1: "a fixed time window to book key WA holiday periods before the rest of the general public ... The dates ... will be advertised online." 9.2: the same booking terms apply.
- **Who qualifies:** "a fully paid member of The Royal Automobile Club of W.A. Limited" (8.2).
- **What the member supplies:** "You will need to enter your RAC member number when making your booking" (`/school-holiday-bookings/`); 8.3.1: "provide your valid RAC Member number when prompted, if booking online". The member must also be a member "during the full period of the booking" (8.3.3), be an occupant (8.3.4), show "current proof of membership on the Arrival Date" (8.4), and book in "the same name as the RAC Member card" (8.5).
- **How many:** up to two bookings for the same period (8.5.1, above). These clauses are in the member-rates section; the pre-sale section only says the same terms apply. Whether the two-booking limit caps pre-sale bookings is not stated.
- **Checking:** the book-now page says "Your member discount will be applied once you have verified your details during checkout." NewBook's own messages (in the page source of `/busselton/booking/`) include "Please validate your Membership to proceed with this Members-Only ##TARIFF##", "The membership number provided was not found." and "The membership found does not match your name."
- **Invalid number, or not the guest's:** the terms state no specific consequence. What follows from the text: member rates need a valid number of a member who stays (8.3); proof is checked on arrival (8.4); RAC may end the agreement "if you breach these Terms" (15.1).
- **Other offers also run member pre-sales**, for example Black Friday 2025: "Valid for sale from 9am AWST 24/11/2025 for RAC members", public two days later.

## 6. Holds, carts and payment

- **No hold in the terms.** "Accommodation is only secured once you have completed your booking and received a booking confirmation." (`/school-holiday-bookings/`).
- **When the contract forms:** "Once you pay for your Booking (either in whole or in part), you will be deemed to have accepted these Terms." (1.5). "Once we have processed the payment ... This confirmation creates an agreement" (1.6). Booking-policy 1.9: RAC may be "unable to accommodate you" and will say the booking was unsuccessful.
- **Deposits and balance:** more than 7 days out, "you may be required to pay a deposit (Deposit) up to the total cost", with the balance "at least 3 days prior to your Arrival Date", charged to the card on file if unpaid (1.2). Within 7 days, possibly the total (1.3).
- **Payment plans:** for bookings over $400 arriving 14 or more days ahead; final payment at least 7 days before; cancelled after 2 missed payments (`/terms-conditions-and-policies/payment-plans/`).
- **Checkout:** the person must tick "I/We have read & agree to the ##POLICIES## of ##NAME##"; otherwise "You must agree to the ##POLICIES## of placing a Booking" (NewBook strings in `/busselton/booking/`; the policies are "Terms and Conditions", "Cancellation Policy", "Refund Policy" and "Privacy Policy"). 16.2: "By proceeding with your Booking, you confirm that you have read and acknowledge the terms of our privacy policy."
- **Cart time limit:** not addressed. NewBook has a cart ("Add to cart", "Clear cart", "Proceed to checkout"), but nothing found says whether a cart reserves stock or for how long. Not tested (that would need a cart).
- **Cable Beach seasonal:** "Payment must be made within 72 hours of us confirming availability to you", else the request is cancelled.

## 7. Cancellations and changes

- **Flexible terms (standard rates):** "You may cancel up to 72hrs prior to your arrival without penalty." Within 72 hours, "you will forfeit the cost of your first nights stay." (`/flexible-booking-terms/`; the same in every park FAQ).
- **The booking terms say it differently:** within 72 hours "you forfeit your Deposit" (3.5.2), and the deposit can be "up to the total cost" (1.2). No show: no refund (3.6). Leaving early: no refund for unused nights (3.5.4).
- **Other rates:**
  - Advance Saver: full refund more than 7 days out, deposit forfeited within 7 days (10.4).
  - Black Friday sale: "Cancellation at any time will see a forfeiture of full stay cost".
  - Summer Stay offer: "Cancellation at any time will see a forfeiture of 1 night deposit."
  - School Holiday Repeat Booking: "If you cancel ... at any time, you will forfeit your Deposit" (5.4).
  - Cable Beach seasonal deposits are non-refundable.
- **Changes:** need "RAC's prior consent" (2.1); changes inside the cancellation-restricted period count as a cancellation (2.1.1); the rate may change (2.3).
- **For watches (an inference, not a term):** free cancellation ends 72 hours before the 2pm arrival time, so cancelled stock most likely reappears in the days before that point. Repeat and seasonal guests who cancel also release stock (seasonal guests lose future seasonal bookings).

## 8. Privacy

- RAC's privacy policy covers how RAC handles personal information. It says nothing about a member storing their own member number or booking details in another app. Not addressed. (`https://rac.com.au/about-rac/site-info/privacy`, "last updated on: 6 October 2026")
- The booking terms (12.1, 16) point to the same policy. The person acknowledges it at checkout (16.2).
- Because RAC checks the number against the member's name, a stored number is personal data that identifies the member. WA Stay's own rules decide how to keep it (see rules 11–12).

## 9. Anything else

- **RAC may cancel disruptive bookings:** "We may cancel this Agreement at any time if we believe your Booking may cause disruption to the operation of RAC Parks and Resorts, other RAC members or guests." (12.8). Breach: RAC may end the agreement by written notice (15.1).
- **Site terms are all or nothing:** "If these Terms and Conditions are not accepted in full, you do not have permission to access the contents of this website".
- **Repeat and seasonal bookings are human-only processes:** in person at reception (5.2.1), on arrival (6.2.4), or a form for current guests (`/cable-beach/seasonal-bookings/`).
- **Leavers:** RAC refuses school-leaver bookings in the Leavers period (12.7); Busselton asks others booking that week to phone.
- **Who is who:** the booking party is "RAC Tourism Assets Pty Ltd (ACN 168 253 085)"; the site terms are from "Royal Automobile Club of WA". Rose Gardens Holiday Park (`rosegardensholidaypark.com.au`) is an RAC park; it links the same booking terms, disclaimer and privacy policy, and its robots.txt allows everything.
- **Ningaloo Reef Resort** is "Closed for redevelopment" (`/bookings/`).

## Rules the app must follow

Rules 1–7 apply to every request. Rules 8–16 apply to bookings, holds and member numbers.

1. **Personal use only.** RAC data is fetched on the person's own computer, for their own trip, and is never collected on a server, shared between users or sold. WA Stay stays non-commercial while this provider ships (site terms). Test: no RAC code path talks to any host but RAC's and NewBook's.
2. **10 s between automated requests.** Background work (catalogue sync, watches, bulk availability) sends at most one request to `parksandresorts.rac.com.au` every 10 s per app, one at a time (`maxConcurrentRequests: 1`). Test: a fake clock shows no two background requests closer than 10 s.
3. **Slow watches.** `minWatchIntervalMinutes` at least 15 (the ParkStay value; the terms set no number). Watches never poll faster near a release time.
4. **One session.** The app never runs parallel sessions, partitions or browsers against RAC for one person ("refrain from using multiple devices"). Test: one `persist:provider-rac` partition; the HTTP client is single-flight.
5. **No evasion.** Never solve, bypass or work around a Cloudflare challenge or bot check. Never rotate the User-Agent, IP or cookies to avoid one. A challenge or a 403/429 stops the job, is shown to the person, and is not retried in a loop.
6. **Show facts, link the rest.** Show park names, unit types, availability and prices, and link to RAC's own pages. Don't rework RAC's photos or marketing copy into new content, and don't republish them outside the person's app (site terms: no copying "except for your own personal non-commercial home use", no "derivative work").
7. **Nothing of RAC's in public artefacts.** Test fixtures in the public repo are trimmed to factual fields, with no RAC photos or descriptive copy. The website and docs screenshots show no RAC photos. No RAC logo: monogram and brand colour only, plus the independence notice.
8. **Payment and acceptance are human steps.** The app never ticks RAC's "I/We have read & agree" box, never submits card details and never completes a checkout. Checkout is always in RAC's own pages in the payment window, done by the person (1.5, 1.6, 16.2).
9. **Bookings are personal.** Bookings are made only for the person (and the guests named on them). There is no feature to transfer, resell or change the name on a booking (4.1).
10. **The app never cancels or changes a booking.** Changes need RAC's consent (2.1); the person does them on RAC's pages.
11. **Member number: the person's own.** Only the person's own RAC member number is stored, at most one per profile, and only with the person's confirmation that they are the member, will stay, and will book in the name on the card (8.3–8.5).
12. **Member number is a secret.** It is stored through the SecretVault, never logged, and sent only to RAC's booking engine at its own membership prompt in a real booking. The app never checks, tests or tries member numbers outside that flow.
13. **Member bookings: at most two per period.** With a member number, the app never holds or starts more than two bookings for the same arrival date and length: the member's own plus one Additional Booking (8.5.1). Test: a guard refuses a third.
14. **Pre-sale only for members.** The app treats pre-sale stock as bookable only for a profile with a member number. It never offers it to a profile without one.
15. **Holds, if built at all** (stakeholder decision, below): one cart per person at a time, holding only what one booking needs; the cart is cleared as soon as the person declines or the payment window closes; no hold is ever counted as "secured" before RAC's confirmation; and no live hold in any test or trial (architecture-notes §12.33).
16. **Respect booking parameters.** Watches and holds use only stays that meet the park's minimum nights and arrival days, pet limits (two per site) and the 364-day window. When unsure, leave it to RAC's engine and report the refusal as a result.

## Ambiguities for the stakeholder

1. **Should Site Sniper (automatic holds) be offered for RAC at all?** The terms don't forbid it. But "secured" means a paid, confirmed booking; RAC asks people not to strain the site at release; the site terms forbid use that inhibits others; the booking pages run bot detection; and RAC can cancel "disruptive" bookings. Options: (a) no snipes for RAC; (b) snipes only outside school-holiday releases; (c) ask RAC first. Asking RAC in writing is the safest route.
2. **Does a NewBook cart hold stock, and for how long?** Not stated. Finding out needs a cart, which the no-live-holds rule forbids. RAC or NewBook would have to say.
3. **Does a booking prepared by WA Stay count as a "third party booking"** that loses member rates (8.6)? Read plainly, "third party" means other sellers (the privacy policy's "third-party accommodation booking platforms"). The person still books directly on RAC's pages. But RAC could read it otherwise.
4. **Does the 10 s crawl delay apply to a person's own clicks?** It is written for crawlers. Rule 2 applies it to background work only. Interactive requests the person makes (open a park, check dates) would go at browser pace, one at a time.
5. **Do the site terms bind `parksandresorts.rac.com.au`?** They speak of "this site" on rac.com.au, but every Parks & Resorts page links them as its footer "Disclaimer". This review assumes they apply.
6. **Is WA Stay "non-commercial"?** If WA Stay is ever paid, carries ads or is offered as a service, the "personal non-commercial" condition becomes a problem.
7. **Which cancellation rule applies within 72 hours?** The flexible terms say the first night; the booking terms say the deposit, which can be the whole stay. The app should show RAC's words and link the terms, not choose one.
8. **Do the pre-sale times (7, 8 and 9am) apply to the member pre-sale as well as the public release, and in which time zone?** The page doesn't say. AWST is likely. The app should not rely on exact times; it should tell the person.
9. **Does the two-booking member limit cap pre-sale bookings?** Probably, since 9.2 applies the same terms, but it is not stated.
10. **Is the booker required to stay** for a non-member booking? Not stated. Rule 9 keeps bookings personal either way.
11. **Should WA Stay ask RAC for permission, or an API?** Nothing requires it. A short written "no objection" from RAC would settle items 1–4.

## Pages read

All fetched 16 Oct 2026, HTTP 200 unless noted.

- `/robots.txt`; `https://driveau.newbook.cloud/robots.txt` (404); `https://rosegardensholidaypark.com.au/robots.txt`
- `/terms-conditions-and-policies/` and its pages: `booking-policy/`, `payment-plans/`, `pet-policy/`, `summer-stay-3-pay-2-2026/`, `black-friday-sale-2025-tcs/`, `travel-expo-sale-2026-tcs/`; `wa-on-sale/` (404, linked but missing). Competition PDFs not read (prize draws, not bookings).
- `/school-holiday-bookings/`, `/flexible-booking-terms/`, `/anytime-repeat-bookings/`, `/cable-beach/seasonal-bookings/`
- FAQs: `/busselton/park-info/faqs/`, `/cable-beach/park-info/faqs/`, `/monkey-mia/resort-info/faqs/`, `/karri-valley/resort-info/faqs/`, `/esperance/park-info/faqs/`
- `/member-benefits/`, `/bookings/`, `/login/`, `/trade-information/`, `/margaret-river/group-bookings/`, `/busselton/book-now/`, `/busselton/booking/` (the NewBook page, read-only GET)
- `https://rac.com.au/about-rac/site-info/disclaimer` (site terms), `.../privacy`, `.../security`; `https://rosegardensholidaypark.com.au/`
- Not found: a separate "website terms of use" for Parks & Resorts (the footer's "Disclaimer" is it), member-benefit terms specific to parks (the member-benefits page points back to the terms index), and NewBook terms (RAC's terms don't refer to them).
