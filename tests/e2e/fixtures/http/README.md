# Provider HTTP fixtures (Electron smoke tests)

In fixture mode (`WA_STAY_E2E_FIXTURES_DIR`, set by the harness to this folder) no provider
request reaches the network. Each provider's `HttpClient` is a `FixtureHttpClient`
(`src/main/testing/fixture-http-client.ts`) that answers from the files here. Fixture mode is
test-only: a packaged app never enters it.

## Layout

One folder per provider id, each with a `manifest.json` and the response files it names:

```
http/
└── parkstay/
    ├── manifest.json
    ├── campground_map.json      # the catalogue the app syncs 5 s after launch (V5), Explore's places (E1)
    ├── campground_availabilty_view.json   # every campground's free sites for any stay, Explore's dates (E3)
    ├── campsite_availablity_view_20.json  # Bungarra's sites and description, for its detail page (E2) and a new watch's first check (U1)
    ├── campground_page_20.html  # Bungarra's campground page: its About's notices and sections (E2, PD2)
    ├── profile-signed-out.json  # /api/profile signed out (403), the account check at launch (V6)
    └── queue-active.json        # the DBCA queue letting the session through, before a payment window (V6)
```

A provider with no folder, or no routes, answers every request with an error.
`npm run provider:new -- <id>` writes a sample folder for a new API provider, to replace with
its recorded responses ([adding a provider](../../../../docs/providers/adding-a-provider.md#quick-start)).

**This manifest and the Jest one differ on purpose.** The scaffold also writes
`tests/fixtures/providers/<id>/manifest.json` for the provider's Jest tests. That one answers an
unknown place with a 404 (`not-found.json`), which the contract suite and the mapping test ask
for, and a `search` catalogue's name search there answers only `text=Banksia`, so a test proves
the provider sends the text. The app never asks for that unknown place, and a person types any
name, so the folder here has no 404 routes and its name search answers any text.

**A provider with an account** (any `account` but `none`) needs a route for its signed-in check
(the request its `isSignedIn` sends), answered as for a person who is signed out: ParkStay's is
`profile-signed-out.json`. The app checks every account 5 s after launch and whenever Settings →
Accounts opens; without the route the request is refused and logged, and the preview spec
(`tests/e2e/preview-provider.spec.ts`) fails, naming it.

## Manifest

```json
{
  "routes": [
    { "method": "GET", "path": "/api/campground_map/", "file": "campground_map.json" },
    {
      "method": "GET",
      "path": "/api/campground_availabilty_view/",
      "query": { "gear_type": "all" },
      "file": "availability.json"
    },
    { "method": "GET", "path": "/queue", "status": 200, "file": "queue.html", "contentType": "text/html" }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `method` | `GET`, `HEAD`, `POST`, `PUT`, `PATCH` or `DELETE`. |
| `path` | The URL path, exactly, trailing slash included. The host is not compared. |
| `query` | Optional. Every parameter listed must have exactly this value; parameters not listed may have any value. Without `query`, any query string matches. |
| `status` | Optional, default 200. |
| `file` | The response body, relative to the provider's folder. |
| `contentType` | Optional. Defaults from the extension: `.json` → `application/json`, `.html` → `text/html`, anything else → `text/plain`. |

The first matching route wins, so put specific routes (with `query`) before general ones.

A request that no route matches is not sent. It fails with `no fixture for GET <url>; add a
route to <manifest>`, and is appended to `<userData>/e2e-unexpected-requests.log`. A failed
test attaches that log as `unexpected-requests`, which lists exactly the routes to add.

## Provenance and rules

- Only responses from providers' **public** endpoints, recorded without signing in. Never a
  cookie, token, booking, email address or other personal detail.
- Trim each response to the smallest set the journeys need (for ParkStay's catalogue, 8
  campgrounds covering `campground_type` 0, 1, 2 and 4, at least 3 regions, with images and
  features), so a fixture stays readable in review.
- Test data only. Nothing under `tests/` is packaged (`electron-builder.json` ships `dist/`),
  and the app always fetches ParkStay data and images live at runtime (brief O8). Image URLs in
  a fixture are never loaded: the network guard cancels them, and the app shows its fallback.
- **ParkStay** (`parkstay/`): the catalogue, because the app syncs it 5 s after the window is
  up (V5). `campground_map.json` answers `GET /api/campground_map/` with the trimmed public
  sample probed on 2026-10-02 (`ai-state/research/parkstay-api-review.md`): the 6 campgrounds
  the Jest suite uses (`tests/fixtures/parkstay/`, unchanged and first) plus 5 more for the
  Explore journey (E1), 11 in all. They cover `campground_type` 0 (5), 1 (2), 2 (3) and 4 (1)
  across 8 regions (Pilbara, Kimberley, South Coast, Goldfields, Midwest, South West, Swan,
  Warren), each with its images and features, and at most 3 campsites.
  `campground_availabilty_view.json` answers Explore's bulk availability (E3) for any dates, in
  ParkStay's shape (`api.py`: `total_available` is a campground's site count, `total_bookable`
  the sites free every night, both 0 past the 180-day horizon; the provider maps them the other
  way round, to WA Stay's `bookableUnits` and `availableUnits`), sized to those 3 campsites:
  Bungarra 2 free, Lucky Bay 3, Workmans Pool 1, Kurrajong full, Temple Gorge not open, and no
  totals for the campgrounds not bookable online.
- **ParkStay, E2 and U1**: `campsite_availablity_view_20.json` is the Jest fixture
  `tests/fixtures/parkstay/campsite_availablity_view_20.json` (the public per-campground view
  for Bungarra, campground 20), copied unchanged; it answers Bungarra's detail page and a new
  watch's first check, for any dates. `profile-signed-out.json` is Django REST Framework's standard 403
  body for `GET /api/profile` without a session, which the account service's startup check (V6)
  sends 5 s after launch; it is written by hand, not recorded, and holds no personal data.
- **ParkStay, the campground page** (PD2): `campground_page_20.html` is the Jest fixture
  `tests/fixtures/parkstay/campground_page_20.html`, copied unchanged: Bungarra's public
  campground page (`/search-availability/campground/?site_id=20`, fetched with the ParkStay
  `Referer` on 10 Oct 2026, no sign-in), trimmed to its notices, one search box,
  `#campground-details` and its own scripts. Its route matches `site_id=20` only (`query`);
  the host and the `Referer` are not compared. It holds no queue key or personal detail; the
  DBCA office contact links in it are public.
- **ParkStay, the DBCA queue** (Q1 phase 2): `queue-active.json` is the Jest fixture
  `tests/fixtures/parkstay/queue-active.json`, copied unchanged: an `Active` answer to
  `queue.dbca.wa.gov.au`'s `GET /api/check-create-session/` (`queue_group=parkstayv2`; the host
  is not compared). "Pay now" passes the queue before it opens the payment window, so the
  held-snipe journey needs it; its session key is made up.

## Refreshing a fixture

When a provider's response format changes, the journey that uses it fails at the parse step
and names the route. To refresh:

1. Fetch the endpoint once, politely: a browser user agent, the provider's own `Referer` (for
   ParkStay `https://parkstay.dbca.wa.gov.au/`), and one request, not a crawl.
2. Trim it as above, keeping the same ids where the specs rely on them.
3. Save it over the old file, update `manifest.json` if the path or query changed, and note
   the date here.
4. Run `npm run build:e2e && xvfb-run -a npm run test:e2e`, and the provider's Jest tests.
