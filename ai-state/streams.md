# Streams — WA Stay

Status key: ⬜ not started · 🟦 in progress · ✅ done

| Stream | Label | Outcome | Size | Status |
|---|---|---|---|---|
| Platform | `stream:platform` | The main process is well-layered, secure and testable: one repository pattern, transactional migrations, typed and validated IPC, hardened windows, OS-backed secrets, a sandboxed preload, no dead code. | L | ⬜ |
| Providers | `stream:providers` | Accommodation providers are plug-in modules behind one SDK. ParkStay is the first module. Core services (watch, snipe, booking, catalogue, accounts) are provider-agnostic. A browser-automation runtime exists for providers with no API. | L | ⬜ |
| Brand & migration | `stream:brand-migration` | The app is WA Stay everywhere (assets, installer, emails). Existing installs upgrade in place with all data carried over. | M | ⬜ |
| Design system | `stream:design-system` | A documented WA Stay design language, a tokenised Tailwind theme, an accessible component library, and a new top-nav app shell with no login gate. | L | ⬜ |
| Explore | `stream:explore` | Users discover accommodation on a Mapbox map plus search, open a rich location detail view, and see date-aware availability. | L | ⬜ |
| Provider-first UX | `stream:provider-ux` | Watches, Site Sniper, Bookings, Settings/Accounts and notifications are rebuilt on the design system. They are provider-first, and every item shows its provider. | L | ⬜ |
| Docs & quality | `stream:docs` | Electron smoke E2E. The README, docs, developer guide (adding a provider), CLAUDE.md and CHANGELOG describe WA Stay. | M | ⬜ |

## Task map

Size = S/M/L per methodology. "→" = depends on.

### Platform (P)
| ID | Task | Size | Depends |
|---|---|---|---|
| P1 (#12) | Test infrastructure: Jest projects (node vs jsdom), honest setup files, native-ABI guard | M | — |
| P2 (#13) | Database foundation: single injected repository pattern, transactional migrations, v7 integrity migration | L | P1 |
| P3 (#14) | Composition root and typed IPC layer, notifier rename, preload subscriptions with unsubscribe | L | P2 |
| P4 (#15) | Main-process hardening: single instance, external links, CSP, logging, crash policy, no secrets to renderer, Gmail OAuth fixes | L | P3 |
| P5 (#16) | Secret vault on Electron `safeStorage` with legacy migration | M | P3 |
| P6 (#17) | Bundled, sandboxed preload | M | P3 |
| P7 (#18) | Dead code and constants cleanup | S | V3 |

### Providers (V)
| ID | Task | Size | Depends |
|---|---|---|---|
| V1 (#19) | Provider SDK and contract (types, interface, registry, context, IPC contract) | L | P3 |
| V2 (#20) | Provider-aware data model (migration v8) | L | P2, V1 |
| V3 (#21) | ParkStay provider module (catalogue, availability, queue, release policy, holds; sniper fixes) | L | V1 |
| V4 (#22) | Provider-agnostic core services and scheduler correctness | L | V2, V3 |
| V5 (#23) | Location catalogue service (sync, search, detail, bulk availability) | M | V2, V3 |
| V6 (#24) | Provider accounts and in-app sign-in (ParkStay), payment hand-off | L | V1, V3, P5 |
| V7 (#25) | Browser automation runtime (playwright-core) and developer contract | M | V1 |

### Brand & migration (B)
| ID | Task | Size | Depends |
|---|---|---|---|
| B1 (#26) | Brand assets: original logo, icon set, installer art, banner | M | D1 |
| B2 (#27) | App identity rename (product, package, window, emails, installer, publish repo) | M | P4 |
| B3 (#28) | Legacy install migration (userData move, DB copy, auto-launch, shortcuts) | M | B2, V2 |

### Design system (D)
| ID | Task | Size | Depends |
|---|---|---|---|
| D1 (#29) | Design language doc and Tailwind tokens, fonts, icons | M | — |
| D2 (#30) | UI component library (accessible primitives) | L | D1 |
| D3 (#31) | App shell: top navigation, no login gate, data-fetching layer, floating tray | M | D2, V1 |

### Explore (E)
| ID | Task | Size | Depends |
|---|---|---|---|
| E1 (#32) | Explore screen: search bar, Mapbox map, result list, filters, token wiring | L | D3, V5 |
| E2 (#33) | Location detail view | M | E1 |
| E3 (#34) | Date-aware discovery (availability on map and cards) | M | E1, V5 |

### Provider-first UX (U)
| ID | Task | Size | Depends |
|---|---|---|---|
| U1 (#35) | Watches rebuilt provider-first | L | D3, V4, V5 |
| U2 (#36) | Site Sniper rebuilt provider-first ("Soon") | M | U1, V6 |
| U3 (#37) | Bookings rebuilt provider-first ("Soon") | M | D3, V4 |
| U4 (#38) | Settings and Accounts | L | D3, V6, P4 |
| U5 (#39) | Notifications, queue status, update and About surfaces | M | D3 |

### Docs & quality (Q)
| ID | Task | Size | Depends |
|---|---|---|---|
| Q1 (#40) | Electron smoke E2E suite (Playwright `_electron`) | M | D3 |
| Q2 (#41) | Documentation: README, docs, provider developer guide, CLAUDE.md, CHANGELOG | M | most |

## Execution lanes

All work lands on `ccr-da6e94c0-litpr7`. Lanes run in parallel git worktrees and are merged into the feature branch after review.

- **Lane M (main process):** P1 → P2 → P3 → {P4, P5, P6} → V1 → {V2, V3, V7} → V4 → V5 → V6 → B2 → B3 → P7
- **Lane R (renderer):** D1 → D2 → D3 → E1 → E2 → E3 → U1 → U3 → U2 → U4 → U5
- **Lane A (assets/docs):** B1 (after D1) → Q1 → Q2

## Project 2 — RAC

Brief: the Project 2 section of `ai-state/brief.md`. Master plan: `ai-state/streams/rac/master-plan.md`. One stream, with four lanes.

| Stream | Label | Outcome | Size | Status |
|---|---|---|---|---|
| RAC | `stream:rac` | RAC Parks & Resorts is the second provider: its eight parks on Explore with free counts and prices, watches that alert with a one-click booking page, release-alert snipes (member-aware), an optional encrypted member number, and auto-cart built but switched off. A provider-neutral "Stay type" filter works across ParkStay and RAC in Explore, watches and snipes. | L | ⬜ |

### Task map

Size = S/M/L per methodology. "→" = depends on.

#### RAC (R)
| ID | Task | Size | Depends |
|---|---|---|---|
| R1 | Stay-type foundation: `UnitKind`, unit and location kinds, `byKind`, migration v11, catalogue filter and facet, ParkStay mapping | M | — |
| R2 | Polite request pacing: `limits.minRequestIntervalMs`, paced client, scaled catalogue deadlines, form-field fixture routes | M | R1 |
| R3 | Stay-type criteria for watches and snipes (core) | S | R1 |
| R4 | Explore "Stay type" chip replacing "Type"; free counts by stay type | M | R1 |
| R5 | RAC catalogue on Explore: scaffold, manifest, park seed, place detail, links, RAC client, fixtures | M | R2 |
| R6 | Stay type in watch and snipe flows; UnitPicker grouped by kind | M | R3, R4 |
| R7 | Alerts that open the booking page (one click) | M | R2 |
| R8 | Minimum stays, arrival-day rules and rate notes | M | R3, R7 |
| R9 | Unit nouns from stay types; no hard-coded "site" | M | R6, R7, R8 |
| R10 | RAC availability, prices and watches | M | R5, R7, R8 |
| R11 | RAC free counts on Explore; `PREVIEW_PROVIDER=rac` preview | M | R4, R10 |
| R12 | Release-alert snipes: core (snipes without holds, `action`, v12, `ALERTED`, window cap, stop on 403/429) | M | R3, R8, R9 |
| R13 | Release-alert snipes: Site Sniper screens | M | R12 |
| R14 | RAC release policy and snipes (rolling, school holidays, member pre-sale; fake-clock tests) | M | R10, R12 |
| R15 | Credentials accounts: write-only `accounts.saveCredentials`, main-side copy, Settings form | M | R12 |
| R16 | RAC member number and member rates | M | R14, R15 |
| R17 | Experimental provider switches (`manifest.experiments`, `providers.setExperiment`) | M | R15 |
| R18 | Hold release hooks (`release`, `releaseOnPaymentClose`, estimated expiry) | S | R17 |
| R19 | RAC auto-cart, off by default (fixtures and fakes only) | M | R13, R16, R18 |
| R20 | Docs, website and release notes; final gate | M | all |

### Execution lanes

All work lands on `ccr-573ddb1d-hir0sq`. Tasks that edit `src/shared/types/provider.types.ts` or `src/main/providers/sdk/provider.ts` run in Lane S, in order.

- **Lane S (shared types, core, IPC):** R1 → R2 (R3 beside it) → R7 → R8 → R12 → R15 → R17 → R18
- **Lane U (renderer):** R4 → R6 → R9 → R13
- **Lane P (RAC module):** R5 → R10 → R11 → R14 → R16 → R19
- **Lane D (docs):** R20 last
