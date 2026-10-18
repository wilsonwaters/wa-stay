# Rottnest Island (Stay Rottnest): terms review for a WA Stay provider

_2026-10-17. Step 1 ("Terms first") of adding a Rottnest Island provider (`CLAUDE.md`, "Adding a provider")._

This review reads Stay Rottnest's published terms the way a contract lawyer would:

- who is bound, and when;
- what each relevant clause means on its words, in its context and given its purpose;
- how the ambiguities are likely to be resolved;
- what follows for each feature WA Stay might offer.

It is a structured analysis for planning, not legal advice. Where an outcome turns on a reading that RIA or a court might not share, it says so. The stakeholder should take advice from an Australian lawyer before relying on any of the grey-zone readings in [§5](#5-feature-by-feature).

**Sources.** All read on 17 Oct 2026; the full list is under [Documents read](#documents-read).

- **The booking terms:** _Stay Rottnest Terms & Conditions_, RIA4555 – March 2026, "Effective for all new bookings made from 4 March 2026" (2 pages, PDF created 27 Feb 2026). Clause numbers below are this document's.
- **The open-day booking guides:** monthly PDFs, August 2025 to June 2027 stays. The guides restate the T&Cs and add Open Day rules.
- **The FAQ:** RIA4644, August 2026.
- **The website's own terms:** [§2](#2-the-websites-own-terms).
- **Context:** RIA's release rules, in `rottnest-release-rules.md`.

## Contents

- [Bottom line](#bottom-line)
- [1. The documents and who they bind](#1-the-documents-and-who-they-bind)
- [2. The website's own terms](#2-the-websites-own-terms)
- [3. Clause 4, "Use of Automated Software"](#3-clause-4-use-of-automated-software)
- [4. Other clauses that shape the app](#4-other-clauses-that-shape-the-app)
- [5. Feature by feature](#5-feature-by-feature)
- [6. Rules the app must follow](#6-rules-the-app-must-follow)
- [7. The route to an automated cancellation watch](#7-the-route-to-an-automated-cancellation-watch)
- [8. Ambiguities for the stakeholder](#8-ambiguities-for-the-stakeholder)
- [Appendix A: draft request to RIA](#appendix-a-draft-request-to-ria)
- [Documents read](#documents-read)

## Bottom line

Clause 4 is unusually broad. Unlike RAC's terms, which never mention automation, it names the very things WA Stay's watches and Site Sniper do: "web scraping, data mining, rate shopping, booking". It also catches a booking that automation only **assisted**. So the line WA Stay can safely draw does not fall between alerting and holding. It falls between **software that interacts with Stay Rottnest's website** and **software that helps a person who does all the interacting themselves**.

| Use | Verdict | Why, in one line |
| --- | --- | --- |
| (a) A hand-built catalogue of RIA's accommodation (precincts, unit types, beds, check-in times) with links to stayrottnest.com | **Permitted** | No software does anything on Stay Rottnest's site; facts are not protected; links are clicked by the person. |
| (b) The Open Day calendar and reminders to be in the waiting room before 8:30 | **Permitted** | No request to Stay Rottnest at all. The person joins the queue and books in their own browser. |
| (c) "Time to look" reminders for a cancellation, timed to when RIA's fee and payment rules make cancellations likely; one click opens Stay Rottnest | **Permitted** | It reminds a person. It does not search, scrape or book. |
| (d) Deadline reminders for a booking the person records (cooling-off ends, balance due, fee steps) | **Permitted** | Nothing is sent to RIA; it helps the person keep the booking. |
| (e) One availability read on Stay Rottnest when the person clicks "Check", shown inside WA Stay | **Grey: not recommended without RIA's consent** | Arguably just a browser. But in form it is software extracting data from the site ("web scraping"), and it risks a block on the person's connection. |
| (f) An automatic background watch that polls Stay Rottnest and alerts on a cancellation (notify-only) | **Not permitted on the better reading.** Only with RIA's written consent | A scheduled search is a "task on the internet that would normally require human intervention" and "rate shopping". A booking made from its alert is "assisted" by it. RIA may then cancel without refund on suspicion. |
| (g) Automatic hold, cart or booking: auto-hold watches, hold snipes, an auto-cart experiment | **Prohibited** | "bookings may not be made ... by the use of automated software"; "booking" is a listed example. |
| (h) Automating the waiting room, the SMS passcode or the queue | **Prohibited** | It "mimic[s] human behaviour to gain unauthorized access". It also defeats a security control RIA added "to improve fairness". |
| (i) Release-instant polling (RAC-style alert snipes) | **Prohibited, and pointless** | As (f). Queue-it also gives everyone a random place before 8:30, so being first at 8:30:00 gains nothing. |

**Recommendation.** Ship a Rottnest provider built only from (a)–(d), with no request from the app to Stay Rottnest at all, and enforce that in code. Ask RIA in writing for (e) and (f) ([§7](#7-the-route-to-an-automated-cancellation-watch); [Appendix A](#appendix-a-draft-request-to-ria)). Never build (g)–(i).

## 1. The documents and who they bind

- **The booking terms are the licence.** Clause 7(a) grants "a licence to use and occupy the Premises" "in consideration for the payment of the accommodation fees and the primary guest's agreement to these licence terms". The contract forms when a booking is made. The terms apply to "all new bookings made from 4 March 2026". The party is the **primary guest**, the person making the booking (1(a)). That is WA Stay's user.
- **WA Stay is not a party.** The developer and the app are not bound by the booking terms. Two consequences still matter:
  - **The user carries the risk.** Clause 4(b) lets RIA cancel "without refund" and block "website users or specific IP addresses". The first falls on the user's booking; the second on their connection, possibly on an Open Day.
  - **The developer's exposure is low, but not nil.** A tool designed and promoted to do what a counterparty's contract forbids, with knowledge of that contract, is the fact pattern behind the tort of **inducing breach of contract**. That tort needs knowledge and an intention to induce the breach. A general tool used against the terms by a user is a different case from a Rottnest-specific poller shipped after reading clause 4. A careful adviser removes this exposure by design rather than by argument. RIA's goodwill, needed for any later permission, points the same way.
- **The guides incorporate the terms.** Each Open Day guide prints the terms and adds Open Day rules: the waiting room, the SMS passcode, two units per transaction, the 5/3 rule, fixed peak blocks. The FAQ adds: "Non-compliance with the accommodation Terms and Conditions or the Rottnest Island Regulations 1988 may result in cancellation of the accommodation booking without refund".
- **When clause 4 arrived.** Between February and May 2025. It is not in the guide for the 5 Feb 2025 Open Day (the March and April guides could not be fetched), and it is in the guide for the 7 May 2025 Open Day (January 2026 stays), every guide since, and RIA4555. It follows RIA's SMS one-time passcode and "Unique ID restrictions for Stay Rottnest Open Days to improve fairness" (Annual Report 2023–24) and "a new security platform" (Annual Report 2024–25). The context is a deliberate fairness programme against automated advantage: "15,000 people queued online ... and only 1,500 bookings available" (RIA, ABC, Nov 2022). That context matters when the clause is construed ([§3.5](#35-the-trailing-purpose-words)).

## 2. The website's own terms

From `rottnest-booking-flow.md` §2 and §9. The site served a Cloudflare challenge to the research's third request, so some of this comes from the search index and is marked so.

- **The booking terms are also the site's terms of use.** The search page (`bookings.stayrottnest.com/search-rates`) carries this notice: "Stay Rottnest has updated its Terms and Conditions for using this site and booking accommodation. Please review here before making a booking." This is the search index's quotation, not verified against the page. RIA itself presents RIA4555, and so clause 4, as governing **use of the site**, not only bookings. That closes most of the gap in [§3.8](#38-does-the-clause-reach-activity-with-no-booking).
  - Browse-wrap terms, which a visitor accepts only by using the site, bind less reliably than terms ticked at checkout. Australian law has no settled appellate rule on them; the question is whether the notice was reasonable.
  - A notice on the search page itself, before any search, is about as prominent as browse-wrap gets.
  - The design does not depend on this point: it sends no request.
- **Other pages.** A Disclaimer exists (`/disclaimer`, search summary only: accuracy, liability and external links; no automation clause seen). The login footer lists a Privacy Statement and Terms & Conditions, and a sign-up checkbox reportedly refers to "Terms of Use of Rottnest Island Authority". **Not retrieved:** the Privacy Statement and any separate Terms of Use (copyright, linking or framing clauses). A person should read them in a browser before RI3 ships (master plan TQ7). Linking to public pages is not normally restricted, but the check costs nothing.
- **robots.txt.**
  - `www.stayrottnest.com` allows everything.
  - `bookings.stayrottnest.com` disallows everything except `/search-rates`, `/offer` and `/offers` (as archived in August 2026).

  robots.txt is not a contract, but it states the operator's wishes. WA Stay's links point only at allowed paths (the search page) and the `www` CMS pages and PDFs.
- **Technical controls.**
  - A Cloudflare managed challenge met a plain HTTP client on the home page.
  - `bookings.` challenged Common Crawl's crawler in 2025.
  - `X-Frame-Options: SAMEORIGIN` stops the site being framed.
  - A Queue-it waiting room and an SMS passcode guard Open Days.

  These are not terms, but they show RIA does not want non-browser clients. Defeating them is where the criminal-law risk in §3.8 begins.

**Research traffic, for the record.** About 34 anonymous GETs went to `www.stayrottnest.com` on 17 Oct 2026, and none to `bookings.stayrottnest.com`:

- the T&Cs PDF;
- about 30 booking-guide, FAQ and map PDFs, spaced 4–6 s apart;
- `robots.txt`, `sitemap.xml` and the home page, which was challenged, so live requests stopped there.

No search, form, sign-in or booking was involved. Later development needs no more: rule 6 has facts gathered by a person in a browser.

## 3. Clause 4, "Use of Automated Software"

The full text (RIA4555, page 1):

> **4. Use of Automated Software**
> The primary guest acknowledges it is RIA policy that:
> a) bookings may not be made or assisted by the use of automated software or any system designed to perform tasks on the internet that would normally require human intervention. This includes, but is not limited to, automated programs or scripts used for web scraping, data mining, rate shopping, booking, and any other activities that mimic human behaviour to gain unauthorized access or perform excessive interactions with our website.
> b) where a booking is reasonably suspected by RIA to have been made by or with the assistance of automated software or system as described in paragraph (a), RIA may cancel the booking without refund. RIA may block website users or specific IP addresses that have exhibited behaviour consistent with the use of automated software or system as described in paragraph (a).

Australian courts construe a commercial contract objectively: by what a reasonable person in the parties' position would understand the words to mean, read in context and with regard to the transaction's evident purpose (_Electricity Generation Corporation v Woodside Energy Ltd_ [2014] HCA 7; _Mount Bruce Mining Pty Ltd v Wright Prospecting Pty Ltd_ [2015] HCA 37). The analysis below follows that method.

### 3.1 Form: an acknowledgment of policy

Paragraph (a) is framed as the guest "acknowledg[ing] it is RIA policy", not as a promise by the guest. That framing does not help a user:

- Paragraph (b) gives RIA a contractual right to cancel a suspect booking without refund, whatever the status of (a).
- Clause 14(a)(i) separately lets RIA cancel without refund for failure "to comply with a condition of this licence including these terms and conditions".
- Having acknowledged the policy, a guest cannot say they did not know it.

Treat (a) as binding.

### 3.2 The object: "bookings ... made or assisted"

The prohibition attaches to **bookings**, by two limbs:

- **"made"**: software makes the booking. This covers holds, carts, form filling and checkout. Any automatic hold is squarely caught ([§5](#5-feature-by-feature) (g)).
- **"assisted"**: software helps a booking that a person makes. "Assist" in its ordinary meaning is to help or aid. Nothing requires the help to be substantial or to be the last step. A cancellation alert from a poller, which leads the person to open the site and book the freed unit, helps that booking in the ordinary sense, and is the help the clause's purpose targets: an automated advantage in a contested, scarce inventory.

So the common defence "the app only alerts; a human books" does **not** take a polled-alert booking outside the clause. It moves the booking from the "made" limb to the "assisted" limb.

### 3.3 The definition: "automated software or any system designed to perform tasks on the internet that would normally require human intervention"

Three elements:

1. **Automated:** it runs without a person driving each step.
2. **Tasks on the internet:** interactions with web services.
3. **That would normally require human intervention:** a search of Stay Rottnest's availability normally needs a person to choose dates and press search.

A scheduled availability check meets all three. A link the person clicks meets none: the person performs the task. A desktop reminder performs no task on the internet. A search the app runs on a person's click is the hard case ([§5](#5-feature-by-feature) (e)). The person intervened, which is what a browser relies on, but software performs and parses the search.

### 3.4 The examples: "includes, but is not limited to"

- The list is illustrative. It widens rather than narrows the definition.
- **"Rate shopping"** is hospitality-industry vocabulary for the automated collection of a property's rates and availability. It describes an availability poller exactly. "Web scraping" and "data mining" cover reading the site's pages or API responses by program.
- **"booking"** confirms the "made" limb.

### 3.5 The trailing purpose words

"... and any other activities that mimic human behaviour to gain unauthorized access or perform excessive interactions with our website."

The clause can be read two ways:

- **Reading A (narrow).** The purpose words qualify every example, so scraping or rate shopping is caught only if it gains unauthorised access or interacts excessively. A polite poller, say every 30 minutes, would then arguably be outside the clause.
- **Reading B (broad).** The purpose words qualify only "any other activities" (the last-antecedent reading). The listed examples are caught as such. In any case, the first sentence's definition, which is the operative one, has no "excessive" or "unauthorised" qualifier.

**Reading B is the better view:**

1. The examples hang off a definition that is itself unqualified, and "includes" cannot cut that definition down.
2. "Any **other** activities that mimic human behaviour to ..." presupposes that the listed activities are already within the clause.
3. The evident purpose is fair allocation of scarce public accommodation (OTP, Unique ID restrictions, "to improve fairness"). Catching every automated advantage advances that purpose; catching only heavy-handed automation would not.

_Contra proferentem_ (ambiguity construed against the drafter, RIA) would favour Reading A. But Australian courts treat it as a last resort, used only when ordinary construction leaves a real ambiguity. Text and purpose resolve this one.

Even on Reading A, the first judge of what is "excessive" is RIA, on a "reasonably suspected" standard (§3.6). A design built on Reading A is a bet on persuading RIA after a booking has already been cancelled.

### 3.6 The remedy: "reasonably suspected", "without refund", and blocking

- **The standard is suspicion, not proof.** RIA need only "reasonably suspect" assistance by automation. A person who books a long-sought stay minutes after it reappears is the profile such suspicion would rest on.
- **"Without refund" is serious money.** A self-contained booking pays a 25% deposit up front and the balance 30 days before arrival. Campground and hostel bookings pay in full when booked (7(b), 7(c)). The whole stay can be lost.
- **Blocking is a technical measure RIA can take anyway.** It needs no breach and no booking. For a household on one IP address, a block could fall on an Open Day, which is the day it would hurt most.

### 3.7 Is the clause enforceable? (Do not design on it)

- The Australian Consumer Law, as applied in WA, binds the Crown "so far as the Crown carries on a business, either directly or by an authority" (_Fair Trading Act 2010_ (WA) s 28). The Crown's immunity from pecuniary penalties does not extend to an authority (s 30(3)). Selling island accommodation is plausibly carrying on a business, so the unfair contract terms regime (ACL ss 23–25; prohibited, with penalties, for standard-form contracts made or varied from 9 Nov 2023) is in play.
- A term allowing cancellation **without refund on mere suspicion** is open to challenge: one-sided termination, no refund, a low standard, and the detriment falls on the consumer.
- RIA has strong answers. It has a legitimate interest in fair access and the integrity of its system, and the clause is transparent and prominent: it is in every guide.
- A challenge would come after the cancellation, by the user, at their cost.

**Conclusion:** build nothing whose lawfulness depends on winning that argument.

### 3.8 Does the clause reach activity with no booking?

- **As a breach of the booking contract, no.** The object of 4(a) is "bookings", and a person who never books is not in breach of the booking terms by browsing or polling. But RIA presents the same terms as governing "using this site" ([§2](#2-the-websites-own-terms)), so automated polling is probably also outside the terms on which the site may be used at all.
- **The practical reach is wider:**
  - 4(b)'s blocking sentence needs no booking.
  - "Reasonably suspected" looks back: weeks of polling for particular dates makes any later booking of those dates suspect.
  - The website's own terms (§2) may forbid scraping independently of any booking.
- **Criminal law: a further reason never to circumvent.** WA's _Criminal Code_ has an offence of unlawfully using a restricted-access computer system (s 440A; current text to be confirmed by a lawyer). A public website is not ordinarily "restricted". But defeating access controls (the SMS passcode, a Cloudflare or Queue-it challenge, an IP block) moves towards that territory. Rule 4 ([§6](#6-rules-the-app-must-follow)) never goes there.

### 3.9 Others already do it: does that change anything?

Two paid services already check Stay Rottnest and alert by email: RottoWatch (since February 2026, every 4 hours on paid plans, with a REST API and an MCP server) and Quokka Watch. Neither books, and no report was found of either being blocked or warned (`rottnest-prior-art.md`). Their existence does not change the analysis:

- **Others' conduct does not change what clause 4 means.** Construction turns on the text, the context and the purpose, not on how third parties behave.
- **RIA's silence is not a waiver.** Waiver or estoppel would need RIA to know of the conduct and to have elected not to enforce, or to have represented that it would not. Nothing suggests RIA has done either.
- **Both services put the risk on the user.** RottoWatch: "All interaction with the StayRottnest booking site is your own responsibility." That is consistent with §3.2: the alert-driven booking is the user's, and so is the exposure under 4(b).
- **RIA has said it targets bots.** The then Minister told Parliament in May 2023 that the system "has to be able to guard against bot purchasing", that known bot data-centre sources "are immediately blocked", and that suspicious users get a CAPTCHA (Estimates, 25 May 2023, search excerpt). The clause arrived in 2025, after those services' predecessors and the resale scandal.

## 4. Other clauses that shape the app

| Clause | What it says | What it means for WA Stay |
| --- | --- | --- |
| 1(a) Primary guest | The person making the booking is over 18 and shows "original photo identification and a valid credit card to staff on check in" | Rottnest features are for the person's **own** stays. |
| 1(b) Information | Booking information is not released to third parties except limited information to a keyholder | Booking details stay on the person's computer. Nothing is shared or synced. |
| 1(c) No transfer | "The primary guest may not transfer, assign or sell the booking to another person" (since 4 Jan 2023, to stop resale) | No feature to transfer, resell or "pass on" a booking. WA Stay stays non-commercial. |
| 2 Keyholder | One nominated keyholder (over 18) may check in. The guides: a second unit in one name needs a keyholder no later than 7 days before arrival | A deadline the booking tracker can remind about. |
| 3 Minors | A parent or guardian of at least one minor must stay in the same premises (Leavers excepted) | A note in the party step; nothing to enforce. |
| 7 Payment | 25% deposit for self-contained units, the balance due 30 days before arrival; campground and hostel paid in full; 7(e): "Failure to pay ... by the due date will result in the booking being cancelled" | Balance-due reminders. This deadline is also when unpaid bookings return to sale (a cancellation hotspot, [§5](#5-feature-by-feature) (c)). |
| 8(a), 8(b) Changes | Alterations and cancellations "in writing or by email" | The app never cancels or alters a booking, and never sends RIA an email. It links the person to RIA's contact details. |
| 8(c) Minimum stays | Minimum stays, no arrivals or departures on WA public holidays, fixed arrival and departure dates over Summer and Easter school holidays | Modelled from the guides, so no reminder or plan proposes a stay RIA would refuse. |
| 8(d) The 5/3 rule | Into an unreleased month: at least 5 nights in the open month to book at most 3 nights in the closed month; "this does not apply to all Open Days" | Modelled per Open Day, with the guides' exceptions. |
| 8(e) Fees | Cooling-off: full refund within 14 days of booking if more than 30 days to arrival. More than 30 days: $55 or 50% of the first night, whichever is lower. 3–30 days: the first night. Under 48 h before the 2 pm check-in: the whole stay | Deadline reminders for the person's own bookings, and the timing model for "time to look" reminders. |
| 11(a) Stay each night | The guest must "spend each night in the Premises for the duration of the booking"; the guides add "Only book what you need" | No feature encourages speculative, duplicate or hedge bookings. |
| 12 Occupancy | Campground: 2 tents and 6 people per site. Governor Circle, Caroline Thomson Cabins, Kingstown dorms and hostel: 1 person per bed. Self-contained: fixed beds + 50% for select units | The party size is checked against the unit type in watches and plans. |
| Guides: Open Day | Waiting room from 6 am, bookings from 8:30 am AWST; a random queue position for everyone in before 8:30; an SMS passcode to a real mobile ("temporary or virtual phone numbers cannot be used"); 30 minutes to enter when called; at most two units per transaction; "Booking requests received prior to 8:30am on Open Day will not be accepted" | Coaching copy. The app never touches the queue or the passcode, and never suggests extra devices or numbers to improve a place. |

## 5. Feature by feature

Each row asks: does software perform a task on Stay Rottnest's site, and is a booking "made or assisted" by it?

| Feature (ParkStay or RAC equivalent) | Task on Stay Rottnest's site by software? | Booking made or assisted by it? | Verdict | Rottnest design |
| --- | --- | --- | --- | --- |
| **Explore map and list** | No: the catalogue is a hand-built seed shipped with the app | No | Permitted | Precincts on the map, unit types as units, facts only |
| **Explore free counts** (bulk availability) | Yes, automatically, for every place on each date change | Yes | Not permitted | Off. Explore says "Check on Stay Rottnest" |
| **Place page night grid** (availability check) | Yes, on a click | Arguably | Grey (e) | Off for now. The place page shows unit types, rules, the next Open Day for the chosen dates, and "Search on Stay Rottnest" |
| **Watch, automatic** | Yes, scheduled | Yes ("assisted") | Not permitted (f) | Not built without RIA's written consent |
| **Watch, as reminders** ("time to look") | No | No: the person searches and books | Permitted (c) | Reminders at the person's cadence and at cancellation hotspots; one click opens the search |
| **Auto-hold, auto-cart** | Yes | "made" | Prohibited (g) | Never; `holds: false`, no experiment |
| **Site Sniper, hold** | Yes | "made" | Prohibited (g) | Never |
| **Site Sniper, alert** (polls from the release instant) | Yes | "assisted" | Prohibited (i), and no advantage (random queue) | Never |
| **Site Sniper, Open Day reminder** | No | No | Permitted (b) | Reminders the day before, at 6 am (waiting room open) and before 8:30, with the person's prepared plan |
| **Access gate** (ParkStay's DBCA queue) | Yes, the queue | Yes | Prohibited (h) | `accessGate: false`. The person joins Queue-it in their own browser |
| **Account** (sign-in window, saved session) | A sign-in window is the person's own browsing, but a saved session is used by the app's requests | — | Not needed | `account: 'none'`. The person signs in on stayrottnest.com in their own browser |
| **Bookings, manual entry** | No | No | Permitted (d) | Record a Rottnest booking; deadline reminders (when Bookings ships) |
| **Booking import** | Yes | — | Not permitted | `bookingImport: false` |
| **Opening Stay Rottnest at a set time, unasked** | Yes: navigation the person did not ask for | Arguably | Avoid | Every Stay Rottnest page opens on the person's click only |
| **Reading the page the person has open** (the DOM of their own search) | No interaction, but extraction by our software | Arguably | Avoid | Not built. The person reads their own screen |

## 6. Rules the app must follow

Rules 1–5 hold for every Rottnest feature. They are written to be enforced in code and tests, as RAC's terms rules were.

1. **No request to Stay Rottnest from the app.** WA Stay never sends a request to `stayrottnest.com` or any subdomain, its booking engine, its waiting room (Queue-it) or its image and file hosts: not in the background, and not on a click.
   - The provider's `ctx.http` refuses every request before sending it.
   - **Tests:**
     - a registry rule for a links-only manifest;
     - a refusing-client unit test;
     - a fixture-mode e2e journey with the provider registered whose request log has no request to these hosts;
     - a source guard: no Stay Rottnest host appears in the provider's code outside its links module.
2. **The person opens every Stay Rottnest page.** The app opens Stay Rottnest only on the person's click (a link, a button, a notification), in the system browser. It never opens one at a scheduled time by itself. **Test:** a reminder notification's delivery calls no shell or window opener; only its click does.
3. **No automated booking, ever.**
   - No hold, cart, form filling, checkout, passcode, queue, cancellation or alteration.
   - `holds`, `bookingImport`, `accessGate` and `availability` are off.
   - The manifest declares no experiment.
   - **Test:** a manifest test and a registry rule (a links-only provider may not declare these, or an experiment that turns them on).
4. **No evasion.** No request means nothing to evade. If RIA ever grants access (rule 12), a challenge, 403 or 429 stops the job and is never retried in a loop. The app never solves a challenge or rotates its User-Agent, IP or cookies.
5. **No claims the app cannot know.** WA Stay never reads availability, so its Rottnest copy never says free, found, available, held or secured. A reminder says "Time to look", never "A cabin is free". **Test:** a copy guard over the Rottnest notification and reminder strings.
6. **Facts, built by hand, shipped with the app.**
   - The catalogue (precincts, unit types, beds, check-in and check-out times) and the Open Day calendar are written by a developer from public pages and PDFs read in a browser.
   - They reach people in an app update, and are never fetched at run time.
   - No RIA photos, logos, maps or marketing copy; short descriptions in WA Stay's own words.
   - **Test:** a seed guard (no `stayrottnest`, `rottnestisland` or `ria.wa.gov.au` image URLs; no description longer than a sentence).
7. **Personal and non-commercial.**
   - The person's own stays only.
   - No feature to book for, transfer to or resell to anyone (1(c)).
   - Booking details never leave the computer, except in the person's own reminders and email notifier.
8. **The booking rules shape every suggestion.** Plans, reminders and recorded bookings respect:
   - the 5/3 rule as each Open Day's guide applies it;
   - peak fixed blocks per precinct;
   - the Saturday two-night minimum;
   - no arrivals or departures on public holidays;
   - the 14-night maximum;
   - peak three-night minimums;
   - occupancy per unit type;
   - at most two units per transaction.

   When the rules are unsure (an unannounced guide), the app says so and defers to RIA's guide. **Test:** rule unit tests built from the guides' own examples.
9. **Fair Open Day coaching.** The app tells the person that the queue order is random for everyone in before 8:30, that the passcode goes to their own real mobile, and that one person uses one device. It never suggests more devices, numbers or browsers to improve their place, and never automates the passcode or the queue.
10. **Never cancel or change a booking.** The app reminds the person of deadlines (cooling-off, balance due, fee steps) and links RIA's terms and contact details. Changes are made by the person, in writing or by email, as 8(a) and 8(b) require.
11. **Only book what you need.** No feature or copy encourages speculative, duplicate or "hold and dump" bookings. The guides ask people not to.
12. **Independence.**
    - "Stay Rottnest" is named only as where the person books.
    - The app shows WA Stay's own monogram and colour, never an RIA or Stay Rottnest logo.
    - The website's independence notice covers RIA.
13. **Permission changes the rules, only through a new review.** If RIA consents in writing to more ([§7](#7-the-route-to-an-automated-cancellation-watch)), its letter is added to this file and its limits become rules. The provider's manifest changes only after that update.

## 7. The route to an automated cancellation watch

The stakeholder's top priority is a watch that catches a cancellation. Three options:

| Option | What ships | Clause 4 position | Recommendation |
| --- | --- | --- | --- |
| **A. Reminders now** | (a)–(d): the catalogue, the Open Day calendar and coach, "time to look" reminders timed to cancellation hotspots, and deadline reminders | Outside the clause: no software acts on Stay Rottnest's site | **Do this now** |
| **B. Ask RIA** | Send the request in Appendix A. On a written yes, build (e) and a notify-only watch (f) within RIA's stated limits, as a later stage | Permission displaces the policy as between RIA and the user, within its terms | **Do this in parallel.** It is the only route to a real automated watch |
| **C. Ship (f) as an opt-in experiment, at the user's risk** | An automatic watch, off by default, with a warning | Breach on the better reading. Informed consent does not change that the booking is "assisted" | **Not recommended.** It exposes users to cancellation without refund and IP blocks, exposes the developer to an inducement argument, and spends the goodwill option B needs |
| **D. Read a third-party watcher's API** (RottoWatch's REST or MCP API) | WA Stay sends nothing to Stay Rottnest; it asks RottoWatch, which checks Stay Rottnest | The booking is still "assisted by the use of automated software", only someone else's. WA Stay would be knowingly routing its users to the activity clause 4 targets. It also depends on RottoWatch's own terms and its survival | **Not recommended.** It moves the scraping one step away without changing the user's position. It does remove the IP-block risk from the user's own connection |
| **E. A sanctioned channel** | RIA already distributes to Booking.com, Expedia and Hotels.com through its P3 and Oracle OPERA stack, so an authorised availability interface exists | Authorised access is outside clause 4 by definition | **Ask for it as part of B.** RIA is unlikely to give a free desktop app a distribution feed, but asking costs nothing |

A practical note on B: RIA has said what it wants. It wants unwanted bookings returned "for general resale", and it calls its random queue "more like a randomised ballot ... to give everyone the same kind of chance". A request that is personal, notify-only, low-frequency and never books has a fair chance. The request should offer limits, not ask for a blank cheque.

## 8. Ambiguities for the stakeholder

1. **Is a one-shot availability read on the person's click "automated software"?** The person intervened, so it is arguably just a browser. But software performs and parses the search (web scraping in form), and a block could hit the person on an Open Day. Default: not built without RIA's consent.
2. **Does "assisted" reach an alert that leads a person to book?** The better view is yes (§3.2). Option C would rest on the other view.
3. **Is opening a Stay Rottnest page at a scheduled moment "automation"?** It is a small task, but literally within the definition. Default: the person always clicks (rule 2).
4. **Is WA Stay non-commercial, and will it stay so?** This is RAC's RQ4 again. It also matters here, because a commercial product built around RIA's inventory is closer to the resale RIA legislated against in 2023.
5. **Does clause 4's "our website" include RIA's other sites** (ria.wa.gov.au, rottnestisland.com, the PDFs on stayrottnest.com)? Probably it means the booking site. It does not matter while the app fetches none of them (rule 6).
6. **How should the Open Day calendar reach people:** an app update per change (as RAC's release calendar does), or a small calendar file on WA Stay's own website that the app reads? The rule (first Wednesday of month M opens month M+8) covers most of it, so updates are rare.
7. **Should WA Stay ask RIA at all?** Asking draws attention, and a "no" closes option C for good. But C is not recommended anyway, and a "yes" unlocks the watch.

## Appendix A: draft request to RIA

To: Stay Rottnest reservations, `stay@rottnestisland.com` (the address the FAQ gives; RIA may prefer another)
Subject: Request for guidance on clause 4 (Use of Automated Software): personal availability alerts

> Dear Stay Rottnest team,
>
> I develop WA Stay, a free desktop app that helps people in Western Australia plan stays at public accommodation (DBCA's ParkStay campgrounds, RAC's parks and, we hope, Rottnest Island). It runs on the person's own computer and has no server, accounts or advertising. It never sells or transfers bookings.
>
> We have read clause 4 of your Terms & Conditions (RIA4555, March 2026) and want to respect it. Today our Rottnest support makes **no requests to stayrottnest.com at all**. It shows your accommodation types and Open Day calendar, reminds people to join the waiting room before 8:30, and opens your site when they click so they can search and book themselves.
>
> Many of our users would like to know when a stay they want is returned through a cancellation, so they can book it themselves. Would RIA be comfortable with WA Stay doing the following, on the person's own computer only?
>
> 1. Checking availability on stayrottnest.com once when the person asks for specific dates; and/or
> 2. For one person's own trip, checking specific dates no more than once every [30] minutes, alerting the person, and stopping as soon as they have booked or the dates pass.
>
> In both cases WA Stay would never reserve, cart, book, enter the waiting room, handle the SMS passcode, or interact with your site in any other way; the person always books on stayrottnest.com themselves. We would stop at once on any block or error, honour any limits you set, and could identify the app in its requests if you wish.
>
> If you would prefer we do neither, we will keep our Rottnest support to reminders and links. If there is an official way to be told about returned stays, we would gladly point people to it instead.
>
> Kind regards,
> [Name], WA Stay — [contact]

## Documents read

All read on 17 Oct 2026.

- **Booking terms:** _Stay Rottnest Terms & Conditions_, RIA4555 – March 2026: `https://www.stayrottnest.com/cms/stayrottnest/pdfs/stay_rottnest_bookings_terms_and_conditions.pdf`.
- **FAQ:** _Stay Rottnest Frequently Asked Questions_, RIA4644 – August 2026: `https://www.stayrottnest.com/cms/stayrottnest/pdfs/stay_rottnest_faqs_2026.pdf`.
- **Open Day booking guides:**
  - August 2025 to June 2027 stays: `https://www.stayrottnest.com/cms/stayrottnest/pdfs/open_day_booking_guide_<month>_<year>.pdf`;
  - the 2024 guides on `rottnestisland.com`;
  - the index `stay_rottnest_booking_guide.pdf`.

  Details are in `rottnest-release-rules.md`.
- **RIA Annual Reports:** 2023–24 (OTP, Unique ID restrictions) and 2024–25 (new security platform).
- **WA Government media statement**, 29 Dec 2022, "New transfer of ownership booking changes for Rottnest Island".
- **ABC News**, 12 Nov 2022, "Rottnest Island booking system gets overhaul".
- **_Fair Trading Act 2010_ (WA):** ss 10, 28, 30 (legislation.wa.gov.au).
- **Not readable:** the RIA news pages and the open-days page on `ria.wa.gov.au` return a Cloudflare challenge; their content is known only from search snippets. They were not bypassed.
