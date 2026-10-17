# Site Sniper

> **Coming soon.** Site Sniper works and can be used, but it is still being finished: the top
> navigation marks it **Soon** and its page shows a "coming soon" banner. Use it with care,
> and only for stays you will take.

Site Sniper catches a hard-to-get site **the moment it is released**. It prepares ahead of
time, joins the provider's queue when the release uses one, checks availability rapidly across
the release instant, and then does what the snipe is set to do:

- **Hold**: it places a temporary **hold** on the first matching site. You then pay for the
  hold on the provider's own payment page before it runs out.
- **Alert**: it sends a desktop alert (and an email, if set up) with a link to book on the
  provider's own site, and holds nothing, so book it before someone else does.

Site Sniper never pays for you. A snipe holds when its provider can place holds, and alerts
otherwise; a provider that places no holds offers alerts only.

Two providers have Site Sniper. ParkStay WA's snipes hold, and its hold lasts **30 minutes**.
RAC Parks & Resorts' snipes alert: WA Stay places no holds on RAC.

## How ParkStay releases sites

The release modes come from the provider's manifest (`releaseModes`). ParkStay has three:

| Mode             | In the app               | What happens                                                                                                                                                                                                                                                                                         |
| ---------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `daily_rollover` | **When new dates open**  | ParkStay takes bookings 180 days ahead. Each day one more arrival date opens at the campground's own release time, Perth time (Bungarra's is 2:00 am; until the app has read a campground's time it assumes midnight). Site Sniper works out the instant for your arrival date. Uses the DBCA queue. |
| `scheduled`      | **At a scheduled time**  | For campgrounds whose dates are released in blocks, such as those on the Ningaloo coast, at a time you set. The suggested default is the next first Tuesday of a month at 10:00 am AWST, but DBCA can change it, so check the published time. Uses the DBCA queue.                                   |
| `cancellation`   | **When someone cancels** | There is no waitlist; cancelled and lapsed holds reappear straight away. Site Sniper keeps checking (no faster than every 3 s) until a site frees up.                                                                                                                                                |

Joining the DBCA queue early gives no advantage: for scheduled releases DBCA re-allocates
queue places at random at the release time. WA Stay joins genuinely at the start of its
warm-up and keeps the session refreshed as ParkStay's own page does. It never fakes activity
to get around the queue's inactivity rules.

## How RAC releases dates

RAC has two modes. Both are timed: an RAC snipe starts at the release, checks every 10 seconds
at the fastest, for at most 30 minutes, and alerts you when the dates are free.

| Mode             | In the app                | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `daily_rollover` | **When these dates open** | RAC takes bookings 364 days ahead, and one more night opens at midnight Perth time each day, so your stay opens at midnight on the day its last night comes 364 days ahead. WA school holidays are held back and open on RAC's own release days, at each park's hour, Perth time: 7 am at Esperance and Margaret River, 8 am at Busselton, Karri Valley and Monkey Mia, 9 am at Cervantes and Exmouth. Site Sniper works out the later of the two for your stay. Cable Beach has no school-holiday release: outside its dry season only the 364-day window applies. |
| `scheduled`      | **At a time you set**     | For dates RAC releases on a day it announces, such as Cable Beach's dry-season dates (15 May to 15 October), which open on RAC's own monthly release days. Site Sniper checks from the time you set.                                                                                                                                                                                                                                                                                                                                                                                                                      |

- **Members' pre-sale.** RAC members can book school holidays 48 hours before everyone else, at
  the same hour (except Margaret River's dorms). Site Sniper will time a snipe to the pre-sale
  once you can save your RAC member number in WA Stay, which is coming; until then it uses the
  public release.
- **When Site Sniper can't time it**, it says so and the snipe isn't created: school holidays
  RAC hasn't announced yet (from the last school day), dates beyond the release days WA Stay
  knows, or Cable Beach's dry season, whose release days WA Stay doesn't know. Set a watch, or
  choose **At a time you set** when you know the release. WA Stay learns new release days with
  an app update, and a waiting snipe picks them up when it is next armed.
- **Dates already open** can't be sniped: set a watch to hear about cancellations. A release
  counts as passed once your snipe's own **Keep trying for** has run out after it (so 20
  minutes after a release, a snipe that keeps trying for 15 is refused). A member whose
  pre-sale has passed that way is timed to the public release instead. RAC has no "When
  someone cancels" mode, as a watch covers it, every 15 minutes at most.

## Creating a snipe

**Site Sniper → New snipe**, or **Snipe a site** on a place's page (which fills in the place
and dates). The flow has five steps:

1. **Provider**: whose sites to snipe. Only providers with Site Sniper are listed; with one,
   it is chosen for you but still shown.
2. **Location**: the campground.
3. **Your stay**: dates and guests, plus the provider's own fields (ParkStay: Camping with,
   Vehicles, Postcode), the **Stay type** at a place whose units are of more than one kind, and
   the sites you want (any site, or a few). A snipe holds, so at such a place it needs one stay
   type or a site before it goes on (the same chips and rules as a watch:
   [Stay types](watches-and-notifications.md#stay-types)). A warning says when the stay is
   shorter than the sites usually take.
4. **Release**: **When are the sites released?** (or cabins, rooms…: the place's units as
   it calls them). For a scheduled release, the release date
   and time (in the provider's time zone), which must be before your check-in day. **Advanced timing**: Start early (seconds, default
   120), Check every (seconds, default 1.5; never under 0.5, nor under the provider's own floor:
   10 for RAC), Keep trying for (minutes, default 15; a provider may set a limit for a timed
   release mode, `maxWindowMinutes`, and a longer choice is cut to it: 30 for RAC), Most
   attempts (no limit by default).
5. **Review**: the summary, the queue use, a name and notes, and **Book responsibly**. For an
   optional account (ParkStay) it suggests connecting before the release so checkout is
   quicker; for a provider whose holds need an account, the snipe is created paused until you
   connect.

## What a snipe does

| Status                        | Meaning                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Armed                         | Scheduled; a timer is set for the release.                                                                                                                    |
| Waiting for release           | Counting down to the release, less the early start.                                                                                                           |
| Queueing                      | Joining or holding the provider's queue.                                                                                                                      |
| Sniping                       | Checking availability every few seconds across the release.                                                                                                   |
| Held                          | A site is held for you: pay before the countdown ends.                                                                                                        |
| Alert sent                    | The dates were free and you were alerted with a link to book on the provider's site. Nothing is held. It can be started again.                                |
| Booked                        | The payment was confirmed; the booking is under Bookings.                                                                                                     |
| Failed, Expired, Hold expired | It ended: no site within the window or attempts, the arrival date passed, the hold ran out unpaid, or the provider turned the check away. A snipe you stop is disabled, and can be started again. |

- Each snipe has its own timer chain (`src/main/scheduler/snipe-runner.ts`), re-armed after
  the computer sleeps. A check starts only when the previous one has finished.
- **One booking per night.** Before asking for a hold, the snipe reserves the stay's nights.
  A night already held or booked by another snipe or by a watch's automatic hold stops it with
  a clear message (`core/holds/night-guard.ts`). An alert holds nothing, so it reserves no
  night.
- **Which unit.** The first fully available unit of those you chose, or, with none chosen, of
  the stay types you chose (campsites, cabins and villas, rooms, dorms or glamping; none: any
  kind; a unit the provider gives no kind counts as "other"), and only in a stay the
  provider's stay rules allow (its minimum nights, and the days it takes arrivals and
  departures), even when the provider says the unit is free. A snipe never holds "any unit"
  across stay types: with no units chosen, once one of its candidates comes free and they,
  booked or free, are of more than one kind, it holds nothing, reserves no night and alerts you
  instead (**Alert sent**), with the note "The units this snipe could hold are of more than one
  stay type: choose one stay type or units for it." The flow asks for one stay type or units at
  a place it knows is mixed, so this happens only when the flow could not load the place's
  units, or they changed after the snipe was made. A snipe set to hold whose provider no longer
  places holds alerts too, with a note saying so.
- **A provider that turns it away.** If the provider answers a check or a hold with HTTP 403 or
  429 (a block, a challenge or "too many requests"), the snipe stops at once and ends **Failed**
  with "{provider} refused the check (HTTP {status}). Site Sniper stopped and won't try again by
  itself." Nothing retries it; start it again later if you want.
- **Run now** runs one attempt immediately (only while the snipe is running).
- **WA Stay must be running**, and the computer awake, at the release.

## When a snipe alerts

You get a desktop notification, "A site is free at Bungarra" (or a cabin, a spot…: the place's
units as it calls them), and an email if set up. Clicking the notification opens the snipe in
WA Stay and the provider's booking page, filled in with your stay, in your browser; the email has
a **Book on {provider}** link to the same public page, so you can book from your phone. The
link is only ever a page on the provider's own site, never a cart. Nothing is held, so book it
before someone else does. The snipe keeps what was free and when, and can be started again.

## When a site is held

You get a desktop notification (and an email, if set up), and the snipe shows "<site> is held
for you · Held until 10:42 am AWST · 23:10 left", with **Pay now** (the same panel as a watch's
automatic hold). Clicking the notification opens the snipe in WA Stay. The email says the hold is
in WA Stay on the computer that placed it, and also gives the provider's public booking page,
for when you are away from that computer.

1. **Pay now** opens the provider's payment page in its own window, on the same session that
   holds the site. If the DBCA queue is active, the app first waits (at most a minute) to get
   through it.
2. ParkStay may ask you to sign in there. Signing in is optional for holds: the basket stays
   in the session.
3. Pay on ParkStay's pages. WA Stay never sees card details.
4. When ParkStay shows the confirmation for **this** hold (its `/success/` page with the
   hold's own hash and booking number), the snipe becomes **Booked** and the booking appears
   under Bookings. Any other page records nothing.

If the hold runs out unpaid, ParkStay releases the site and the snipe shows Hold expired.

## Book responsibly

Site Sniper works within DBCA's terms, and you must too:

- **One account per person.** Use only your own ParkStay account.
- **One booking per night.** Never hold more than one booking for the same night.
- **Genuine intent.** Only snipe stays you will use. Speculative booking is exactly what DBCA's
  high-demand rules exist to stop.
- **Bookings in the name of someone staying**, whose identity can be checked on arrival.
- **No booking for others, no transfer or resale.**

DBCA may cancel bookings and bar people who break its terms. Site Sniper stops at a hold on
your own session for your own stay and leaves payment to you: it is a fast, prepared person,
not a fleet of bots.

## For developers

- Generic orchestration: `src/main/core/snipes/snipe.service.ts`; timers:
  `src/main/scheduler/snipe-runner.ts`; payment: `src/main/core/holds/hold-payment.service.ts`.
- ParkStay's release rules, holds and queue: `src/main/providers/parkstay/` (`release-policy.ts`,
  `holds.ts`, `queue/`), described in [ParkStay endpoints](providers/parkstay/endpoints.md).
- RAC's release rules: `src/main/providers/rac/release-policy.ts`, and its school-holiday release
  days in `release-calendar.ts`, whose header says how to update them when RAC announces a
  release. The policy sends no request; `availability.check` uses it for `release.opensAt`.
- A new provider gets Site Sniper by declaring `snipes`, release modes and a release policy
  ([Adding a provider](providers/adding-a-provider.md#release-policy)); its snipes alert. With
  `holds` too, they can hold. A snipe's `action` (`alert` or `hold`), its `alert` and the
  ALERTED status are in architecture-notes §12.35.
- No test or agent run places a real hold (architecture-notes §12.33); holds are tested with
  fixtures and seeded rows.
