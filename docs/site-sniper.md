# Site Sniper

> **Coming soon.** Site Sniper works and can be used, but it is still being finished: the top
> navigation marks it **Soon** and its page shows a "coming soon" banner. Use it with care,
> and only for stays you will take.

Site Sniper holds a hard-to-get site **the moment it is released**. It prepares ahead of time,
joins the provider's queue when the release uses one, checks availability rapidly across the
release instant, and places a temporary **hold** on the first matching site. You then pay for
the hold on the provider's own payment page before it runs out. Site Sniper never pays for
you.

ParkStay WA is the only provider with Site Sniper today. Its hold lasts **30 minutes**.

## How ParkStay releases sites

The release modes come from the provider's manifest (`releaseModes`). ParkStay has three:

| Mode | In the app | What happens |
| --- | --- | --- |
| `daily_rollover` | **When new dates open** | ParkStay takes bookings 180 days ahead. Each day one more arrival date opens at the campground's own release time, Perth time (Bungarra's is 2:00 am; until the app has read a campground's time it assumes midnight). Site Sniper works out the instant for your arrival date. Uses the DBCA queue. |
| `scheduled` | **At a scheduled time** | For campgrounds whose dates are released in blocks, such as those on the Ningaloo coast, at a time you set. The suggested default is the next first Tuesday of a month at 10:00 am AWST, but DBCA can change it, so check the published time. Uses the DBCA queue. |
| `cancellation` | **When someone cancels** | There is no waitlist; cancelled and lapsed holds reappear straight away. Site Sniper keeps checking (no faster than every 3 s) until a site frees up. |

Joining the DBCA queue early gives no advantage: for scheduled releases DBCA re-allocates
queue places at random at the release time. WA Stay joins genuinely at the start of its
warm-up and keeps the session refreshed as ParkStay's own page does. It never fakes activity
to get around the queue's inactivity rules.

## Creating a snipe

**Site Sniper → New snipe**, or **Snipe a site** on a place's page (which fills in the place
and dates). The flow has five steps:

1. **Provider**: whose sites to snipe. Only providers with Site Sniper are listed; with one,
   it is chosen for you but still shown.
2. **Location**: the campground.
3. **Your stay**: dates and guests, plus the provider's own fields (ParkStay: Camping with,
   Vehicles, Postcode), and the sites you want (any site, or a few).
4. **Release**: **When are the sites released?** For a scheduled release, the release date
   and time (in the provider's time zone), which must be before your check-in day. **Advanced timing**: Start early (seconds, default
   120), Check every (seconds, default 1.5; never under 0.5), Keep trying for (minutes, default
   15), Most attempts (no limit by default).
5. **Review**: the summary, the queue use, a name and notes, and **Book responsibly**. For an
   optional account (ParkStay) it suggests connecting before the release so checkout is
   quicker; for a provider whose holds need an account, the snipe is created paused until you
   connect.

## What a snipe does

| Status | Meaning |
| --- | --- |
| Armed | Scheduled; a timer is set for the release. |
| Waiting for release | Counting down to the release, less the early start. |
| Queueing | Joining or holding the provider's queue. |
| Sniping | Checking availability every few seconds across the release. |
| Held | A site is held for you: pay before the countdown ends. |
| Booked | The payment was confirmed; the booking is under Bookings. |
| Failed, Expired, Hold expired | It ended: no site within the window or attempts, the arrival date passed, or the hold ran out unpaid. A snipe you stop is disabled, and can be started again. |

- Each snipe has its own timer chain (`src/main/scheduler/snipe-runner.ts`), re-armed after
  the computer sleeps. A check starts only when the previous one has finished.
- **One booking per night.** Before asking for a hold, the snipe reserves the stay's nights.
  A night already held or booked by another snipe or by a watch's automatic hold stops it with
  a clear message (`core/holds/night-guard.ts`).
- **Run now** runs one attempt immediately (only while the snipe is running).
- **WA Stay must be running**, and the computer awake, at the release.

## When a site is held

You get a desktop notification (and an email, if set up), and the snipe shows "<site> is held
for you · Held until 10:42 am AWST · 23:10 left", with **Pay now** (the same panel as a watch's
automatic hold).

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
- A new provider gets Site Sniper by declaring `snipes`, `holds`, release modes and a release
  policy ([Adding a provider](providers/adding-a-provider.md#release-policy)).
- No test or agent run places a real hold (architecture-notes §12.33); holds are tested with
  fixtures and seeded rows.
