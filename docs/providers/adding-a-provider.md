# Adding a provider

A **provider** is a module that brings one accommodation source into WA Stay: ParkStay WA
today, RAC Parks & Resorts next, perhaps Hipcamp or a holiday-park chain later. This guide
takes you from nothing to a provider that shows up on Explore, in the create flows and in
Settings, with tests. You change nothing in the core services, the IPC contract or the
renderer: they find providers through the registry and read what each one can do from its
manifest.

Start with the [quick start](#quick-start): one command generates a working provider to fill
in. The rest of the guide is the reference. If you are an AI agent, follow the checklist in
[CLAUDE.md, "Adding a provider"](../../CLAUDE.md#adding-a-provider) (the `/add-provider`
command walks you through it), and use this guide for the detail.

Two worked examples run through the guide. Both are real, compiling providers in the test
tree:

- **Example Parks** (`tests/fixtures/providers/example-api/`), an **API provider**: JSON over
  `ctx.http`, with holds (`holds.ts`) and a sign-in (`auth.ts`).
- **Example Holiday Parks** (`tests/fixtures/providers/example-browser/`), a **browser
  provider**: a website with no API whose availability appears only after a search form's
  script runs, read through `ctx.browser`.

Every code block marked as coming from one of those files is a word-for-word copy of a region
of it. `tests/unit/docs/docs-sync.test.ts` fails if they drift, and
`tests/unit/docs/example-providers.test.ts` compiles the examples under the main process's
`tsconfig.json`, registers them in a fresh `ProviderRegistry`, runs the provider contract suite
on them, and tests their mapping, holds and sign-in.

ParkStay (`src/main/providers/parkstay/`) is the full-size reference: an access gate, a release
policy, holds, payment and sign-in. See [the ParkStay provider](parkstay/README.md).

## Contents

- [Quick start](#quick-start)
- [Words](#words)
- [Before you start](#before-you-start)
- [How a provider plugs in](#how-a-provider-plugs-in)
- [1. The folder](#1-the-folder)
- [2. The manifest](#2-the-manifest)
- [3. The provider context](#3-the-provider-context)
- [4. An API provider](#4-an-api-provider)
- [5. A browser provider](#5-a-browser-provider)
- [6. Holds](#6-holds)
- [7. Sign-in](#7-sign-in)
- [8. Other optional modules](#8-other-optional-modules)
- [9. Timeouts, failures and retries](#9-timeouts-failures-and-retries)
- [10. Register it](#10-register-it)
- [11. Test it](#11-test-it)
- [12. Preview in the app](#12-preview-in-the-app)
- [What the app does with it](#what-the-app-does-with-it)
- [Checklist](#checklist)

## Quick start

1. **Generate the provider.** Pick an id: 2–32 lower-case letters, digits or hyphens, starting
   with a letter. It is stored in every watch and booking, so it never changes.

   ```bash
   npm run provider:new -- acme-parks              # an API provider: JSON over ctx.http (the default)
   npm run provider:new -- acme-parks --browser    # a website with no API, read in a browser
   npm run provider:new -- acme-parks --search     # a catalogue too big to list: searched by map area and name
   npm run provider:new -- acme-parks --name "Acme Parks & Resorts"   # a display name of your own
   ```

   It writes these files, adds the provider to `BUILT_IN_PROVIDERS` (`--no-register` prints
   the lines instead), and prints the next steps:

   | File                                               | What it is                                                                                                       |
   | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
   | `src/main/providers/acme-parks/manifest.ts`        | The manifest, every capability spelled out and commented                                                         |
   | `src/main/providers/acme-parks/index.ts`           | The factory and the modules: catalogue, availability, links                                                      |
   | `src/main/providers/acme-parks/mapping.ts` (API)   | The API's raw shapes (zod) and their mapping to the SDK's types                                                  |
   | `src/main/providers/acme-parks/pages.ts` (browser) | The site's paths, selectors and labels, the page functions and their mapping                                     |
   | `tests/integration/acme-parks-provider.test.ts`    | The [contract suite](#the-contract-suite) and mapping tests                                                      |
   | `tests/fixtures/providers/acme-parks/`             | Sample responses for Jest (API), or a made-up site for the [fake browser](#a-browser-provider-without-a-browser) |
   | `tests/e2e/fixtures/http/acme-parks/` (API)        | The responses the app answers from in [fixture mode](#the-electron-smoke-tests)                                  |

   As generated, it passes lint, format, type-check, `npm test` and the e2e suite, and it
   never contacts a real site: its addresses start empty, and until you set them every call
   fails with a `ProviderError` such as "Acme Parks is not set up yet: set ACME_PARKS_API_URL
   in src/main/providers/acme-parks/index.ts". The sample data uses `.invalid` and `.test`
   hosts, which never resolve.

2. **Fill in the API calls.** Work through every `TODO`: the addresses, the request paths and
   parameters, the raw shapes and the provider's words (kinds of place, night states). Record
   a few of the provider's public responses, without signing in, trim them, and put them in
   `tests/fixtures/providers/acme-parks/` with their routes in its `manifest.json`
   ([recorded responses](#recorded-responses-fixturehttpclient)); copy the ones the app needs
   into `tests/e2e/fixtures/http/acme-parks/`, with a signed-out answer for the signed-in check
   if it has an account ([the Electron smoke tests](#the-electron-smoke-tests)). Update the
   expectations in the generated test to match. A browser provider gets a trimmed copy of the
   site's markup in `site.ts` instead.

3. **Run its tests**: the contract suite and the mapping.

   ```bash
   npx jest tests/integration/acme-parks-provider.test.ts
   ```

4. **Preview it in the app**, network-free, on its recorded responses
   ([preview in the app](#12-preview-in-the-app)):

   ```bash
   npm run build:e2e
   npx cross-env PREVIEW_PROVIDER=acme-parks playwright test preview-provider
   ```

   On Linux without a display, put `xvfb-run -a` in front of the second command. It checks that
   Explore lists the provider's places; with dates (two nights from tomorrow, or from
   `PREVIEW_ARRIVAL=YYYY-MM-DD` for dates its responses cover), that Explore shows its free
   counts (with `bulkAvailability`) and that a place's "Check availability" answers; and that
   Settings → Accounts shows it, with a screenshot of each in the report
   (`npx playwright show-report`). A browser provider is previewed by hand instead
   ([browser providers](browser-providers.md#preview-in-the-app)).

5. **Register it and run everything.** The scaffold has added it to `BUILT_IN_PROVIDERS`
   ([register it](#10-register-it)). Before you call it done, the whole gate passes:

   ```bash
   npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz
   npm run build:e2e && npm run test:e2e        # Linux: xvfb-run -a npm run test:e2e
   ```

   **Done** means: the provider's own tests and the full suite pass, it shows on Explore in the
   preview, no `TODO` is left, its terms of use allow what it does, and no test or trial run
   placed a real hold, booking or payment or reached the live site.

## Words

The same words are used in code, the database and the UI:

| Word | Meaning | ParkStay |
| --- | --- | --- |
| Provider | An accommodation source module, with an id such as `parkstay` | ParkStay (DBCA) |
| Location | A bookable place shown on the map | A campground |
| Area | A location's parent grouping: park, town or region | A park, and its region |
| Unit | An individually bookable thing at a location: site, cabin, room | A campsite (or a class of sites) |
| Stay | Dates (`arrival`, `departure`, calendar dates `YYYY-MM-DD`) and party | |
| Watch | A recurring availability check that alerts | |
| Snipe | A timed attempt to hold a unit the moment it is released (Site Sniper) | |
| Hold | A temporary reservation that the person pays for on the provider's site | A 30-minute booking |
| Location key | `${providerId}:${externalId}`, unique across providers | `parkstay:20` |

## Before you start

- **Read the provider's terms of use** and record what they say about automated access in
  your module's header comment. If they forbid it, the provider can still be listed with links
  only, but not automated.
- **Prefer an API.** Open the site's network panel: many "no API" sites load their data from
  JSON endpoints `ctx.http` can call. Use browser automation only when there is none
  ([browser providers](browser-providers.md)).
- **WA Stay acts for one person**, for stays they mean to take: one account per person, one
  booking per night, holds only in their own name, payment always by the person on the
  provider's site. Your module must keep to that.
- **Be polite.** Ask for what the person's action needs, at the pace one careful person would.
- **Never place a real hold, booking or payment** in a test or a trial run, and never point a
  test at the live site. Tests run on recorded responses or a made-up site; a live check is
  anonymous, read-only and a handful of requests at most.

## How a provider plugs in

1. Your folder exports a `ProviderFactory`, made with `defineProvider(manifest, create)`.
2. `src/main/providers/index.ts` lists it in `BUILT_IN_PROVIDERS`.
3. At start-up the composition root (`src/main/app/container.ts`) registers every factory in
   the `ProviderRegistry`. For each one the registry validates the manifest, builds the
   provider's `ProviderContext` from it, calls `create(ctx)`, and checks that every capability
   the manifest claims has its module.
4. Core services (`src/main/core/`) only ever ask the registry: `registry.withCapability('watches')`,
   `registry.require(id, 'holds')`. A capability that is not there is a typed
   `ProviderCapabilityError` (IPC code `CAPABILITY`), never a crash.
5. The renderer reads the manifests through `providers.list()` and renders generically:
   provider pickers, badges, stay fields, release modes. It contains no per-provider code.

A provider that fails to register is logged and skipped; the app starts with the others.

## 1. The folder

Everything specific to your provider lives in `src/main/providers/<id>/`, never in `core/`,
`shared/` or the renderer. The scaffold starts you with `manifest.ts`, `index.ts` and
`mapping.ts` (API) or `pages.ts` (browser). As it grows, ParkStay's layout is a good model:

```text
src/main/providers/<id>/
├── index.ts         # the factory (defineProvider)
├── manifest.ts      # the manifest
├── client.ts        # every request: headers, dates in the provider's format, error mapping
├── catalog.ts       # locations → LocationSummary / LocationDetail
├── availability.ts  # nights → NightStatus
├── holds.ts, auth.ts
├── links.ts         # the provider's own pages
└── types.ts         # raw response shapes; never exported to shared/
```

Inside `src/main/providers/<id>/` you import the SDK as `../sdk`, as ParkStay does. The
examples live in the test tree, so they use the `@main` alias, which works in both places.

## 2. The manifest

The manifest says who the provider is and what it can do. It is plain data, it crosses IPC to
the renderer, and the registry validates it with `ProviderManifestSchema`
(`src/shared/types/provider.types.ts`), then freezes it.

<!-- region: tests/fixtures/providers/example-api/index.ts#api-manifest -->

```ts
export const exampleApiManifest: ProviderManifest = {
  id: 'example-api',
  name: 'Example Parks WA',
  shortName: 'Example Parks',
  description: 'Campgrounds and cabins from the Example Parks booking API.',
  website: 'https://www.example-parks.test',
  integration: 'api',
  // A coloured monogram badge: never a third-party logo. White text on it must pass AA.
  brand: { color: '#1F5A7A', monogram: 'EP' },
  locationKinds: ['campground', 'cabin', 'other'],
  timezone: 'Australia/Perth',
  currency: 'AUD',
  capabilities: {
    catalog: true,
    catalogMode: 'full',
    availability: true,
    bulkAvailability: true,
    watches: true,
    snipes: false,
    // Holds (holds.ts), and an account that helps but is never needed (auth.ts).
    holds: true,
    bookingImport: false,
    accessGate: false,
    account: 'optional',
  },
  limits: { minWatchIntervalMinutes: 30, maxConcurrentRequests: 2, catalogTtlHours: 24 },
  stayFields: [
    {
      key: 'siteType',
      label: 'Site type',
      type: 'select',
      options: [
        { value: 'any', label: 'Any' },
        { value: 'powered', label: 'Powered' },
        { value: 'unpowered', label: 'Unpowered' },
      ],
      default: 'any',
      appliesTo: ['availability', 'watch'],
    },
  ],
  // The bulk endpoint reads only the dates: a change of party or site type reuses its answer.
  bulkAvailabilityStayFields: ['arrival', 'departure'],
};
```

| Field | Rules |
| --- | --- |
| `id` | 2–32 lower-case letters, digits or hyphens, starting with a letter. It is stored in every watch, snipe, booking and notification, so it never changes. |
| `name`, `shortName` | Shown in pickers and badges. `shortName` (at most 24 characters) also prefixes desktop notifications: "Example Parks · …". |
| `description` | One line, shown in the provider step of the create flows. |
| `website` | An https URL. |
| `integration` | `api`, `browser` or `hybrid` ([choosing](browser-providers.md#choosing-api-browser-or-hybrid)). |
| `brand` | `color` as `#RRGGBB` and a `monogram` of 1–3 capitals or digits: the `ProviderBadge`. Never a third-party logo. Check that white text on the colour passes WCAG AA. |
| `locationKinds` | The `LocationKind`s your locations can have, at least one ([the list](#location-kinds)). Every location's `kind` must be one of them. |
| `timezone` | The IANA zone the provider's dates and release times are in. The context gives it to you as `ctx.timezone`. |
| `currency` | ISO 4217, e.g. `AUD`. Prices in `NightStatus.price` are in it. |
| `capabilities` | What the provider can do ([below](#capabilities)). |
| `limits` | How hard the app may use it ([below](#limits)). |
| `stayFields` | Provider-specific stay inputs ([below](#stay-fields)). |
| `releaseModes` | Site Sniper's release modes, when `capabilities.snipes` ([below](#release-modes)). |
| `bulkAvailabilityStayFields` | What bulk availability depends on ([below](#bulk-availability-stay-fields)). |

### Location kinds

`locationKinds` comes from a fixed list (`LOCATION_KINDS` in `src/shared/types/provider.types.ts`).
A place's kind sets its label and what its units are called on Explore's cards and the place
page ("2 of 6 cabins available"):

| Kind | Shown as | Its units are called |
| --- | --- | --- |
| `campground` | Campground | sites |
| `caravan-park` | Caravan park | sites |
| `holiday-park` | Holiday park | sites |
| `cabin` | Cabin | cabins |
| `hut` | Hut | bunks |
| `glamping` | Glamping | tents |
| `farm-stay` | Farm stay | rooms |
| `home` | Home | rooms |
| `other` | Place to stay | units |

Map the provider's own words to these with an explicit table, and a word you do not know to
`other` (so keep `other` in `locationKinds`).

### Capabilities

Each flag turns on a part of the app. The registry refuses a provider whose flag has no module
behind it (`CONSISTENCY_RULES` and `MANIFEST_RULES` in `src/main/providers/registry.ts`).

| Capability | Needs | Turns on |
| --- | --- | --- |
| `catalog` | `catalog.getLocation`, and `listLocations` or `searchArea` per `catalogMode` | Explore's map and list, a location's detail page |
| `catalogMode` | `full`: `catalog.listLocations`; `search`: `catalog.searchArea` (and optionally `catalog.searchText`) | `full`: the whole catalogue is synced every `catalogTtlHours` and searched offline. `search`, for a marketplace too big to list: the app asks `searchArea` for the area Explore's map shows (all of WA when there is no map), at most 5 pages an area, and `searchText` for a name typed in Explore's "Where" or a watch's location step; what it finds is stored and works like a synced place, and each area or text is asked at most once per `catalogTtlHours` ([how the app uses it](browser-providers.md#search-mode-catalogues-catalogmode-search)). |
| `availability` | `availability.check` | "Check availability" on a location's page |
| `bulkAvailability` | `availability.search` | Free-unit counts on Explore's pins and cards, "Available only" |
| `watches` | `availability.check` | The provider in Watches |
| `holds` | `holds.create` and `holds.paymentUrl` | "Hold a site automatically when found" on watches, and the payment window ([holds](#6-holds)) |
| `snipes` | `availability`, `holds` and `release`, plus at least one release mode that `release.supports()` accepts | The provider in Site Sniper |
| `bookingImport` | `bookings.get` | "Import booking" on the Bookings page |
| `accessGate` | `access` | Queue handling and the access-status chip; required by any release mode with `usesAccessGate` |
| `account` | `auth` unless `none` | A row in Settings → Accounts ([sign-in](#7-sign-in)) |

`account` says how much the provider needs the person signed in:

| `account` | Meaning |
| --- | --- |
| `none` | No account. Settings shows "No account needed". |
| `optional` | Signing in helps (a quicker checkout) but nothing waits on it. ParkStay and Example Parks are `optional`: their holds need no sign-in. |
| `required-for-holds` | Holds need it: a snipe created signed out stays paused, and a hold attempt is refused with `AUTH_REQUIRED` until the person connects. |
| `required` | Everything needs it. |

### Limits

`limits` is optional; without it the provider gets `DEFAULT_PROVIDER_LIMITS` (15, 4, 24). The
context gives the effective values as `ctx.limits`.

| Limit | What reads it |
| --- | --- |
| `minWatchIntervalMinutes` | The watch form offers no shorter interval, and the scheduler runs a shorter stored one at this interval (`core/watches/next-check.ts`). |
| `maxConcurrentRequests` | The watch loop runs at most `min(2, maxConcurrentRequests)` checks at once for the provider, and a `search` catalogue's area searches stay within it. **Your module enforces it for every request it sends**, with `createLimiter` from the SDK: Example Parks sends its catalogue, availability, hold and sign-in check requests through one limiter, reading each answer inside it, and the scaffold's API provider limits its requests the same way. A browser provider's `withPage` calls already run one at a time. |
| `catalogTtlHours` | How long a synced catalogue stays fresh before the catalogue service syncs it again; for a `search` catalogue, how long an area or text search is not repeated. |

A browser provider should use `maxConcurrentRequests: 1` and generous intervals.

### Stay fields

`stayFields` are inputs a stay needs beyond dates and guests, such as gear type, vehicles or a
postcode. The renderer draws them generically (`components/stay/ProviderStayFields.tsx`);
values travel in `StayQuery.params` and are stored in `stay_params`. Main validates them
against the descriptor (type, options, `min`/`max`, `pattern`, `required`) and fills defaults
(`core/stay-params.ts`); an invalid value is a `VALIDATION` error on `stayParams.<key>`.

| `type` | Drawn as | Its value in `params` | Checked against |
| --- | --- | --- | --- |
| `select` | A select of its `options` (at least one, each `{ value, label }`) | The chosen option's `value`, a string | `options` |
| `number` | A stepper | A number | `min` and `max` |
| `text` | A text field | A string | `pattern`, a regular expression the whole value must match |
| `boolean` | A checkbox | `true` or `false` | |

A `default` must be a value of the field's type, or the manifest is refused; `required` makes
a form that shows the field refuse it empty.

`appliesTo` says which forms show the field:

| `appliesTo` | Where the field shows |
| --- | --- |
| `watch` | The watch form. |
| `hold` | A watch's "Hold a site automatically" section, and Site Sniper's stay step. |
| `snipe` | Site Sniper's stay step. |
| `availability` | Nowhere yet. The place page's "Check availability" and Explore's bulk availability send no stay fields at all. |

So `availability.check` and `availability.search` must work without `stay.params`: fall back to
the field's default, as Example Parks' `check` does with `siteType` (it shows in Watches, and
the place page's check asks for "any"). Fields the watch form saved reach `check` when the
watch runs.

### Release modes

When `capabilities.snipes` is on, `releaseModes` describes how the provider releases dates:

```ts
interface ReleaseModeDescriptor {
  id: string; // lower case, e.g. 'daily_rollover'
  label: string; // "When new dates open"
  description: string;
  usesAccessGate: boolean; // a snipe in this mode waits in the provider's queue
  fields?: StayFieldDescriptor[]; // extra inputs this mode needs
}
```

Site Sniper shows them as choices, and the core asks your `release.computeReleaseAt({ mode,
… })` for the instant. A mode with `usesAccessGate` needs `capabilities.accessGate`.
ParkStay's modes are `daily_rollover`, `scheduled` and `cancellation`.

### Bulk availability stay fields

Bulk answers are cached by stay. `bulkAvailabilityStayFields` lists the stay fields your
`availability.search` actually reads (always both dates), so a change to anything else reuses
the cached answer instead of asking the provider again. Example Parks reads only the dates;
ParkStay reads the dates and the gear type, so changing the number of guests on Explore costs
no request.

## 3. The provider context

`create(ctx)` receives a `ProviderContext` (`src/main/providers/sdk/context.ts`), built from
your validated manifest. It is everything the provider gets from the app; a provider never
reaches for globals, never imports `electron`, an HTTP library, the database or the app logger.

| `ctx.` | What it is |
| --- | --- |
| `id`, `manifest`, `timezone`, `limits` | From your manifest (limits with defaults applied). |
| `http` | Your `HttpClient` ([below](#the-httpclient)). |
| `browser` | A `BrowserAutomation` that drives the installed Edge or Chrome, with your own persistent profile at `<userData>/providers/<id>/browser`. It costs nothing until first used ([browser providers](browser-providers.md)). |
| `state` | Your own key-value store (`provider_state` table, namespaced by your id). |
| `secrets` | Your encrypted secrets (`ScopedSecretVault`): ciphertext from the app's SecretVault (Electron `safeStorage`), stored in your state under `secret:<key>`, readable only by your provider. Never put a secret in `state`. |
| `logger` | A child logger tagged `{ provider: id }`. Never log cookies, tokens, form values or personal details; log URLs without query strings. |
| `clock` | The current time. Use it rather than `new Date()`, so tests can fix it. |

### The HttpClient

`ctx.http` has one interface (`src/main/providers/sdk/http.ts`) and three implementations:

- **In the app**, `ElectronSessionHttpClient`: Chromium's network stack on your session
  partition `persist:provider-<id>`. Your sign-in and payment windows use the same partition,
  so their cookies are your requests' cookies.
- **In fixture mode and in tests**, `FixtureHttpClient`
  (`src/main/testing/fixture-http-client.ts`): recorded responses, by method and path; nothing
  is sent ([recorded responses](#recorded-responses-fixturehttpclient)).
- **In tests against a loopback server**, `NodeHttpClient`: Node's `fetch` with an in-memory
  cookie jar.

They all behave the same:

- `request(method, url, options)`, `getJson(url, options)` (expects 2xx JSON) and
  `postForm(url, form)` (form-encoded, expects 2xx JSON); `withDefaults({ headers })` returns a
  client that adds headers to every request, on the same cookies. There is no JSON `POST`
  helper: use `request('POST', url, { headers, body: JSON.stringify(…) })`, as Example Parks'
  holds do.
- **`options.query`** is appended to the URL, encoded; `null` and `undefined` values are left
  out. Never build a query string by hand.
- **https only** (plain http only to a loopback host, for tests). Anything else is refused
  before it is sent.
- **Cookies** come only from the client's cookie store (`http.cookies`); a `Cookie` header you
  set is ignored.
- **Redirects** are followed (at most 5) and the final URL reported; `redirect: 'manual'`
  returns the 3xx, `'error'` rejects.
- **Every request has a timeout** (30 s by default, `timeoutMs` to change it) and honours your
  `AbortSignal`.
- **Errors:** a non-2xx answer from `getJson`/`postForm` is a `ProviderHttpError` (with
  `status`), a body that is not JSON a `ProviderParseError`, a timeout a `ProviderTimeoutError`,
  no response a `ProviderHttpError` with status 0, an abort an `AbortError`. `request` itself
  resolves for any status: check `response.status`.

If the provider blocks library user agents, send a browser one (ParkStay's `headers.ts`). In
the app, the partition's user agent already matches Electron's Chromium.

## 4. An API provider

`create(ctx)` returns the provider's modules: `links` always, and a module for each capability.
An API provider talks to the provider only through `ctx.http` ([the HttpClient](#the-httpclient)).
ParkStay is the full-size example: every request goes through one client class
(`src/main/providers/parkstay/client.ts`) that adds the browser headers and the `Referer`,
converts dates to ParkStay's `YYYY/MM/DD`, caps requests in flight at the manifest's limit, and
turns the DBCA queue's page into an `AccessGateError` ([ParkStay endpoints](parkstay/endpoints.md)).
Example Parks is the same shape, small. From the top, the imports:

<!-- region: tests/fixtures/providers/example-api/index.ts#api-imports -->

```ts
import { z } from 'zod';
import {
  createLimiter,
  defineProvider,
  ProviderParseError,
  type ProviderContext,
  type ProviderFactory,
  type ProviderLinks,
} from '@main/providers/sdk';
import type { LocationDetail, LocationSummary } from '@shared/types/catalog.types';
import type {
  BulkAvailabilityEntry,
  LocationAvailability,
  LocationKind,
  NightState,
  NightStatus,
  ProviderManifest,
  StayQuery,
  UnitAvailability,
} from '@shared/types/provider.types';
import { eachNight } from '@shared/utils/calendar-date';
import { makeLocationKey } from '@shared/utils/location-key';
import { createExampleAuth } from './auth';
import { createExampleHolds } from './holds';
```

**Validate what the provider returns.** Its JSON is not a contract; a zod schema turns a
change on its side into a clear `ProviderParseError` instead of an `undefined` deep in your
mapping:

<!-- region: tests/fixtures/providers/example-api/index.ts#api-raw -->

```ts
/** What the API returns. Validated: a provider's JSON is not a contract. */
const RawPark = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  type: z.string(),
  lat: z.number(),
  lng: z.number(),
  town: z.string(),
  region: z.string().optional(),
  photos: z.array(z.string()),
  facilities: z.array(z.string()),
  siteCount: z.number().int().optional(),
});
const RawParkList = z.object({ parks: z.array(RawPark) });
const RawParkDetail = RawPark.extend({
  description: z.string().optional(),
  sites: z.array(
    z.object({ id: z.string(), name: z.string(), type: z.string(), sleeps: z.number() })
  ),
});
const RawAvailability = z.object({
  sites: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      nights: z.array(z.object({ date: z.string(), status: z.string(), price: z.number() })),
    })
  ),
});
const RawBulk = z.object({
  parks: z.array(z.object({ id: z.number().int(), free: z.number().int(), total: z.number() })),
});
type RawPark = z.infer<typeof RawPark>;
```

**Map the provider's words explicitly**, and fall back to the neutral value: an unknown kind
is `other`, an unknown night is `unknown`, never `available`. Return only the stay's own
nights, each a `YYYY-MM-DD` calendar date:

<!-- region: tests/fixtures/providers/example-api/index.ts#api-mapping -->

```ts
/** The API's words, mapped explicitly. An unknown word gets the neutral value. */
const KINDS: Record<string, LocationKind> = { campground: 'campground', cabin: 'cabin' };
const NIGHT_STATES: Record<string, NightState> = {
  open: 'available',
  booked: 'booked',
  closed: 'closed',
  'not-yet-open': 'not-released',
};

/** Only the stay's own nights, each `YYYY-MM-DD`; a night the API left out is `unknown`. */
function toNights(stay: StayQuery, raw: { date: string; status: string; price: number }[]) {
  const byDate = new Map(raw.map((night) => [night.date, night]));
  return eachNight(stay.arrival, stay.departure).map((date): NightStatus => {
    const night = byDate.get(date);
    const state = (night && NIGHT_STATES[night.status]) ?? 'unknown';
    return state === 'available' ? { date, state, price: night!.price } : { date, state };
  });
}
```

**The factory.** `defineProvider` pairs the manifest with `create`, which builds the modules
for one context. Requests go through one helper, which encodes the query, keeps no more in
flight than the limit, and validates the answer:

<!-- region: tests/fixtures/providers/example-api/index.ts#api-factory -->

```ts
export function createExampleApiFactory({
  baseUrl = 'https://api.example-parks.test',
}: ExampleApiOptions = {}): ProviderFactory {
  return defineProvider(exampleApiManifest, (ctx: ProviderContext) => {
    // Every request: JSON, and no more in flight than the manifest's limit.
    const http = ctx.http.withDefaults({ headers: { Accept: 'application/json' } });
    const limit = createLimiter(ctx.limits.maxConcurrentRequests);

    async function get<T>(
      path: string,
      schema: z.ZodType<T>,
      { query, signal }: { query?: Record<string, string | number>; signal?: AbortSignal } = {}
    ): Promise<T> {
      const url = new URL(path, baseUrl).href;
      // `query` is encoded for you. A non-2xx answer is a ProviderHttpError, a body that is
      // not JSON a ProviderParseError.
      const body = await limit(() => http.getJson<unknown>(url, { query, signal }));
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        throw new ProviderParseError({ providerId: ctx.id, url, message: `Unexpected ${path}` });
      }
      return parsed.data;
    }

    const links: ProviderLinks = {
      location: (externalId) => `${SITE}/parks/${encodeURIComponent(externalId)}`,
      booking: (externalId, stay) => {
        const page = `${SITE}/book/${encodeURIComponent(externalId)}`;
        return stay
          ? `${page}?${new URLSearchParams({ from: stay.arrival, to: stay.departure })}`
          : page;
      },
    };

    function toSummary(raw: RawPark): LocationSummary {
      const externalId = String(raw.id);
      return {
        key: makeLocationKey(ctx.id, externalId),
        providerId: ctx.id,
        externalId,
        name: raw.name,
        kind: KINDS[raw.type] ?? 'other',
        bookingMode: 'online',
        lat: raw.lat,
        lng: raw.lng,
        area: { name: raw.town, region: raw.region },
        imageUrls: raw.photos.filter((url) => url.startsWith('https://')),
        amenities: raw.facilities,
        unitCount: raw.siteCount,
        infoUrl: links.location(externalId) ?? undefined,
        bookingUrl: links.booking(externalId) ?? undefined,
      };
    }

    return {
      links,
      catalog: {
        async listLocations(signal) {
          const { parks } = await get('/api/parks', RawParkList, { signal });
          return parks.map(toSummary);
        },
        async getLocation(externalId, signal): Promise<LocationDetail> {
          const park = await get(`/api/parks/${encodeURIComponent(externalId)}`, RawParkDetail, {
            signal,
          });
          return {
            ...toSummary(park),
            // Raw provider HTML: main sanitises it before it crosses IPC.
            descriptionHtml: park.description,
            units: park.sites.map((site) => ({
              unitId: site.id,
              unitName: site.name,
              unitType: site.type,
              maxPeople: site.sleeps,
            })),
            fetchedAt: ctx.clock().toISOString(),
          };
        },
      },
      availability: {
        async check(externalId, stay, options = {}): Promise<LocationAvailability> {
          // A stay field the person did not set (or a caller that sends none, such as the
          // place page) falls back to the field's default.
          const siteType = stay.params?.siteType ?? 'any';
          const query = {
            arrival: stay.arrival,
            departure: stay.departure,
            guests: stay.adults + (stay.children ?? 0),
            siteType: String(siteType),
          };
          const path = `/api/parks/${encodeURIComponent(externalId)}/availability`;
          const { sites } = await get(path, RawAvailability, { query, signal: options.signal });
          const wanted = options.unitIds?.length ? new Set(options.unitIds) : undefined;
          const units = sites
            .filter((site) => !wanted || wanted.has(site.id))
            .map((site): UnitAvailability => {
              const nights = toNights(stay, site.nights);
              const fullyAvailable = nights.every((night) => night.state === 'available');
              const total = fullyAvailable
                ? nights.reduce((sum, night) => sum + (night.price ?? 0), 0)
                : undefined;
              return { unitId: site.id, unitName: site.name, nights, fullyAvailable, total };
            });
          return {
            key: makeLocationKey(ctx.id, externalId),
            checkedAt: ctx.clock().toISOString(),
            units,
            bookingUrl: links.booking(externalId, stay) ?? undefined,
          };
        },
        async search(stay, signal): Promise<BulkAvailabilityEntry[]> {
          const query = { arrival: stay.arrival, departure: stay.departure };
          const { parks } = await get('/api/availability', RawBulk, { query, signal });
          return parks.map((park) => ({
            key: makeLocationKey(ctx.id, String(park.id)),
            availableUnits: park.free,
            bookableUnits: park.total,
          }));
        },
      },
      // Holds and the sign-in check take their turn with every other request.
      holds: createExampleHolds({
        providerId: ctx.id,
        http,
        limit,
        apiUrl: baseUrl,
        siteUrl: SITE,
      }),
      auth: createExampleAuth({ apiUrl: baseUrl, siteUrl: SITE, limit }),
    };
  });
}
```

The rules the normalised types carry (`src/shared/types/provider.types.ts`,
`catalog.types.ts`):

- **Keys.** `key` is always `makeLocationKey(ctx.id, externalId)`; use the provider's own
  stable id as `externalId`, never a position in a list.
- **`LocationSummary`** needs a `kind` from your `locationKinds`, a `bookingMode` (`online`,
  `offline`, `external` or `application`), coordinates, `imageUrls` (absolute https only) and
  `amenities` (plain words). `area`, `summary`, `unitCount`, `infoUrl` and `bookingUrl` are
  optional.
- **`LocationDetail`** adds `units` (`UnitSummary[]`), and optionally `descriptionHtml` and a
  `releaseInfo` sentence. Return the provider's HTML as you found it: main sanitises it
  (`sanitizeProviderHtml`) before it crosses IPC, and its links open in the system browser.
  A description in titled parts can be `sections` (`{ title, html }`, in the provider's order;
  the place page shows them as an accordion, the first open, instead of `descriptionHtml`), and
  short notices `notices` (`{ level: 'warning' | 'caution' | 'info', text }`, plain text). Main
  sanitises each section too, its headings from `h4`, and drops a section with no title or text
  and a notice with another level. A map of the location can be a document in `documents`
  (`{ id, kind: 'map', title, mediaType, url }`, `url` an absolute https address on your own
  site): the place page shows a button for it, and main opens it in a document window. The
  address stays in main and never reaches the renderer; main drops a document without an https
  address. `getLocation`'s `options.previous` is the detail main stored
  last, however old: reuse part of it when one of your sources fails (ParkStay keeps the
  sections when its campground page cannot be read).
- **Availability.** `check` returns a `LocationAvailability`: one `UnitAvailability` per unit,
  each with one `NightStatus` per night of the stay (`available`, `booked`, `closed`,
  `not-released` or `unknown`, and `price` when known), `fullyAvailable` only when every night
  is `available`, and `total` when every night has a price. Honour `unitIds` (only those
  units) and set `bookingUrl` to a stay-specific deep link when the provider has one.
- **Dates and time zones.** Stays are calendar dates: never turn them into `Date` objects and
  back (a time zone shifts them). Convert to the provider's own format with a string
  transform, as ParkStay's `toParkStayDate` does (`2026-11-10` → `2026/11/10`). "Today" is
  today in `ctx.timezone` (`todayIn` from `@shared/utils/calendar-date`).
- **Errors** are `ProviderError`s (`src/main/providers/sdk/errors.ts`): an unknown location
  rejects (the HTTP 404 does it here), it never returns an empty result. Let an `AbortError`
  propagate.
- **Bulk availability** ([below](#bulk-availability-entries)): `search` returns a count of free
  and bookable units per place, not nights.

### Bulk availability entries

With `bulkAvailability`, `availability.search(stay)` answers every place at once, for Explore's
cards and pins and its "Available only" filter. It returns one `BulkAvailabilityEntry` per place
it has an answer for:

| Field | Meaning |
| --- | --- |
| `key` | The place's location key, `makeLocationKey(ctx.id, externalId)`. Main keeps only entries for places of this provider that are in the stored catalogue (and in the area Explore shows). |
| `availableUnits` | How many units are free on **every** night of the stay. A unit free on some nights only does not count. |
| `bookableUnits` | How many units can be booked online for these dates at all, free or not: the place's total, or 0 when none can be booked (not released yet, closed, or past the provider's booking window). |

The names invite a swap: `availableUnits` is the smaller number, the free ones, and
`bookableUnits` the total. Explore reads them as:

| Entry | The card says |
| --- | --- |
| `availableUnits` above 0 | "2 of 5 sites available" (only "2 sites available" if `bookableUnits` is smaller) |
| `availableUnits` 0, `bookableUnits` above 0 | "No site free every night" |
| Both 0 | "No sites open for these dates" |
| No entry for the place | "Availability unknown" |

So leave out a place you have no answer for rather than send zeros, which would read as full or
not open. ParkStay's own names read the other way round (its `total_available` is a
campground's site count, `total_bookable` the sites free every night): map a provider's numbers
by what they mean, not by their names.

## 5. A browser provider

Example Holiday Parks has no API, so it reads the site's pages in the person's installed Edge
or Chrome. Its availability appears only after the park page's search form runs: the site's
script fetches the nights and draws a table. [Browser providers](browser-providers.md) has the
full detail (the runtime, selectors, waiting, politeness, bot walls, search-mode catalogues);
here is what you need to start.

### When to choose browser automation

| Choose | When |
| --- | --- |
| HTTP (`integration: 'api'`, `ctx.http`) | The site has JSON (or plain HTML) endpoints that answer a normal request with the right headers. **Always prefer it**: faster, lighter on the person's computer and on the provider, and less fragile. ParkStay is an HTTP provider. |
| Browser automation (`integration: 'browser'`, `ctx.browser`) | There is no usable endpoint: the pages are built by scripts from data you cannot request, or the site only answers a real browser. Check the site's network panel first. |
| Both (`integration: 'hybrid'`) | Most data comes from endpoints, but one step needs a browser. |

And never when the provider's terms forbid automated access.

### The automation runtime

`ctx.browser` is a `PlaywrightBrowserAutomation` (`src/main/providers/sdk/browser-automation.ts`)
with one method you use, `withPage(fn, { headed?, timeoutMs?, signal? })`. It loads
`playwright-core` on first use, drives the installed Edge or Chrome (WA Stay bundles and
downloads no browser) with Chromium's sandbox on, keeps one persistent profile per provider at
`<userData>/providers/<id>/browser`, and runs a provider's calls one at a time. The browser
closes after 5 minutes without a call, and on quit. [Browser providers](browser-providers.md#the-withpage-lifecycle)
has the details.

Sign-in by browser automation (`auth.kind: 'automation'`) is declared and validated but **not
implemented**: the account service supports only `browser-session` ([sign-in](#7-sign-in)).

### The example

<!-- region: tests/fixtures/providers/example-browser/index.ts#browser-imports -->

```ts
import type { Page } from 'playwright-core';
import {
  defineProvider,
  ProviderHttpError,
  type ProviderContext,
  type ProviderFactory,
  type ProviderLinks,
} from '@main/providers/sdk';
import type { LocationDetail, LocationSummary } from '@shared/types/catalog.types';
import type {
  LocationAvailability,
  LocationKind,
  NightState,
  NightStatus,
  ProviderManifest,
  UnitAvailability,
} from '@shared/types/provider.types';
import { eachNight } from '@shared/utils/calendar-date';
import { makeLocationKey } from '@shared/utils/location-key';
```

The manifest says `integration: 'browser'` and keeps the provider polite: one page at a time,
hourly at most, a catalogue that stays fresh for three days:

<!-- region: tests/fixtures/providers/example-browser/index.ts#browser-manifest -->

```ts
export const exampleBrowserManifest: ProviderManifest = {
  id: 'example-browser',
  name: 'Example Holiday Parks',
  shortName: 'Example Holiday',
  description: 'Holiday parks and cabins from the Example Holiday Parks website.',
  website: 'https://www.example-holiday.test',
  integration: 'browser',
  brand: { color: '#7A3B1F', monogram: 'EH' },
  locationKinds: ['holiday-park', 'caravan-park', 'cabin', 'other'],
  timezone: 'Australia/Perth',
  currency: 'AUD',
  capabilities: {
    catalog: true,
    catalogMode: 'full',
    availability: true,
    bulkAvailability: false,
    watches: false,
    snipes: false,
    holds: false,
    bookingImport: false,
    accessGate: false,
    account: 'none',
  },
  // A page visit costs the site far more than an API call: one page at a time, and rarely.
  limits: { minWatchIntervalMinutes: 60, maxConcurrentRequests: 1, catalogTtlHours: 72 },
};
```

**Page functions run inside the browser.** They may use only their arguments and browser
globals, never a Node variable or import, and they return plain data. Read data attributes,
roles and test ids, never CSS class names. The main process's `tsconfig.json` has no DOM types,
so the example describes the few element methods it uses:

<!-- region: tests/fixtures/providers/example-browser/index.ts#browser-read -->

```ts
/** What the park markup holds, read inside the page. */
interface RawPark {
  externalId: string;
  kind: string;
  lat: number;
  lng: number;
  name: string;
  town: string;
}

interface RawUnit {
  unitId: string;
  unitName: string;
  nights: { date: string; status: string; label: string }[];
}

/** The part of a DOM element the page functions read (main's tsconfig has no DOM types). */
interface PageElement {
  getAttribute(name: string): string | null;
  querySelector(selector: string): PageElement | null;
  querySelectorAll(selector: string): ArrayLike<PageElement>;
  readonly textContent: string | null;
}

/**
 * Runs inside the browser: it may use only its argument and browser globals, never a Node
 * variable or import. It reads data attributes and test ids, never CSS class names.
 */
function readParks(elements: PageElement[]): RawPark[] {
  const text = (root: PageElement, testId: string): string =>
    root.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? '';
  return elements.map((el) => ({
    externalId: el.getAttribute('data-park') ?? '',
    kind: el.getAttribute('data-kind') ?? '',
    lat: Number(el.getAttribute('data-lat')),
    lng: Number(el.getAttribute('data-lng')),
    name: text(el, 'name'),
    town: text(el, 'town'),
  }));
}

/** Runs inside the browser, like `readParks`. */
function readUnits(rows: PageElement[]): RawUnit[] {
  return rows.map((row) => ({
    unitId: row.getAttribute('data-unit') ?? '',
    unitName: row.getAttribute('data-unit-name') ?? '',
    nights: Array.from(row.querySelectorAll('[data-night]')).map((cell) => ({
      date: cell.getAttribute('data-night') ?? '',
      status: cell.getAttribute('data-status') ?? '',
      label: cell.textContent?.trim() ?? '',
    })),
  }));
}
```

**Interpret in Node**, where it is easy to test:

<!-- region: tests/fixtures/providers/example-browser/index.ts#browser-mapping -->

```ts
const KINDS: Record<string, LocationKind> = {
  holiday: 'holiday-park',
  caravan: 'caravan-park',
  cabin: 'cabin',
};
const NIGHT_STATES: Record<string, NightState> = {
  vacant: 'available',
  booked: 'booked',
  closed: 'closed',
};

/** `$145.00` → 145; text without a price → undefined. Plain Node code, easy to unit test. */
function parsePrice(label: string): number | undefined {
  const match = /\$\s*([\d,]+(?:\.\d+)?)/.exec(label);
  return match ? Number(match[1].replace(/,/g, '')) : undefined;
}
```

**One unit of work per `withPage` call**, the signal passed through so an abort closes the
page, an error page turned into an error, and the site's own form filled in and sent, waiting
for its result rather than for a time:

<!-- region: tests/fixtures/providers/example-browser/index.ts#browser-factory -->

```ts
export function createExampleBrowserFactory({
  baseUrl = 'https://www.example-holiday.test',
}: ExampleBrowserOptions = {}): ProviderFactory {
  return defineProvider(exampleBrowserManifest, (ctx: ProviderContext) => {
    const url = (path: string): string => new URL(path, baseUrl).href;
    const parkPath = (externalId: string): string => `/parks/${encodeURIComponent(externalId)}`;

    const links: ProviderLinks = {
      location: (externalId) => url(parkPath(externalId)),
      booking: (externalId) => url(`${parkPath(externalId)}/book`),
    };

    /** Navigates, and turns an error page into an error: a page without data is not empty. */
    async function open(page: Page, path: string): Promise<void> {
      const response = await page.goto(url(path), { waitUntil: 'domcontentloaded' });
      const status = response?.status() ?? 0;
      if (status < 200 || status >= 300) {
        throw new ProviderHttpError({ providerId: ctx.id, status, url: url(path) });
      }
    }

    function toSummary(raw: RawPark): LocationSummary {
      return {
        key: makeLocationKey(ctx.id, raw.externalId),
        providerId: ctx.id,
        externalId: raw.externalId,
        name: raw.name,
        kind: KINDS[raw.kind] ?? 'other',
        bookingMode: 'online',
        lat: raw.lat,
        lng: raw.lng,
        area: { name: raw.town },
        imageUrls: [],
        amenities: [],
        infoUrl: links.location(raw.externalId) ?? undefined,
      };
    }

    return {
      links,
      catalog: {
        // One unit of work per withPage call; the signal closes the page when it aborts.
        listLocations: (signal) =>
          ctx.browser.withPage(
            async (page) => {
              await open(page, '/parks');
              return (await page.$$eval('[data-park]', readParks)).map(toSummary);
            },
            { signal }
          ),
        getLocation: (externalId, signal) =>
          ctx.browser.withPage(
            async (page): Promise<LocationDetail> => {
              await open(page, parkPath(externalId));
              const [park] = await page.$$eval('main[data-park]', readParks);
              const units = await page.$$eval('li[data-unit]', (items) =>
                items.map((item) => ({
                  unitId: item.getAttribute('data-unit') ?? '',
                  unitName: item.textContent?.trim() ?? '',
                }))
              );
              return { ...toSummary(park), units, fetchedAt: ctx.clock().toISOString() };
            },
            { signal }
          ),
      },
      availability: {
        check: (externalId, stay, options = {}) =>
          ctx.browser.withPage(
            async (page): Promise<LocationAvailability> => {
              await open(page, parkPath(externalId));
              // The park page's own search form: the site's script fetches the nights and
              // draws the table. Locators wait for each field; wait for the table, not a time.
              await page.getByLabel('Arrival').fill(stay.arrival);
              await page.getByLabel('Departure').fill(stay.departure);
              await page.getByLabel('Guests').fill(String(stay.adults + (stay.children ?? 0)));
              await page.getByRole('button', { name: 'Check availability' }).click();
              await page.getByRole('table', { name: 'Availability' }).waitFor();
              const rows = await page.$$eval('tr[data-unit]', readUnits);
              const wanted = options.unitIds?.length ? new Set(options.unitIds) : undefined;
              const units = rows
                .filter((row) => !wanted || wanted.has(row.unitId))
                .map((row): UnitAvailability => {
                  const byDate = new Map(row.nights.map((night) => [night.date, night]));
                  // Only the stay's nights, whatever else the page shows.
                  const nights = eachNight(stay.arrival, stay.departure).map(
                    (date): NightStatus => {
                      const night = byDate.get(date);
                      const state = (night && NIGHT_STATES[night.status]) ?? 'unknown';
                      const price = state === 'available' ? parsePrice(night!.label) : undefined;
                      return { date, state, ...(price !== undefined ? { price } : {}) };
                    }
                  );
                  const fullyAvailable = nights.every((night) => night.state === 'available');
                  return { unitId: row.unitId, unitName: row.unitName, nights, fullyAvailable };
                });
              return {
                key: makeLocationKey(ctx.id, externalId),
                checkedAt: ctx.clock().toISOString(),
                units,
              };
            },
            { signal: options.signal }
          ),
      },
    };
  });
}
```

The browser profile keeps the provider's own cookies and sign-in between runs. It is a
different cookie jar from `ctx.http`'s session partition: a `hybrid` provider must not assume a
sign-in in one is visible to the other.

## 6. Holds

A hold is a temporary reservation the person then pays for on the provider's own site
(`capabilities.holds`). The app places one when a watch with "Hold a site automatically" finds
a match, or a snipe fires; the person pays in a payment window on your session partition.
Example Parks places a hold with `POST /api/holds`, through its limiter like every request:

<!-- region: tests/fixtures/providers/example-api/holds.ts#holds -->

```ts
import { z } from 'zod';
import {
  ProviderParseError,
  type HoldFailureReason,
  type HoldResult,
  type HoldsModule,
  type HttpClient,
  type Limiter,
} from '@main/providers/sdk';
import type { ProviderId } from '@shared/types/provider.types';

/** What `POST /api/holds` answers with a 201. */
const RawHold = z.object({
  hold: z.object({ reference: z.string().min(1), expiresAt: z.iso.datetime(), siteId: z.string() }),
});

/** The statuses Example Parks refuses a hold with, and what each means. */
const REFUSALS: Record<number, HoldFailureReason> = {
  401: 'auth-required',
  403: 'auth-required',
  409: 'taken',
  422: 'invalid',
  423: 'in-progress',
};

export interface ExampleHoldsOptions {
  providerId: ProviderId;
  http: HttpClient;
  /** The provider's limiter: a hold waits its turn with every other request. */
  limit: Limiter;
  /** The API, for `POST /api/holds`. */
  apiUrl: string;
  /** The website, whose checkout the payment window opens. */
  siteUrl: string;
}

export function createExampleHolds(options: ExampleHoldsOptions): HoldsModule {
  const { providerId, http, limit, apiUrl, siteUrl } = options;
  const checkout = (reference: string): string =>
    `${siteUrl}/checkout/${encodeURIComponent(reference)}`;

  return {
    async create({ externalId, unitId, stay }, signal): Promise<HoldResult> {
      const url = `${apiUrl}/api/holds`;
      // Through the limiter, like every request, with the answer read inside it. An abort or
      // a failed request rejects (the core logs it); a refusal is a result.
      const answer = await limit(async () => {
        const response = await http.request('POST', url, {
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            parkId: externalId,
            // No unit: Example Parks picks a free site for the stay.
            siteId: unitId ?? null,
            arrival: stay.arrival,
            departure: stay.departure,
            guests: stay.adults + (stay.children ?? 0),
          }),
          signal,
        });
        const created = response.status === 201;
        return { status: response.status, body: created ? await response.json() : undefined };
      });
      if (answer.status !== 201) {
        return {
          ok: false,
          reason: REFUSALS[answer.status] ?? 'error',
          message: `Example Parks did not hold the site (HTTP ${answer.status})`,
        };
      }
      const parsed = RawHold.safeParse(answer.body);
      if (!parsed.success) {
        throw new ProviderParseError({ providerId, url, message: 'Unexpected /api/holds answer' });
      }
      const { reference, expiresAt, siteId } = parsed.data.hold;
      return { ok: true, reference, expiresAt: new Date(expiresAt), unitId: siteId };
    },

    // The payment window opens here, on the provider's session partition.
    paymentUrl: (hold) => checkout(hold.reference),
    // The top-level origins it may visit: the checkout and the card payment page.
    paymentOrigins: [siteUrl, 'https://pay.example-parks.test'],

    // Strict: only this hold's own confirmation page, showing its reference, means it is paid.
    async bookedReference(hold, page) {
      if (page.url.split(/[?#]/)[0] !== `${checkout(hold.reference)}/confirmed`) return null;
      return (await page.hasText(`Booking ${hold.reference} confirmed`)) ? hold.reference : null;
    },
  };
}
```

- **`create({ externalId, unitId?, unitGroupId?, stay }, signal)`** returns a `HoldSuccess`
  (`reference`, `expiresAt`, `unitId`) or a `HoldFailure` with a reason: `taken`,
  `in-progress`, `auth-required`, `closed`, `invalid` or `error`. **A refusal is a result, not
  a rejection**: the core tells the person why and carries on. Reject only for an abort or a
  request that failed (it is logged, and the attempt reported as failed). `unitId` may be
  missing: hold any free unit for the stay, or refuse with `invalid`. The core's night guard
  has already made sure the person holds nothing else for those nights.
- **`paymentUrl(hold)`** is where the person pays; the app opens it in a payment window on
  your partition, after `access.ensure()` when you have an access gate.
- **`paymentOrigins`** are the top-level https origins the payment window may visit
  (sub-frames are not restricted, for card and 3-D Secure frames).
- **`bookedReference(hold, page)`** decides whether a page the payment window loaded is
  **this** hold's confirmation, using only `page.url` and `page.hasText(text)` (the browser's
  find-in-page; nothing runs in the page). Return the booking reference to record, or `null`.
  Without it the app cannot tell when a payment completes. Be strict: Example Parks wants its
  own confirmation path with this hold's reference, and the reference on the page; ParkStay
  wants its `/success/` page with this hold's hash and its booking number.
- **Never place a real hold** in a test or a trial run. Example Parks' holds are tested on a
  recorded 201 and a loopback server (`tests/unit/docs/example-providers.test.ts`).

## 7. Sign-in

Required unless `capabilities.account` is `none`. The only sign-in the app implements is
**`browser-session`**: the person signs in on the provider's own pages, in an app window on
your session partition, so the cookies they get are the ones `ctx.http`, holds and the payment
window use. Example Parks' account is `optional`:

<!-- region: tests/fixtures/providers/example-api/auth.ts#auth -->

```ts
import { z } from 'zod';
import {
  isAbortError,
  ProviderHttpError,
  ProviderParseError,
  ProviderTimeoutError,
  type BrowserSessionAuth,
  type HttpClient,
  type Limiter,
} from '@main/providers/sdk';
import type { AccountStatus } from '@shared/types/provider.types';

/** What `GET /api/me` answers for a signed-in session. Only the email and name are read. */
const RawMe = z.object({ email: z.string().min(1), name: z.string().optional() });

const unknown = (reason: string): AccountStatus => ({ state: 'unknown', reason });

export function createExampleAuth(options: {
  apiUrl: string;
  siteUrl: string;
  /** The provider's limiter: the check waits its turn with every other request. */
  limit: Limiter;
}): BrowserSessionAuth {
  const { apiUrl, siteUrl, limit } = options;
  return {
    kind: 'browser-session',
    // Where the sign-in window opens. It runs on the provider's session partition, so the
    // cookies the person gets there are the ones ctx.http sends.
    signInUrl: `${siteUrl}/account/sign-in`,
    // Every top-level https origin the sign-in flow visits, the identity provider included.
    allowedOrigins: [siteUrl, 'https://login.example-parks.test'],
    // Pages that mean "probably signed in": the app then asks isSignedIn to be sure.
    completionUrlPatterns: [`${siteUrl}/account/welcome*`],

    // Asks the provider with the partition's cookies (`http`). Only a definite answer is
    // signed in or signed out; anything else is `unknown` with a reason, and the app keeps the
    // last definite answer.
    async isSignedIn(http: HttpClient, signal?: AbortSignal): Promise<AccountStatus> {
      try {
        // Through the limiter, like every request, with the answer read inside it.
        const answer = await limit(async () => {
          const response = await http.request('GET', `${apiUrl}/api/me`, {
            headers: { Accept: 'application/json' },
            timeoutMs: 15_000,
            signal,
          });
          const found = response.status === 200;
          return { status: response.status, body: found ? await response.json() : undefined };
        });
        if (answer.status === 401 || answer.status === 403) return { state: 'signed-out' };
        if (answer.status !== 200) return unknown(`http ${answer.status}`);
        const me = RawMe.safeParse(answer.body);
        if (!me.success) return unknown('parse');
        const { email, name } = me.data;
        return { state: 'signed-in', email, ...(name ? { displayName: name } : {}) };
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (error instanceof ProviderTimeoutError) return unknown('timeout');
        if (error instanceof ProviderParseError) return unknown('parse');
        if (error instanceof ProviderHttpError) {
          return unknown(error.status === 0 ? 'network' : `http ${error.status}`);
        }
        throw error;
      }
    },
  };
}
```

- **`signInUrl`** is where the window opens. **`allowedOrigins`** is every top-level https
  origin of the flow (the identity provider and any queue included); the window refuses any
  other. **`completionUrlPatterns`** (`*` wildcard) are pages that mean "probably done": the app
  then confirms with `isSignedIn`.
- **`isSignedIn(http, signal)`** asks the provider with the partition's cookies (`http`, not
  `ctx.http`) and returns `signed-in` (with email and name), `signed-out`, or `unknown` with a
  reason when the answer was not definite (a 5xx, a queue, no network). Never turn "could not
  tell" into `signed-out`: the app keeps the last definite answer, and checks again later
  (answers are cached for 60 s, an `unknown` one for 5 s).
- Settings → Accounts shows the provider's row with "Connect" and "Sign out". Sign-out clears
  only your partition, and is refused (`ACCOUNT_BUSY`) while a snipe or hold needs it.

| `kind` | How the person signs in | Status |
| --- | --- | --- |
| `browser-session` | On the provider's own pages, in an app window on your partition, as above. | Implemented. ParkStay uses it ([sign-in](parkstay/authentication.md)). |
| `credentials` | The app asks for `fields` (`AccountFieldDescriptor`, secret ones kept in `ctx.secrets`) and calls `signIn(values, http)`. | Declared and validated; the account service does not implement it yet. |
| `automation` | `signIn(browser)` signs in through browser automation. | Declared and validated; the account service does not implement it yet. |

## 8. Other optional modules

Add these when the capability needs them. Their interfaces are in
`src/main/providers/sdk/provider.ts`; ParkStay implements every one.

### Access gate

A waiting room or virtual queue in front of the provider (`capabilities.accessGate`). ParkStay:
`queue/access-gate.ts`.

```ts
interface AccessGate {
  readonly waitingRoomOrigins?: readonly string[]; // e.g. ['https://queue.dbca.wa.gov.au']
  status(): AccessStatus; // idle | waiting (position, eta) | active (expiresAt) | expired | error
  ensure(options?: { signal?: AbortSignal; maxWaitMs?: number }): Promise<AccessStatus>;
  holdOpen(): () => void; // keeps the session alive until the release is called (ref-counted)
  onStatus(listener: (status: AccessStatus) => void): () => void;
  dispose(): void;
}
```

- When a request meets the gate, throw `AccessGateError`; the app reports `ACCESS_GATE` and
  shows the queue state.
- `waitingRoomOrigins` are the waiting room's top-level https origins (or
  `https://*.<domain>` patterns). A sign-in or payment window that passes through one is sent
  back to the page it was opened for when the waiting room lets the person through to the
  provider's home page.
- Status reaches the renderer only as `providers.accessStatus(id)` and the
  `provider:access-status` event. The registry disposes the gate on quit.

### Release policy

When dates become bookable, for Site Sniper (`release`). ParkStay: `release-policy.ts`.

- `supports(mode)` must accept every `releaseModes` id (the registry checks it).
- `computeReleaseAt({ mode, externalId, stay, params, requestedAt, now, signal })` returns the
  instant the stay opens, or `null` for "poll continuously" (a cancellation mode).
- `describe(externalId)` returns a sentence for the location's page, such as "Bookings open
  180 days ahead at 2:00 am AWST".
- `pollFloorMs: { window, continuous }` are the fastest the core may poll inside a release
  window and continuously. Pick them for the provider's capacity, not yours.

### Bookings

`bookings.get(reference)` (and `list`) return `ExternalBooking`s, for "Import booking"
(`capabilities.bookingImport`). `links.manageBooking(reference)` gives "Manage on {shortName}"
on a booking.

### Links and dispose

`links.location(externalId)` and `links.booking(externalId, stay?)` are required (return
`null` when there is no page); they must be absolute https URLs. `dispose()` is called on quit,
after the access gate's; the registry also closes your browser.

## 9. Timeouts, failures and retries

### Timeouts

The core bounds every call it makes to a provider. These are fixed, the same for every
provider: the manifest's `limits` set how often and how many, not how long. Keep each call well
inside its bound; a call that runs over is aborted through its `signal`. The catalogue's bounds
are `DEFAULT_CATALOG_TIMINGS` in `src/main/core/catalog/location-catalog.service.ts`, and the
sign-in check's is `DEFAULT_ACCOUNT_TIMINGS` in `src/main/core/accounts/provider-account.service.ts`.

| Call | Bound | What happens then |
| --- | --- | --- |
| A `full` catalogue sync (`listLocations`), `syncTimeoutMs` | 60 s | The sync fails; the cached locations are kept. |
| A place's detail (`getLocation`), `detailTimeoutMs` | 20 s | The place page shows the cached detail if there is one, or an error. |
| A place page's availability check (`check`), `availabilityTimeoutMs` | 20 s | The check fails with an error. |
| Explore's availability for the chosen dates (bulk `availability.search`), `availabilityTimeoutMs` | 20 s | The search fails, and a timeout is not asked again for 60 s (`bulkErrorTtlMs`). |
| One page of a `search` catalogue's area or text search, `searchTimeoutMs` | 20 s | That search fails (earlier pages are kept), and is not asked again for 60 s (`searchErrorTtlMs`). |
| One `ctx.http` request | 30 s (`timeoutMs`) | `ProviderTimeoutError`. |
| One `ctx.browser.withPage` call | 60 s (`timeoutMs`) | Playwright's `TimeoutError`. |
| A sign-in check (`isSignedIn`), `probeTimeoutMs` | 15 s | The account shows as unknown, never signed out. |
| A watch check, a hold | none from the core | Only your own request and page timeouts apply. |

Other timings from the same table: the first sync starts once the window has been open for
5 s (`startDelayMs`), stale catalogues are looked at every 60 minutes (`recheckMs`), a detail is
cached for 6 hours (`detailTtlMs`), bulk availability for 5 minutes (`bulkTtlMs`; a failed
answer for 1 minute, `bulkErrorTtlMs`) and a place page's check for 1 minute (`checkTtlMs`).

A browser provider is the one most at risk: a cold browser start plus a page with a script can
take several seconds on a slow computer. Do one unit of work per call, and wait for elements,
never for a time.

### When a call fails

- **The core does not retry a failed call.** `ProviderError.retryable` is logged, and nothing
  reads it. A failed watch check is recorded as an error on the watch (the person sees the
  message), and the watch runs again at its normal interval. A failed catalogue sync keeps the
  cached locations and is tried again at the next hourly look (or after 1, 2 and 5 minutes
  while nothing is cached).
- **HTTP 429** reaches the person as `RATE_LIMITED`, and is never retried at once. The core does
  not read `Retry-After` (`ProviderHttpError` does not keep headers). If the provider asks you
  to slow down, raise `minWatchIntervalMinutes`, lower `maxConcurrentRequests`, and fetch less.
- **Do not retry in a loop inside a module**, and never sleep and try again. Throw a
  `ProviderError` with a message the person can act on, and let the next scheduled run try.

## 10. Register it

Add the factory to `src/main/providers/index.ts`: an import, and an entry in
`BUILT_IN_PROVIDERS`. The scaffold does both for you (`--no-register` prints the lines instead).

<!-- region: tests/fixtures/providers/example-api/index.ts#api-register -->

```ts
/** What `src/main/providers/index.ts` would list: `[parkstayFactory, exampleApiFactory]`. */
export const exampleApiFactory = createExampleApiFactory();
```

```ts
export const BUILT_IN_PROVIDERS: readonly ProviderFactory[] = [parkstayFactory, exampleFactory];
```

At start-up `registry.register(factory, makeContext)` checks, in order: the id (valid, not
taken), the manifest (schema, then the flag rules), the context, the provider's links and
`auth`, and a module behind every capability. Any failure is a `ProviderRegistrationError`
naming the provider and the rule; `registerBuiltInProviders` logs it and starts the app
without that provider.

Registering changes nothing else in the project, and no existing test depends on which
providers are built in:

- Jest tests about ParkStay register ParkStay alone; tests of the registry and the container
  go through every built-in provider or use fakes. Nothing reaches the network:
  in Jest the app's HTTP client sits on a mocked Electron.
- The Electron smoke tests register only ParkStay (the `WA_STAY_PROVIDERS` hook: the harness
  sets `parkstay` unless a launch passes its own `providers`), so their place counts and
  pre-selections hold however many providers are built in.

Then run the whole gate, as in the [quick start](#quick-start): lint, format, type-check,
`npm test`, `test:tz` and the e2e suite.

## 11. Test it

### Where the tests go

| What | Where |
| --- | --- |
| The provider's tests: the contract suite and its mapping | `tests/integration/<id>-provider.test.ts` (Jest's `main` project) |
| Recorded responses for Jest (API), with their routes | `tests/fixtures/providers/<id>/` and its `manifest.json` |
| A made-up copy of the site for the fake browser (browser) | `tests/fixtures/providers/<id>/site.ts` |
| Recorded responses for the app in fixture mode (API) | `tests/e2e/fixtures/http/<id>/` and its `manifest.json` |
| An Electron journey that shows the provider (optional) | `tests/e2e/<name>.spec.ts`, launching with `providers: ['<id>']` |

Record only the provider's public responses, anonymously and politely (a browser user agent,
one request, not a crawl), trimmed to what the tests need, with no cookie, token, booking or
personal detail.

### Recorded responses: FixtureHttpClient

`FixtureHttpClient` (`src/main/testing/fixture-http-client.ts`) answers requests from recorded
responses: a folder per provider with a `manifest.json` of routes (`method`, `path`, and
optionally `query`, `status`, `contentType`) and the files they name. The host is not compared,
so any https address does, and a request that no route answers fails without being sent
([the route format](../../tests/e2e/fixtures/http/README.md#manifest)). It is the client the app
uses in fixture mode, so the same format serves Jest and the Electron smoke tests:

<!-- region: tests/unit/docs/example-providers.test.ts#test-fixtures -->

```ts
/**
 * A test context (in-memory state, a fake vault, a fixed clock) whose HTTP answers from the
 * recorded responses `tests/fixtures/providers/<id>/manifest.json` lists, by method and path.
 * The host is not compared, and a request no route answers fails without being sent.
 */
function fixtureContext(manifest: ProviderManifest) {
  return createTestProviderContext(manifest, {
    http: new FixtureHttpClient({
      providerId: manifest.id,
      fixturesDir: path.join(ROOT, 'tests/fixtures/providers'),
      logFile: UNEXPECTED_LOG,
    }),
  });
}
```

A route with `query` answers only a request with those values, so a fixture can prove the
provider sent the right parameters (Example Parks' availability route answers only
`siteType=powered` for the stay). When a test needs answers that differ for the same request
(a refusal, a slow server, a wrong shape), serve them from a loopback server with
`NodeHttpClient`, as the example's tests do.

### The contract suite

`describeProviderContract` (`tests/utils/provider-contract.ts`) is the conformance suite every
provider runs: a valid manifest, a module behind every capability, keys that round-trip, every
module honouring `AbortSignal`, `ProviderError`s for failures, https links, and registration in
a `ProviderRegistry`. Modules the provider lacks are skipped. It checks the shape of what each
module answers, not whether it is right for your provider: that is what your mapping tests are
for. What it calls, module by module (`sample` is the subject's place and stay, by default the
first listed place and a two-night stay 30 days ahead):

| Module | What the suite calls | What it checks |
| --- | --- | --- |
| The manifest | Nothing | It passes `ProviderManifestSchema`; every capability has its module and the flags agree (`providerViolations`); a three-letter currency; limits, if any, of at least 1 (`catalogTtlHours` above 0); every release mode passes `release.supports()`, and a provider with `snipes` describes at least one; it registers in a fresh `ProviderRegistry` under its id, modules unchanged. |
| `links` | `location` and `booking` (with and without the stay) for `sample`, and `manageBooking('REF-1')` | Each is an absolute https URL or `null`. |
| `catalog` | `listLocations()`, or every `searchArea` page over `searchBbox` (default: the whole world); `getLocation` for `sample` and for `unknownExternalId` | At least one place; unique keys that round-trip and name the provider; kinds from `locationKinds`; a detail with the same key and a `units` array; an unknown place rejects with a `ProviderError`; every call rejects with an `AbortError` for a signal aborted before it and one aborted during it. |
| `search` catalogue | `searchArea` page after page over `searchBbox`; `searchText(searchText)` if there is one | Items inside the box (to 0.01°); a `nextCursor` that is a non-empty string, changes, and ends within 100 pages; an abort honoured on the first and the next page; `searchText` finds places of this provider, and honours an abort. |
| `availability` | `check` for `sample` and for `unknownExternalId`; `search(stay)` if there is one | Nights only inside the stay, under the location key, with a `checkedAt` date; an unknown place rejects with a `ProviderError`; `search`'s keys name the provider; both honour an abort. |
| `access` | `status()`, `onStatus()` and its unsubscribe, `holdOpen()` released twice, `ensure()` | The status names the provider; `ensure` honours an abort. |
| `release` | `computeReleaseAt` for every release mode | A `Date` or `null`; `pollFloorMs` above 0; an abort honoured. |
| `holds` | `create({ externalId, stay })`, only with a signal aborted before the call or at once after it starts | It rejects with an `AbortError`. Nothing about a hold's answer is checked, and no hold is placed: test refusals, the answer's shape and `bookedReference` yourself, on recorded responses or a loopback server, as the example does. |
| `auth` | Nothing: `isSignedIn` is never called | `isSignedIn` is a function; a `browser-session` sign-in has an https `signInUrl` and https `allowedOrigins`. Test `isSignedIn`'s answers yourself. |
| `bookings`, `dispose` | Nothing | Nothing. |

For a browser provider, pass `openPages`: after every test its browser must have no page open.

Register the provider as the app does, in a fresh registry, on recorded responses:

<!-- region: tests/unit/docs/example-providers.test.ts#test-api -->

```ts
// A fresh registry, as the app has, and the provider on recorded responses: any https
// host does, because a FixtureHttpClient answers by path and never sends a request.
const registry = new ProviderRegistry();
const factory = createExampleApiFactory({ baseUrl: 'https://api.example-parks.test' });
registry.register(factory, fixtureContext);
provider = registry.require('example-api', 'bulkAvailability');
```

and run the suite on it:

<!-- region: tests/unit/docs/example-providers.test.ts#test-contract -->

```ts
describeProviderContract('example-api', () => {
  const factory = createExampleApiFactory({ baseUrl: 'https://api.example-parks.test' });
  return {
    provider: factory(fixtureContext(factory.manifest)),
    sample: { externalId: '101', stay: STAY },
    unknownExternalId: '999',
  };
});
```

Then test the mapping: normalised `LocationSummary`s, `NightStatus`es with `YYYY-MM-DD` dates
and only the stay's nights, unknown words read as `unknown`, an unknown location as a
`ProviderError`, and the limiter. The scaffold's generated test is a starting point for all of
these.

### A browser provider without a browser

Unit tests never start a browser: `createTestProviderContext` gives a context whose browser
fails the test unless you set one up. Give it the fake browser from
`tests/utils/fake-browser.ts`: its pages load your fixture site into jsdom and run the site's
scripts, forms and links go back through the site, and a page script's `fetch` is answered by
the site, so your real page code runs against it. Pass `openPages` to the contract suite so it
checks that no call leaves a page open:

<!-- region: tests/unit/docs/example-providers.test.ts#test-fake-browser -->

```ts
describeProviderContract('example-browser', () => {
  // Pages come from the example site, in jsdom, its scripts running: the provider's own
  // page code runs against them.
  const fake = createFakeBrowser(renderExampleSite);
  const factory = createExampleBrowserFactory();
  return {
    provider: factory(createTestProviderContext(factory.manifest, { browser: fake })),
    sample: { externalId: 'sunset-bay', stay: STAY },
    unknownExternalId: 'nowhere',
    openPages: fake.openPages,
  };
});
```

The fake supports the part of playwright-core's `Page` providers use: `goto`, locators and
`getByRole`, `getByLabel`, `getByText`, `getByTestId`; `fill`, `click`, `selectOption`,
`check`, `waitFor`; `$$eval`, `evaluate`, `waitForURL` and more (the list is at the top of the
file). Anything else throws "not supported by the fake browser: <name>". It records `visits`,
`requests` (a page script's `fetch` calls included) and `pageErrors` for your assertions.

Tests of the browser runtime itself (launch failures, crashes, a locked profile) mock
`playwright-core` with `tests/utils/fake-playwright.ts`; a provider does not need it. For a
real-browser check against a loopback copy of a site, see
[browser providers](browser-providers.md#the-real-browser-smoke-test).

### The Electron smoke tests

The Electron smoke tests (`tests/e2e`) run the built app in network-free fixture mode: every
provider's `HttpClient` is a `FixtureHttpClient` that answers from
`tests/e2e/fixtures/http/<id>/manifest.json`, and any other request is cancelled and logged. A
provider with no folder there answers every request with an error. The journeys register only
ParkStay, so a new provider changes none of them; a journey written for your provider launches
with `launchWaStay({ providers: ['parkstay', '<id>'] })` ([tests/README.md](../../tests/README.md)).

**A provider with an account** (any `account` but `none`) needs a route there for its
signed-in check too: the request `isSignedIn` sends (Example Parks' `GET /api/me`), answered as
for a person who is signed out, such as a 401 with a small JSON body written by hand (ParkStay's
is `profile-signed-out.json`). The app checks every account 5 s after launch and whenever
Settings → Accounts opens. Without the route the request is refused and logged
(`<userData>/e2e-unexpected-requests.log`), the account reads as unknown, and the preview spec
fails, naming the request.

**Two fixture manifests.** The scaffold writes `tests/fixtures/providers/<id>/manifest.json` for
Jest and `tests/e2e/fixtures/http/<id>/manifest.json` for the app, and they differ on purpose.
The Jest one also answers an unknown place with a 404 (`not-found.json`), which the contract
suite and the mapping test ask for, and a `search` catalogue's name search answers only
`text=Banksia`, so a test proves the provider sends the text. The app never asks for that
unknown place, and a person types any name, so the e2e one has no 404 routes and its name search
answers any text.

Fixture mode serves `ctx.http` only. `ctx.browser` is the real browser automation, so a browser
provider must not be registered in a journey unless its pages are local.

## 12. Preview in the app

See the provider in the running app before you call it done.

**The preview spec** (API providers). `tests/e2e/preview-provider.spec.ts` launches the built
app as the smoke tests do (fixture mode, a temp profile, no network) with only your provider
registered, and checks that:

- Explore lists its places;
- with dates (two nights from `PREVIEW_ARRIVAL`, by default tomorrow in the provider's time
  zone, set through Explore's address), Explore shows its free counts without an error, when it
  has `bulkAvailability`;
- the first place's page opens with those dates, and "Check availability" answers with the
  night grid (every unit's nights) or "No sites were listed for these dates", not an error;
- Settings → Accounts shows it;
- fixture mode refused no request (the photos it never loads aside), and the window logged no
  errors.

```bash
npm run build:e2e
npx cross-env PREVIEW_PROVIDER=acme-parks playwright test preview-provider
npx cross-env PREVIEW_PROVIDER=acme-parks PREVIEW_ARRIVAL=2026-11-10 playwright test preview-provider   # dates of your choice
npx playwright show-report        # Explore, Explore with dates, the place page, Accounts
```

Recorded responses cover the dates they were recorded for. If they say nothing about any night
of the stay, every night reads Unknown: the preview still passes, with a warning in the report
and the output, and you set `PREVIEW_ARRIVAL` (a date, `YYYY-MM-DD`, from today on) to dates
they cover. The scaffold's sample responses cover 9 to 12 November 2026, so a generated
provider shows its nights with `PREVIEW_ARRIVAL=2026-11-10`.

On Linux without a display, run the second command under `xvfb-run -a`. A step that fails
quotes what the app logged about the provider, such as "Acme Parks is not set up yet: set
ACME_PARKS_API_URL …" or "no fixture for GET …; add a route to
tests/e2e/fixtures/http/acme-parks/manifest.json", and a refused request names the route to
add. The first place must list units for its availability to be checked. Without
`PREVIEW_PROVIDER` the spec is skipped, so the suite and CI never run it.

**By hand, from source.** The same test hooks work for a build you click through yourself. They
are honoured only when the app runs from source, never in a packaged build:

```bash
npm run build:e2e
npx cross-env WA_STAY_E2E_FIXTURES_DIR=tests/e2e/fixtures/http WA_STAY_PROVIDERS=parkstay,acme-parks WA_STAY_USER_DATA_DIR=tmp/preview-profile electron .
```

`WA_STAY_E2E_FIXTURES_DIR` turns on fixture mode, `WA_STAY_PROVIDERS` picks the providers
(ParkStay's fixtures are there too), and `WA_STAY_USER_DATA_DIR` keeps the run out of your own
WA Stay data (`tmp/` is ignored by git; delete the folder to start again). On Linux as root, or
in a container, add `--no-sandbox` after `electron .`.

**Browser providers.** Fixture mode does not cover `ctx.browser`: in the app, a browser provider
drives a real browser against whatever address its code names, so the preview spec cannot run
it. Keep its tests on the fake browser, and once they pass, preview it by hand against its
made-up site served on your own computer ([the steps and why they are safe](browser-providers.md#preview-in-the-app)):

```bash
node scripts/serve-provider-site.mjs acme-parks   # serves tests/fixtures/providers/acme-parks/site.ts at http://127.0.0.1:8123
# set ACME_PARKS_SITE_URL to 'http://127.0.0.1:8123' for now, then:
npm run build:e2e
npx cross-env WA_STAY_E2E_FIXTURES_DIR=tests/e2e/fixtures/http WA_STAY_PROVIDERS=acme-parks WA_STAY_USER_DATA_DIR=tmp/preview-profile electron .
```

On Linux without Edge or Chrome, give the app a Chromium build with `WA_STAY_BROWSER_PATH`. Set
the address back before you run the tests: `npm test` fails while a provider names a loopback
address (`tests/unit/providers/no-loopback-addresses.test.ts`). You may also let it read the live site by hand,
read-only and briefly, as a person browsing would. A generated browser provider fails before it
starts a browser until you set its address, so registering it as generated is safe.

## What the app does with it

Once registered, with no other change:

- **Explore** syncs a `full` catalogue (every `catalogTtlHours`), or searches a `search` one
  by the map's area as it moves, indexes it for search (FTS5), and shows its locations on the
  map and in the list with the provider's badge, the Provider, Type, Region and Facilities
  filters, and, with `bulkAvailability`, free counts for the chosen dates.
- **A location's page** shows the detail (cached for 6 hours), "Check availability" for
  Explore's dates and party (no stay fields: [stay fields](#stay-fields)), the provider's
  links, and the create actions the capabilities allow.
- **Watches and Site Sniper** list the provider in their first step when it has the
  capability, with its stay fields and release modes. A watch's location step searches the
  stored catalogue (and, for a `search` catalogue with `searchText`, the provider).
- **Settings → Accounts** shows its row and, with `browser-session`, its sign-in.
- **Notifications** name the provider; desktop titles start with its `shortName`.

## Checklist

What a finished provider looks like. (The steps to get there are in
[CLAUDE.md, "Adding a provider"](../../CLAUDE.md#adding-a-provider).)

- [ ] Terms of use read; automated access allowed; noted in the module header.
- [ ] `id` final (it is stored in user data); `shortName` at most 24 characters.
- [ ] Brand colour with an AA-contrast white monogram; no third-party logo anywhere.
- [ ] `timezone` set; dates handled as `YYYY-MM-DD` strings; "today" in the provider's zone.
- [ ] `currency` set; prices in it.
- [ ] `limits` set for the provider's capacity; requests limited with `createLimiter`.
- [ ] Every capability has its module, and nothing is claimed that is not built.
- [ ] Raw responses validated; words mapped explicitly; unknown is never `available`.
- [ ] `check` and `search` work without `stay.params` (the field's default).
- [ ] Only https image URLs; HTML left for main to sanitise.
- [ ] Every module honours its `AbortSignal`, stays inside the core's timeouts, and fails with
      a `ProviderError`; no retry loops.
- [ ] Holds: refusals are results; `bookedReference` accepts only this hold's confirmation.
- [ ] Sign-in: `isSignedIn` answers `unknown`, never `signed-out`, when it cannot tell, and
      `tests/e2e/fixtures/http/<id>/` answers its request as signed out.
- [ ] No cookies, tokens or personal details in logs, fixtures or errors.
- [ ] No `TODO` left from the scaffold; no placeholder address.
- [ ] Factory in `BUILT_IN_PROVIDERS`; its tests, the full `npm test` and the e2e suite pass;
      the preview shows it on Explore and answers its availability for dates.
- [ ] No real hold, booking or payment, and no live site, in any test or trial run.
