# Rottnest Island (Stay Rottnest / RIA): how accommodation is released

Research date: 2026-10-17 (all sources fetched that day). Scope: release rules, open days, booking rules, cancellations and inventory, for a possible WA Stay provider. The stayrottnest.com booking engine, search and availability pages were not accessed. Only CMS PDFs under `stayrottnest.com/cms/stayrottnest/pdfs/` were fetched, about 30 requests spaced 4–6 s apart.

Labels used below:
- **[V: source]**: verified, seen in that source. The source keys are listed under Sources.
- **[S: source]**: seen only in a search-engine snippet of a page that blocked us.
- **[I]**: inferred.

Access note: `www.ria.wa.gov.au` HTML pages and `www.rottnestisland.com` HTML pages return a Cloudflare managed challenge (HTTP 403, "Just a moment...") to curl and WebFetch. `web.archive.org` is blocked by the egress proxy. The RIA open-days page and the RIA news items therefore could not be read directly. The underlying documents could be read: the monthly Open Day booking guide PDFs, which are the "schedule PDFs" the stakeholder remembers, the T&Cs, the FAQ, the annual reports, the WA Government media statement and news articles.

---

## Summary

- **Release rule.** Each **Open Day** releases one whole calendar month of stays for **all** RIA accommodation types at once: self-contained units, heritage cottages, bungalows, chalet, Caroline Thomson Cabins, Kingstown dorms, Governor Circle, Hostel and Campground.
  - Open Days fall on the **first Wednesday of month M** and release stay month **M+8**. The last night released is about nine months out, so RIA calls it "nine months in advance".
  - Bookings open at **8:30 am AWST**, and the **online waiting room opens from 6 am**. [V: every guide 2023–2027, booking-guide index]
  - Only one exception is documented. When the first Wednesday was New Year's Day (2025), the Open Day moved to the following Wednesday, **8 January 2025**. [V: Sep 2025 guide]
  - One Open Day was postponed a week after an outage: 1 June 2022 moved to 8 June 2022. [V: Geraldton Guardian/The West 2022-06-01]
- **Latest schedule.** The Open Day on **Wed 7 Oct 2026** released **June 2027**. "Availability for Stay Rottnest accommodation dates up to June 2027 have been released." [V: openday.rottnestisland.com]
  - The next Open Days are:
    - **Wed 4 Nov 2026**: July 2027
    - **Wed 2 Dec 2026**: Aug 2027
    - **Wed 6 Jan 2027**: Sep 2027
  - The published schedule continues monthly to **Wed 6 Oct 2027**: June 2028. [V: booking-guide index, June 2027 guide]
- **Queue.** The waiting room is the Queue-it virtual waiting room [S: RIA "new booking website" news, 4 Dec 2022].
  - Everyone who is in the waiting room before 8:30 gets a **random position**, "whether they joined at 6 am or 8:25 am". Anyone who joins after 8:30 goes to the back.
  - When their turn comes, a person has **30 minutes to enter** the booking site.
  - Since the Feb 2025 Open Day, an **SMS one-time passcode** to a mobile number is required to enter the waiting room. Since the Mar 2026 Open Day, "temporary or virtual phone numbers cannot be used". [V: guides]
- **Site Sniper has no timing edge on an Open Day.** [I, from the random-queue rule] Arriving at 8:30:00 exactly gives no advantage over arriving at 6:05.
- **Ballots.** There is no ballot now. The old ballot was abolished around 2014; the ABC reported in Nov 2022 that it was abolished "about eight years ago". Peak periods are handled instead with **fixed arrival/departure blocks per precinct**, released on the normal Open Day. [V: ABC 2022-11-12; Nov 2026–Apr 2027 guides]
- **Automation is forbidden by the T&Cs.** Clause "Use of Automated Software" is in the T&Cs from about the May 2025 Open Day, and in the current T&Cs RIA4555, effective for bookings from 4 Mar 2026. It reads:
  > bookings may not be made or assisted by the use of automated software … This includes, but is not limited to, automated programs or scripts used for web scraping, data mining, rate shopping, booking …

  The penalty is cancellation **without refund**, and "RIA may block website users or specific IP addresses". [V: T&Cs PDF; every guide since Jan 2026 stays]
  - The 2023–24 annual report records a "One-time password … and Unique ID restrictions for Stay Rottnest Open Days to improve fairness". The 2024–25 report records "a new security platform".
  - **Implication for WA Stay** [I]: the project's rule ("If they forbid automated access, the provider gets links only") points to a **links-only** Rottnest provider. At most a deep link and the Open Day calendar would be shown, with no polling watches and no Site Sniper.
- **Cancellations.** Cancelled stays go back on general sale on stayrottnest.com. This is the stated purpose of the 2023 no-transfer rule: "return unwanted bookings to Stay Rottnest, making the resale available to everyone". [V: WA Gov media statement 2022-12-29]
  - No source says *when* a cancellation reappears: immediately, batched, or at a set time. Cancellations must be made "in writing or by email". [V: T&Cs]
  - Same-day bookings cannot be made online. [V: WA.gov.au service page]

---

## Open days

### Rule

**Bookings open (verified).** All RIA accommodation (self-contained units, Campground and Hostel) opens at **8:30 am AWST**. The booking guides state that this booking guide "covers all Rottnest Island Authority Accommodation; from self-contained units to the Campground and Hostel". [V: every guide]
- Current wording: "Bookings for June 2027 will open on Wednesday 7 October 2026 at 8:30 am and the online waiting room will open from 6 am. * All times listed are in Australian Western Standard Time (AWST)". [V: June 2027 guide]
- The index PDF says: "Lock in key dates for Open Days to book reservations nine (9) months ahead. Open Days occur the first Wednesday of each month." [V: booking-guide index]
- RIA's open-days page has the same rule, in words seen only in snippets: "Rather than having accommodation options open for booking all year round, it releases availability for Stay Rottnest one month at a time, nine months in advance of the next booking period." It adds that if Stay Rottnest has technical difficulties the Open Day "may be delayed or rescheduled depending on forecast downtime". [S: RIA open-days page]

**Formula.** Open Day = first Wednesday of month M → releases calendar month M+8. [V: all 54 dated rows below fit; checked by script]
- Exception: 1 January → the following Wednesday (8 Jan 2025). [V]
- No other WA public holiday can fall on a first Wednesday [I].
- The next year in which 1 January is a Wednesday is 2031 [I].

**What "released" means** [V: guides; T&Cs §8(d)]:
- **5/3 rule.** "When booking in advance and into a month that has not yet been released for sale, at least 5 nights must be booked within the open month to be able to book a maximum of 3 nights in the closed month. Subsequent shortening of the stay by reducing the number of nights in the arrival month is not permitted. Please note this does not apply to all Open Days (see applicable Booking Guide)."
  - Consequence [I]: up to the first 3 nights of a month can already be partly booked before that month's own Open Day.
- **Months with the 5/3 carry-over suspended.** These guides say "There will be no bookings into [next month] on this Open Day":
  - Nov 2026 (nothing into Dec)
  - Dec 2026 (no New Year's Eve and nothing into Jan 2027)
  - Apr 2027 (depart by Sat 1 May 2027)
  - Jun 2027 (depart by Thu 1 Jul 2027)
- **Peak fixed blocks.** In peak periods each precinct has fixed arrival/departure blocks (below), released on the normal Open Day.
  - "Bookings after the below fixed dates and into January 2027 (including New Year's Eve) are available from Wednesday 6 May 2026." [V: Dec 2026 guide]

**Queue and day-of mechanics, current guide** [V: June 2027 guide; the same text has been used since the Feb 2025 Open Day]:
> As an enhanced security measure on Open Days, a one-time-use passcode is required for access to the virtual waiting room to book your next stay online. Prior to accessing the virtual waiting room, you will be prompted to enter your mobile number, and choose the country code. A one-time-use passcode will then be sent to your mobile number which will need to be entered on the next screen within 10 minutes. Note that temporary or virtual phone numbers cannot be used. The virtual waiting room will open from 6 am and bookings will open from 8:30 am. Any users in the waiting room prior to bookings opening will receive a randomised position in the queue and will still be required to go through the security measure.

> 1. Head to stayrottnest.com by 8:30 am AWST … A tip: In the virtual waiting room prior to 8:30 am? You'll be assigned a random position in the queue whether they joined at 6 am or 8:25 am.
> 3. When it's your turn to book, you'll have 30 minutes to enter the booking site. If you exceed the time, you'll have to join the back of the queue.
> 4. … Places fill fast and your booking is not confirmed until payment details have been authorised.

2024 wording [V: Apr/May/Aug 2024 guides]:
- "if you join after 8:30 am, you'll join at the back of the queue"
- "You can take as long as you like without being kicked off the site if you are actively using it; but remember – places fill fast and your booking is not confirmed until your payment details have been authorised."
- "In general, almost 90% of successful bookings are made online within the first 30 minutes of an Open Day"

**Channels on an Open Day:**
- Online, or by phone on 1800 111 111 from 8:30.
- No in-person bookings at the Fremantle office (from 1 Mar 2023), and none at the island Visitor Centre on Open Days. [V: May 2024 guide; S: RIA news 23 Feb 2023]
- "Booking requests received prior to 8:30am on Open Day will not be accepted." [V: 2024 guides]
- Accessible (ACROD) requests go by email to stay@rottnestisland.com, "processed in order they are received from 8:30 am onwards", with "A limit of one booking per ACROD Card". In peak months the limit is "one fixed date booking per ACROD Card". [V]

**Advice on bots and automation:**
- The guides contain no bot advice beyond the karma note: "Occasionally we hear of someone booking more than they need, only to dump it later … Only book what you need".
- The T&Cs clause is quoted under Booking rules.
- 2023–24 annual report, ICT: "One-time password implemented for Stay Rottnest Open Day accommodation booking to improve fairness" and "Unique ID restrictions for Stay Rottnest Open Days to improve fairness".
- 2024–25 annual report: "Additional accommodation booking system security features including implementation of a new security platform and improved booking process". [V]

**Demand data points** [V: news]:
- April 2021, Christmas release: "3000 people sat in the que"; "In the first 15 minutes we'd had over 500 bookings"; Christmas stays had a "five night minimum stay period". [6PR 2021-04-06]
- RIA, Nov 2022: "We had 15,000 people queued online for that open day in January, and only 1,500 bookings available". About 10% of Christmas-holiday hopefuls succeed. [ABC 2022-11-12]

### Table of open days (past and upcoming)

All are at 08:30 AWST unless noted. In the "Source" column:
- **cover** means the stay month's own guide states this date.
- **sched** means the date appears only in another guide's forward schedule.

| Open day | Stay period released | Source | Notes |
| --- | --- | --- | --- |
| Tue 6 Apr 2021 | Dec 2021 | 6PR | Pre-Stay Rottnest system. Next: "on the 3rd of May … opening for January". Appears to be first Monday then, moved for Easter Monday [I] |
| Mon 3 May 2021 | Jan 2022 | 6PR (announced) | First Monday [I] |
| Wed 1 Jun 2022 → **Wed 8 Jun 2022** | Feb 2023 | Geraldton Guardian/The West | "significant technical issue overnight … reschedule the Open Day to Wednesday 8 June" |
| Wed 1 Feb 2023 | Oct 2023 | 2022/23 index guide | First Open Days after stayrottnest.com launched (4 Dec 2022) |
| Wed 1 Mar 2023 | Nov 2023 | sched (2022/23 index) | |
| Wed 5 Apr 2023 | Dec 2023 | sched | |
| Wed 3 May 2023 | Jan 2024 | sched | |
| Wed 7 Jun 2023 | Feb 2024 | sched | |
| Wed 5 Jul 2023 | Mar 2024 | sched | |
| Wed 2 Aug 2023 | Easter + Apr 2024 | cover | Fixed Easter/April school-holiday blocks per precinct; max 14 nights |
| Wed 6 Sep 2023 | May 2024 | cover | 5/3 into June 2024; Geordie & Fay's unavailable from 15 Apr 2024 (works) |
| Wed 4 Oct 2023 | Jun 2024 | sched | |
| Wed 1 Nov 2023 | Jul 2024 | sched | |
| Wed 6 Dec 2023 | Aug 2024 | cover | Geordie & Fay's unavailable Aug 2024 |
| Wed 3 Jan 2024 | Sep 2024 | sched | |
| Wed 7 Feb 2024 | Oct 2024 | cover | |
| Wed 6 Mar 2024 | Nov 2024 | sched | |
| Wed 3 Apr 2024 | Dec 2024 | sched | |
| Wed 1 May 2024 | Jan 2025 | sched | |
| Wed 5 Jun 2024 | Feb 2025 | sched | |
| Wed 3 Jul 2024 | Mar 2025 | sched (Oct 2024 guide) | The Aug 2024 guide misprints "Wednesday, 7 July 2024" (a Sunday) |
| Wed 7 Aug 2024 | Apr 2025 | sched (Oct 2024 guide) | The Aug 2024 guide misprints "Wednesday, 3 August 2024" (a Saturday) |
| Wed 4 Sep 2024 | May 2025 | sched | |
| Wed 2 Oct 2024 | Jun 2025 | sched | |
| Wed 6 Nov 2024 | Jul 2025 | sched | |
| Wed 4 Dec 2024 | Aug 2025 | cover | |
| **Wed 8 Jan 2025** | Sep 2025 | cover | Second Wednesday: 1 Jan is a public holiday |
| Wed 5 Feb 2025 | Oct 2025 | cover | **First "New Security Measure": SMS OTP for the waiting room**; Fay's Bay unavailable Oct 2025 |
| Wed 5 Mar 2025 | Nov 2025 | sched | |
| Wed 2 Apr 2025 | Dec 2025 | sched | |
| Wed 7 May 2025 | Jan 2026 | cover | NYE/Jan 2026 fixed blocks; min 3 nights for Campground, Kingstown dorms and Governor Circle; Feb 2026 carry-over from 4 Jun 2025. **First guide carrying the automated-software T&C** |
| Wed 4 Jun 2025 | Feb 2026 | sched | |
| Wed 2 Jul 2025 | Mar 2026 | sched | |
| Wed 6 Aug 2025 | Apr 2026 | sched | |
| Wed 3 Sep 2025 | May 2026 | sched | |
| Wed 1 Oct 2025 | Jun 2026 | sched | |
| Wed 5 Nov 2025 | Jul 2026 | cover | 5/3: arrive by Mon 27 Jul, depart by Tue 4 Aug 2026; Saturdays min 2 nights |
| Wed 3 Dec 2025 | Aug 2026 | cover | 5/3: arrive by Thu 27 Aug, depart by Fri 4 Sep 2026 |
| Wed 7 Jan 2026 | Sep 2026 | cover | 5/3 into Oct; "maximum stay of 14 nights per booking from Friday 25 September 2026"; school holidays 26 Sep–11 Oct |
| Wed 4 Feb 2026 | Oct 2026 | cover | 5/3: arrive by Tue 27 Oct, depart by Wed 4 Nov 2026; max 14 nights |
| Wed 4 Mar 2026 | Nov 2026 | cover | Fixed blocks from 22 Nov; **no bookings into Dec**; new T&Cs (minors) effective 4 Mar 2026; "virtual phone numbers cannot be used" |
| Wed 1 Apr 2026 | Dec 2026 | cover | Fixed blocks all December; **no bookings over NYE or into Jan 2027**; min 3 nights for Campground, Kingstown dorms, Hostel family rooms and Governor Circle |
| Wed 6 May 2026 | Jan 2027 (incl. NYE) | cover | Fixed blocks all January; Feb 2027 carry-over from 3 Jun 2026 |
| Wed 3 Jun 2026 | Feb 2027 | cover | Channel Swim Sat 20 Feb 2027: booking must include Fri 19 or Sun 21; 5/3 into March |
| Wed 1 Jul 2026 | Mar 2027 (incl. Easter) | cover | Easter fixed blocks (Good Friday 26 Mar 2027); Port to Pub Sat 20 Mar: must include Fri or Sun; 5/3 into April |
| Wed 5 Aug 2026 | Apr 2027 | cover | April school-holiday fixed blocks (10–25 Apr 2027); **no bookings into May** (depart by Sat 1 May) |
| Wed 2 Sep 2026 | May 2027 | cover | 5/3 into June; Bathurst unavailable from 27 Apr 2027 (works) |
| **Wed 7 Oct 2026** | **Jun 2027** | cover | Latest held. **No bookings into July** (depart by Thu 1 Jul 2027); Bathurst unavailable June 2027; WA Day 7 Jun 2027 |
| **Wed 4 Nov 2026** | **Jul 2027** | sched + index | Next |
| Wed 2 Dec 2026 | Aug 2027 | sched + index | |
| Wed 6 Jan 2027 | Sep 2027 | sched + index | |
| Wed 3 Feb 2027 | Oct 2027 | sched + index | |
| Wed 3 Mar 2027 | Nov 2027 | sched + index | |
| Wed 7 Apr 2027 | Dec 2027 | sched + index | |
| Wed 5 May 2027 | Jan 2028 | sched + index | |
| Wed 2 Jun 2027 | Feb 2028 | sched + index | |
| Wed 7 Jul 2027 | Mar 2028 | sched + index | |
| Wed 4 Aug 2027 | Apr 2028 | sched + index | |
| Wed 1 Sep 2027 | May 2028 | sched + index | |
| Wed 6 Oct 2027 | Jun 2028 | sched + index | Last published date |

Notes on the published schedules:
- Every schedule carries "Subject to change. See stayrottnest.com for the latest schedule."
- Each month's guide PDF is published a few weeks before its Open Day. Going by PDF ModDates, between 6 and 20 days before; for example, the June 2027 guide was modified 18 Sep 2026.
- The guide URLs follow a pattern: `https://www.stayrottnest.com/cms/stayrottnest/pdfs/open_day_booking_guide_<month>_<yyyy>.pdf`, where `<month>` is lower case and spelled out and `<yyyy>` is the stay month's year. The pattern holds for Jul 2025 stays onward; 2024 guides were under `rottnestisland.com/docs/default-source/open-day/`.
- The index PDF `stay_rottnest_booking_guide.pdf` (last-modified 25 Sep 2026) lists the next 12 Open Days and links the last 12 guides.

**Merged schedule.** The rows were extracted by script into `schedule-merged.txt`. Every row shows an 8-month offset, and every Open Day is a first Wednesday except 8 Jan 2025. [V]

### Peak fixed blocks (example: Dec 2026, Open Day 1 Apr 2026) [V: Dec 2026 guide p3]

> For those wishing to holiday in Stay Rottnest accommodation in December 2026, you must arrive and depart on the fixed dates shown below with a maximum stay not exceeding 14 nights. These fixed dates are in place during peak periods.

Blocks are staggered by precinct:
- **Thomson Bay North:** 29 Nov–3 Dec, 3–9, 9–14, 14–21 and 21–27 Dec.
- **Bathurst and Caroline Thomson Cabins:** 29 Nov–3 Dec, 3–7, 7–11, 11–18, 18–23 and 23–30 Dec.
- **Longreach Bay and Fay's Bay:** 30 Nov–4 Dec, 4–10, 10–16, 16–22 and 22–29 Dec.
- **Geordie Bay:** 1–8, 8–15, 15–22 and 22–29 Dec (Tuesdays).
- **Thomson Bay South and Kingstown Heritage/Superior View:** 28 Nov–2 Dec, 2–6, 6–13, 13–19, 19–24 and 24–31 Dec.

"Campground, Kingstown Dormitories, Hostel Family Rooms and Governor Circle have a minimum 3-night stay requirement in December 2026." The same structure is used for:
- late Nov 2026 (from 22 Nov)
- Jan 2027
- Easter 2027
- April 2027 school holidays

The full tables are in the guides' `*.layout.txt` files. Implication [I]: in peak periods availability is per (precinct, fixed block), not per night. A cancellation watch must ask for exact block dates.

---

## Ballots

- **No current ballot** for any period. None of the 20+ guides, the T&Cs or the FAQ mention one. [V, by absence]
- **History** [V: ABC 2022-11-12]:
  - Facebook users advocated "a return to the old ballot system, which enabled visitors to choose an accommodation category and be allocated a unit at random if successful".
  - RIA's Director of Visitor Services Deborah Taylor: "the ballot system, which was abolished about eight years ago, was administratively burdensome and was scrapped because the RIA wanted to offer a 'first in, best dressed' system instead. 'We believe the online queue system that we now have is more like a randomised ballot … to give everyone the same kind of chance'".
- **What replaces it:** the randomised Queue-it position for everyone present before 8:30, plus fixed school-holiday blocks. Peak blocks are released on the ordinary monthly Open Day, eight months ahead. [V]

---

## Booking rules (2023 update and current)

### January 2023 T&C update [V: WA Gov media statement 2022-12-29 and RIA news, title only]

The new booking site launched in early December 2022: "following the launch of the new Stay Rottnest booking site earlier this month". The RIA news item is dated 4 Dec 2022. [S: RIA news]
- "All new bookings made from Wednesday, 4 January 2023 will be subject to a new condition preventing the transfer of ownership to another person. The original guest will now remain as the owner of the booking."
- "The owner may add another person to check in to the accommodation. But the original guest's details will remain on the booking and they will be liable for any costs …"
- "The change reflects customer feedback that the online reselling of Rottnest Island bookings to unknown third parties, rather than returning them to Stay Rottnest for general resale, was unfair."
- "Bookings made before 4 January 2023 will remain transferable as per the terms and conditions that applied at the time of booking."
- The Minister said: "As bookings can be made up to nine months in advance … The change … is expected to encourage customers to return unwanted bookings to Stay Rottnest, making the resale available to everyone. This builds on recent customer-friendly updates such as the new Stay Rottnest booking site, amendments to cancellation fees and reduced deposit requirements". The old amounts are not given.
- From 1 Mar 2023 there are no in-person bookings at the Fremantle office or at the Visitor Centre on Open Days, and "additional resources will be allocated to our call centre for popular Open Days". [S: RIA news 23 Feb 2023; V: May 2024 guide]

### Current rules [V: T&Cs RIA4555 "Effective for all new bookings made from 4 March 2026"; June 2027 guide; FAQ RIA4644 Aug 2026]

| Topic | Rule |
| --- | --- |
| Primary guest | Over 18; must "physically provide original photo identification and a valid credit card to staff on check in" |
| Transfer and resale | "The primary guest may not transfer, assign or sell the booking to another person." (since 4 Jan 2023) |
| Keyholder | One nominated keyholder (over 18) may check in instead, with ID and credit card. The primary guest stays liable |
| Must stay | "spend each night in the Premises for the duration of the booking" (§11a). 2024 guides: "you can only be the registered guest for one accommodation at a time and must be staying in the unit for the duration of the stay" |
| Minors | From 4 Mar 2026, a parent or guardian of at least one minor must stay in the same premises; "Leavers" are excepted |
| Units per transaction | "A maximum of two units per transaction. If you book a second unit in your name, you will need to nominate a keyholder … no later than 7 days prior to arrival." 2024: "If you want to book more units, you'll need to join the queue again." No per-account or per-season cap is stated [V by absence] |
| Max nights | "A maximum stay of 14 nights per booking" (Apr 2024, Oct 2025, Oct 2026 and peak guides). The Sep 2026 guide says "from Friday 25 September 2026". Whether it applies year-round is unclear |
| Min stays | "All Saturdays have a minimum two-night stay requirement" (2024–2026 guides). "Unit arrivals and departures are not permitted on public holidays." Peak: Campground, Kingstown dorms, Hostel family rooms and Governor Circle min 3 nights. Event weekends (Channel Swim, Port to Pub) must include Friday or Sunday. FAQ: "Some minimum night stays are required, and these vary according to the season." T&Cs §8(c): "Fixed arrival and departure dates may also be set over Summer and Easter school holidays." |
| Payment | "All bookings of self-contained accommodation must pay a 25% deposit at time of booking, with the balance due 30 days prior to arrival. Campground and Hostel bookings require payment in full at time of booking." Balance charged automatically. "Failure to pay the full booking price by the due date will result in the booking being cancelled". Visa and Mastercard only (no Amex or Diners, per the 2024 guide) |
| Hold / cart | No timed cart hold is published. "your booking is not confirmed until payment details have been authorised". RIA in 2022: "bookings not being held until a deposit has been paid" (ABC). Queue entry window: 30 min. OTP entry window: 10 min |
| Cancellation fees (§8e) | (i) Cooling off: cancel within 14 days of booking with >30 days to arrival → full refund. (ii) >30 days, after cooling off → "$55 fixed charge or 50% of the cost of the first night (whichever is the lowest)". (iii) 3–30 days → 100% of the first night. (iv) "Less than 48 hours prior to 2 pm check-in time: Full payment for the stay will be retained." The 2024 terms had no cooling-off clause, though the guide mentioned a "14-day cooling off period on an open day if you need to change your booking". The formal clause appears from the Aug 2025 guide |
| Alterations | "in writing or by email". Cancellations "must be cancelled in writing or by email". 5/3 stays cannot be shortened in the arrival month |
| Unit allocation | Specific unit requests are best-effort; the unit number is "assigned until approximately three weeks before you arrive" (FAQ: emailed about 3 weeks prior). Under 3 weeks: phone to confirm a unit (WA.gov.au) |
| Same day | "Online bookings cannot be made for same day accommodation." Phone 1800 111 111 instead (WA.gov.au, updated 22 May 2023) |
| Check-in / out | Self-contained: in from 2 pm, out before 9 am. Campground: 10 am for both |
| Occupancy | Campground: 2 tents and 6 people per site. Governor Circle, Caroline Thomson Cabins, Kingstown dorms and Hostel: 1 person per bed. Self-contained: fixed beds + 50% for select units |
| Reallocation | "Under exceptional circumstances the RIA reserves the right to reallocate a booking to an alternative of a similar type." |
| **Automated software (§4)** | Quoted in full below |

T&Cs §4, "Use of Automated Software", is quoted in full here because it bears directly on WA Stay:
> The primary guest acknowledges it is RIA policy that: a) bookings may not be made or assisted by the use of automated software or any system designed to perform tasks on the internet that would normally require human intervention. This includes, but is not limited to, automated programs or scripts used for web scraping, data mining, rate shopping, booking, and any other activities that mimic human behaviour to gain unauthorized access or perform excessive interactions with our website. b) where a booking is reasonably suspected by RIA to have been made by or with the assistance of automated software or system as described in paragraph (a), RIA may cancel the booking without refund. RIA may block website users or specific IP addresses that have exhibited behaviour consistent with the use of automated software or system as described in paragraph (a).

When the clause first appeared [V]:
- It is absent from the Oct 2025 guide (Open Day 5 Feb 2025).
- It is present in the Jan 2026 guide (Open Day 7 May 2025, PDF modified 30 Apr 2025), numbered §3 there.
- It is in every later guide and in the standalone T&Cs (RIA4555, March 2026).

---

## Cancellations back to inventory

- **They do go back on general sale** [V]:
  - WA Gov 2022-12-29: "encourage customers to return unwanted bookings to Stay Rottnest, making the resale available to everyone".
  - RIA in the ABC, Nov 2022: "The fairest thing is actually to cancel it, return the accommodation to us and then it's available to everyone for bookings".
  - Grantourismo (Mar 2023, updated Jan 2026): "if bookings are no longer required they go back onto the reservations site".
- **Timing is not documented.** No source says immediately, batched or at a set time. Cancellation is "in writing or by email" (T&Cs §8b), which suggests staff processing in business hours (phone hours: Mon–Fri 8:30 am–5 pm) before the nights reappear [I].
- **Gaps fill quickly.** The P3 booking-engine case study (Aug 2023) quotes RIA:
  > We now have a huge demand for short-lead time bookings … people could scroll through the availability calendar … 40% of the new bookings were made for gaps during the peak period from December to April

  Properties are "more consistently fully booked with few gaps between stays". [V: hotel-online 2023-08-29]
- **Likely clusters of returned inventory** [I, from the fee and payment rules]:
  - Within 14 days after each Open Day: the cooling-off period gives a full refund while >30 days remain, and RIA itself complains of people who "book more than they need, only to dump it later".
  - Around 30 days before arrival: unpaid balances are cancelled automatically, and the fee steps up from $55 to a full night.
  - Around 48 hours before 2 pm check-in, when the fee becomes the whole stay.
- **Peak periods return whole blocks** [I]: a cancelled peak booking frees a fixed (precinct, block) slot, and the dates cannot be changed.
- **Not bookable online on the day**: a same-day cancellation can be booked by phone only [V: WA.gov.au].

---

## Inventory overview

**Operator.** RIA runs all of the following under the **Stay Rottnest** brand (stayrottnest.com, Reservations 1800 111 111). Per the P3 case study: "69 different room types spanning seven locations". [V: hotel-online 2023]

Unit numbering and approximate counts come from the Stay Rottnest accommodation maps (`ria/maps/*.pdf`). Counts are taken from the map text and are approximate [V/approx]:

| Precinct (numbers) | Approx. count | Types |
| --- | --- | --- |
| Thomson Bay South (201–248) | 48 | Standard (refurbished, small living room), Ocean View, Premium; "Kingstown Heritage/Superior View" are grouped with it for peak blocks |
| Thomson Bay North (301–349, 4xx; 450 = Chalet) | ~55 | Premium, Premium View, Heritage cottages (Vincent Way), Heritage View, North Heritage Bungalows (canvas sides), Chalet |
| Bathurst (501–548), near Bathurst Lighthouse and Pinky Beach | ~45–48 | Non-refurbished Standard, Ocean View, Premium and Premium View, plus heritage (incl. the lighthouse keeper's cottage). Unavailable from 27 Apr 2027 and through June 2027 for works |
| Caroline Thomson Cabins (701–728) | 28 | 6-bed cedar cabins (1 double + 2 bunks), kitchenette |
| Campground (601–643) | 43 sites | Tent and swag sites near Thomson Bay and The Basin; up to 6 people and 2 tents per site |
| Longreach Bay (801–836) | 36 | Ocean View, Premium View |
| Fay's Bay (850–865) | 16 | Premium, Premium View. Longreach + Fay's = 52 refurbished units (2024–25 annual report) |
| Geordie Bay (901–952) | 51 | Ocean View, Premium, Premium View (queen beds). "51 units in Geordie Bay" refurbished (annual reports) |
| Kingstown: Governor Circle (101–109) | 9 cottages | 9-, 13- and 18-bed group cottages, mostly bunks |
| Kingstown Barracks dormitories (111–128) | 18 rooms | Dormitory rooms, communal bathrooms; 114, 119 and 124 have en-suites. 2024 guide: "17 dormitory rooms" |
| Kingstown Commanders Cottages (150, 152, 153) | 3 | Heritage and ocean view; 6–13 beds |
| Rottnest Hostel (154–183, at Kingstown) | ~30 bunks / family rooms | Single bunk in a shared room, plus family rooms (1 double + 1 bunk) |

**Totals** [V: annual reports, via search snippets for 2019–21]:
- 2019–20: 283 rental units.
- 2020–21: 292 self-contained units.
- 2023–24: 87.14% annual self-contained occupancy and 25,784 self-contained check-ins.
- 2024–25: 28,329 self-contained check-ins.

**Other names:**
- "Allison" campground: the current maps call it simply "Campground". "Allison Tentland" is a historical name and is not used in current RIA material [I/unverified].
- Kingstown Barracks is the dorms/hostel precinct.

**Not on stayrottnest.com** (private operators under RIA lease; each books on its own site) [V/S: search results; ABC 2022 notes the Pinky's glamping "is not part of the RIA's accommodation booking system"]:
- **Samphire Rottnest**: Thomson Bay, about 80 rooms.
- **Hotel Rottnest**: Thomson Bay, about 18–80 rooms; sources conflict.
- **Discovery Parks / Discovery Rottnest Island**: Pinky Beach, about 83 eco-tents.
- **Karma Rottnest / Rottnest Lodge**: about 60–80 rooms in 2020.
- **The Lodge Wadjemup**: the redeveloped lodge; 109 rooms in stages, 63 from Jan 2025 and 46 Poolhouse rooms by Jul 2025 [S].

Counts for these are unverified secondary figures.

---

## Unknowns

1. **Release instant.**
   - What exactly changes at 08:30:00 AWST on an Open Day: whether the new month's inventory flips to bookable at that instant, or is already loaded and only the queue gates access.
   - How the booking engine shows not-yet-released months before the Open Day (sold out? hidden?). The booking-engine agent should check this anonymously.
2. **Whether Queue-it runs outside Open Days.** The snippet says it manages "peak loads … during booking 'Open Days'".
3. **When cancellations reappear online** (immediately or after manual processing), and whether there is any batching.
4. **Whether the 14-night maximum applies year-round** or only in peak periods.
5. **OTP start date.** The 2023–24 annual report (Jul 2023–Jun 2024) says an OTP and "Unique ID restrictions" were implemented. The guides first mention the SMS OTP for the 5 Feb 2025 Open Day. What "Unique ID restrictions" are (one queue slot per mobile number?) is not explained.
6. **Exact unit counts** per precinct and type. The map-text counts are approximate, and the Hostel bed count is unknown.
7. **The RIA open-days page itself** (ria.wa.gov.au), the RIA news items (4 Dec 2022, 28 Dec 2022, 23 Feb 2023, "open day postponed", "please note open days can only be booked online or over the phone") and rottnestisland.com HTML pages. All are blocked by a Cloudflare challenge, and their content is known only from search snippets.
8. **Pre-2022 rules.** The 2021 Open Days appear to have been on the first Monday (6PR dates) [I]. When they moved to Wednesday (by Jun 2022) is not documented.
9. **Fee for 48 hours to 3 days before arrival.** The T&Cs list ">30 days", "3–30 days" and "<48 h before 2 pm check-in", so the 2–3-day window is not stated explicitly.
10. **Whether RIA has enforced the automation clause** (cancelled bookings or IP blocks). No reports found.

---

## Sources (all fetched 2026-10-17)

Files are saved under `/tmp/claude-0/-home-user/ad6929c6-e464-57e2-adce-3cdda806854a/scratchpad/rottnest/ria/`. Each PDF has `.raw.txt`, `.clean.txt` and `.layout.txt` extractions; HTML pages have `.txt` extractions.

**Stay Rottnest / RIA documents (PDF, curl)**
- Booking-guide index: https://www.stayrottnest.com/cms/stayrottnest/pdfs/stay_rottnest_booking_guide.pdf (Last-Modified 25 Sep 2026)
- T&Cs RIA4555 (Mar 2026): https://www.stayrottnest.com/cms/stayrottnest/pdfs/stay_rottnest_bookings_terms_and_conditions.pdf
- FAQ RIA4644 (Aug 2026): https://www.stayrottnest.com/cms/stayrottnest/pdfs/stay_rottnest_faqs_2026.pdf
- Monthly guides at `https://www.stayrottnest.com/cms/stayrottnest/pdfs/open_day_booking_guide_<m>_<y>.pdf`, for:
  - august_2025, september_2025, october_2025
  - january_2026, july_2026, august_2026, september_2026, october_2026, november_2026, december_2026
  - january_2027, february_2027, march_2027, april_2027, may_2027, june_2027
  - march_2025 and april_2025 returned 404
- Older guides at `https://www.rottnestisland.com/docs/default-source/open-day/`: `open_day_booking_guide_apr_2024.pdf`, `Open_Day_booking_guide_May_2024.pdf`, `open_day_booking_guide_august_2024.pdf`, `open_day_booking_guide_october_2024.pdf`
- 2022/23 index guide (third-party copy, PDF dated 25 Jan 2023): https://volleyballwa.com.au/wp-content/uploads/2022/11/Stay-Rottnest-Booking-Guide.pdf
- Accommodation maps: `https://www.stayrottnest.com/cms/stayrottnest/pdfs/accommodation_map_{thomson_bay_north,thomson_bay_south,longreach_fay_geordie_bay,bathurst_caroline_thomson_cabins,kingstown_barracks,campground}.pdf` (in `ria/maps/`)
- RIA Annual Report 2024–25: https://www.ria.wa.gov.au/docs/default-source/reports/annual-reports/annual-report-2024-25.pdf
- RIA Annual Report 2023–24: https://www.dbca.wa.gov.au/sites/default/files/2024-10/rottnest_island_authority_annual_report_2023-24.pdf

**Web pages (curl or WebFetch)**
- Open Day landing page: https://openday.rottnestisland.com/ ("dates up to June 2027 have been released")
- WA Gov media statement, 29 Dec 2022, "New transfer of ownership booking changes for Rottnest Island": https://www.wa.gov.au/government/media-statements/McGowan%20Labor%20Government/New-transfer-of-ownership-booking-changes-for-Rottnest-Island-20221229
- WA.gov.au, "Book Rottnest Island accommodation" (updated 22 May 2023): https://www.wa.gov.au/service/sport-and-recreation/community-recreation/book-rottnest-island-accommodation
- ABC News, 12 Nov 2022: https://www.abc.net.au/news/2022-11-12/rottnest-island-booking-system-gets-overhaul/101578166
- Geraldton Guardian / The West, 1 Jun 2022 (Open Day postponed): https://www.geraldtonguardian.com.au/news/rottnest/rottnest-island-authoritys-booking-system-crashes-on-first-day-february-2023-reservations-open-c-7013477
- 6PR, 6 Apr 2021: https://www.6pr.com.au/500-bookings-in-15-minutes-why-rottnest-island-has-been-flooded-with-bookings/
- Hotel-Online / P3 case study, 29 Aug 2023: https://www.hotel-online.com/news/australias-rottnest-island-authority-deploys-p3s-custom-booking-engine-to-address-unique-property-and-guest-needs
- Grantourismo (Mar 2023, modified Jan 2026): https://grantourismotravels.com/easiest-way-to-book-rottnest-island-accommodation/

**Blocked (Cloudflare 403); content from WebSearch snippets only [S]**
- https://www.ria.wa.gov.au/managing-the-island/visitor-experience/stay-rottnest-accommodation-open-days
- https://www.ria.wa.gov.au/news-and-media/updated-accommodation-booking-t-c-s-to-commence-in-january-2023 (also `ria.wa.gov.au/Articles/latest-news/stay-rottnest-changes`, 28 Dec 2022)
- https://www.ria.wa.gov.au/news-and-media/new-booking-website-for-ria-accommodation (also `/Articles/latest-news/Stay-Rottnest`, 4 Dec 2022; Queue-it)
- https://www.ria.wa.gov.au/news-and-media/changes-to-stay-rottnest-booking-system (23 Feb 2023)
- https://ria.wa.gov.au/Articles/latest-news/open-day-postponed
- https://www.ria.wa.gov.au/works-and-service-notices/please-note--open-days-can-only-be-booked-online-or-over-the-phone
- rottnestisland.com `/stay/accommodation/stay-rottnest-{self-contained,campground,hostel}`
- web.archive.org: refused by the egress proxy
