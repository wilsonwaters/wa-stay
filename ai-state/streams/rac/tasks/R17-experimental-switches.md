# R17: Experimental provider switches

## Description
RAC's auto-cart must ship switched off. The stakeholder turns it on only after verifying it with one genuine booking of their own (brief R2, RQ2). This task builds the generic switch for that:
- a provider declares **experiments** in its manifest, each turning on one or more capabilities;
- the person turns one on in Settings → Accounts, on the provider's row;
- it takes effect when WA Stay restarts.

Capability flags drive every screen. Applying experiments before the registry parses and freezes the manifest keeps the UI honest: no screen offers something the running app cannot do (master plan, decision 1).

No provider declares an experiment in this task. R19 declares RAC's `autoCart`.

## Size
M

## Depends on
R15 (the Accounts row it extends; the `provider.types.ts` edit order in Lane S)

## Scope
1. **Manifest** (`src/shared/types/provider.types.ts`):
   - `ProviderManifest.experiments?: ProviderExperiment[]`, where `ProviderExperiment = { id; label; description; warning?; turnsOn: BooleanCapability[] }`.
   - `ProviderManifestSchema` checks it:
     - ids are unique and match `^[a-z][A-Za-z0-9]{1,31}$`;
     - `label` and `description` are non-empty;
     - `turnsOn` is non-empty, and each entry is a boolean capability that is **off** in the manifest.
   - A new `MANIFEST_RULES` entry (`registry.ts:85`): the manifest with every experiment applied still passes the other manifest rules.
2. **State** (main only):
   - The stored state is the `provider_state` row `('<providerId>', 'core.experiments')`, with the value `{ [experimentId]: boolean }`.
   - A small `ProviderExperiments` service (`src/main/providers/experiments.ts`) reads and writes it through `ProviderStateRepository`.
   - A provider's own `ctx.state` can no longer get, set or delete `core.*` keys, and `list()` leaves them out. Today nothing stops a provider from turning on its own experiment (`provider-state.repository.ts:91-112`). Core services keep using the repository directly.
3. **Applied at registration** (`registerBuiltInProviders`, `src/main/providers/index.ts:25`):
   - For each factory, it reads the stored state and registers a factory whose manifest has the enabled experiments' capabilities turned on. This happens before `registry.register` parses and freezes the manifest (`registry.ts:322-327,350`), so `ctx.manifest` is the applied manifest too.
   - Export `withExperiments(factory, ids)` for tests: R19 runs RAC's contract suite with it.
   - An experiment that is stored on but no longer declared is ignored, with a warning.
   - If registration with experiments fails, the provider is registered without them. The failure is logged, and the experiment reads `failed: true`.
4. **IPC** (`providers` namespace: channel in `contracts/channels.ts`, definition in `contracts/providers.ts`, handler in `ipc/handlers/providers.handlers.ts`, preload mapper; the parity tests enforce all four):
   - `providers.experiments({ providerId })` returns `ProviderExperimentState[]`, each `{ id, enabled, active, failed? }`: `enabled` is the stored value, `active` is whether it applies in this run.
   - `providers.setExperiment({ providerId, experimentId, enabled })` stores the value and returns the same list. An unknown provider is `UNKNOWN_PROVIDER`; an undeclared experiment is `NOT_FOUND`.
   - **Turning off** an experiment that turns on `holds` is refused with `ACCOUNT_BUSY` ("A stay is held on {shortName}. Pay for it or let it go first.") while the container's `isBusy` predicate is true (`container.ts:277`: a QUEUEING, SNIPING or HELD snipe, or an unexpired watch hold).
   - **Off stops new holds at once.** While a `holds` experiment is active but stored off:
     - the watch auto-hold (`watch.service.ts:426-498`) places no hold for that provider and notes "Automatic holds on {shortName} are turning off. Restart WA Stay." The watch alerts as usual;
     - a hold snipe alerts instead, as R12 does for a provider without holds.
     Turning on is never immediate.
   - The log names the provider, the experiment and on or off. Nothing else.
5. **Settings → Accounts** (`features/settings/accounts/AccountRow.tsx`, through new hooks in `renderer/api/providers.ts`):
   - A provider with experiments gets an "Experimental" group in its row, with one `Switch` per experiment showing its label and description, plus "Takes effect when WA Stay restarts".
   - **Turning on** opens a `ConfirmDialog` (`tone="danger"`) titled "Turn on {label}?". It shows the description, the warning and "Takes effect when WA Stay restarts", and its confirm label is "Turn on".
   - **Turning off** needs no confirmation. A refusal shows its message in an alert under the switch, and the switch stays on.
   - While `enabled !== active`, a line under the switch says "Turns on when WA Stay restarts" or "Turns off when WA Stay restarts". With `failed`, it says "Couldn't turn on. See the logs, or turn it off."
6. **Docs here:**
   - `docs/providers/adding-a-provider.md` gets an "Experiments" section (prose and a manifest-table row);
   - CLAUDE.md: the IPC table's `providers` row, the Provider SDK manifest bullet, and the `ACCOUNT_BUSY` wording;
   - `ApiErrorCode`'s comment (`api.types.ts:36`) covers the new refusal.

## Non-goals
- RAC's `autoCart` and everything behind it (R19). Hold release (R18).
- A "Restart now" button, or applying an experiment without a restart.
- Remote or per-user feature flags. Experiments on `account` or `catalogMode`.
- Hiding the switch in packaged builds (RS1's default: shown to everyone, off).

## Completion Criteria
- [ ] Schema and rule tests (~8):
  - accepted: a valid experiment;
  - refused: a duplicate id, an empty `turnsOn`, an unknown capability, a capability already on, `account`, and an applied manifest that breaks "snipes needs release modes".
- [ ] `ctx.state` refuses `core.*` on get, set and delete, and `list()` omits those keys. ParkStay's tests pass unchanged.
- [ ] `tests/unit/providers/experiments.test.ts`, with a fake provider whose `holds` sit behind an experiment:
  - off: `manifest.capabilities.holds` and `ctx.manifest.capabilities.holds` are false, and `provider.holds` is undefined;
  - on: holds is true and the module is there;
  - a stored id that is not declared is ignored, with a warning;
  - an experiment whose module is missing registers without it, logged, `failed: true`.
- [ ] IPC harness tests (`tests/integration/provider-experiments.test.ts`):
  - a round trip of both methods, and the stored row;
  - `active` stays unchanged until a second container is built on the same database (the restart);
  - `ACCOUNT_BUSY` with a HELD snipe, and with an unexpired watch hold;
  - `UNKNOWN_PROVIDER`, `NOT_FOUND`, and `VALIDATION` for a bad payload.
- [ ] Core tests for the pending turn-off: the fake provider's `holds.create` is never called, the watch's note is set, and the hold snipe alerts.
- [ ] The parity tests pass for both new methods.
- [ ] Renderer tests (`features/settings/accounts/Experiments.test.tsx`), with a manifest that declares one experiment:
  - ParkStay's row has no "Experimental" group;
  - on → dialog → "Turn on" → `setExperiment` is called and the pending line shows;
  - Cancel leaves the switch off and makes no call;
  - a refused turn-off shows the alert, and the switch stays on.
- [ ] A11y:
  - the switch has role `switch`, its accessible name is the experiment's label, and its description is linked;
  - the dialog is an `alertdialog` named by its title. Focus starts on Cancel, Escape cancels, and focus goes back to the switch on close;
  - the pending line is announced once (`useAnnounce`);
  - the refusal has `role="alert"`.
- [ ] `npm run provider:new` output (`tests/scripts/new-provider.test.ts`) and `tests/fixtures/providers/example-*` pass unchanged.
- [ ] Docs and CLAUDE.md lines above are updated.
- [ ] Full gate: `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`, then `npm run build:e2e && xvfb-run -a npm run test:e2e`.

## Edge Cases
- **Stored value that is not an object of booleans** (corrupt JSON, an array): everything reads as off, with a warning. The next `setExperiment` rewrites the row.
- **An update removes a declared experiment:** the stored id is ignored, and the next write drops it.
- **Setting the current value:** no write, the same answer.
- **On, then off, before a restart:** nothing pending, nothing changes.
- **A provider that failed to register, or was left out by `WA_STAY_PROVIDERS`:** `UNKNOWN_PROVIDER`, and its stored row is untouched.
- **Fixture mode:** experiments apply as normal, so e2e can seed the row before launch (R19 does).
- **Two `setExperiment` calls at once:** the last write wins, and both answers match the stored row.
- **A hold placed in the same second as the turn-off:** the busy check runs first. A hold that is already placed refuses the turn-off.

## Test Strategy
- **Unit (~18):** schema and rule, state-key guard, applying experiments and the fallback, pending turn-off checks in the watch and snipe paths.
- **Component (~6):** the Experimental group, the dialog flow, the refusal, the pending line, and the a11y assertions above.
- **Integration (~6):** an IPC harness round trip, the refusals, and a "restart" with a second container on the same database.
- **E2E:** none new: no built-in provider declares an experiment until R19, which adds the journey (turn on, relaunch, see the hold option). The existing 22 journeys must pass.

## Context Files to Read First
- `CLAUDE.md` ("Provider SDK", "IPC Pattern", "Composition root")
- `ai-state/streams/rac/master-plan.md` (decision 1, contract additions, RS1)
- `src/shared/types/provider.types.ts`, `src/main/providers/sdk/manifest.ts`, `src/main/providers/registry.ts`, `src/main/providers/index.ts`
- `src/main/providers/sdk/context.ts`, `src/main/providers/sdk/kv-store.ts`, `src/main/database/repositories/provider-state.repository.ts`
- `src/main/app/container.ts` (provider registration, `isBusy`)
- `src/main/core/watches/watch.service.ts` (auto-hold), `src/main/core/snipes/snipe.service.ts` (hold path, as R12 leaves it)
- `src/shared/contracts/providers.ts`, `src/shared/contracts/channels.ts`, `src/main/ipc/handlers/providers.handlers.ts`, `src/preload/index.ts`
- `src/renderer/features/settings/accounts/AccountRow.tsx`, `AccountsSection.tsx`, `src/renderer/components/ui/Switch.tsx`, `ConfirmDialog.tsx`
- `ai-state/streams/rac/tasks/R15-credentials-accounts.md`

## Notes
- **Why a restart:** the manifest is frozen at registration and read by the renderer. A runtime gate would show options that then fail, and the provider's factory decides at build time which modules exist.
- **Why off acts at once for holds:** without it, an auto-hold watch could still put a stay in the cart between the turn-off and the restart, and the app could not pay for that hold or release it afterwards.
- `core.` is already the core's prefix in `provider_state` (`core.catalog.sync`, `core.catalog.search`).

## Assumptions
- `providers.experiments` (a read method) is needed beside the plan's `providers.setExperiment`, so a pending change still shows after the page reloads. This is a small contract addition beyond the master plan's table.
- The turn-off refusal reuses `ACCOUNT_BUSY` (its meaning widens to "a hold or snipe needs this") rather than adding a new error code.
- Stopping new holds while a turn-off is pending is this spec's addition to the plan. It needs a one-line check in the watch and snipe hold paths.
- RS1 is still open: the switch is shown to everyone, off, with a warning and a confirm dialog. If the stakeholder wants it in developer builds only, gate the group on `runsFromSource` instead.
