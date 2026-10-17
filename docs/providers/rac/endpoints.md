# RAC Parks & Resorts endpoints

What the RAC provider (`src/main/providers/rac/`) sends to RAC Parks & Resorts' site, the pages
it links to, what it knows of and never uses, and how it reads RAC's codes. The code is the
source of truth: every request goes through `RacClient` (`client.ts`), and the paths below are
the ones its callers pass. Paths are on `https://parksandresorts.rac.com.au` unless they name
another host; `<slug>` is a park's path (`busselton`). The trimmed, anonymous responses the tests
use are in `tests/fixtures/providers/rac/`.

RAC's booking engine is NewBook's, served on RAC's own host: one NewBook instance per park, each
park a WordPress site of its own with a numeric site id (`blog_id`).

## Contents

- [Status legend](#status-legend)
- [Rules every request follows](#rules-every-request-follows)
- [Requests WA Stay sends](#requests-wa-stay-sends)
- [Pages WA Stay opens or links to](#pages-wa-stay-opens-or-links-to)
- [Known, never used](#known-never-used)
- [RAC's codes](#racs-codes)

## Status legend

| Status | Meaning |
| --- | --- |
| Verified live 2026-10-16 | Requested from the live site on 16 Oct 2026, anonymously and read-only; the answer's shape is recorded, trimmed to facts, in `tests/fixtures/providers/rac/`. |
| Verified live 2026-10-17 | Opened on the live site on 17 Oct 2026, anonymously and read-only (a handful of requests). |
| From RAC's page code, not exercised | Read in the scripts and markup RAC's own pages load. WA Stay's behaviour follows that code and fixtures made from it, never a live request. |
| Known, never used | On RAC's site or in its booking engine, and never requested by WA Stay. `tests/unit/docs/rac-endpoints-doc.test.ts` checks that the module's code does not name it. |

## Rules every request follows

- **One host.** Only `https://parksandresorts.rac.com.au` is asked. Redirects are followed by the
  client, by hand, on that host only, three at most. Any other address, first or by redirect, is
  refused and never sent. NewBook's own hosts are never asked by the module, and the NewBook key
  RAC's answers echo is never used.
- **One at a time, paced.** One request in flight, on the provider's own session
  (`persist:provider-rac`). The core paces them: 10 s from one request's end to the next one's
  start in the background (a watch, a snipe), 1 s for what the person starts (a place page,
  Explore's dates, "Check now"), which goes first ([pacing](README.md#pacing)).
- **Headers.** A page asks for `text/html`. The availability request sends what RAC's own page
  sends: `X-Requested-With: XMLHttpRequest` (without it RAC answers "No direct file access"),
  `Origin`, and the park's book-now page as `Referer`. The User-Agent is never set or changed:
  the app's own Chromium one goes.
- **A block stops everything.** A 403, a 429, a `cf-mitigated: challenge` header, or a 503 or 200
  page with Cloudflare's challenge in it ("Just a moment…" as its title, or `cf_chl_opt`) stops
  every RAC request for 30 minutes, doubled for each block in a row with no answer between, and
  longer when `Retry-After` asks, up to a day. The pause is kept in the provider's state, so a
  restart honours it. The detection script ordinary pages load is not a block. Nothing retries,
  and no challenge is ever answered. The log names the status only.
- **Other failures.** Any other answer that is not 2xx is an HTTP error with its status (a 5xx,
  such as Cloudflare's 520, is marked retryable, but nothing retries it in a loop). An answer
  that is not RAC's JSON is a parse error, never an empty answer.
- **Dates.** The availability request sends `6 Nov 2026` (built from the calendar date's text,
  never a `Date`); links send `2026-11-06`.

## Requests WA Stay sends

| Method | Path | Status | Sent by | What WA Stay reads |
| --- | --- | --- | --- | --- |
| POST | `/wp-content/themes/parks-and-resorts/template-parts/components/booking-engine/availability-ajax.php` | Verified live 2026-10-16 | `availability.ts` (`check`, and `categories` for the others), `bulk.ts` (one per park), `catalog.ts` (a NewBook-native park's categories) | The form RAC's book-now page posts: `blog_id`, `available_from` and `available_to` (`6 Nov 2026`), `adults`, `children`, `infants`, `animals` (the stay's pets, 0–2), `equipment_type_ids=all`, `equipment_measurement_unit=m`, and empty `equipment_length` and `equipment_width` (what RAC's page sends before equipment is chosen). No cookie, nonce or token is needed. The JSON answer has every category of the park: its id, type id, name and `sort`; per night `sites_available` (free sites), `sites_code` and `sites_message`; for the whole stay `stay_through_sites_available`, `_code` and `_message`; `online_booking_url`; and its tariffs, each with `tariff_label`, `tariff_short_description` (read only to tell a members' rate, never shown or kept), `tariff_success`, `tariff_code`, `tariff_message`, `tariff_total`, and per night `amount`, `minimum_periods`, `close_arrival` and `close_departure`. Everything else is dropped unread, the NewBook key and each tariff's cart address included. An answer takes 4–8 s and can be 400 KB; it is never cached by RAC (`no-store`). Codes: [below](#racs-codes). |
| GET | `/<slug>/book-now/` | Verified live 2026-10-16 | `catalog.ts` `getLocation` (`book-now.ts`), at the five parks on RAC's own widget | The page WordPress renders: each active category (`div.accommodation-item`) with `data-cat-id`, `data-cat-type-id`, `data-max-guests`, `data-max-animals`, `data-accessible`, `data-allowed-equipment`, its title, gallery photos (`data-src`), features and short description; the type filter's labels, the equipment names, and the dated notices (`div.booking-notification`, `data-date-from`, `data-date-to`). A page with no category is a parse error, and the place page falls back to the copy stored last. At the three NewBook-native parks (Exmouth, Karri Valley, Monkey Mia) the page lists nothing until searched, so the availability request above lists their categories instead. |

## Pages WA Stay opens or links to

Links open in the system browser.

| Method | Path | Status | Used for |
| --- | --- | --- | --- |
| GET | `/<slug>/` | Verified live 2026-10-16 | "View on RAC", and a place's "More information" (`links.location`). |
| GET | `/<slug>/book-now/?available_from=…&available_to=…&adults=…&children=…&infants=…&pets=…&membership_type=…` | Verified live 2026-10-16 | "Book on RAC" for a park and stay with no category (`links.booking`, and the check's own link): the page fills in the dates, the party and the pets, and searches them. `membership_type` is `member` while a member number is saved, else `non-member`; the number itself is never in a link. Without a stay, the bare page. Checked at Busselton; the same parameters at the NewBook-native parks are untested. |
| GET | `/<slug>/booking/?available_from=…&available_to=…&force_category_id=<id>&adults=…&children=…&infants=…&animals=…` | Verified live 2026-10-17 | "Book on RAC" for a category and stay, on the place page, in a watch's or snipe's alert and in its email: RAC's own `online_booking_url` from the availability answer when it is this page (https on RAC's host, under the park's `/booking/`, with no `cart` or `rest_api_data_id` in it), else built the same way by `links.booking` for the unit `cat:<id>`. The page shows the dates, the nights, the guests and the category, then loads its availability. Its cart stays empty: nothing is added until the person presses its book button. |
| GET | `/<slug>/contact-us/` | Verified live 2026-10-16 | Not opened by the app: each park's address and coordinates in `parks.ts` were read from it by hand. |
| GET | `/school-holiday-bookings/` | Verified live 2026-10-16 | Not opened by the app: where RAC announces its school-holiday releases, read by hand to keep the [release calendar](release-calendar.md) current. |
| GET | Photos on NewBook's image host | Verified live 2026-10-16 | A category's photos, from its book-now page's gallery, kept only when https on that host (`RAC_IMAGE_HOST` in `book-now.ts`) and loaded by the app's window as the place page shows them. Never stored, and never in the repository or on the website. |

## Known, never used

| Method | Path | Status | Why WA Stay does not use it |
| --- | --- | --- | --- |
| GET | `/locations/` | Known, never used | RAC's list of parks. The parks are a seed of facts (`parks.ts`), so the catalogue sync sends nothing. |
| GET | `/<slug>/wp-json/wp/v2/accommodation` | Known, never used | WordPress's posts for a park's categories, with RAC's descriptions and images. The book-now page has the facts the place page shows. |
| POST | `/wp-content/themes/parks-and-resorts/template-parts/components/booking-engine/get-online-cart-url-ajax.php` | Known, never used | A cart address for a category and stay. RAC's own page no longer calls it (the call is commented out), and a cart address adds the stay to a cart. |
| GET | `/<slug>/booking/?login` | Known, never used | The park's NewBook guest-account sign-in (an email address and password, behind reCAPTCHA). WA Stay needs no RAC sign-in: a member number is typed at RAC's checkout. |
| POST | `/<slug>/booking/?cart=Booking` | Known, never used | RAC's checkout form. Agreeing to RAC's terms and paying are the person's own steps, on RAC's page. |
| POST | `/<slug>/wp-content/themes/parks-and-resorts/inc/newbook/api/rac-<park>.php?newbook_api_action=data&query=extend_multiple_holds` | Known, never used | Extends a cart's hold, from RAC's cart page. WA Stay never extends one. |
| POST | `https://apiau.newbook.cloud/cc_secure/<id>` | Known, never used | Where RAC's checkout sends card details, to NewBook. WA Stay never sees or sends card details. |

## RAC's codes

`mapping.ts` reads RAC's codes for a category's nights, its whole stay and its tariffs. Counts,
codes and amounts may come as numbers or as text.

**Nights** (`sites_code` and `sites_available` per date):

| RAC | A night in WA Stay |
| --- | --- |
| 0, with free sites | Free, with its price |
| 0 with no free site, 3 or 5 | Booked |
| 2, 4, 6, 7 or 8 | Closed, with RAC's message (`sites_message`) as plain text |
| 9 | Not released yet (beyond the 364-day window) |
| 1, anything else, or no entry | Unknown |

**Tariffs.** A tariff counts when RAC accepted it for the stay (`tariff_success`) and it is
public, or it is a members' tariff and the person has saved a member number. A members' tariff is
told only by its words: its label or short description names members ("RAC Member Rate",
"Members-Only …") and not non-members ("Non-Member Rate"). Prices come from the cheapest tariff
that counts: each night's `amount` and the stay's `tariff_total`, except NewBook's placeholder
amount, `999`, which means no price. With no tariff that counts, the public "Standard Rate"
(else the first public tariff) decides why:

| Tariff code | Meaning in WA Stay |
| --- | --- |
| 6, 7, 9 or 10 | Stay rules refuse the stay (a minimum stay, or an arrival day): its free nights read "stay rules apply" |
| 2, 3, 4, 8 or 11 | Closed (a special date, a stop-sell), with RAC's message |
| 5 | Not released yet |

The tariff the prices come from (else the deciding one) gives the stay rules: `minimum_periods`
for each night (the arrival night's is the stay's minimum), and `close_arrival` and
`close_departure` as days with no arrivals or no departures.

**The whole stay** (`stay_through_sites_code` and `stay_through_sites_available`): 0 with a site
free means one site is free for every night. 0 with none, 3 or 5 is a split stay (free nights on
different sites); 2, 4, 6, 7 or 8 is closed, with its message; 9 is not released yet. A category
closed for the stay (code 2) with no night closed of its own is closed only when its tariffs
agree; otherwise its nights' own codes decide.

A stay is free only when every night is free, one site is free for all of them, a tariff counts,
and the arrival night's rules allow the stay.
