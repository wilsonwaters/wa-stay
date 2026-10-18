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
