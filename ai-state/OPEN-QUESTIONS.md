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
