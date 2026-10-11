# Troubleshooting

Problems using WA Stay. For problems building or running it from source, see
[development: troubleshooting](development.md#troubleshooting).

## Finding the logs

**Settings → About → Open logs folder**, or `%APPDATA%\WA Stay\logs` on Windows. Logs never
contain passwords, cookies, sign-in links or the DBCA queue key. Attach the latest log, and the
**Technical details** from Settings → About, to a bug report on
[GitHub Issues](https://github.com/wilsonwaters/wa-stay/issues).

## Installing and starting

**"Windows protected your PC".** WA Stay is not code-signed yet. Choose **More info**, then
**Run anyway**.

**"WA Stay requires Windows 10 or later".** Older versions of Windows are not supported.

**WA Stay is already running but no window shows.** It may have started minimised (Settings →
App → **Start minimised**): click its taskbar button. Starting it again brings the running
window forward; only one copy runs at a time.

## Upgrading from WA ParkStay Bookings

**"WA Stay could not copy your data from WA ParkStay Bookings".** The first start after an
upgrade could not copy the old data. The message names the folder that still holds it,
unchanged. **Retry** tries again (close anything that might be using the files first); **Start
fresh** opens WA Stay without the old data, which stays where it is; **Quit** tries again on the
next start.

**My old taskbar pin opens nothing, or the old app.** Pins made for the old version point
at the old program. Unpin it and pin WA Stay from its new shortcut
([upgrading](installation.md#upgrading-from-wa-parkstay-bookings)).

## Explore

**There is no map, only a list.** This build of WA Stay has no Mapbox token. Explore says so
and works as a list. Released builds include the map.

**No places at all.** The catalogue downloads a few seconds after start-up, and WA Stay tries
again by itself (after 1, 2 and 5 minutes) if that fails. Check the internet connection. Once
downloaded, the catalogue works offline.

**Cards say availability could not be checked, or show nothing for my dates.** Availability
needs a connection, and ParkStay can be busy. If the DBCA queue is active, WA Stay says so and
shows its place in the queue at the bottom right. Places that ParkStay does not book online show
"Info only".

**"Too many checks in a short time".** ParkStay asked the app to slow down. Wait a minute before checking
again; WA Stay never retries this straight away.

## Watches

**A watch never alerts.** WA Stay checks watches only while it is running and the computer is
awake. Turn on **Start WA Stay when you sign in** (Settings → App). Check that the watch is
active, not paused: a watch with **Stop watching after the first alert** pauses after alerting.
A maximum price is applied only when ParkStay shows a price for every night.

**A watch shows an error.** Its page shows the last error. Network problems and a busy ParkStay
fix themselves at the next check. "The arrival date has passed" means the stay has begun and the
watch has stopped.

## Sign-in and payment

**The ParkStay sign-in window does not finish.** ParkStay emails a code; type it into the
window. If the email has a link instead, paste it under **Have a sign-in link?** in Settings →
Accounts. If the DBCA queue shows up, wait in it: the window goes back to the sign-in page when
it lets you through. Closing the window cancels; nothing changes.

**"Signing out now would lose it".** A snipe is queueing, sniping or holding a site, or a
watch's hold has not expired. Sign out once it has finished.

**Pay now says the hold has expired.** A ParkStay hold lasts 30 minutes; after that ParkStay
releases the site.

**I paid but the snipe is not Booked.** WA Stay records a booking only when ParkStay shows the
confirmation page for that hold in the payment window. If you paid somewhere else, add the
booking by hand under Bookings (**Add booking**).

## Notifications and email

**No desktop notifications.** Check Settings → Notifications → **Desktop notifications**, and
that Windows allows notifications from WA Stay (Windows Settings → System → Notifications).

**Email does not arrive.** Use **Send test email** in Settings → Notifications; it explains what
went wrong. For Gmail and Outlook use an app password, not your normal password. If the card
says the saved password could not be decrypted (for example after copying your data to another
computer or Windows account), enter it again.

## Updates

**No update is offered.** The app checks 15 seconds after start-up; **Settings → About → Check
for updates** checks now. The portable exe never updates itself.
