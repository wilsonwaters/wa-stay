/**
 * Stored-secret state as the renderer may see it (never the secret itself).
 *
 * - `ok`: a secret is stored and the app can read it.
 * - `missing`: nothing is stored.
 * - `unreadable`: something is stored but cannot be decrypted (another machine or Windows
 *   account, a locked keyring, a deleted local key file, or a newer app version). The user
 *   has to enter it again; the stored value is kept until they do.
 */
export type SecretState = 'ok' | 'missing' | 'unreadable';

/**
 * Where the secret vault's key lives:
 * - `os`: the operating system protects it (Electron `safeStorage`: DPAPI, Keychain, or a
 *   Linux keyring).
 * - `local`: a random key in `<userData>/secret-vault.key`, used when OS encryption is not
 *   available (Linux without a keyring). Weaker: anyone who can read that file can decrypt.
 */
export type SecretStorageBackend = 'os' | 'local';
