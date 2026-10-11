# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

To be released as **2.0.0**. WA ParkStay Bookings becomes **WA Stay**: an app for finding and
booking places to stay across Western Australia, with ParkStay WA as its first provider.
Existing installs upgrade in place and keep their data (see Upgrade notes).

### Added
- **Explore**, the new home screen: every place from every provider on a Mapbox map of WA and in a list, with search, filters (provider, type, region, facilities, online booking) and results that follow the map. Without a map token it works as a list (#32).
- **Place pages**: photos, the provider's description and facilities, every site night by night with prices for your dates (with each site's description and how many people and vehicles it takes), and links to book or read more on the provider's site (#33).
- **Availability for your dates on Explore**: free-site counts on every pin and card, and an "Available only" filter (#34).
- **Providers**: a provider SDK and registry, so new accommodation sources plug in without changing the rest of the app, including sites with no API through browser automation of the installed Edge or Chrome (#19, #25). ParkStay WA is the first provider, rebuilt on it (#21). A developer guide with a quick start and compiling examples, `docs/providers/adding-a-provider.md` (#41), and `npm run provider:new`, which generates a working provider to start from.
- **Provider accounts**: sign in to ParkStay in the app, on ParkStay's own page, from Settings → Accounts; signing in is optional (#24, #38).
- **Paying for a held site in the app**: "Pay now" opens ParkStay's payment page on the session that holds the site; once ParkStay confirms the payment, the snipe or watch shows as booked and the booking appears under Bookings (#24, #36).
- **Hold a site automatically when found**, for watches on providers with holds (#22, #35). The old "auto-booking" checkbox did nothing, so it is turned off on every upgraded watch: turn on the new option per watch if you want it.
- **Site Sniper** *(coming soon)*: holds a hard-to-get site the moment it is released (a new date opening, a scheduled block release, or a cancellation), waiting in the DBCA queue when the release uses it, with one booking per night enforced across snipes and watches (#21, #22, #36).
- **Bookings** *(coming soon)*: your trips from every provider, added by hand or recorded when you pay for a hold in the app, with "Manage on ParkStay" links (#37).
- Every watch, snipe, booking and notification shows its provider, and every create flow starts by choosing one (#35, #36, #37, #39).
- Desktop notifications open the page they are about, and say which provider they are from (#39).
- Settings rebuilt: Accounts, Notifications (desktop, sound, email), App (start when you sign in, start minimised) and About (#38).
- A new logo, icons, installer art and design language (#26, #29, #30, #31).
- Automated tests of the built app, run in CI on every change, and a check of the packaged app (#40).

### Changed
- The app is now **WA Stay**: new name, icons, installer, shortcuts, emails and data folder (`%APPDATA%\WA Stay`). The repository moves to `wilsonwaters/wa-stay` (#26, #27, #28).
- The Dashboard is retired: the app opens on Explore, and the top navigation has Explore, Watches, Site Sniper and Bookings, with Settings in the account menu. There is no login screen (#31).
- **Watches**, **Site Sniper** and **Bookings** are rebuilt provider-first, with a step-by-step create flow, photos and clearer status. Site Sniper and Bookings are marked "Soon" while they are finished (#35, #36, #37).
- Watches check no more often than every 15 minutes (a provider can set a longer minimum); a watch saved with a shorter interval keeps it as an option and is run every 15 minutes (#22, #35).
- ParkStay sign-in happens in the app, on ParkStay's own sign-in page (Settings → Connect ParkStay). Connect ParkStay once in Settings; the old saved password is no longer used. Signing in is optional: holds work without it, and you can sign in on the payment page.
- Notifications, and the record of each notification email sent, are deleted automatically once they are 30 days old.
- Notification providers are now called **notifiers** (the outbound channels, such as email), so "provider" always means an accommodation source (#14).
- Email alerts name the provider in their subject (#27, #39).
- Scheduling uses precise timers instead of cron; snipes and watches re-arm after the computer wakes (#22).
- Data is stored per provider, with stay dates as calendar dates (database migrations v7–v10) (#13, #20, #24, #18).
- Built on Electron 44 (from 28) with a current Chromium, and an updated SQLite (3.53). Updates after 2.0.0 download only the parts of the installer that changed; the first update from 1.2.0 downloads in full.

### Removed
- Gmail OTP sign-in. Nothing used it any more. WA Stay deletes any saved Gmail sign-in from its own data folder on start. If you used Gmail OTP in v1.x, a copy of that sign-in (`gmail-oauth.json`, with a still-valid access token) remains in the old v1 data folder (`%APPDATA%\parkstay-bookings`), which WA Stay keeps untouched as your backup; it is safe to delete that file. To revoke the access you gave the app, remove it from your Google account at https://myaccount.google.com/permissions.
- The Dashboard, the login screen and the unused Skip The Queue feature (#18, #31).
- The fake "cancel booking" action: "Manage on ParkStay" opens ParkStay's own bookings page instead (#22, #37).

### Fixed
- Site Sniper, new in this release, was fixed before its first release: it sent dates in a format ParkStay rejects, could not read ParkStay's availability, and its checks could overlap and place more than one hold. Each snipe now has one timer chain and one check at a time, checked against the live site (#21, #22).
- Watch prices were always 0, so a maximum price never worked; prices now come per night from ParkStay (#21, #22).
- The record of notification emails, broken by an unreleased database change after 1.2.0, is repaired by migration v7 (#13).
- Watches with short intervals ran only hourly, and the stored next check was ignored (#22).
- Two copies of the app could run at once on the same data (#15).
- The DBCA queue could crash the app with an unhandled error and could not be cancelled (#21).
- Logging out deleted every watch, booking and snipe (the local profile); nothing can delete it now (#14).
- "Open logs folder" opened an empty folder (#15).
- Times were shown 8 hours out in Perth for some saved records (#39).

### Security
- Stored secrets are encrypted with the operating system's own encryption (Electron `safeStorage`: Windows DPAPI, the macOS Keychain or a Linux keyring) instead of keys derived from constants in the code; v1.x secrets are re-encrypted once (#16).
- The old ParkStay password is removed from the database file, and its freed pages are overwritten (#24).
- The installed app is locked down with Electron fuses: it cannot be run as a plain Node.js runtime or with a debugger attached, loads its code only from its own integrity-checked archive, and encrypts its cookies on disk. The app window refuses every browser permission except writing to the clipboard (for "Copy").
- Dependencies with known vulnerabilities are updated: nodemailer, sanitize-html and the YAML parser the updater uses.
- Secrets are never sent to the window: the email password is write-only (#15).
- The window is sandboxed with a bundled preload, a Content-Security-Policy, blocked navigation and new windows, and checks that every request comes from the app's own page (#14, #15, #17).
- Provider sign-in and payment windows show only the provider's own pages, sandboxed, with no app script, an allow-list of sites, and every permission and certificate error refused (#24).
- Provider descriptions are sanitised before display, and their links open in the browser (#23, #33).
- Logs never carry passwords, cookies, sign-in links or the DBCA queue key (#15).

### Upgrade notes
- **Automatic.** WA ParkStay Bookings 1.x updates itself to WA Stay (or run the new installer). On the first start your watches, snipes, bookings, notifications, settings and email settings are copied to `%APPDATA%\WA Stay`. The old folder, `%APPDATA%\parkstay-bookings`, is kept untouched as a backup; it is safe to delete once you have checked everything is there (#27, #28).
- **What does not carry over.** Two old sign-ins, by design: your saved ParkStay password (dropped; your ParkStay email is kept as a sign-in hint) and the Gmail OTP sign-in (removed, see Removed). Connect ParkStay once in Settings → Accounts if you like: ParkStay emails a code. It is optional (#24, #18).
- **Shortcuts** are renamed to WA Stay. A taskbar pin made for the old version points at the old program (`WA ParkStay Bookings.exe`): unpin it and pin WA Stay again (#27).
- **Install folder.** An automatic update keeps the old program folder (`%LOCALAPPDATA%\Programs\WA ParkStay Bookings\`); running the installer by hand installs into a `WA Stay` subfolder of it. Both work (#27).
- **Automatic holds start off.** A watch that had the old "auto-booking" box ticked comes across with "Hold a site automatically when found" off, because the old box never did anything. Turn it on per watch if you want WA Stay to hold sites for you (#22, #35).
- **Launch at login** carries over to WA Stay, with "Start minimised" turned on, as the old version always started hidden (#28, #38).
- **Downgrading** to WA ParkStay Bookings is not supported.

## [1.2.0] - 2026-05-18

### Added
- Watches UI: partial match indicator highlights sites/dates that only meet some search criteria (#5)

### Fixed
- Watch results now show real site labels and only the dates that are actually available (#9)
- Launch on startup no longer registers in dev mode — previously the dev electron.exe was added to Windows startup, which launched the generic Electron welcome screen instead of the app (#10)
- Auto-update no longer 404s on Windows artifact lookups — installer/blockmap names are now hardcoded so electron-updater can find them (#8)

## [1.1.0] - 2026-04-12

### Added
- Launch on startup setting with option to start minimised to system tray
- `/release` Claude command for automated release workflow

### Fixed
- Queue API types aligned with live DBCA queue response format

### Changed
- Release process documentation updated with branch freshness check

## [1.0.0] - 2026-02-10

### Added
- **Watch System**: Monitor campground availability with configurable intervals, desktop/email notifications, and optional auto-booking
- **Queue Handling**: Automatic detection and handling of the DBCA queue system with session persistence
- **Gmail OTP Integration**: OAuth2-based Gmail integration for automatic OTP code extraction from ParkStay emails
- **Email Notifications**: SMTP-based email notification provider with encrypted configuration
- **Notification Center**: In-app notification bell with read/unread tracking and desktop notifications
- **Dashboard**: Overview of active watches, recent activity, and system statistics
- **Credential Security**: AES-256-GCM encryption for all stored credentials, derived from machine-specific ID
- **Settings Page**: Full settings with account, Gmail, notification, app, and advanced configuration tabs
- **About Dialog**: Application info, system details, and quick links (GitHub, issues, logs)
- **Auto-Updates**: In-app update notifications with download progress and restart-to-update flow via GitHub Releases
- **Portable Build**: Standalone .exe that runs without installation

### Security
- Context isolation enabled, node integration disabled in renderer
- IPC messages validated with Zod schemas
- All credentials encrypted at rest with AES-256-GCM
- No telemetry, no cloud dependencies, all data stored locally in SQLite

### Notes
- Bookings import and Skip The Queue pages are included but disabled in the UI (coming in v1.1.0)
- Windows x64 only for this release; macOS and Linux support planned
