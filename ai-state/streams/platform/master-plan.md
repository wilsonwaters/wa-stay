# Platform stream — master plan

**Label:** `stream:platform` · **Lane:** M (main process) · **Owner:** orchestrator · **Status:** ⬜ not started

## Goal

Make the Electron main process well-layered, secure and testable so that every other stream builds on solid ground:

- tests run in the right environment, with honest setup files and a clear native-module error;
- one repository pattern with an injected `Database`, parameterised SQL only, and transactional migrations, including a v7 integrity migration that repairs the delivery-log foreign key;
- one composition root (`src/main/app/container.ts`) and a typed, zod-validated, sender-checked IPC layer generated from `src/shared/contracts/`, with `events.on()` subscriptions that can unsubscribe;
- a hardened shell: single instance, guarded windows, CSP, real log files, a crash policy that keeps snipes alive, and no secrets crossing to the renderer;
- secrets stored with Electron `safeStorage`, migrated transparently from the legacy PBKDF2(machineId) schemes;
- a bundled preload running with `sandbox: true`;
- no dead code, constants or stale status documents.

Binding inputs: `ai-state/architecture-notes.md` §1 (layout), §2 (vocabulary), §4 (IPC surface), §5 (v7), §7 (security baseline). Primary research input: `ai-state/research/tech-review.md`.

## Task list

Status key: ⬜ not started · 🟦 in progress · ✅ done

| ID | Task | Size | Depends | Status | Spec |
|---|---|---|---|---|---|
| P1 | Test infrastructure: Jest `main` (node) and `renderer` (jsdom) projects, honest setup files, pinned clocks, native-ABI pretest guard | M | — | ⬜ | [tasks/P1-test-infrastructure.md](tasks/P1-test-infrastructure.md) |
| P2 | Database foundation: one injected base repository, parameterised SQL, transactional migrations, v7 integrity migration tested from real v5 and v6 fixtures | L | P1 | ⬜ | [tasks/P2-database-foundation.md](tasks/P2-database-foundation.md) |
| P3 | Composition root, typed IPC contracts with zod and sender validation, no renderer `userId`, `events.on()` with unsubscribe, notification provider → notifier rename | L | P2 | ⬜ | [tasks/P3-composition-root-typed-ipc.md](tasks/P3-composition-root-typed-ipc.md) |
| P4 | Main-process hardening: single instance, main window guards, CSP (Mapbox-ready), log files after ready, crash policy, secrets never sent to the renderer, Gmail inbox channels removed, OAuth loopback fixes | L | P3 | ⬜ | [tasks/P4-main-process-hardening.md](tasks/P4-main-process-hardening.md) |
| P5 | SecretVault on `safeStorage` with a versioned envelope, legacy ciphertext migration, explicit "unreadable" state, documented fallback | M | P3 | ⬜ | [tasks/P5-secret-vault.md](tasks/P5-secret-vault.md) |
| P6 | Bundled preload (esbuild) and `sandbox: true` | M | P3 | ⬜ | [tasks/P6-bundled-sandboxed-preload.md](tasks/P6-bundled-sandboxed-preload.md) |
| P7 | Dead code and constants cleanup, scheduled data cleanup, `job_logs` removal, stale root docs | M | V3, V4 | ⬜ | [tasks/P7-dead-code-cleanup.md](tasks/P7-dead-code-cleanup.md) |

### Ordering and parallelism

- P1 → P2 → P3 are strictly sequential: each one changes the foundation the next one builds on.
- P4, P5 and P6 each depend only on P3 and may run in parallel worktrees. They do overlap in a few files, so **merge P4 first** and rebase the others onto it:
  - P4 and P6 both touch `src/main/app/main-window.ts` and `package.json` scripts.
  - P4 and P5 both touch `services/gmail/oauth2-handler.ts`, `services/auth/AuthService.ts` and the notifier repository and handlers.
- V1 can start once P3 has merged. V6 needs P5.
- P7 runs last in lane M (after V4 and B3), so it removes only what is still dead at that point.

## Integration points

### Providers stream (V)

- **V1** registers `ProviderRegistry` in `app/container.ts`. It adds the `providers` and `catalog` namespaces to `shared/contracts/` and maps `ProviderCapabilityError` to an `APIResponse` `code` (`'CAPABILITY'`) in `ipc/handle.ts`. It also builds `ScopedSecretVault` on top of P5's `SecretVault` together with V2's `provider_state` table.
- **V2** writes migration v8 on top of P2's v7. It reuses P2's fixtures (`tests/fixtures/db/`) and the transactional `applyMigration` wrapper. The released v1.2.0 schema is **v5** (v6 never shipped), so v8's upgrade test must start from the v5 fixture as well as the v6 one.
- **V3** replaces P2's `QueueSessionRepository` with `provider_state`, removes the fake ParkStay endpoints (a precondition for P7), and swaps the transitional `queue:status` event for `provider:access-status`.
- **V4** moves services into `core/` and must keep constructor injection: it may not call `new` outside `container.ts`. It emits `watch:updated` and `snipe:updated` through P3's `RendererEvents`.
- **V6** uses P5's vault, uses Gmail OTP from the main process only (P4 removes the inbox channels), and owns the sign-in/payment window policy. P4's guards cover only the main window.

### Design-system stream (D)

- **D3** builds `renderer/api/*` hooks on the `WindowApi` type exported by `shared/contracts`, and uses the unsubscribe function returned by `events.on()`. CSP (P4) forbids inline scripts in production and only allows fonts from `'self'`/`data:`, which matches the bundled `@fontsource-variable` fonts. D3 removes the login gate: see open question 1.

### Brand & migration stream (B)

- **B2** renames the window title (`app/main-window.ts`, created in P4), the Gmail OAuth success page text, `productName`, and the logger's temp-path fallback. B2 also owns `app.setAppUserModelId`.
- **B3** must call `app.setPath('userData', …)` before `ready`. Three Platform pieces depend on that ordering:
  - P4 initialises file logging after `ready`, so log files land in the final folder.
  - P2 opens the DB from a path that B3 supplies (`openDatabase(path)`).
  - P5 must not write any `safeStorage` envelope until the final userData path is set: the OS key material lives in userData (see the P5 notes).
- B3 copies the legacy `gmail-oauth.json` as-is. P5's startup migration then converts it.

### Explore stream (E)

- E1's Mapbox needs P4's CSP allowances: `api.mapbox.com`, `*.tiles.mapbox.com`, `events.mapbox.com` and `blob:` workers. External "View on ParkStay" links rely on P4's `setWindowOpenHandler` sending them to `shell.openExternal`.

### Provider-first UX stream (U)

- **U4** surfaces P4's `hasPassword`/`hasClientSecret` flags and P5's `secretState: 'unreadable'` and vault `backend: 'local'` warnings.
- **U5** uses `events.on('notification:created' | 'updater:*')` and emits `app:navigate`, which P3 declares in the contract (§12.6).
- **U4** and **U5** add their settings keys to P3's typed settings registry (§12.7).

### Docs & quality stream (Q)

- **Q1**'s Electron smoke E2E runs against P6's bundled, sandboxed preload. It reuses P1's Jest projects layout conventions.
- **Q2** owns the final rewrite of CLAUDE.md and the docs. P2 and P3 make the small CLAUDE.md corrections their changes need (migration list, IPC pattern). P7 folds the useful parts of the stale root troubleshooting docs into `docs/development.md`.

### Findings handed to other streams (discovered while planning)

- **Data loss on logout (→ D3, V2, V6).** `App.tsx:51` logout calls `auth.deleteCredentials`, which deletes the `users` row (`AuthService.ts:135-146`). Every watch, booking, snipe and notification has `user_id … ON DELETE CASCADE` (`connection.ts:59,93,138,379`), so logging out wipes all of the user's data. Provider sign-out must never delete the profile row.
- **The v6 schema never shipped (→ B3, V2).** The released v1.2.0 (`dcccfa7`) ships migrations up to v5. v6 (Site Sniper) exists only on this branch, so real upgrades go v5 → v7 → v8.

## Out of scope

- DBCA queue service defects (tech-review #10: unhandled `'error'`, uncancellable `pollUntilActive`, shared keep-alive): **V3**.
- Scheduler correctness (#2 overlapping snipe ticks, #11 hourly clamping, `next_check_at`, `powerMonitor`, stale closures): **V4**.
- Calendar-date storage and timezone handling (#14): **V2**.
- ParkStay authentication, cookie jar and payment hand-off (#3): **V1** and **V6**.
- Notification stubs and dead preload listeners beyond `notification:created` (#15): **V4** and **U5**.
- Renderer redesign, the login gate and dead UI controls: **D** and **U** streams.
- App identity, `appId`/`productName`, userData relocation and installer: **B2** and **B3**.
- Upgrading Electron 28 (OPEN-QUESTIONS Q1), and macOS/Linux release builds.

## Open questions

Each question has a default that the task uses unless the stakeholder overrides it.

| # | Question | Default used | Blocks |
|---|---|---|---|
| 1 | Once D3 removes the login gate, a fresh install has no `users` row, but every watch, snipe and notification has a NOT NULL FK to `users`. Who creates the local profile before V2's v8 lands? | P3 resolves `userId` as the first `users.id` and otherwise returns `code: 'NO_PROFILE'`. V2's v8 makes the profile independent of credentials. D3 must not ship "no gate" before V2, or must accept `NO_PROFILE` errors on create flows in the meantime. | P3, D3 |
| 2 | §2 vocabulary says "notifier" in code, DB and UI, but §5's v7 list does not mention renaming DB objects. Should v7 rename them? | Yes. v7 renames `notification_providers` → `notifiers`, and the rebuilt log column becomes `notifier_channel`. The table is being rebuilt anyway, so this costs nothing. | P2 |
| 3 | §5 asks for a v6 fixture, but the released v1.2.0 is v5. Which fixture should the tests use? | **Resolved by architecture-notes §12.13:** use both a v5 (v1.2.0) and a v6 SQL-dump fixture. | P2 |
| 4 | Secret storage when OS encryption is unavailable, or on Linux with `basic_text`: refuse to store secrets, or use a local key file? | Use a local AES-256-GCM key file (`<userData>/secret-vault.key`, mode 0600). Report `backend: 'local'` so U4 can warn. Upgrade to `os` automatically once it becomes available. | P5 |
| 5 | CSP `img-src`: allow `https:` broadly, or allowlist image hosts declared in provider manifests? | Allow `https:` broadly, so new providers need no core change (brief success criterion 6). Revisit if V1 adds `imageHosts` to the manifest. | P4 |
| 6 | `job_logs` is never written: drop it or start using it? | Drop it in the next free migration version (expected v9, after V2's v8). | P7 |
| 7 | Should `gmail:wait-for-email` and `gmail:test-search` go as well as `get-recent-emails`? | Yes, because §4 says "no inbox reads exposed". The service methods stay available inside the main process for V6. | P4 |

## Changelog

- 2026-10-02 created. Specified P1–P7.
- 2026-10-02 conformed to architecture-notes §12:
  - P2 fixtures are SQL dumps (§12.13).
  - P3 adds the typed settings-key registry (§12.7) and declares the `app:navigate` event (§12.6).
- 2026-10-02 refined two tasks against streams.md:
  - **P7** is resized from S to M. It includes a migration, the cleanup wiring and folding the docs.
  - **P7**'s dependencies change from V3 to V3 + V4, so it no longer races V4's service moves.
