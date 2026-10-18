# RI13: Checks with RIA's written consent (design notes, not scheduled)

## Status

**Not scheduled.** This task exists only if RIA answers the request in `ai-state/research/rottnest-terms.md` Appendix A (decision T2) with **written consent**. RIA's letter then becomes part of that file, and its limits become rules there (terms rule 13). Until then nothing here is built, and no code anticipates it beyond what RI1–RI10 need for themselves.

These notes exist so a "yes" from RIA turns into work quickly, and so the reminder features are built in a way this can extend.

## What consent might cover, and what it would change

| RIA consents to | What WA Stay would build | Changes |
| --- | --- | --- |
| **(e) A check on the person's click** | The place page's "Check availability" for Rottnest: one search for the stay, shown night by night by unit type | `integration` becomes `'api'` (or a new `'on-click'` value: background requests refused by the HttpClient, interactive ones allowed, a natural extension of RI1's refusing client); `availability` on; `bulkAvailability` off (fan-out is not a click) |
| **(f) A notify-only background watch at a stated frequency** | Look reminders become real watches: a check at each hotspot, and at the person's cadence no more often than RIA allows. They alert with the booking link and never hold | `watches` in polling mode; `limits.minWatchIntervalMinutes` = RIA's figure (the request offers 30). Hotspots (RI10) set *when* to check, so the same timing model serves both modes |
| **An official feed or interface (option E)** | Whatever it provides, through its own documented API | A new review of its terms |

**Never, whatever the consent says unless it names them expressly:**

- holds, carts, bookings;
- the waiting room, the SMS passcode;
- Open Day polling;
- Explore fan-out.

## Technical notes for that day

- **The site:**
  - P3 Hotel Software's engine on `bookings.stayrottnest.com`, behind Cloudflare Bot Management;
  - its robots.txt allows only `/search-rates` and `/offer(s)`;
  - a plain HTTP client was challenged on the home page.

  So the consent should say how WA Stay identifies itself (a User-Agent naming WA Stay and its version) and whether RIA will exempt it. WA Stay must never solve a challenge (terms rule 4).
- **The client:** an RAC-style client (`src/main/providers/rac/client.ts`):
  - one host, one request at a time;
  - RIA's minimum gap;
  - a 403, 429 or challenge stops every request for a cool-down that doubles;
  - a block ends a snipe and is recorded on a watch (`isProviderBlock`).
- **The request shape is unknown today.** It needs a person's browser session (devtools, HAR export, trimmed) to record, anonymously, the request the search page makes. Recording it is the first step, done by the stakeholder by hand, not by an agent (rule 6).
- **Fixtures:** trimmed, made-up prices or none, no personal data, and no RIA photos or copy (as RAC's).
