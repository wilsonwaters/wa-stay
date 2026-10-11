# Design system — master plan

**Label:** `stream:design-system` · **Lane:** R (renderer) · **Owner:** renderer agent + stakeholder design review

## Goal

Give WA Stay a design language people would call distinctive and calm rather than "AI-built". It is Airbnb-like in structure and Western Australian in mood: Indian Ocean blue, sun gold, black-swan ink, coral, sand and eucalypt. The stream delivers:

1. A written design language (`docs/design/design-language.md`), semantic design tokens (CSS variables, then Tailwind), bundled fonts (Figtree and Fraunces), lucide icons and a dev-only `/__design` preview route.
2. An accessible primitive library in `src/renderer/components/ui/`. Every other renderer stream builds only from it.
3. A new app shell in `src/renderer/app/`. It has a top header and nav, no login gate, a route table organised by feature, a React Query `renderer/api/*` layer and a floating tray that stops overlays overlapping.

When the stream is done, the app opens on `/` inside the new shell. Legacy pages still work, restyled through the tokens, until the provider-ux stream rebuilds them.

## Task list

| ID | Task | Size | Depends | Status |
|---|---|---|---|---|
| D1 | [Design language, tokens, fonts, icons, `/__design`](tasks/D1-design-language-and-tokens.md): doc, palette with verified AA pairs, Tailwind on CSS variables, Figtree/Fraunces, lucide at stroke 1.75, brushstroke and photo-placeholder atoms, token-guard test | M | none | ⬜ |
| D2 | [UI component library](tasks/D2-ui-component-library.md): about 30 accessible primitives (forms, overlays, feedback, Toast provider, ProviderBadge, DateRange/Guests fields, Combobox), behaviour-based tests, legacy Spinner/ConfirmDialog/Toast replaced | L | D1 | ⬜ |
| D3 | [App shell](tasks/D3-app-shell.md): `renderer/app/` header and nav (aria-current, brushstroke indicator, Soon pills), account menu, no login gate, feature route table, React Query and `renderer/api/*` hooks, tray, error boundaries, 404, route focus, min window size | M | D2, V1 | ⬜ |

Execution order: D1, then D2, then D3 (lane R). D1 can start immediately. D2 does not need V1, because ProviderBadge uses a structural type. D3 waits for V1, which supplies `providers.list` and the shared contract.

## Integration points

| With | What crosses the boundary | Owner of the seam |
|---|---|---|
| **B1** brand assets | B1 uses the D1 palette tokens and brushstroke SVGs (`src/renderer/assets/brush/`) for the original logo. D3 shows `src/renderer/assets/brand/logo-lockup.svg` if B1 has landed, and otherwise a text `Wordmark` in Fraunces. | D1 → B1 → D3 |
| **V1** provider contract | D2 `ProviderBadge` takes a structural `ProviderBadgeInfo` (`id, name, shortName, brand{color,monogram}`) that is assignable from `ProviderManifest`. D3 populates `ProviderManifestsProvider` from `useProviders()`. | V1 |
| **P3 / P6** IPC and preload | The D3 hooks call `window.api.<namespace>` exactly as typed in `src/shared/contracts/`. `events.on()` returns an unsubscribe function. D3 adds no IPC. | P3 |
| **P4** hardening | CSP `font-src 'self'` covers the bundled fonts. External links use `<a target="_blank">` and rely on `setWindowOpenHandler` → `shell.openExternal`. D3 sets `minWidth: 960, minHeight: 640` in `src/main/app/main-window.ts` (a single-line change; tell P4 if it is in flight). | P4 |
| **E1–E3** Explore | These tasks use `components/ui/*`, `ROUTES`/`buildPath` from `app/routes.ts`, the `api/` patterns (`unwrap`, `queryKeys`, `useApiEvent`), the tray (map attribution must stay uncovered) and `useAnnounce`. D3 renders a placeholder `ExplorePage` at `/` until E1 replaces it. | D3 → E1 |
| **U1–U5** provider-first UX | U1–U5 rebuild the legacy pages that D3 moves to `features/<domain>/legacy/`, using D2 primitives, and delete the legacy folders as they go. U5 rebuilds QueueStatus, UpdateNotification, NotificationBell and About inside the D3 header and tray slots. U4 owns `/settings/:section?` (§12.10). | U-stream |
| **Q1** smoke E2E | Q1 relies on stable accessible names that D3 documents in `docs/design/shell.md`: nav links "Explore", "Watches", "Site Sniper, coming soon", "Bookings, coming soon"; the "Account and settings" button; one `h1` per page. | D3 → Q1 |
| **B2** identity rename | The `index.html` `<title>` and the BrowserWindow title belong to B2. The D3 header wordmark only renders "WA Stay". | B2 |
| **P1** test infra | Renderer tests run in the jsdom project. D3 adds shared test helpers in `tests/utils/renderer/` (`renderWithApp`, `createMockApi`). | P1 → D3 |

### Guard tests (shared enforcement)

- **Token guard** (D1, `tests/unit/design/token-guard.test.ts`). In `components/ui`, `app`, `features` (excluding `features/*/legacy`), `api` and `components/LocationCard*`, it fails on raw Tailwind palette classes (`bg-gray-500`, `text-primary-600`), hex literals and emoji.
- **API boundary guard** (D3, `tests/unit/renderer/api-boundary.test.ts`). It fails if `window.api` appears outside `src/renderer/api/**`. An explicit allow-list covers the legacy files, and each U task removes its entries.

## Out of scope

- A dark theme (brief). Tokens are structured so one could be added later, but no `dark:` variants are written.
- Storybook or any separate component workbench. The dev-only `/__design` route does this job.
- Redesigning the legacy pages (Watches, Site Sniper, Bookings, Settings). They pick up the new tokens through the legacy bridge, and the U-stream rebuilds them.
- The logo, app icon and installer art (B1), and window/product renaming (B2).
- Domain composites such as LocationCard, NightGrid and the search pill (E1/E2), and watch/snipe forms (U1/U2).
- i18n frameworks. The UI is en-AU only, with copy rules in the design language doc.
- A custom frameless title bar. The native frame stays.
- Removing Tailwind's default palette. That happens after the U-stream deletes the last legacy page and is logged for P7/Q2.

## Open questions

| # | Question | Blocks | Proposed default |
|---|---|---|---|
| DQ1 | D2 holds about 30 primitives, more than 8 hours of work. Should it run as D2a (form and feedback: Button…Field, Badge, Spinner, Skeleton, Notice, Toast, EmptyState, PageHeader, Card) and D2b (overlays and composite: Dialog, Sheet, Menu, Popover, Tooltip, Tabs, SegmentedControl, Combobox, DateRangeField, GuestsField, ProviderBadge)? | D2 plan approval | Keep one issue with two commits in that order. Split if plan review estimates more than 2 days. |
| DQ2 | Primary CTA colour: **coral-600 `#C4432A`** (Airbnb-like warmth, stands out against blue water and green parks), with ocean as the brand colour. Does the stakeholder sign off? | D1 design approval | Coral CTA |
| DQ3 | Raise the minimum window size from 800×600 to **960×640** so the header and the Explore split view never break. | D3 | 960×640 |
| DQ4 | ~~Combobox addition~~: settled by architecture-notes §12.8, which also adds Disclosure, RadioCard and Stepper. | — | Resolved |
| DQ5 | `Popover`, `Notice`, `VisuallyHidden` and `useAnnounce` have been added to D2 because DateRange, Guests, filter chips and error alerts need them. Confirm. | D2 | Include |

## Changelog

- **2026-10-02:** Stream master plan created with D1–D3 specs. D2 additions (Combobox, Popover, Notice, VisuallyHidden, useAnnounce) and the 960×640 minimum window are recorded as open questions DQ3–DQ5.
- **2026-10-02:** Aligned with architecture-notes §12. D2 adds Disclosure, RadioCard and a standalone Stepper (§12.8). D3 routes follow §12.10 (`/site-sniper/:id`, `/settings/:section?`, create redirects keep the query string). DQ4 is now settled by §12.8.
