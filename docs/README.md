# WA Stay documentation

WA Stay is a desktop app for finding and booking places to stay across Western Australia, from
ParkStay WA's national-park campgrounds to RAC Parks & Resorts' holiday parks and Rottnest
Island's villas, cabins and campground on Stay Rottnest. The project
overview and downloads are in the [README](../README.md).

## Using WA Stay

- [Installation](installation.md): download, install, update, uninstall, and
  [upgrading from WA ParkStay Bookings](installation.md#upgrading-from-wa-parkstay-bookings).
- [User guide](user-guide.md): Explore, a place's page, watches, Site Sniper, bookings,
  notifications and settings.
- [Watches and notifications](watches-and-notifications.md): how watches check and match,
  automatic holds, desktop and email notifications.
- [Site Sniper](site-sniper.md) (coming soon): release modes, holds, payment and booking
  responsibly.
- [Troubleshooting](troubleshooting.md).

## Developing WA Stay

- [Development](development.md): setup, the native module, running, building, scripts and tests.
- [Architecture overview](architecture/overview.md): processes, source layout, start-up, the
  provider architecture, the data model, security and the upgrade path.
  - [ADR-001: UI framework choice](architecture/adr/ADR-001-ui-framework-choice.md)
- [Security](security.md): secret storage (a member number included), legacy secrets,
  experiments, provider sign-in and payment windows.
- [CLAUDE.md](../CLAUDE.md): conventions for working in the code (IPC, migrations, checks).
- [Tests](../tests/README.md): the Jest suite, fixtures and the Electron smoke tests.

## Providers

- [Providers](providers/README.md): the providers matrix and the provider SDK.
- [Adding a provider](providers/adding-a-provider.md): a quick start (`npm run provider:new`,
  then preview it in the app), and API and browser providers step by step, with compiling
  examples of holds and sign-in.
- [Browser providers](providers/browser-providers.md): providers with no API.
- [ParkStay WA](providers/parkstay/README.md): the manifest, releases, data and terms.
  - [Endpoints](providers/parkstay/endpoints.md): what is requested, with verification status.
  - [Sign-in](providers/parkstay/authentication.md): the in-app sign-in window.
- [RAC Parks & Resorts](providers/rac/README.md): the manifest, the parks, availability, pacing,
  releases, the member number and RAC's terms.
  - [Endpoints](providers/rac/endpoints.md): what is requested, with verification status, and
    RAC's codes.
  - [Release calendar](providers/rac/release-calendar.md): keeping the school-holiday release
    days current.
- [Stay Rottnest](providers/rottnest/README.md): the manifest, the precincts, the shared search,
  booking rules, Open Days and plans, the notice and Stay Rottnest's terms.
  - [Endpoints](providers/rottnest/endpoints.md): the one request, with verification status,
    and what is never used.
  - [Open Days and booking guides](providers/rottnest/open-days.md): keeping the Open Days,
    booking guides and public holidays current.

## Design

Owned by the design stream; the source of truth for the UI.

- [Design language](design/design-language.md): palette, type, motion, the brushstroke.
- [Components](design/components.md): the `components/ui` primitives.
- [Shell](design/shell.md): navigation, routes and stable accessible names.
- [Map](design/map.md): Explore's map style and layers.

## Releasing

- [Release process](release-process.md): checks, the changelog rule, the pipeline, the 2.0.0
  rename, the repository description.
- [2.0 release checklist](release-checklist-2.0.md): the manual checks for 2.0.0.
- [Code signing](code-signing.md).
- [Website](website.md): the public page in `site/`, publishing it to GitHub Pages, and a
  custom domain.
- [Brand and icons](../resources/README.md).
