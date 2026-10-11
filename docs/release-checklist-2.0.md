# WA Stay 2.0 release checklist

The checks no CI or test suite can do for 2.0.0: a real Windows machine, a real GPU, a real
ParkStay account and the GitHub settings. They are collected from the open questions and the
review notes of the tasks that built 2.0. Work down this page in order, and note the results in
the pull request. The steps for publishing are in the [release process](release-process.md#the-200-release).

The Windows checks run on the installer of the **draft** 2.0.0 release: pushing the `v2.0.0`
tag builds it, and no installed copy sees a draft until you press Publish.

## Before you start

- A Windows 10 or 11 PC (or VM) where you can install the last 1.x release, **1.2.0**, from its
  release page, with a few watches, a booking, email settings and **Launch on startup** turned on.
- Your own ParkStay account, and a stay you genuinely intend to take for the hold test.
- The Mapbox token at hand for the repository secret.

## Before the tag

- [ ] **Rename the repository to `wa-stay`**, and never create a new `parkstay-bookings`
  repository (it would break the redirect v1.x installs update through).
- [ ] **Check the redirect:** `curl -sIL https://github.com/wilsonwaters/parkstay-bookings/releases/latest`
  and `curl -sIL https://github.com/wilsonwaters/parkstay-bookings/releases.atom` (the feed v1.x's
  updater reads) both end at a `wa-stay` URL.
- [ ] **Set the description, topics and social preview** from
  [the release process](release-process.md#repository-description-and-topics).
- [ ] **Add the `MAPBOX_ACCESS_TOKEN` repository secret** (Settings → Secrets and variables →
  Actions), a public `pk.` token.
- [ ] **The release commit is green in CI** (the `CI` workflow: format, lint, tests, `e2e` and
  `packaged-smoke`): the tag's own pipeline runs only type-check, lint, format and the unit tests.
- [ ] **Delete the merged `wip/*` backup branches** on GitHub (the git proxy could not):
  `wip/e1-explore`, `wip/e3-dates`, `wip/p7-cleanup`, `wip/u1-watches`, `wip/u2-snipes`,
  `wip/u3-bookings`, `wip/u4-settings`, `wip/u5-notifications`, `wip/v3-class-listed`,
  `wip/v4-core-scheduler`, `wip/v6-accounts-phase1`, and any later ones once merged.
- [ ] Optional: make the `e2e` check required for `main` once it has run green a few times.

## Build the candidate

- [ ] **Bump to 2.0.0 and push the tag**: release process steps
  [3 and 4](release-process.md#3-update-changelogmd) (`npm version major`, which takes 1.2.0 to
  2.0.0). Wait for **WA Stay Build and Release** to finish, then download
  `WA-Stay-Setup-2.0.0.exe` from the draft on the Releases page.
- [ ] Explore in the installed candidate shows the map (the Mapbox secret reached the build).
- If a check below fails: delete the draft release and the tag (`git push --delete origin v2.0.0`
  and `git tag -d v2.0.0`), fix it on `main`, and tag again. Nothing was published, so no
  installed copy saw it.

## Install and upgrade (Windows)

- [ ] **Fresh install** on a machine that never had v1.x: SmartScreen → More info → Run anyway;
  installs to `%LOCALAPPDATA%\Programs\WA Stay`; desktop and Start-menu shortcuts are "WA Stay";
  the app opens on Explore with the map. No `migration.json` is written.
- [ ] **Upgrade the way the updater does** over v1.2.0: quit v1.2.0 and run the draft's installer
  as v1.2.0's updater would, `WA-Stay-Setup-2.0.0.exe --updated` (add `/S` for the silent install
  that runs when the app quits with an update waiting). WA Stay starts with "Your data has moved
  to WA Stay", and the watches, booking, notifications, settings and email settings are there
  (send a test email: the password was carried over). The real auto-update is checked after
  publishing.
- [ ] **Upgrade by running the installer by hand** over v1.2.0, on a second machine or after
  reinstalling v1.2.0: same result. The program lands in
  `%LOCALAPPDATA%\Programs\WA ParkStay Bookings\WA Stay\` (an automatic update keeps
  `…\WA ParkStay Bookings\`); both work.
- [ ] **The old uninstaller's question (BQ2):** if v1.x's uninstaller asks whether to delete the
  data during the upgrade, answer **Yes** once (on a throwaway copy): WA Stay must still start
  with the data, from `%APPDATA%\WA Stay\legacy-snapshot`.
- [ ] **Automatic holds start off:** a watch that had "Enable Auto-booking" ticked in v1.2.0
  comes across with "Hold a site automatically when found" off.
- [ ] **The old data folder** `%APPDATA%\parkstay-bookings` is untouched after the upgrade
  (compare its file dates and sizes).
- [ ] **Launch at login (BQ4):** before upgrading, record the v1.x entry with
  `reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. After the first WA Stay
  start, that entry is gone and one for WA Stay is there, without `--hidden` unless Start
  minimised is on. Note the v1.x value name in the pull request.
- [ ] **Taskbar pins:** a pin made for v1.x points at the old `WA ParkStay Bookings.exe`. Check
  what it does after the upgrade, unpin it, pin WA Stay from its Start-menu shortcut, and check
  the new pin opens WA Stay (and that the running app groups under it).
- [ ] **Uninstall:** "Do you also want to delete your WA Stay data?" defaults to No; with the old
  folder present a second question names it, default No. An update never asks.

## Start minimised (UQ1)

- [ ] In Settings → App, turn on **Start WA Stay when you sign in** and **Start minimised**.
  Sign out of Windows and back in. Expect a WA Stay taskbar button, no window on screen and
  focus left where it was; clicking the taskbar button restores the window.
- [ ] Turn **Start minimised** off, sign out and in again: the window opens normally.
- [ ] A v1.2.0 install that had launch at login on gets **Start minimised** on after the upgrade
  (its old entry started hidden).

## ParkStay account and payment

These use your real ParkStay account. Place a hold only for a stay you will take, and pay for
it or let it lapse; never hold more than one booking per night.

- [ ] **Sign in with the emailed code (PQ1):** Settings → Accounts → Connect. The sign-in window
  shows ParkStay's pages; ParkStay emails a code; type it in. The window closes and the row says
  "Signed in as <your email>". If ParkStay sends a link instead, paste it under **Have a
  sign-in link?** and note this in the pull request.
- [ ] **The signed-in check (PQ2):** the account stays signed in when you reopen Settings, and
  the log shows no profile errors.
- [ ] **After a restart:** quit and reopen WA Stay. Note whether the account still shows signed
  in, and after how long it becomes signed out (ParkStay's session lasts about an hour).
- [ ] **Sign out:** the row shows signed out; your watches and bookings are untouched.
- [ ] **While the DBCA queue is active** (for example at a Ningaloo release time, or whenever
  ParkStay shows its waiting room): Connect shows the queue's page in the window and comes back
  to the sign-in page when let through; **Pay now** on a hold waits for the queue (up to a
  minute) and then opens the payment page.
- [ ] **An anonymous hold, then payment (genuine intent only):** while signed out, create a
  snipe in "When someone cancels" mode (or a watch with **Hold a site automatically when
  found**) for a stay you will take that has a free site. When it holds the site (30 minutes),
  choose **Pay now**, sign in inside the payment window when ParkStay asks, and check that the
  basket still holds the site. Pay. The snipe or watch must become **Booked** and the booking
  appear under Bookings with ParkStay's `PB` reference. Note which hosts the payment window
  visited at the top level (PQ5).

## Explore on a real GPU

- [ ] **Back from a zoomed map:** zoom Explore's map in to zoom 9 or closer (the address's
  `map=` ends in 9 or more), open a place, then press Back (and Alt+Left): Explore returns at the
  same view with the map drawn, no blank map or crash. (Under xvfb a reload into a zoomed map
  crashes software GL; a real GPU must not.)
- [ ] **The pin pulse:** with dates set, the map's availability pills pulse ("···") only while
  availability is loading, and the pulse fades out and stops once it has arrived. With Windows'
  animation effects off (reduced motion) the pills do not pulse.

## Gmail OTP removal

- [ ] On a v1.x install that used Gmail OTP: after the upgrade there is no `gmail-oauth.json` in
  `%APPDATA%\WA Stay`, while `%APPDATA%\parkstay-bookings\gmail-oauth.json` remains. Delete it,
  then remove the app's access at <https://myaccount.google.com/permissions>, and check that the
  CHANGELOG and [upgrade notes](installation.md#upgrading-from-wa-parkstay-bookings) describe
  exactly that.

## After publishing

- [ ] On a machine with v1.2.0 installed, let it update to the published 2.0.0 through the
  redirect, and check the data as above. If the update goes wrong, edit the release back to a
  draft at once: installed copies stop being offered it.
