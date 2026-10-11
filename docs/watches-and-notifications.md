# Watches and notifications

A **watch** checks a place for your dates on a schedule and tells you when something frees
up. **Notifications** reach you in the app, on the desktop and, if you set it up, by email.
This page is the deep dive; the [user guide](user-guide.md#watches) has the short version.

## Watches

### Creating a watch

**Watches → New watch**, or **Watch for availability** on a place's page (which fills in the
provider, the place and your dates, and opens on "Your stay"). Five steps:

1. **Provider.** Only providers that support watches are listed; with one (ParkStay WA), it is
   chosen for you but still shown.
2. **Location.** Search the provider's synced catalogue.
3. **Your stay.** Dates and guests, the provider's own fields (ParkStay: **Camping with**:
   Any, Tent, Campervan or Caravan), **Preferred sites** (leave all unticked to hear about any
   site) and **Max price per night** (optional; in dollars, applied only when the provider
   shows a price for every night).
4. **Alerts.**
   - **Check every**: 15 minutes, 30 minutes, 1, 4 or 12 hours, or daily (default 1 hour).
     A provider can set a longer minimum (`limits.minWatchIntervalMinutes`). A watch saved by
     the old 1.x app with a shorter interval keeps it as an extra option, and is run every
     15 minutes.
   - **Alert on partial availability**: also tell you when only some nights are free.
   - **Stop watching after the first alert**: the watch pauses once it has alerted.
   - **Hold a site automatically when found**, for providers with holds ([below](#automatic-holds)).
5. **Review**, grouped Where, When, Who and Alerts, with a name you can change.

### What a check does

- **One request per check**: the provider's availability for the place and stay, every unit
  night by night (`core/watches/watch.service.ts`).
- **Matching** (`core/watches/matching.ts`) uses only that answer:
  - the units you chose, by id or name (or every unit);
  - **a full match** is a unit free on every night that passes the price rule;
  - **a partial match** (when turned on and there is no full match) is each run of
    consecutive free nights on a unit, reported as its own shorter stay;
  - the price rule applies per night, and only when every night has a price.
- **Results** are kept on the watch: the last result, when it last ran and runs next, how
  many times it has found something, and the last availability, which its page shows night by
  night.
- **When the arrival date has passed** (in the provider's time zone), the watch stops.
- **Check now** runs a check at once, whether or not the watch is active.

### Scheduling

`JobScheduler` (`src/main/scheduler/`) runs watches whose next check is due, at most two at a
time for each provider (fewer if its `maxConcurrentRequests` is lower). Each next check is the
interval plus a little jitter, so watches do not all hit a provider at once. After the computer
wakes, due watches run. **WA Stay checks watches only while it is running**; turn on
**Start WA Stay when you sign in** in Settings → App to keep them going.

### Automatic holds

For a provider with holds (ParkStay), **Hold a site automatically when found** places a hold
on the first fully matching site, by the same path and safety rules as Site Sniper:

- one booking per night: a night already held by a snipe or another watch's hold blocks it;
- the hold is recorded on the watch with its reference and expiry, and a notification says
  "Site held at <place>";
- the watch shows the same hold panel as a snipe: "<site> is held for you", the time it is held
  until and a countdown of the time left to pay (ParkStay: 30 minutes);
- **Pay now** in that panel opens the provider's payment page in its own window, on the session
  that holds the site;
- if a hold is not placed (the site went, the provider refused), the watch alerts as usual and
  shows why.

Hold only what you will use ([Book responsibly](site-sniper.md#book-responsibly)).

## Notifications

### Where they appear

| Where | What |
| --- | --- |
| **The bell** (top right) | Every notification, newest first, with an unread count. Click one to open what it is about (a watch, a snipe, a booking). Mark read, mark all read, delete, clear all. |
| **The desktop** | An OS notification for each one, titled with the provider, e.g. "ParkStay · Sites available at Bungarra". Clicking it brings WA Stay forward on that page. Settings → Notifications: **Desktop notifications** and **Play a sound**. |
| **Email** | Each notification, sent through your own email account (below). |

What creates a notification: a watch finding sites (or some nights), a hold placed by a snipe
or a watch, a payment confirmed (booked), the welcome notice after an upgrade, and errors that
need your attention.

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

### For developers

- `NotificationService` (`core/notifications/notification.service.ts`) stores each
  notification (with its `provider_id`; the stored title has no provider prefix), shows the
  desktop notification and emits `notification:created`.
- `NotificationDispatcher` (`notification-dispatcher.ts`) sends it to every enabled notifier
  and records each delivery in `notification_delivery_logs`.
- A **notifier** is an outbound channel (`notifiers/base.notifier.ts`); the only one is
  `SmtpEmailNotifier` (`notifiers/email-smtp.notifier.ts`). A "provider" is always an
  accommodation source.
- The IPC namespaces are `notifications` and `notifiers`; notifier settings go out as
  `NotifierView`s with `hasPassword` instead of the password.
