# P5 — SecretVault on Electron safeStorage with legacy migration

**Stream:** platform · **Depends on:** P3

## Description
The three stored-secret schemes are obfuscation, not protection (tech-review #6). The key material is a constant in the source plus a machine id that anyone on the box can read:

| # | Secret | Scheme |
|---|---|---|
| 1 | ParkStay password in `users` | `PBKDF2(machineId + 'parkstay-bookings-v1-secret', 'parkstay-salt', 100000, 32, sha512)` with AES-256-GCM, hex in three columns (`AuthService.ts:13,165-227`) |
| 2 | Notifier config | Same scheme with `'parkstay-notification-providers-v1'` / `'parkstay-provider-salt'`, stored as `iv:tag:hex` (repository renamed by P3; formerly `notification-provider.repository.ts:21,395-460`) |
| 3 | Gmail OAuth client secret and tokens | electron-store 8.2.0 (conf 10.2.0) with the hard-coded `encryptionKey: 'parkstay-gmail-oauth-encryption-key'` (`oauth2-handler.ts:30-33`). conf writes `IV(16 bytes) + ':' + aes-256-cbc` with `pbkdf2(key, iv.toString(), 10000, 32, 'sha512')`. |

On top of that, a failed decrypt silently yields an empty config (formerly `notification-provider.repository.ts:61-66`), so the user just sees "not configured".

Per O7 and architecture-notes §7, secrets move to Electron `safeStorage` behind a versioned envelope. Electron 28.3.3 provides `isEncryptionAvailable`, `encryptString`, `decryptString` and, on Linux, `getSelectedStorageBackend`.

## Size
M

## Scope
- **`src/main/security/secret-vault.ts`**
  - `new SecretVault({ safeStorage: SafeStorageLike, platform, localKey: LocalKeyStore, logger })`.
  - Methods: `encrypt(plain): string`, `decrypt(envelope): string` (throws `SecretUnreadableError`), `isEnvelope(v)`, `needsUpgrade(envelope)` and `status(): { backend: 'os' | 'local' }`.
- **Envelope.** `vault:v1:<backend>:<base64>`. An unknown version or backend is unreadable, with the message "created by a newer version".
- **Backend choice.**
  - `os` when `isEncryptionAvailable()` is true and the backend is not Linux `basic_text`.
  - Otherwise `local`: AES-256-GCM with a random 32-byte key in `<userData>/secret-vault.key`, created with mode 0600 and never logged.
  - Expose `secretStorage: { backend }` in `app.getInfo`.
- **`src/main/security/legacy-decryptors.ts`.** Exact copies of the three legacy algorithms, with the constants verbatim and marked "legacy: never change". The machine id is injected; the container passes `machineIdSync()`. `node-machine-id` is imported only here.
- **`src/main/security/legacy-migration.ts`.** `migrateLegacySecrets({ db, vault, machineId, gmailStorePath })` runs at startup after the DB migrations and before any consumer reads. It is idempotent and migrates each item independently (one transaction per DB row):
  - `users`: put the envelope in `encrypted_password` and set `encryption_iv`, `encryption_auth_tag` and `encryption_key` to `''` (the columns are NOT NULL).
  - `notifiers.config`: replace it with the envelope.
  - `gmail-oauth.json`: rewrite atomically (temp file + rename) as `{ "format": 2, "credentials": "<envelope>", "tokens": "<envelope>" }`.
  - It returns and logs `{ migrated, current, failed }` counts and never logs values.
- **Consumers.**
  - `AuthService` and `NotifierRepository` drop their own crypto and use the vault.
  - `OAuth2Handler` drops `encryptionKey` and reads and writes the format-2 file through the vault.
  - Reads accept legacy or `local` envelopes and upgrade them to `os` when that becomes possible.
- **Explicit unreadable state.** Add `SecretState = 'ok' | 'missing' | 'unreadable'`:
  - Auth status: `{ email, hasPassword, secretState }`.
  - Notifier view: `secretState`, plus `status: NotifierStatus.ERROR` and `lastError: 'Saved password could not be decrypted; re-enter it'`.
  - Gmail status: `{ isAuthorized: false, secretState: 'unreadable' }`.
  - The dispatcher skips unreadable notifiers, logging this once, instead of sending with an empty config.
  - **Unreadable ciphertext is never overwritten** except by an explicit user save.
- **Docs.** Add a "Secret storage" section to `docs/security.md`: backends, the Linux fallback and its weakness, legacy migration, and what "unreadable" means for users.

## Non-goals
- `ScopedSecretVault` and per-provider keyed secrets (V1, on `provider_state` from V2).
- Provider sign-in cookies (V6; Electron partitions).
- Dropping the `users` password columns (V2/V6).
- Warning UI (U4).
- Stripping secrets from IPC (P4).
- Moving userData (B3).

## Completion Criteria
- [ ] With a fake `safeStorage` (available): round-trips work, the envelope starts `vault:v1:os:`, and the same plaintext encrypts to a different envelope each time.
- [ ] Fallback when `isEncryptionAvailable()` is false, or when the Linux backend is `basic_text`:
  - the backend is `local`;
  - the key file is created with mode `0o600` (asserted on POSIX);
  - round-trips work;
  - `app.getInfo().secretStorage.backend === 'local'`.
- [ ] A `local` envelope read when `os` is available is re-encrypted to `os` and persisted.
- [ ] A tampered envelope, a foreign key or an unknown version throws `SecretUnreadableError` rather than returning `''`.
- [ ] The legacy decryptors recover the fixture plaintexts:
  - P2's fixture `users` and `notifiers` rows, using machine id `fixture-machine-id`;
  - a legacy `gmail-oauth.json` generated **in the test** with the installed `conf@10.2.0` and the legacy key.
- [ ] `migrateLegacySecrets` on the v5 and v6 fixtures, loaded and upgraded to v7:
  - afterwards no `users`/`notifiers` value matches `/^[0-9a-f]{32}:[0-9a-f]{32}:/` or the hex column layout;
  - every value decrypts through the vault to the original plaintext;
  - a second run reports `migrated: 0`.
- [ ] With the wrong machine id, migration leaves the rows byte-identical. `notifiers.get` then shows `secretState: 'unreadable'` and `status: 'error'`, the dispatcher does not call `send`, and logs contain no secret.
- [ ] After saving secrets, a byte scan of the DB file (including `-wal`) and of `gmail-oauth.json` finds none of the seeded plaintexts.
- [ ] `grep -rnE "pbkdf2Sync|createCipheriv|machineIdSync|encryptionKey" src/main | grep -v "src/main/security/"` returns nothing.
- [ ] `docs/security.md` has the "Secret storage" section.
- [ ] `npm run lint && npm run format:check && npm run type-check && npm test` pass.

## Edge Cases
- **`safeStorage` before `ready`.** It is usable only after `ready`. The vault is created in the container after `ready`, and a call before then throws a clear error.
- **Locked Linux keyring.** If the keyring is locked at startup, decrypt fails. Report `unreadable` and retry on the next start; never re-encrypt over the ciphertext.
- **Windows profile binding.** Windows `safeStorage` is bound to the user profile. A DB copied to another machine or account becomes unreadable, as expected; this is documented.
- **`Local State` and userData.**
  - Verify whether Electron keeps the `safeStorage` key in Chromium's `Local State` inside userData.
  - If it does, envelopes do not survive a userData change, so B3 must switch userData before the vault's first write.
  - Dev DBs encrypted between P5 and B3 may become unreadable after B3. The explicit error state covers this.
- **Empty values.** A legacy `users` row with an empty password, or an empty notifier config, migrates as `missing`, not `unreadable`.
- **`gmail-oauth.json` problems.**
  - Missing file: not configured.
  - Already format 2: no change.
  - Corrupt JSON: `unreadable`, and the file is preserved as `gmail-oauth.json.corrupt-<ts>`.
- **Crash during migration** leaves either the old or the new value for each item. Re-running finishes the job.
- **Deleted key file.** If `secret-vault.key` is deleted while `local` envelopes exist, they become `unreadable`. Never regenerate the key silently over existing envelopes without logging a warning.

## Test Strategy
- **Unit:** about 20 tests.
  - Vault (9): os round-trip, fallback ×2, upgrade, tamper, unknown version, before-ready, key-file mode, status.
  - Legacy decryptors (5): auth, notifier, gmail conf, wrong key, malformed.
  - Consumers (6): AuthService status, NotifierRepository unreadable, dispatcher skip, OAuth2Handler format-2 read and write, no overwrite on unreadable.
- **Component:** none. U4 renders the states later.
- **Integration:** about 4 tests. Fixture-based `migrateLegacySecrets` (v5 and v6), the idempotent re-run, and the plaintext byte scan.

## Context Files to Read First
- `ai-state/architecture-notes.md` §1 (`security/`), §3 (`ProviderContext.secrets`), §6 and §7. `ai-state/brief.md` O7.
- `ai-state/research/tech-review.md` finding 6 and "Rename risks" (encryption constants).
- `src/main/services/auth/AuthService.ts` and `src/main/database/repositories/notifier.repository.ts` (post-P3)
- `src/main/services/gmail/oauth2-handler.ts` and `node_modules/conf/dist/source/index.js:300-370` (legacy encryption)
- `tests/fixtures/db/README.md` (from P2), `src/main/app/container.ts` and `src/main/ipc/handlers/app.handler.ts`
- `node_modules/electron/electron.d.ts`, `SafeStorage` (around line 8520)

## Notes
- `SafeStorageLike` is the four-method subset of Electron's `safeStorage`. Tests use a deterministic fake built on AES with a fixed key; there is no real keyring in CI.
- This task covers encryption at rest only. V1's `ScopedSecretVault` is a thin namespaced key-value layer over `vault.encrypt`/`decrypt` stored in `provider_state`.
- B3 copies the legacy `gmail-oauth.json` unchanged into the new userData. This task's startup migration converts it there. The legacy folder stays untouched as a backup.

## Orchestrator addendum (2026-10-02, from the V1 review)
- [ ] Replace V1's `UnavailableSecretVault` placeholder in `src/main/app/container.ts` with a real vault-backed `ScopedSecretVault` factory, namespaced per provider (architecture-notes §12.30).
