# RI10: Docs, website and release notes

## Scope

1. **`docs/providers/rottnest/`:**
   - README: what the module does, the notice and the risk in plain words, the client's rules, and what it never does;
   - `endpoints.md`, with verification status;
   - `open-days.md`, the calendar's upkeep.
2. **Other docs:**
   - the provider guide's notice section;
   - feature docs (watches, Site Sniper, security);
   - CLAUDE.md: overview, manifest, IPC, error codes, services, guards;
   - CHANGELOG `[Unreleased]`.
3. **Website:**
   - the providers row (`data-provider="rottnest"`, "Stay Rottnest", "SR"), its colour and badge;
   - the independence notice names the Rottnest Island Authority;
   - a "Questions" answer: WA Stay checks Stay Rottnest, never books, and the person accepts a notice first.
4. **The final gate:** lint, format, type-check, test, test:tz, build:e2e, test:e2e, and the Rottnest preview.

## Notes from the build

- `docs/providers/rottnest/`: README (the module, the notice and the risk, the limits, what it never does), `endpoints.md` (one request, the pages linked, what is never used; statuses "From a browser capture, 2026-10-18", "Linked, not requested", "Known, never used"), checked by `tests/unit/docs/rottnest-endpoints-doc.test.ts`, and `open-days.md` (the Open Days, booking guides, public holidays and room types' upkeep).
- Other docs: the guide's release modes (reminder-only) and preview, Site Sniper, watches and notifications, security, the components doc, the docs and providers indexes, the root README, CLAUDE.md (overview, version 2.1.0, layout, the Stay Rottnest row, fixtures, docs tests, further reading) and the CHANGELOG (booking rules and Open Day plans; the provider and notices were already there).
- Website: the Stay Rottnest row (`data-provider="rottnest"`, "SR", `--provider-rottnest` `#9e3819`), the independence notice names the Rottnest Island Authority, and a Questions answer on notices. *Deviation:* the answer is provider-neutral ("Why does a provider ask me to accept a notice first?"), as the site's copy rule names a provider only in its row and the notice. "Coming next" now says Site Sniper reminds where a provider's terms rule out checking.
- The preview (`PREVIEW_PROVIDER=rottnest`) now accepts a provider's notice in Settings → Accounts first, as a person would; it shows 9 places, 7 available, and Thomson Bay North's 12 cabin types free.
- The place page offers "Set release reminders" only for dates not yet on sale.
