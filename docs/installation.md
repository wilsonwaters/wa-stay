# Installation

WA Stay is a Windows desktop app. macOS and Linux builds are not released; developers can
[build from source](development.md) on any of the three.

## Contents

- [Requirements](#requirements)
- [Download](#download)
- [Install](#install)
- [First start](#first-start)
- [Upgrading from WA ParkStay Bookings](#upgrading-from-wa-parkstay-bookings)
- [Updates](#updates)
- [Uninstall](#uninstall)
- [Where WA Stay keeps things](#where-wa-stay-keeps-things)

## Requirements

- Windows 10 or later, 64-bit (the installer refuses older versions).
- An internet connection for places, availability and the map. The catalogue and your watches,
  snipes and bookings are kept locally.
- For providers that need browser automation (none yet): Microsoft Edge or Google Chrome.

## Download

From the [latest release](https://github.com/wilsonwaters/wa-stay/releases/latest):

| File | Use it when |
| --- | --- |
| `WA-Stay-Setup-x.y.z.exe` | You want WA Stay installed, with Start-menu and desktop shortcuts and automatic updates. **Recommended.** |
| `WA-Stay-Portable-x.y.z.exe` | You want to run it without installing. It does not update itself: download the new portable exe for each release. |

WA Stay is **not code-signed yet**, so Windows SmartScreen may say "Windows protected your PC".
Choose **More info**, then **Run anyway**.

## Install

1. Run `WA-Stay-Setup-x.y.z.exe` (approve SmartScreen as above).
2. Choose where to install it. The default, for your user only, is
   `%LOCALAPPDATA%\Programs\WA Stay`; no administrator rights are needed.
3. The installer creates **WA Stay** shortcuts on the desktop and in the Start menu, and can
   start WA Stay when it finishes.

To pin WA Stay to the taskbar, right-click its Start-menu shortcut (or the running app's
taskbar button) and choose **Pin to taskbar**.

## First start

WA Stay opens on **Explore**: no login, no setup wizard. A few seconds after start-up it
downloads the provider's catalogue (ParkStay's 169 campgrounds), and then you can search,
filter and open places. Optional next steps:

- **Settings → Notifications**: set up email alerts.
- **Settings → Accounts → Connect ParkStay**: sign in to ParkStay in the app (optional; it makes
  paying for a held site quicker).
- **Settings → App**: start WA Stay when you sign in to Windows, so watches keep running.

See the [user guide](user-guide.md).

## Upgrading from WA ParkStay Bookings

WA Stay is the new name of WA ParkStay Bookings, rebuilt as a booking app for all of Western
Australia. **Upgrading keeps your data and needs nothing from you.**

- **Auto-update works.** WA ParkStay Bookings 1.x offers the WA Stay update like any other (it
  follows GitHub's redirect to the renamed repository). You can also download and run
  `WA-Stay-Setup-x.y.z.exe` yourself.
- **If the old version's uninstaller asks whether to delete your data, choose No.** The WA Stay
  installer has already copied the old data folder to `%APPDATA%\WA Stay\legacy-snapshot`
  before that question, so your data is safe either way, but No keeps the original backup too.
- **Your data is copied on the first start.** WA Stay copies your watches, snipes, bookings,
  notifications, settings and email settings from `%APPDATA%\parkstay-bookings` to
  `%APPDATA%\WA Stay`, then shows a notice, "Your data has moved to WA Stay". The old folder
  is **left untouched as a backup**. Once you have checked that everything is there, it is safe
  to delete. If the copy fails, WA Stay says why and offers **Retry**, **Start fresh** (open
  without your old data, which stays in the old folder) or **Quit**.
- **The install folder.** An automatic (silent) update keeps the old program folder,
  `%LOCALAPPDATA%\Programs\WA ParkStay Bookings\`. Running the installer by hand puts WA Stay in
  a `WA Stay` subfolder of it, `%LOCALAPPDATA%\Programs\WA ParkStay Bookings\WA Stay\`. Both
  work; nothing needs fixing.
- **Shortcuts are renamed.** The installer removes the old **WA ParkStay Bookings** desktop and
  Start-menu shortcuts and adds **WA Stay** ones. A **taskbar pin** made for the old version
  still points at the old program (`WA ParkStay Bookings.exe`): unpin it, then pin WA Stay
  again from its new shortcut.
- **Launch at login carries over.** If WA ParkStay Bookings started when you signed in, WA Stay
  does too: the old entry is replaced with one for WA Stay. The old version always started
  hidden, so **Start minimised** is turned on for you (WA Stay opens in the taskbar). Change
  either in Settings → App.
- **What carries over, and what deliberately does not.** Your watches, snipes, bookings,
  notifications, settings and email settings (including the email password, re-encrypted) all
  carry over. Two old sign-ins do not, by design: the saved ParkStay password (dropped; your
  ParkStay email is kept) and the Gmail OTP sign-in (removed). Both are explained below.
- **Your ParkStay password is no longer used.** Sign-in now happens on ParkStay's own page, in
  the app. Connect ParkStay once in **Settings → Accounts** if you like; ParkStay emails you a
  code to sign in. It is optional: watches, Site Sniper and holds all work without it. The old
  saved password is removed from WA Stay's data; only your email is kept, as a sign-in hint.
- **Gmail OTP is removed.** Nothing used it any more. WA Stay deletes any saved Gmail sign-in
  from its own data folder on start. If you used Gmail OTP in v1.x, a copy of that sign-in
  (`gmail-oauth.json`, with a still-valid access token) remains in the old v1 data folder
  (`%APPDATA%\parkstay-bookings`), which WA Stay keeps untouched as your backup; it is safe to
  delete that file. To revoke the access you gave the app, remove it from your Google account
  at <https://myaccount.google.com/permissions>.
- **Downgrading is not supported.** WA ParkStay Bookings cannot read WA Stay's data. Because
  WA Stay never changes the old folder, a reinstalled v1.2.0 would show your data as it was
  before the upgrade, and would offer the WA Stay update again.

The old folder also still holds the v1.x database with its encrypted ParkStay password until
you delete the folder ([security](security.md#legacy-v1x-secrets)).

## Updates

The installed app checks GitHub for a new version 15 seconds after it starts. When there is
one, a card at the bottom right offers **Download**; once downloaded, **Restart now** installs
it (or it installs when you next quit). **Settings → About → Check for updates** checks at any
time. Updates keep your data.

## Uninstall

**Windows Settings → Apps → WA Stay → Uninstall.** The uninstaller asks "Do you also want to
delete your WA Stay data?" (default **No**). If the old app's data folder
(`%APPDATA%\parkstay-bookings`) is still there, it asks about that separately (default **No**). An update never deletes data.

## Where WA Stay keeps things

| What | Where (Windows) |
| --- | --- |
| Data folder | `%APPDATA%\WA Stay` |
| Database | `%APPDATA%\WA Stay\wa-stay.db` |
| Logs | `%APPDATA%\WA Stay\logs` (**Settings → About → Open logs folder**) |
| ParkStay's session (cookies) | `%APPDATA%\WA Stay\Partitions\provider-parkstay` |
| The old 1.x app's data (after an upgrade) | `%APPDATA%\parkstay-bookings`, untouched |
| The program | `%LOCALAPPDATA%\Programs\WA Stay` (or the old folder after an upgrade, above) |

Problems: [troubleshooting](troubleshooting.md).
