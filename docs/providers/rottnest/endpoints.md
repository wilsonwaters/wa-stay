# Stay Rottnest endpoints

What the Stay Rottnest provider (`src/main/providers/rottnest/`) sends to Stay Rottnest, the
pages it links to, and what it knows of and never uses. The code is the source of truth: every
request goes through `RottnestClient` (`client.ts`), which sends one path only. Paths are on
`https://bookings.stayrottnest.com` (Stay Rottnest's booking engine) unless they name another
host. The trimmed responses the tests use are in `tests/fixtures/providers/rottnest/`.

No agent has requested anything from `bookings.stayrottnest.com`. What the module knows of the
results page comes from one search captured in a person's own browser (cookies left out), and
from Stay Rottnest's public pages and documents.

## Contents

- [Status legend](#status-legend)
- [Rules every request follows](#rules-every-request-follows)
- [Requests WA Stay sends](#requests-wa-stay-sends)
- [Pages WA Stay links to](#pages-wa-stay-links-to)
- [Known, never used](#known-never-used)

## Status legend

| Status                             | Meaning                                                                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| From a browser capture, 2026-10-18 | Requested by a person in their own browser on 18 Oct 2026 and exported (cookies left out); the answer's shape is recorded, trimmed to facts, in `tests/fixtures/providers/rottnest/`. No agent requested it. |
| Linked, not requested              | A public page WA Stay opens in the person's browser. WA Stay itself never requests it.                                                                                                                       |
| Known, never used                  | On Stay Rottnest's sites, and never requested or linked to by WA Stay. `tests/unit/docs/rottnest-endpoints-doc.test.ts` checks that the module's code does not name it.                                      |

## Rules every request follows

- **One request, one path.** Only `GET /rates-room1` on `https://bookings.stayrottnest.com`,
  with only the fields Stay Rottnest's own search form sends: `hotel` (always `62607`, the
  island), `arrival`, `departure`, `rooms` (`1`), `adults[1]` and `children[1]` (children 0–17,
  infants included). Any other host, path, method or field is refused before it is sent.
- **One at a time, slowly.** One request in flight, on the provider's own session
  (`persist:provider-rottnest`). The core paces them: 60 s from one request's end to the next
  one's start in the background (watches), 1 s for what the person starts (a place page's check,
  Explore's dates, "Check now"). Every caller of the same stay and party shares one search,
  kept for 2 minutes.
- **No redirect followed.** A redirect to a waiting room is a block; any other redirect is an
  error. Nothing is followed.
- **A block stops everything.** A 403, a 429, a `cf-mitigated: challenge` header, Cloudflare's
  challenge page ("Just a moment…", or `cf_chl_opt`), or a waiting room (a redirect to Queue-it,
  or its page) stops every Stay Rottnest request for 12 hours, doubled for each block in a row
  with no answer between, and longer when `Retry-After` asks, up to 7 days. The pause is kept in
  the provider's state, so a restart honours it. Nothing retries, and no challenge or waiting
  room is ever answered.
- **Quiet on Open Day mornings.** From 5:30 am to noon Perth time on an Open Day, every request
  is refused before it is sent.
- **Headers.** The client sets only `Accept: text/html`. The session presents the app's one
  browser identity (the Chromium the app runs, this operating system, the app's languages),
  the same as its windows, never rotated or changed to get past a check. The session is never
  signed in and holds no cookie of the person's.
- **Before the first request,** the person has accepted Stay Rottnest's notice in WA Stay; until
  then the core sends nothing ([README](README.md#the-notice-and-the-risk)).
- **Logs** name the path and the status, never the query (the stay's dates and party).

## Requests WA Stay sends

| What               | Path                                                                               | Status                             | Notes                                                                                                                                                                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Results for a stay | `/rates-room1?hotel=62607&arrival=…&departure=…&rooms=1&adults[1]=…&children[1]=…` | From a browser capture, 2026-10-18 | Server-rendered HTML: every room type on the island as a card (`room-calendar-root`, `data-group`, `data-location-type`, `data-sleeps`, `data-bedrooms`), free with "from $…" for the stay, or `unavailable`. Read by `results-page.ts`; one search answers the place page, Explore and every watch. |

## Pages WA Stay links to

| What                           | Path                                                                                                  | Status                | Notes                                                                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A stay's search, at a precinct | `/rates-room1?hotel=62607&arrival=…&departure=…&rooms=1&adults[1]=…&children[1]=…&roomCategories[]=…` | Linked, not requested | "Book on Stay Rottnest", in alerts, emails and the place page: Stay Rottnest's own search, showing the precinct (`roomCategories[]` is its group). The person books from there. |
| The search, with no stay       | `/search-rates`                                                                                       | Linked, not requested | "Book on Stay Rottnest" when no dates are chosen.                                                                                                                               |
| My Booking                     | `/login`                                                                                              | Linked, not requested | "Manage on Stay Rottnest": the person's own sign-in, in their browser.                                                                                                          |
| Accommodation maps             | `https://www.stayrottnest.com/accommodation-maps`                                                     | Linked, not requested | A precinct's link: there is no page per precinct.                                                                                                                               |
| Stay Rottnest                  | `https://www.stayrottnest.com`                                                                        | Linked, not requested | The provider's website ("Open Stay Rottnest" on an Open Day plan).                                                                                                              |

## Known, never used

| What                | Path                                                   | Status            | Notes                                                                                                           |
| ------------------- | ------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------- |
| The booking step    | `/details/hotel/62607/arrival/…`                       | Known, never used | Where a room type's "Book" button posts. Never requested, opened or linked to.                                  |
| Party limits        | `/api/hotel-occupancys`                                | Known, never used | The search form's party picker loads it; WA Stay checks the party against each room type's sleeps instead.      |
| Offers              | `/offers`                                              | Known, never used | Stay Rottnest's deals.                                                                                          |
| The waiting room    | `https://*.queue-it.net/…`                             | Known, never used | Queue-it, on Open Days. A redirect to it stops every request, as a block.                                       |
| Cloudflare's checks | `/cdn-cgi/challenge-platform/…`                        | Known, never used | The page's own bot checks; never answered.                                                                      |
| Booking guides      | `https://www.stayrottnest.com/cms/stayrottnest/pdfs/…` | Known, never used | RIA's Open Day booking guides, read by a person in a browser for the booking rules ([Open Days](open-days.md)). |
