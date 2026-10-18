# R15: Credentials accounts

## Description
As a person, I can save an account detail a provider asks for, such as my RAC member number (R16), once, in Settings → Accounts. It is encrypted on my computer and never shown back to me. I can replace it, remove it, or copy it to paste at the provider's checkout.

This task implements the SDK's `credentials` sign-in kind, which is declared and validated (`sdk/provider.ts:287-301`, `registry.ts:138-142`) but refused by the account service (`provider-account.service.ts:351-365`). It does so minimally and generically, for every provider. No built-in provider uses it until R16.

Values are write-only over IPC, as the SMTP password is (`core/notifications/notifier-view.ts`). They are never logged, never returned to the renderer, and never sent by the core (brief R5, RO4; terms rules 11–12).

## Size
M. At the top of M: the SDK, core, IPC and renderer parts are each small.

## Depends on
R12, for lane order only: both edit `src/shared/types/provider.types.ts`. There is no functional dependency.

## Scope
1. **SDK and types:**
   - `CredentialsAuth.confirmations?: readonly AccountConfirmation[]`, where `AccountConfirmation = { key; label }`: statements the person must tick to save (R16 adds RAC's three, rule 11);
   - `AccountFieldDescriptor.copyable?: boolean`, default false. Only these fields can be copied, so a future password field is never put on the clipboard;
   - `ProviderAccount` gains `authKind`, `fields?` and `confirmations?` (credentials only), and `savedFields?: string[]`: the keys that have a stored value, never a value;
   - schemas and type-equality tests for each;
   - `registry.secretsOf(id)` returns the provider's `ScopedSecretVault` (its context's `secrets`), like `httpOf` (`registry.ts:380-384`).
2. **`ProviderAccountService`:**
   - **`saveCredentials(providerId, values, confirmed)`**:
     - The provider's auth must be `credentials`. Otherwise it is `VALIDATION`: "{shortName} doesn't use saved details".
     - `values` must have exactly the declared keys. Each value is trimmed, non-empty, and at most 256 characters.
     - `confirmed` must contain every confirmation key.
     - Otherwise it is `VALIDATION`, with issue paths `values.<key>` or `confirmed`. A message never quotes a value.
     - Then it calls `auth.signIn(values, httpOf(id), signal)`, within the probe limit (15 s):
       - `signed-in`: each value is stored with `secretsOf(id).set('account.<key>', value)`, all or nothing (on a failure, the keys already written are deleted). The row is upserted as signed in with `lastSignedInAt`. `account:updated` is emitted and the account returned;
       - `signed-out`: `VALIDATION` "{shortName} didn't accept these details". Nothing is stored;
       - `unknown`: `PROVIDER_ERROR` "Couldn't check these details. Try again." Nothing is stored.
     - Saving again replaces every value.
     - Saves are single-flight per provider.
   - **Status** of a credentials account: `signed-in` when every field has a stored value, otherwise `signed-out`. It is worked out main-side: `auth.isSignedIn` is never called, so no request is made. `refreshStale` and the start-up check skip these providers.
   - **`signOut`** for credentials deletes every `account.<key>` and stores `signed-out`. No partition clear and no `ACCOUNT_BUSY`: there is no session to lose.
   - **`copyCredential(providerId, key)`**:
     - the field must be declared, copyable and saved. Otherwise `VALIDATION`, or `NOT_FOUND` when it is not saved;
     - main reads the value and writes it through a `Clipboard` port (Electron `clipboard.writeText`, wired in `app/container.ts`; faked in tests);
     - it returns nothing.
   - **Change hook:** `ProviderAccountServiceDeps.onCredentialsChanged?(providerId)` is called after a save, a replace and a removal, with the provider id only. R16 wires it in the container: it drops RAC's availability caches and re-arms snipes, so R14's instants are asked again.
   - **`signIn` (the window)** stays `NOT_IMPLEMENTED` for credentials: the renderer never calls it.
3. **IPC:**
   - `accounts.saveCredentials({ providerId, values, confirmed })` returns a `ProviderAccount`;
   - `accounts.copyCredential({ providerId, key })` returns nothing.

   For each: `contracts/channels.ts`, `contracts/accounts.ts` (zod schemas and type equality), `ipc/handlers/accounts.handlers.ts`, the preload's mappers, `src/preload/window.d.ts` and `src/renderer/api/accounts.ts`. The hooks `useSaveCredentials` and `useCopyCredential` keep no value in the React Query cache. `handle()` already logs no payload values.
4. **Renderer** (`src/renderer/features/settings/accounts/`), generic. For `authKind: 'credentials'`, `AccountRow` shows:
   - **Status:** "{label} saved", or "Not added".
   - **Buttons:** "Add {label}" (or "Add details" when there are several fields), "Replace", "Remove", and "Copy {label}" for each copyable saved field.
   - **Add or Replace** opens a `Dialog` titled "{shortName} account". It has:
     - one field per descriptor, with its label and help. Secret fields are masked, with `autocomplete="off"` and `spellcheck={false}`;
     - the confirmations as checkboxes;
     - a Save button disabled until every confirmation is ticked, with the hint "Tick each statement to save."

     Errors show on their field or in a `Notice`. On success the dialog closes, the form resets (the value leaves memory), and "{label} saved" is announced.
   - **Remove** confirms first: "Remove your {label}? WA Stay forgets it; you can add it again any time." Then it calls `signOut`.
   - **Copy** announces "Copied" (a failure shows a toast).
   - The strings go in `accountText.ts`. Build from `components/ui`, following `SecretField.tsx`'s saved and replace pattern.
5. **Test support:** `tests/utils/fake-provider.ts` gets an option for a `credentials` auth, with fields, a confirmation, a copyable field, and a scripted `signIn` answer.
6. **Docs:**
   - **CLAUDE.md:** the IPC table's `accounts` row; the ProviderAccountService row; the Provider SDK `auth` bullet (`credentials` implemented); Secrets (account values are kept as `account.<key>` in the provider's vault, write-only over IPC).
   - **`docs/providers/adding-a-provider.md`**, the sign-in section: fields, `confirmations`, `copyable`, what `signIn` checks, and where values live. A code block only if it is a source region of a compiling example (the docs test).
   - **`docs/security.md`.**
   - **`ai-state/architecture-notes.md`:** a credentials item in §12.35 (R12 created it), amending §12.30's "declared and validated only".

## Non-goals
- RAC's `credentials` auth, its fields and confirmations, its format check, and the copy button by "Book on RAC" (R16).
- `automation` sign-in.
- More than one set of values per provider.
- Checking a value with the provider over the network.
- The Experimental switch (R17).
- Website copy about the member number (R16 and R20).

## Completion Criteria
- [ ] `tests/unit/core/provider-account.service.test.ts`, `describe('credentials accounts')`:
  - with `FakeSecretVault`, saving stores ciphertext under `secret:account.<key>` in `provider_state`, and the row does not contain the plaintext;
  - replace and remove work;
  - saving without the confirmations is `VALIDATION` with `['confirmed']`;
  - an unknown or missing field is `VALIDATION` with `values.<key>`;
  - `signed-out` and `unknown` answers store nothing;
  - the status is worked out with no call to `isSignedIn` and no HTTP request.
- [ ] `tests/integration/credentials-leak.test.ts`, through the IPC harness: a sentinel value is never in:
  - any IPC response (`list`, `status`, `saveCredentials`, `signOut`, `copyCredential`, and each `VALIDATION`);
  - any `account:updated` payload;
  - any log line;
  - any request the FakeProvider's HTTP client sees.

  The clipboard port receives it exactly once, on copy.
- [ ] `copyCredential` refuses a field that is not copyable, and one that is not saved.
- [ ] Saving, replacing and removing each call `onCredentialsChanged` once, with the provider id and nothing else.
- [ ] The contract parity tests (`tests/unit/ipc/contract.test.ts`) and the preload tests pass with both channels.
- [ ] `tests/integration/accounts-ipc.test.ts` and `AccountsSection.test.tsx` pass for `browser-session` providers. They change only to accept the new `ProviderAccount` fields.
- [ ] `AccountsSection.test.tsx`, credentials cases:
  - add, replace, remove and copy work;
  - after a save, the typed value is nowhere in the DOM.
- [ ] **Accessibility** (asserted in those tests):
  - on open, focus goes to the dialog's first field; Cancel or Escape returns it to the opener; after a save it returns to the row's button;
  - each field has a visible label, and its help is linked with `aria-describedby`;
  - errors use `role="alert"` and are linked to their field;
  - each checkbox's accessible name is its statement;
  - the disabled Save explains why;
  - "{label} saved", "Copied" and the removal are announced in a polite live region.
- [ ] Docs and §12.35 are updated as listed.
- [ ] The full gate passes: `npm run lint && npm run format:check && npm run type-check && npm test && npm run test:tz`, then `npm run build:e2e && xvfb-run -a npm run test:e2e`.
- [ ] The CLAUDE.md lines this task makes stale (the IPC table, ProviderAccountService, the SDK `auth` bullet, Secrets) are updated.
- [ ] The website needs no change: no shipped provider uses credentials until R16.

## Edge Cases
- **Vault not ready** (before `ready`) or an unreadable secret:
  - a save fails with `INTERNAL` and nothing is stored;
  - copy answers "Couldn't read your saved {label}. Add it again.";
  - the status reads `signed-out`, with one warning that names the key only.
- **Two saves at once:** the second waits for the first. The dialog disables Save while one is pending.
- **Quit during a save:** all or nothing, so no half-saved set is left.
- **Odd values:** spaces and dashes are trimmed by the core; reformatting belongs to the provider's `signIn` (R16 strips dashes, as RAC's own page does). Unicode is kept. Over 256 characters is `VALIDATION`.
- **Wrong provider:** `saveCredentials` for a `browser-session` provider is `VALIDATION`. For an unknown id it is `UNKNOWN_PROVIDER`; for a provider with no account, `CAPABILITY`.
- **A value inside an error message:** zod and handler messages never quote a value (the leak test checks it).
- **Removing while a snipe is armed:** the hook fires, and R16's wiring re-arms it with the public timing. Nothing in flight is lost.
- **Clipboard:** it is not cleared later by itself. Copy is an explicit action by the person.
- **Linux CI:** the clipboard port is faked, and no real clipboard is touched.
- **No migration:** values live in `provider_state`, which already exists.

## Test Strategy
- **Unit (~14):** service save, replace, remove, refusals, status, copy and the change hook; schemas; registry `secretsOf`; `accountText`.
- **Component (~10):** the credentials row states; the dialog's focus, labels, confirmations, errors and reset; remove; copy and its announcement.
- **Integration (~4):** the leak test; IPC parity; `accounts-ipc` with a credentials FakeProvider; the container wiring of the clipboard.
- **E2E:** none new. No built-in provider has credentials until R16. The suite still runs, because the renderer and IPC change.

## Context Files to Read First
- `CLAUDE.md` ("Secrets", "IPC Pattern", "Key Services")
- `ai-state/streams/rac/master-plan.md` (design decision 5; terms rules 11, 12)
- `ai-state/architecture-notes.md` (§4, §7, §12.30, §12.32)
- `src/main/core/accounts/provider-account.service.ts`; `src/main/core/accounts/ports.ts`
- `src/main/providers/sdk/provider.ts`; `src/main/providers/sdk/secrets.ts`; `src/main/providers/registry.ts`
- `src/shared/types/provider.types.ts` (`AccountFieldDescriptor`, `:134-142`; `ProviderAccount`, `:342-352`)
- `src/shared/contracts/accounts.ts`, `channels.ts`; `src/main/ipc/handlers/accounts.handlers.ts`; `src/main/ipc/handle.ts`; `src/preload/index.ts`
- `src/main/app/container.ts`; `src/main/core/notifications/notifier-view.ts`
- `src/renderer/features/settings/accounts/*`; `src/renderer/features/settings/notifications/email/SecretField.tsx`
- `tests/utils/fake-provider.ts`; `tests/integration/accounts-ipc.test.ts`; `docs/security.md`

## Notes
- **Why main writes the clipboard.** The renderer never receives the value, so the copy button is a request to main, not a read.
- **Contract additions** (now in the master plan's table): `AccountFieldDescriptor.copyable` and the `onCredentialsChanged` hook. R16 relies on both: the first for terms rule 12, the second for R14's member timing (brief R3).

## Assumptions
1. Removing credentials does not clear the provider's session partition, and is never `ACCOUNT_BUSY`.
2. The clipboard is not cleared later by itself.
3. `confirmed` is a list of confirmation keys, not one boolean, so each statement is checked.
