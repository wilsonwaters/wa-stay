# Open Questions

| # | Question | Blocks | Status |
|---|---|---|---|
| Q1 | Electron 28 is end-of-life. Upgrade to a current Electron (native rebuild of better-sqlite3, re-test auto-update) as a follow-up project? | nothing in this PR | Deferred, raise at handoff |
| Q2 | The repo rename to `wilsonwaters/wa-stay` must happen **before** the v2.0.0 release is published. v1.x installs follow GitHub's redirect from `parkstay-bookings`. Never recreate a repo named `parkstay-bookings`, or the redirect breaks. | release of v2.0.0 | Stakeholder action |
| Q3 | Repo description: there is no GitHub tool available to set it. Proposed text is in PROGRESS.md for the stakeholder to paste. | nothing | Stakeholder action |
| Q4 | `MAPBOX_ACCESS_TOKEN`: the stakeholder supplied a public token on 2026-10-02 and verified it works (styles and tiles return 200). It is stored only in the gitignored `.env` and the orchestrator scratchpad. The stakeholder is adding it as a GitHub Actions repository secret. The workflow should accept `secrets.MAPBOX_ACCESS_TOKEN \|\| vars.MAPBOX_ACCESS_TOKEN`. | — | Resolved |
| PQ1 | ParkStay sign-in (Azure AD B2C): does it email a code or a magic link? | V6 runtime check | Default: support both (code typed in the window; link pasted via `accounts.openSignInLink`). **Stakeholder confirms with a real sign-in.** |
| PQ2 | The signed-in check `GET /api/profile` has not been probed with a real session. | V6 | Default: 200 with `email` = signed in, 401/403 = signed out, anything else = unknown. Stakeholder confirms. |
| PQ3 | Daily rollover instant is per campground (`release_time`, model default 10:00, e.g. Bungarra 02:00), not always 00:00 AWST. | V3 | Default: use the per-campground time when known, else 00:00 AWST. |
| PQ4 | Watch auto-hold. | V4, U1 | Resolved: implement as `autoHold` (architecture-notes §12.4). |
| PQ5 | Which hosts are allowed at the top level of the payment window. | V6 | Default: `*.dbca.wa.gov.au` plus the B2C hosts at top level; subframes unrestricted and sandboxed. Confirm with a real hold. |
| PQ6 | Minimum watch interval. | V4, U1 | Default: options 15/30/60/240/720/1440 min, default 60; legacy values below 15 are clamped when scheduled. |
| UQ1 | "Start minimised" on Windows (U4, master plan OQ8): a login launch with `--hidden` calls `minimize()` on a window that was never shown. Electron should show it minimised in the taskbar without taking focus; the sandbox only checks this on Linux (xvfb). | U4 sign-off | **Stakeholder manual check** on the `windows-artifacts` build: in Settings → App turn on "Start WA Stay when you sign in" and "Start minimised", sign out of Windows and back in. Expect a WA Stay taskbar button, no window on screen and focus left where it was; clicking the taskbar button restores the window. Then turn "Start minimised" off, sign in again: the window opens normally. Also: a v1.x upgrade that had launch at login gets "Start minimised" on (its Run value keeps `--hidden`). |

## Project 2 — RAC Parks & Resorts

| # | Question | Blocks | Status |
|---|---|---|---|
| RQ1 | Should WA Stay ask RAC in writing for a "no objection" (or an API)? It would settle the terms ambiguities (holds, the crawl delay for a person's own clicks, "third party booking" in 8.6). | nothing (not required) | Stakeholder's call; suggested |
| RQ2 | Auto-cart (R2) cannot be verified without a real cart. The stakeholder verifies it with one genuine booking of their own before switching it on. | switching R2 on | Stakeholder action after release |
| RQ3 | How pre-sale nights look in the availability response before and during a member pre-sale has not been seen. The next chances, read-only, are 3 Feb 2027 (members) and 5 Feb 2027 (public). | snipe accuracy at pre-sale | Default: treat any free night as bookable for a profile with a member number, and leave it to RAC's engine otherwise |
| RQ4 | Is WA Stay "non-commercial", and will it stay so? The RAC site terms allow only personal non-commercial use. | nothing today | Stakeholder confirms |
| RQ5 | Within 72 h of arrival, the flexible terms (lose the first night) and the booking terms (lose the deposit) disagree. | nothing | Default: the app quotes neither; it links RAC's terms |
| RS1 | Show the Experimental auto-cart switch to every user, or only in developer builds? | R17 | Resolved 2026-10-16: shown to everyone in Settings → Accounts → RAC row under "Experimental", off by default, with a warning and a confirm dialog; takes effect after a restart |
| RS10 | Do Cable Beach's school-holiday nights follow the rolling window? | R14 | Resolved 2026-10-16: yes, only the rolling 364-day window |
| RS11 | When does the member pre-sale open? | R14, R16 | Resolved 2026-10-16: at the park's own public release time (7, 8 or 9 am, Australia/Perth), 48 h before the public release |
| RS12 | What do RAC places show on Explore: category counts or site counts? | R11 | Resolved 2026-10-16, changed from the proposed category counts: free units only (e.g. "27 free", the units free for the whole stay summed over the park's categories, filtered by stay type), with no "of M" total; ParkStay keeps "N of M" |
| RS13 | RAC member number format? | R16 | Resolved 2026-10-16: digits only, kept as a string (leading zeros survive), 4–16 digits after removing spaces and hyphens; tests, fixtures and docs use made-up numbers only |
| RQ6 | Cable Beach's dry-season nights (15 May–15 Oct) open on RAC's monthly seasonal release days, not the rolling window (rac-terms §4); RS10 ("rolling only") was answered without that detail. | RAC snipes at Cable Beach | **Orchestrator default (2026-10-17):** refuse automatic release timing for Cable Beach stays inside the dry season ("choose a time you set, or set a watch"); a `scheduled` snipe or a watch still works. Stakeholder to confirm, or supply RAC's seasonal release days to encode. |
