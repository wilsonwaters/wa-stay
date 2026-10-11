# Providers

WA Stay brings accommodation from several sources into one app. Each source is a
**provider**: a module in `src/main/providers/<id>/` behind the provider SDK. The core
services, the IPC contract and the renderer never name a provider; they read what each one can
do from its manifest.

## Providers

| Provider | Status | Explore | Availability | Watches | Site Sniper | Holds and payment | Booking import | Account |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [ParkStay WA](parkstay/README.md) (DBCA national-park campgrounds) | Built in | Yes, 169 campgrounds | Yes, per night with prices, and bulk for map pins | Yes | Coming soon | Yes, 30-minute holds paid on ParkStay | No | Optional |
| RAC Parks & Resorts | Planned (the next project) | | | | | | | |

Other providers (Hipcamp, holiday-park chains, Airbnb) are possible with the SDK, including
ones with no API, but none is planned in this release.

## The provider SDK

- **Manifest** (`ProviderManifest`, `src/shared/types/provider.types.ts`): id, names, brand
  colour and monogram, location kinds, time zone, currency, capabilities, limits, stay fields,
  release modes. Validated with zod and frozen by the registry.
- **Modules** (`AccommodationProvider`, `src/main/providers/sdk/provider.ts`): `links` always;
  `catalog`, `availability`, `access`, `release`, `holds`, `bookings` and `auth` when the
  capabilities need them. `defineProvider(manifest, create)` makes the factory.
- **Context** (`ProviderContext`, `src/main/providers/sdk/context.ts`): an `HttpClient` on the
  provider's own session partition (or a test client), browser automation on the installed
  Edge or Chrome, key-value state, scoped encrypted secrets, a child logger and a clock.
- **Registry** (`ProviderRegistry`, `src/main/providers/registry.ts`): registers the factories
  listed in `src/main/providers/index.ts`, checks that every capability has its module, and is
  the only way core services find a provider.
- **Errors** (`src/main/providers/sdk/errors.ts`): `ProviderError` and its kinds
  (capability, HTTP, timeout, parse, auth required, access gate, browser unavailable), mapped
  to IPC error codes by `toApiError`.

## Guides

- [Adding a provider](adding-a-provider.md): the quick start (`npm run provider:new -- <id>`
  generates a working provider; fill it in, test it, preview it in the app), then the
  reference, with an API example (holds and sign-in included) and a browser example that
  compile. AI agents follow the checklist in [CLAUDE.md](../../CLAUDE.md#adding-a-provider).
- [Browser providers](browser-providers.md): providers with no API, read through Playwright.
- [ParkStay WA](parkstay/README.md): the reference provider, its [endpoints](parkstay/endpoints.md)
  and its [sign-in](parkstay/authentication.md).
- [Architecture overview](../architecture/overview.md): how providers sit in the app.
