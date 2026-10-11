# User guide

WA Stay helps you find places to stay across Western Australia and get them when they are
hard to book. It works with **providers**, the booking systems that own the places. The first
is **ParkStay WA**, DBCA's booking system for national-park campgrounds; more are planned.

New to WA Stay? Install it first ([installation](installation.md)). Upgrading from the old 1.x
app? Your data moves over by itself ([upgrading](installation.md#upgrading-from-wa-parkstay-bookings)).

## Contents

- [Finding your way around](#finding-your-way-around)
- [Explore](#explore)
- [A place's page](#a-places-page)
- [Watches](#watches)
- [Site Sniper (coming soon)](#site-sniper-coming-soon)
- [Bookings (coming soon)](#bookings-coming-soon)
- [Notifications](#notifications)
- [Settings](#settings)
- [Good to know](#good-to-know)

## Finding your way around

There is no login: WA Stay opens on **Explore**. The top navigation has **Explore**,
**Watches**, **Site Sniper** and **Bookings**; the last two carry a **Soon** pill because they
are still being finished, but you can use them. On the right are the **notifications bell** and
the **account menu**, which opens **Settings**.

Everything shows which provider it belongs to: a small coloured badge with the provider's
monogram (ParkStay's is "PS" on green).

## Explore

![Explore: the search pill with dates for 10 to 12 November and 2 adults, filter chips, results showing 11 places of which 3 are available, and a map of Western Australia with pins showing free sites](images/explore.png)

- **Search.** The pill at the top takes **Where** (a place, park or region), **When** (your
  dates) and **Who** (guests). Results update as you type.
- **Filters.** **Provider**, **Type** (campground, cabin, holiday park…), **Region**,
  **Facilities**, **Book online** and, once you have dates, **Available only**.
- **Availability.** With dates, every card and map pin shows how many sites are free for your
  whole stay ("2 of 3 sites available", "No site free every night", "Info only" for places
  that are not booked online), and the heading counts the places available.
- **The map** shows every place from every provider. With **Search as I move the map** on, the
  list narrows to the area you are looking at. Pins cluster when zoomed out; the key explains
  the colours. If WA Stay was built without a map token, Explore shows the list only and says
  so.
- The list is ordered by distance from the middle of the map. Your search, filters, dates and
  map position are in the page address, so Back takes you where you were.

Places and photos come live from the provider. The catalogue is refreshed once a day and works
offline in between; availability needs a connection.

## A place's page

![A place's page for Bungarra in Cape Range National Park: the ParkStay badge, the photo area, an availability table showing three campsites free at 30 dollars on both nights, and the Check your dates card](images/place-detail.png)

Click a place to open its page:

- the provider, the type of place, the park and region, photos and the provider's description;
- **Check your dates**: pick dates and guests and **Check availability** to see every site
  night by night, with prices ("3 of 5 sites free for all 2 nights"; **Fully available only**
  narrows the table), and under each site's name how many people and vehicles it takes and
  the provider's description of it;
- **Book on ParkStay** opens ParkStay in your browser with this place and your dates chosen;
  its **See availability** takes you on to book;
- **Watch for availability** starts a watch for this place and these dates;
- **Snipe a site** starts a Site Sniper snipe;
- **View on ParkStay** and **More information** open the provider's pages in your browser.

## Watches

![The Watches page with a watch for Bungarra, 10 to 12 November, checked just now: 3 sites available, found once, now paused](images/watches.png)

A watch checks a place for your dates on a schedule and tells you when sites free up.

1. **New watch** (or **Watch for availability** on a place's page).
2. Choose the provider, the place and your stay: dates, guests, **Camping with**, the sites you
   prefer (or any) and an optional maximum price per night.
3. Choose the alerts: how often to check (every 15 minutes to daily; 1 hour by default),
   whether to tell you about partial availability (only some nights free), whether to stop
   after the first alert, and, for ParkStay, **Hold a site automatically when found**.
4. Review and **Create watch**.

Each watch shows its last result, when it last checked and next checks, and how many times it
has found something. **Check now** checks at once. The menu lets you edit, pause or resume, and
delete it. Filter the list by provider and by status (active or paused).

A watch that holds a site shows **Pay now**: see [Site Sniper](#when-a-site-is-held). More
detail: [Watches and notifications](watches-and-notifications.md).

## Site Sniper (coming soon)

Site Sniper holds a hard-to-get site the moment it is released: when ParkStay opens a new
date (180 days ahead, at the campground's release time), at a scheduled block release, or when
someone cancels. It joins the DBCA queue when the release uses it, checks rapidly across the
release, and places a 30-minute hold that you then pay for.

**New snipe** walks through the provider, the place, your stay (with ParkStay's vehicles and
postcode), when the sites are released, and a review. Hold only what you will use. Full guide:
[Site Sniper](site-sniper.md).

### When a site is held

You get a notification, and the snipe (or watch) shows "<site> is held for you", the time it is
held until and a countdown of the time left to pay ("Held until 10:42 am AWST · 23:10 left").
A watch and a snipe show the same panel.

1. **Pay now** opens ParkStay's payment page in its own window. If the DBCA queue is busy,
   WA Stay first gets you through it.
2. Sign in there if ParkStay asks; the held site stays in your basket.
3. Pay on ParkStay's pages. WA Stay never sees your card.
4. When ParkStay confirms this booking, the snipe or watch shows **Booked** and the booking
   appears under Bookings.

## Bookings (coming soon)

Bookings keeps your trips from every provider in one place, in **Upcoming**, **Past** and
**Cancelled** tabs, with search and a provider filter.

- Bookings paid through WA Stay's payment window are added for you.
- **Add booking** records one you made elsewhere: the provider, the place, check-in and
  check-out, the unit, guests, the reference and the cost.
- A booking's page shows its details, copies the reference, and links to **Manage on
  ParkStay** to change or cancel it on ParkStay's own site.
- Importing bookings straight from a provider appears only for providers that support it;
  ParkStay does not yet.

## Notifications

The bell shows every notification, newest first, with an unread count; click one to open what
it is about. WA Stay also shows desktop notifications (titled with the provider, e.g.
"ParkStay · Sites available at Bungarra") and can email you. Notifications older than 30 days
are deleted automatically.

The tray at the bottom right shows the DBCA queue while WA Stay is waiting in it, and offers
app updates when one is ready.

## Settings

Open Settings from the account menu (top right).

- **Accounts.** One row per provider. **Connect** signs you in to ParkStay in an in-app
  window, on ParkStay's own pages: ParkStay emails you a code to type in. It is optional: holds
  work without it, and you can sign in on the payment page instead. Connecting before a release
  just makes checkout quicker. Got a sign-in link by email instead? Paste it under **Have a
  sign-in link?**. **Sign out** clears ParkStay's session in WA Stay and nothing else; it waits
  while a snipe or hold needs the session. [How sign-in works](providers/parkstay/authentication.md).
- **Notifications.** **Desktop notifications** and **Play a sound**, and **Email**: your SMTP
  settings (Gmail, Outlook or your own server), where to send alerts, and **Send test email**.
  [Email setup](watches-and-notifications.md#email).
- **App.** **Start WA Stay when you sign in** and **Start minimised** (it opens in the
  taskbar instead of on screen). Available on Windows and macOS.
- **About.** The version, **Check for updates**, **Open logs folder**, and **Technical
  details** (versions of Electron, Chrome and Node.js) for bug reports.

## Good to know

- **WA Stay checks watches and runs snipes only while it is running** (and the computer is
  awake). Closing the window quits it; turn on **Start WA Stay when you sign in** to keep it
  going.
- **Your data stays on your computer**, in `%APPDATA%\WA Stay` on Windows. WA Stay talks to the
  providers (ParkStay, the DBCA queue), Mapbox for the map (the Mapbox map library also sends
  Mapbox its standard usage events), GitHub for updates, and your own email server if you set
  one up. WA Stay itself has no account, no cloud service and no analytics.
- **Payment is always yours to make**, on the provider's own site.
- **Book responsibly.** One account per person, one booking per night, and only stays you will
  take. [DBCA's terms](providers/parkstay/README.md#dbcas-terms).
- Something not working? [Troubleshooting](troubleshooting.md).
