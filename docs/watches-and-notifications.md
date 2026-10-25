# Watches and notifications

A **watch** checks a place for your dates on a schedule and tells you when something frees
up. **Notifications** reach you in the app, on the desktop and, if you set it up, by email.
This page is the deep dive; the [user guide](user-guide.md#watches) has the short version.

## Watches

### Creating a watch

**Watches → New watch**, or **Watch for availability** on a place's page (which fills in the
provider, the place and your dates, and opens on "Your stay"). Five steps:

1. **Provider.** Only providers that support watches are listed; when only one does, it is
   chosen for you but still shown.
2. **Location.** Search the provider's synced catalogue.
3. **Your stay.** Dates and guests, the provider's own fields (ParkStay: **Camping with**:
   Any, Tent, Campervan or Caravan; RAC: **Pets**, up to 2, where pets are allowed), **Stay
   type** at a place whose units are of more than one
   kind ([below](#stay-types)), **Preferred sites** (leave all unticked to hear about any
   site) and **Max price per night** (optional; in dollars, applied only when the provider
   shows a price for every night). A warning says when the stay is shorter than the sites
   usually take, as WA Stay alerts only on stays the provider accepts
   ([below](#what-a-check-does)).
4. **Alerts.**
   - **Check every**: 15 minutes, 30 minutes, 1, 4 or 12 hours, or daily (default 1 hour).
     A provider can set a longer minimum (`limits.minWatchIntervalMinutes`: Stay
     Rottnest's is 30 minutes). A watch saved by
     the old 1.x app with a shorter interval keeps it as an extra option, and is run every
     15 minutes.
   - **Alert on partial availability**: also tell you when only some nights are free.
   - **Alert on stays that move between sites** ("cabins", "spots": the watch's own word): also
     tell you when every night is free, but not on one site, so you would move during your stay
     and book more than once or through the place. Off by default ([split stays](#split-stays)).
   - **Stop watching after the first alert**: the watch pauses once it has alerted.
   - **Hold a site automatically when found**, for providers with holds ([below](#automatic-holds)).
5. **Review**, grouped Where, When, Who and Alerts, with a name you can change.

### What a check does

- **One request per check**: the provider's availability for the place and stay, every unit
  night by night (`core/watches/watch.service.ts`).
- **Matching** (`core/watches/matching.ts`) uses only that answer:
  - the units you chose, by id or name; else the units of the stay types you chose
    ([below](#stay-types)); else every unit;
  - **a full match** is a unit free on every night that passes the price rule and the
    provider's stay rules;
  - **a split stay** (when turned on and there is no full match) is every night free, but only
    by moving between units ([below](#split-stays)); it comes before a partial match, as it
    covers every night;
  - **a partial match** (when turned on and there is no full match or split stay) is each run
    of consecutive free nights on a unit, reported as its own shorter stay;
  - the price rule applies per night, and only when every night has a price;
  - **stay rules**: where the provider has a minimum stay, or days with no arrivals or no
    departures, a night it refuses for the stay is never free, a partial run is trimmed to
    start on a day that takes arrivals and end on one that takes departures, and a run
    shorter than its minimum (the arrival night's) is dropped, so a watch never alerts on a
    stay the provider would refuse.
- **Counts** of what is free for the stay are Explore's: each full match counts the units it
  stands for (`UnitAvailability.freeCount`, added up by `freeUnitsOf` in
  `src/shared/utils/free-units.ts`), else one. A provider whose units are single sites counts
  one each (ParkStay: "Found 3 sites available", "2 of 3 sites free for all 2 nights"); RAC's
  units are categories, each counting its sites free for the whole stay, with no total and in
  Explore's word, "free" (`freeUnitsWord`): "Found 51 sites free", "51 sites free for all 2
  nights", where Explore says "51 spots free". The alert, its email, Check now, the watch's
  card and its night grid all count this way, and the night grid's notes and "Show all" name
  RAC's categories as types, never as a count of sites. A partial match describes nights, not
  a count ("2 of 3 nights available").
- **Results** are kept on the watch: the last result, when it last ran and runs next, how
  many times it has found something, and the last availability (with each unit's count),
  which its page shows night by night. A check stored before counts reads one per unit until
  the next check. The result is, best first: the whole stay free ("51 sites free"), a split
  stay ("Free across 2 sites", or "Free if you move sites" when the provider can't say how
  many), some nights ("2 of 3 nights available"), or nothing free.
- **When the arrival date has passed** (in the provider's time zone), the watch stops.
- **Check now** runs a check at once, whether or not the watch is active.

### Split stays

A **split stay** is a stay free every night, but only by moving between units: site A for the
first two nights, site B for the rest. It is never counted as free, never "available", and
never held. Where the provider can tell, WA Stay shows it for what it is, with how to book it:

- **Booked through the place.** At an RAC park, a category can have a free site every night
  but no one site free for them all. RAC's staff book such a stay as separate stays when you
  contact the park, so WA Stay says "Contact {park}" and links the park's contact page. RAC
  doesn't say which sites are free, so there are no parts and no count, and the price (the
  category's nightly rate) always reads "about".
- **Booked part by part.** At a ParkStay campground, WA Stay finds the fewest bookings that
  cover the stay, each a run of nights on one site that the site's stay rules allow (and, for a
  watch, within its price limit), and lists them in order with **Book {dates} on ParkStay** for
  each, ParkStay's page for that part's dates. The parts never share a night. At a campground
  listed by site class, ParkStay's own breakdown gives the parts.
- **Never across stay types.** A split stay keeps to one kind: a site then a cabin is not one.
- **Where it shows.** A place's page shows the split stays of its check in a block under the
  night grid ("Free if you move sites"). On Explore an RAC park whose only option is a split
  stay reads **Free if you move**, muted, after the places with something free and before
  "None free", and **Available only** hides it. ParkStay's Explore counts can't tell, so its
  campgrounds read "None free" there.

A watch alerts on split stays only with **Alert on stays that move between sites** ticked:

- with nothing free on one unit, a split stay is the watch's result, ahead of some nights; it
  counts as found, and its alert pauses a watch set to **Stop watching after the first alert**,
  as an alert for some nights does;
- the watch's page shows the same block instead of **Book on {provider}** ("Contact {park}" is
  its main button), and its night grid shows every unit; its card and Check now say "Free
  across 2 sites" (or "Free if you move sites");
- **Hold a site automatically when found** never holds one: it holds only a unit free for the
  whole stay, and the alert adds "WA Stay doesn't hold these automatically.";
- turning the option on or off makes the watch due at once, so its result follows the setting;
  a check already running then keeps nothing.

Site Sniper never takes a split stay ([Site Sniper](site-sniper.md)).

### Stay types

A watch can ask for stay types: campsites, cabins and villas, rooms, dorms or glamping (its
`unitKinds`, matched against the provider's `unitKind` on each unit). Then only units of those
kinds match: the alert counts only those, and the watch's page shows only those. A unit the
provider gives no kind counts as "other", so at a provider that sets no kinds a watch for cabins
finds nothing. Units you chose by name win: the stay types do not filter them. With no stay
type, every unit counts.

The flow offers them as **Stay type** chips on "Your stay" (and on Edit) only at a place whose
units are of more than one kind, counting a unit with no kind as "other": a campground of sites
alone shows none, and a place with sites and units of no kind shows just **Camping**. The chips
come from the place's units, not from the catalogue's summary. Leave them all off for any stay
type. **Preferred sites** groups such a place's units by stay type; choosing stay types narrows
it to units of those kinds and unticks any chosen site of a kind turned off (it says how many),
so the two never disagree.
A link from Explore with stay types (`stay=cabin`) chooses them once the place's units load: the
ones the place has are kept; at a mixed place with none of them they are cleared, with a notice;
at any other place they are dropped without one.

### Scheduling

`JobScheduler` (`src/main/scheduler/`) runs watches whose next check is due, at most two at a
time for each provider (fewer if its `maxConcurrentRequests` is lower). Each next check is the
interval plus a little jitter, so watches do not all hit a provider at once. After the computer
wakes, due watches run. **WA Stay checks watches only while it is running**; turn on
**Start WA Stay when you sign in** in Settings → App to keep them going.

### A provider that asks for a pause

A provider can ask for a pause between requests (`limits.minRequestIntervalMs`). RAC Parks &
Resorts asks for 10 seconds, so its requests go one at a time:

- a watch's check is background work: it waits its turn, at least 10 seconds after RAC's last
  request ended;
- what you start yourself goes first, a second after the request before it: a watch's **Check
  now**, a place's **Check availability**, and your dates on Explore (RAC's eight parks then
  take about 40 to 60 seconds together, with "Still checking RAC…" meanwhile);
- if RAC turns a request away (HTTP 403 or 429, or a security check), WA Stay sends RAC nothing
  for 30 minutes, longer for blocks in a row, and the watch shows "RAC Parks & Resorts turned
  the request away (HTTP 429). WA Stay won't ask again until 3:45 pm." It checks again at its
  next check after that.

Stay Rottnest asks for 60 seconds, and one search of it answers every watch, check and Explore
count for the same stay and party, so ten watches of one stay cost one request. It isn't checked
from 5:30 am to noon on its Open Days, and a request it turns away stops every check of it for 12
hours, doubling up to 7 days ([Stay Rottnest](providers/rottnest/README.md#availability)).

ParkStay asks for no pause. [How RAC is paced](providers/rac/README.md#pacing).

### A provider with a notice

Some providers' terms put a risk on you for using WA Stay with them, and WA Stay asks you to read
a notice before it checks them at all (Stay Rottnest's, about its rule on automated software).
Until you accept it, a watch on that provider can't be created, and an existing one doesn't
check: it reads "Paused: read and accept Stay Rottnest's notice in WA Stay." The new-watch flow
shows the notice when you choose the provider. Once you accept it, paused watches check again at
their next check. Withdrawing it in Settings → Accounts pauses them again at once.

### Automatic holds

For a provider with holds (ParkStay; RAC only with its auto-cart experiment turned on,
[below](#rac-the-auto-cart)), **Hold a site automatically when found** places a hold on the
first fully matching site, by the same path and safety rules as Site Sniper:

- one booking per night: a night already held by a snipe or another watch's hold blocks it;
- the hold is recorded on the watch with its reference and expiry, and a notification says
  "Site held at <place>" (or "Cabin held at …") and asks you to complete payment within the
  time left ("within 30 minutes" on ParkStay). Its email says "This hold is in WA Stay on the
  computer that placed it. Open WA Stay there to pay before it expires.", and gives the
  provider's public booking page for when you are away from that computer, warning that what
  WA Stay held may show as taken there until the hold ends;
- the watch shows the same hold panel as a snipe: "<site> is held for you", the time it is held
  until and a countdown of the time left to pay (ParkStay: 30 minutes);
- **Pay now** in that panel opens the provider's payment page in its own window, on the session
  that holds the site;
- for a provider that can let a hold go early, **Let it go** sits beside **Pay now**. It asks
  first ("Let this hold go?"), then the provider lets the hold go and the panel says so: "You let
  it go.", or, when the provider no longer held it, "{provider} no longer holds it. If you paid,
  look for {provider}'s confirmation email." Such a provider may also let the hold go when its
  payment window closes without a confirmed payment, and deleting the watch lets its hold go
  first. WA Stay never takes a closed window as unpaid: the provider checks its own side.
  ParkStay's holds run their 30 minutes as before;
- when the provider can only guess how long a hold lasts, the panel and the alert say "about"
  ("Held until about 10:42 am", "within about 10 minutes");
- if a hold is not placed (the site went, the provider refused), the watch alerts as usual and
  shows why;
- a [split stay](#split-stays) is never held: its alert adds "WA Stay doesn't hold these
  automatically.";
- **never "any unit" across stay types**: a watch with no units chosen whose wanted units are of
  more than one kind (campsites and a hut, or the two stay types it asks for), booked or free,
  places no hold. It alerts as usual, with "Not held automatically: this place has more than one
  stay type. Choose one stay type or units to let WA Stay hold one." So at a place the flow knows
  is mixed, **Hold a site automatically when found** needs one stay type or a site chosen on
  "Your stay" before the Alerts step (or Edit) goes on.

Hold only what you will use ([Book responsibly](site-sniper.md#book-responsibly)).

### RAC: the auto-cart

RAC's holds are an experiment, off by default: **Put stays in my RAC cart automatically**, under
Experimental on RAC's row in Settings → Accounts, which takes effect when WA Stay restarts.
Until then an RAC watch only alerts. With it on, RAC's automatic hold is its cart:

- **A stay in your RAC cart.** WA Stay adds the stay to your RAC cart in the app, and **Pay
  now** opens RAC's cart page, where you check out and pay. WA Stay never marks it booked: look
  for RAC's confirmation email.
- **Your equipment, for a site.** Ticking **Hold a site automatically when found** at an RAC park
  asks for your equipment (its type, length and width in metres), which RAC's cart needs for a
  site. Without it a site is not held, and the watch says why. A cabin or a room needs none.
- **"About" expiries.** The hold runs until RAC's cart says, or, when the cart page gives no
  countdown, for about 10 minutes: the panel and the alert say "about".
- **Let it go, or close the window.** **Let it go**, closing the payment window without paying,
  and deleting the watch all take the stay out of the cart, but only while RAC's cart still
  holds it: one you paid for has left the cart, and is never touched.
- **One cart at a time.** RAC's cart holds one stay from WA Stay at a time: while it does, no
  other is added ("Your RAC cart already holds a stay. Pay for it or let it go first."). Another
  watch alerts as usual, with that note; a snipe keeps trying while its window lasts.
- **Never past the cart.** WA Stay never checks out, agrees to RAC's terms, types your card or
  fills in your member number: **Copy RAC member number** sits beside **Pay now** for that.

[How the auto-cart works](providers/rac/README.md#the-auto-cart-experiment).

## Notifications

Alerts name units by what they are: "Sites available at Bungarra" for ParkStay's campsites,
"Cabins available at …" or "Cabin held at …" for cabins, and "spots" when the units found are of
more than one stay type ("Found 3 spots available at …"). The words come from the units found or
held, else the watch's or snipe's stay types, else the provider's usual kind of place. The
number is Explore's count of what is free for the whole stay ([above](#what-a-check-does)): at
an RAC park, the sites of every category found, not the categories.

### Where they appear

| Where | What |
| --- | --- |
| **The bell** (top right) | Every notification, newest first, with an unread count. Click one to open what it is about (a watch, a snipe, a booking). Mark read, mark all read, delete, clear all. |
| **The desktop** | An OS notification for each one, titled with the provider, e.g. "ParkStay · Sites available at Bungarra". Clicking it brings WA Stay forward on that page. Clicking an alert that a watch found something, or that a snipe found the dates free ("A site is free at …"), also opens the provider's booking page for those dates in your browser, for every provider; an alert that a site is held opens only the watch or snipe, where you pay. A split stay's alert ("Free if you move sites at …") opens only the watch, where its parts are. Settings → Notifications: **Desktop notifications** and **Play a sound**. |
| **Email** | Each notification, sent through your own email account (below). An alert that a watch found something, or that a snipe found the dates free, has a **Book on {provider}** link to the provider's public booking page for those dates (the nights it found, for some nights), so you can book from your phone. The link is never a cart or a checkout. An alert that a site is held says the hold is in WA Stay on the computer that placed it, and still gives the link. A split stay's alert has **How to book** instead: **Contact {place}**, the place's contact page, or each part in order with **Book on {provider}** for its dates. |

What creates a notification: a watch finding sites (or a split stay, or some nights), a snipe
finding the dates free (an alert, [Site Sniper](site-sniper.md#when-a-snipe-alerts)), an Open Day
plan's reminder (one for every plan due at that time with the same provider,
[Site Sniper](site-sniper.md#stay-rottnests-open-days-plans); clicking it opens the plan, then
the provider's booking page, and its email has the **Book on {provider}** link), a hold placed
by a snipe or a watch, a payment confirmed (booked), the welcome notice after an upgrade, and
errors that need your attention.

Notifications and the record of emails sent are deleted automatically after 30 days (the
retention job, 5 minutes after start and then daily).

### Email

WA Stay sends email through **your** SMTP server (an email notifier). Settings → Notifications
→ Email:

1. Choose **Gmail**, **Outlook** or a custom server (host, port, security).
2. Enter your email address and, for Gmail or Outlook, an **app password** (not your normal
   password; the setup instructions in the card explain how to create one).
3. **Send alerts to**: the address to send to (your own by default).
4. **Send test email** checks the settings and tells you, in plain words, what went wrong.

The password is stored encrypted (the app's SecretVault, on the operating system's own
encryption) and is **write-only**: the app never shows it again or sends it back to the window.
Saving the settings with an empty password keeps the stored one, as long as the server, port
and account are the same. If the stored password cannot be decrypted (for example after
copying your data to another computer), the card says so and you enter it again.

### The booking link

When a watch finds a stay, the alert carries the provider's booking page for it
(`core/booking-link.ts`): for a whole stay, the first matching unit's own page
(`UnitAvailability.bookingUrl`) if the provider gives one, else `links.booking` with the stay's
dates and the unit; for some nights, the longest run with its own dates. ParkStay's is its
public search page with the campground and the dates; RAC's is the category's own booking page
with the stay filled in, which adds nothing to a cart until you press its book button. The
core keeps a link only when it is
https on the provider's own site (its website's host, or a subdomain of it); a link that adds to
a cart is never one (the provider's rule). It is never stored: the watch's page works out the
same link from the last check ("Book on {provider}" under the result, while the stay has not
begun), and logs name only a link's origin. Moving a watch to another place forgets what its
last check saw, so the page shows no link (and no result) until the new place is checked. A
check that was already running when the watch was moved, or its stay, units, stay types or
stay fields changed, keeps nothing of its answer or its failure and alerts on nothing: the
change makes the watch due again, and the next check asks about what it is now. A provider
turning that check away (HTTP 403 or 429) is the one thing kept: the watch shows it, and its
next check waits its interval rather than asking again at once.

A split stay's alert carries no booking link, so a click opens the watch. Its email gets the
split stay's own links instead: the place's contact page (`links.contact`, else the place's own
page) for one booked through the place, or each part's booking page (`links.booking` with the
part's dates and unit). Each is kept by the same rule, checked again when the alert is sent, and
never stored; the watch's page works them out from the last check while it is a split stay on
the watch's own dates.

### For developers

- `NotificationService` (`core/notifications/notification.service.ts`) stores each
  notification (with its `provider_id`; the stored title has no provider prefix), shows the
  desktop notification and emits `notification:created`. An alert's booking page and whether it
  is about a hold in the app (`dispatchMeta.bookingUrl`, `heldInApp`) go to the notifiers and
  the desktop click only, never to `notifications` or the delivery log. `notify` keeps a link
  only when it is on the notification's provider's site (the `providerManifest` option); a
  click opens it with the `openExternal` option (`shell.openExternal`) after `app:navigate`.
- A split stay's alert (`notifyWatchSplitFound`) carries `dispatchMeta.splitStay` (the contact
  page, or each part's label and booking page) instead of a `bookingUrl`; `notify` checks each
  URL against the provider's site as it does `bookingUrl`, and the email notifier renders it as
  "How to book". The split stays themselves come from `core/split-stays.ts` (`splitStaysOf`,
  `withSplitStayLinks`).
- `NotificationDispatcher` (`notification-dispatcher.ts`) sends it to every enabled notifier
  and records each delivery in `notification_delivery_logs`.
- A **notifier** is an outbound channel (`notifiers/base.notifier.ts`); the only one is
  `SmtpEmailNotifier` (`notifiers/email-smtp.notifier.ts`). A "provider" is always an
  accommodation source.
- The IPC namespaces are `notifications` and `notifiers`; notifier settings go out as
  `NotifierView`s with `hasPassword` instead of the password.
