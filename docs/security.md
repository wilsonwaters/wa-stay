# Security

This document describes how WA Stay protects data on the user's machine: [secret
storage](#secret-storage), [provider windows](#provider-sign-in-and-payment-windows), [the main
window's permissions](#the-main-windows-permissions) and [the packaged app's Electron
fuses](#the-packaged-app-electron-fuses). The overall baseline (sandboxing, CSP, IPC checks) is
in the [architecture overview](architecture/overview.md#security).

## Secret storage

### What is stored

The app keeps these secrets on disk:

| Secret | Where it is stored |
| --- | --- |
| Email (SMTP) notifier settings, including the app password | `notifiers.config` in the database |
| Provider secrets (`ProviderContext.secrets`) | the provider's own state (`provider_state`), under `secret:<key>` |

No built-in provider stores a secret yet. The email password is write-only over IPC: the
window gets the notifier settings without it (`hasPassword` instead), and saving without a
password keeps the stored one only for the same server, port and account.

Provider sign-in (ParkStay) stores no secret of the app's: the person signs in on the
provider's own page in an app window, and the session cookies stay in the provider's
session partition (`<userData>/Partitions/provider-<id>`), shared with the provider's HTTP
client. `provider_accounts` holds only the sign-in state, email and name. See
[Provider sign-in and payment windows](#provider-sign-in-and-payment-windows).

Every one of them is encrypted by the **SecretVault** (`src/main/security/secret-vault.ts`)
and stored as a versioned envelope:

```text
vault:v1:<backend>:<base64>
```

- The vault never stores or logs a plaintext secret, a decrypted value or a key.
- The same plaintext encrypts to a different envelope each time.
- Each provider's secrets are sealed with that provider's id and the secret's key. A
  ciphertext copied to another provider or key does not decrypt as theirs.

### Backends

The vault encrypts new secrets with one of two backends.

**`os`: Electron `safeStorage`.** This is the normal case. The operating system protects
the key:

| Platform | Key protection | Where the key lives |
| --- | --- | --- |
| Windows | DPAPI, bound to the Windows user account | Wrapped with DPAPI in Chromium's `Local State` file inside userData (`os_crypt.encrypted_key`) |
| macOS | Keychain | A Keychain item for the app |
| Linux | Secret Service (GNOME Keyring, KWallet) | An item in the user's keyring. Nothing is written to userData. |

On Windows, `safeStorage` encrypts with AES-256-GCM, which detects any change to a
ciphertext. On macOS and Linux it is Chromium's OSCrypt, which uses AES-128-CBC with no
MAC, so a changed envelope is not always detected: it usually fails to decrypt, but it can
decrypt to different bytes.

**`local`: the fallback.** This is AES-256-GCM with a random 32-byte key in
`<userData>/secret-vault.key`. The key file is created with mode `0600` only when the
first secret is saved, and it is never logged. The vault uses `local` when either of these
is true:

- `safeStorage.isEncryptionAvailable()` is false.
- On Linux, `safeStorage.getSelectedStorageBackend()` is `basic_text`. Chromium then uses
  a hard-coded password, which is no protection.

The backend in use is reported by `app.getInfo()` as `secretStorage: { backend }`, so the
UI can warn when it is `local`.

### The Linux fallback and its weakness

On Linux without a keyring (no GNOME Keyring or KWallet, an unrecognised desktop, or a
headless session) the app uses the `local` backend. It is weaker than `os`:

- Anyone who can read `secret-vault.key` can decrypt the secrets: the same user, root, or
  anyone with a copy of the userData folder (for example a backup).
- File permissions (`0600`) are the only protection.

It is still much better than v1.x, whose keys could be derived from constants in the
source code plus the machine id.

To use OS encryption on Linux:

1. Run a Secret Service provider, such as GNOME Keyring or KWallet, with an unlocked
   default keyring.
2. If the desktop is not detected, start the app with
   `--password-store=gnome-libsecret` (or `kwallet5` or `kwallet6`).

Once `os` is available, each `local` secret is re-encrypted to `os` the next time it is
read, and stored once the new envelope decrypts back to the same value (otherwise the
`local` envelope is kept and a warning is logged). The key file is then no longer needed for those secrets. It is kept, and
never deleted automatically.

### Ordering at startup

`safeStorage` works only after Electron's `ready` event. On Windows its key lives in
`Local State` inside userData. So the vault is lazy: constructing it touches neither
`safeStorage` nor the key file. A use before `ready` throws `SecretVaultNotReadyError`.
The required order (architecture-notes §12.23) is:

1. `app.setPath('userData', …)`: the final userData folder, set before `ready`.
2. The legacy install migration (copying a legacy data folder). `Local State` is never
   copied from another profile.
3. The vault's first use: the legacy secret migration in `createContainer`, after `ready`.

Changing userData after the vault's first write makes `os` envelopes unreadable on
Windows, because the `Local State` key no longer matches.

### Legacy (v1.x) secrets

v1.x used three schemes. Their keys came from constants in the source code, so they were
obfuscation, not protection:

| Secret | v1.x scheme |
| --- | --- |
| ParkStay password | AES-256-GCM, key `PBKDF2(machineId + app constant, constant salt)`, stored as hex in three columns. Not migrated: see below |
| Notifier config | The same scheme with other constants, stored as `iv:authTag:ciphertext` |
| `gmail-oauth.json` (Gmail OTP) | electron-store's AES-256-CBC with a hard-coded `encryptionKey`. Not migrated: see below |

`migrateLegacySecrets` (`src/main/security/legacy-migration.ts`) runs at every start,
after the database migrations and before anything reads a secret. It:

- decrypts each legacy value once with an exact copy of its v1.x algorithm
  (`src/main/security/legacy-decryptors.ts`, the only code that reads the machine id, and
  only when a machine-bound legacy value is found), and re-encrypts it with the vault;
- decrypts each new envelope and compares it with the plaintext before it replaces the
  legacy value, which is the only copy. If they differ, the item is left as it is and
  counted as `failed`;
- handles each item on its own, in one transaction per database row, so a crash leaves
  each item either old or new, and the next start finishes the job;
- is idempotent: values that are already envelopes are left alone;
- logs only counts, for example `Legacy secrets: 3 migrated, 0 current, 0 failed`.

A legacy value that cannot be decrypted is left exactly as it is and counted as `failed`.
This happens, for example, when the database came from another machine, whose machine id
differs. The next start tries again. An empty legacy notifier config migrates as "nothing
stored".

The v1.x ParkStay password is not migrated. ParkStay never used it (sign-in is now the
in-app window), so database migration v9 drops its `users` columns before
`migrateLegacySecrets` runs. Only the email is kept, as the ParkStay account's hint. The old
ciphertext is not left in the WA Stay database file:

- the migrations run with SQLite's `secure_delete` on, so the rows and pages the `users`
  rebuilds (v8, v9) free are overwritten with zeros;
- v9 also records a `vacuum-freed-pages` task in the `maintenance` table, in its own
  transaction. After the migration the file is rewritten (VACUUM) and the WAL truncated,
  and only then is the task removed. If VACUUM fails (a full disk, for example), the task
  stays and every later start tries again while the file has free pages.

**The old encrypted password still exists outside that file.** The v1.x data folder
(`%APPDATA%\parkstay-bookings`, or the installer's `%APPDATA%\WA Stay\legacy-snapshot`), kept
as the backup described below, holds the v1.x database with the encrypted ParkStay
password until the user deletes that folder.

The Gmail OTP sign-in is not migrated either: the feature is gone. On every start
`removeRetiredGmailStore` deletes any `gmail-oauth.json` in the WA Stay data folder (and only
there; a symlink's target is left alone). The v1.x data folder keeps its own copy, which holds a
still-valid Google access token: the user may delete that file and revoke the app's access at
<https://myaccount.google.com/permissions> ([upgrading](installation.md#upgrading-from-wa-parkstay-bookings)).

#### The legacy data folder is the backup of the pre-vault secrets

On the first start after an upgrade, the legacy install migration
(`src/main/migration/legacy-install.ts`) copies the v1.x database from `%APPDATA%\parkstay-bookings` (or, if the v1.x uninstaller deleted that folder, from the
installer's `%APPDATA%\WA Stay\legacy-snapshot`) into the WA Stay data folder. The secret
migration above then re-encrypts **only the copies**. The legacy folder and the snapshot
keep the v1.x originals, so they are the only backup of the secrets as v1.x stored them:

- The app never deletes or modifies either folder. The source database is opened
  read-only and backed up with SQLite's online backup. Opening the database read-only may leave SQLite's empty `-wal`/`-shm` sidecars
  beside it.
- `migration.json` in the WA Stay data folder records what was copied, from where, and the
  source schema version. A failed copy shows the folder that keeps the old data.
- A source SQLite cannot open in place is first copied to `.legacy-staging` in the WA Stay
  data folder. That copy holds the pre-vault secrets too: it is removed once the backup is
  done and, if a crash left it behind, at the next start.
- Only the user removes them: uninstalling with "delete your WA Stay data" removes the
  WA Stay folder (the snapshot is inside it), and asks again, default No, before deleting
  the legacy folder.

### What "unreadable" means

Every stored secret has a state (`SecretState`):

| State | Meaning |
| --- | --- |
| `ok` | A secret is stored and the app can decrypt it. |
| `missing` | Nothing is stored. |
| `unreadable` | Something is stored, but it cannot be decrypted. |

A secret becomes `unreadable` when:

- the data was copied from another computer or another Windows account;
- the Linux keyring is locked or unavailable at startup;
- `secret-vault.key` was deleted or replaced;
- it was saved by a newer version of the app (an unknown envelope version or backend);
- it was tampered with, or is a legacy value that could not be migrated.

Tampering is always detected for `local` envelopes and for `os` envelopes on Windows (both
AES-256-GCM). On macOS and Linux an `os` envelope has no MAC (see [Backends](#backends)), so
a tampered one may decrypt to wrong data instead of reading as `unreadable`.

An unreadable secret is never treated as empty, and it is never overwritten except by the
user saving a new one. What the user sees:

| Secret | When unreadable |
| --- | --- |
| Email notifier | The notifier shows `secretState: 'unreadable'`, status `error` and "Saved password could not be decrypted; re-enter it". Nothing is sent through it, and the skip is logged once. Saving the email settings again fixes it. |

A locked keyring is usually temporary: unlock it and restart the app, and the secrets read
again. Nothing was overwritten in the meantime.

If `secret-vault.key` is missing when a new `local` secret is saved, a new key is created,
and a warning is logged that secrets saved under the earlier key cannot be read.

### Testing notes

- The unit and integration tests use a fake `safeStorage`
  (`tests/utils/fake-safe-storage.ts`). There is no keyring in CI.
- Playwright's Electron launcher always adds `--password-store=basic`, so any app run
  driven by `_electron.launch` uses the `local` backend on Linux. To exercise `os` on
  Linux, start Electron directly with `--password-store=gnome-libsecret` in a session that
  has an unlocked GNOME Keyring.

## Provider sign-in and payment windows

A provider's sign-in window (and, with holds, its payment window) shows the provider's own
pages, so it gets nothing of the app (`src/main/app/provider-windows.ts`):

- It runs on the provider's session partition, `persist:provider-<id>`, sandboxed, with
  context isolation, no Node integration, web security on, no `<webview>`, and no script of
  the app injected. Its webContents is never a trusted IPC sender.
- Top-level navigations and main-frame redirects may only go to the provider's allow-list
  (ParkStay: its own site, the DBCA SSO gateway, Azure AD B2C and the DBCA queue; a payment
  window also allows DBCA's own hosts, `*.dbca.wa.gov.au`, for the payment ledger). Anything
  else is cancelled and logged by origin only; a sign-in window opens it in the system
  browser instead. Sub-frames are not restricted (payment pages use them).
- Every permission request and check is refused, certificate errors are rejected, and no
  client certificate or HTTP credentials are offered.
- The pages keep their own Content-Security-Policy: the app never changes their headers.
- The window title shows the host it is on, since there is no address bar.
- Logs never carry a sign-in link's token, a cookie, the provider's profile or the payment
  confirmation's `checkouthash`.
- A payment is recorded only from the provider's own confirmation page for that hold
  (ParkStay: `/success/` with `checkouthash = sha256(hold reference)`); any other page,
  including another booking's confirmation, records nothing. The app never sees card
  details: they are typed into the provider's own payment pages.

Signing out clears the partition (cookies, storage, HTTP auth cache) and nothing else: the
local profile, watches, snipes and bookings stay. It is refused while a snipe or hold needs
the session.

## Document windows (the campground map)

A location's document, such as ParkStay's campground map (a one-page PDF served with
`X-Frame-Options: DENY`), opens in a window of its own, in Electron's built-in PDF viewer
(`src/main/app/document-windows.ts`, `catalog.openDocument`). The document is not the app's, so
the window gets nothing of it:

- **The address never comes from the renderer.** The renderer sends the location's key and the
  document's id; main takes the address from the detail it cached. ParkStay keeps only an https
  address on its own origin, and the catalogue drops any document whose address is not https.
  `catalog.get` returns documents without their address.
- It runs sandboxed, with context isolation, no Node integration (frames and workers included),
  web security on, no `<webview>`, no preload and no script of the app. `plugins` is on for
  document windows only: it turns on the PDF viewer. Its webContents is never a trusted IPC
  sender.
- It runs on its own in-memory partition, `documents-<providerId>`, never the provider's
  `persist:provider-<id>`: no provider cookie is sent, and nothing is kept after the app quits.
- The top level shows only the document's own URL. Every other navigation and main-frame
  redirect is cancelled (a redirect before the document arrives closes the window), new
  windows are refused, and each is logged by origin only.
- Downloads are refused, except the viewer's own: the document itself, or the copy the viewer
  saves from its own extension origin.
- Every permission request and check, and every device request, is refused; certificate errors
  are rejected; no client certificate or HTTP credentials are offered; the document cannot stop
  the window closing.
- The answer must be the document's media type (`application/pdf`) with a 2xx status, checked on
  the response headers before anything renders. Anything else (ParkStay may answer a missing
  file with a 200 `text/plain` "ERROR opening file") closes the window, and the place page shows
  the `PROVIDER_ERROR` message.
- The title is "<place> · Campground map", which the document cannot change. A second open of
  the same document focuses its window. Document windows close with the main window and on
  quit.

In fixture mode (test-only, from source only) the document partition answers from the provider's
fixtures (`src/main/testing/fixture-documents.ts`) and refuses, and logs, everything else.

## The main window's permissions

Electron grants every permission a page asks for unless its session has handlers. The main
window runs on the default session, and `guardPermissions` (`src/main/app/main-window.ts`)
gives it handlers that refuse every permission request and every permission check, with one
exception: `clipboard-sanitized-write`, for the app's own page in its top frame.
`navigator.clipboard.writeText` needs it ("Copy reference" on a booking, "Copy error details"
on the error screen) and fails without it. Desktop notifications are shown by the main process
(Electron's `Notification`) and need no permission. A refused request is logged with the
permission and the page's origin only. The Electron smoke tests check, in the built app, that
the clipboard write is granted, that other permissions read as denied, and that copying works.

Provider windows and document windows refuse everything, the clipboard included ([above](#provider-sign-in-and-payment-windows)).

No request the app makes offers a client certificate. Since Electron 44, `app` emits
`select-client-certificate` for `net` requests as well (every provider's HTTP client and the
updater; there is no webContents), and when nothing handles it Electron sends the first
matching certificate from the system store. `refuseClientCertificates`
(`src/main/app/main-window.ts`) handles it for every request and offers none; the request then
continues without a certificate. Provider windows do the same for their pages.

## The packaged app (Electron fuses)

Electron fuses are switches in the Electron executable itself. electron-builder flips them when
it packages the app (`electronFuses` in `electron-builder.json`), just before signing, so they
apply to the installed `WA Stay.exe` (changing one means modifying the executable, which breaks
its signature when the build is signed):

| Fuse | Set to | Effect |
| --- | --- | --- |
| `RunAsNode` | off | `ELECTRON_RUN_AS_NODE` is ignored: the executable cannot be used as a plain Node.js runtime. Nothing in the app forks a Node process. |
| `EnableNodeOptionsEnvironmentVariable` | off | `NODE_OPTIONS` and `NODE_EXTRA_CA_CERTS` are ignored, so no environment variable can load code (`--require`) into the main process. A TLS-inspecting proxy's certificate cannot be added that way; provider traffic goes through Chromium's network stack, which uses the system's certificates. |
| `EnableNodeCliInspectArguments` | off | `--inspect`, `--inspect-brk` and `SIGUSR1` do not open Node's inspector on the main process. |
| `OnlyLoadAppFromAsar` | on | The app is loaded only from `resources/app.asar`, never from a `resources/app` folder. |
| `EnableEmbeddedAsarIntegrityValidation` | on | electron-builder records the SHA-256 of `app.asar`'s header in the executable (a Windows resource; `Info.plist` on macOS), and every file packed in the archive carries its own block hashes. Electron checks both as it reads, so a modified `app.asar` does not run. Windows and macOS only: Linux has no such check. Only the files kept outside the archive (`app.asar.unpacked`) are not covered: playwright-core, and better-sqlite3's one native binary (`prebuilds/<platform>-<arch>.node`, which cannot load from inside an archive). better-sqlite3's JavaScript is inside the archive and checked, and its C sources and other platforms' binaries are not packaged. |
| `EnableCookieEncryption` | on | Cookie values on disk, such as a provider session's (`persist:provider-<id>`), are encrypted with the operating system's key (DPAPI on Windows), as Chrome does. It is one-way: cookies saved before are encrypted the next time they are written, and turning the fuse off again would make the stored cookies unreadable. |

The other fuses keep Electron's defaults; `GrantFileProtocolExtraPrivileges` stays on because
the window loads its page from `file://`.

`npm run smoke:packaged` reads the fuses back from the packaged Linux executable with
`@electron/fuses` and checks each one, checks that every file in `app.asar` has its integrity
hash and that the only better-sqlite3 file outside it is the one binary, and starts the
executable as shipped with `--inspect`, which it must ignore. The release build checks the
Windows executable the same way (`scripts/check-windows-package.js`, in `build.yml`): its fuses,
its integrity record against `app.asar`'s header, and its one better-sqlite3 binary. Running from
source (`npm start`, the Electron tests) uses `node_modules/electron`'s own executable, whose
fuses are not changed.
