/**
 * SecretVault: every stored secret (passwords, OAuth secrets and tokens, provider secrets)
 * is encrypted here, behind a versioned envelope (architecture-notes §7):
 *
 *   vault:v1:<backend>:<base64>
 *
 * - `os`: Electron `safeStorage` (Windows DPAPI, macOS Keychain, a Linux keyring). Used when
 *   `isEncryptionAvailable()` is true and, on Linux, the backend is not `basic_text`
 *   (Chromium's `basic_text` uses a hard-coded password, so it is no protection).
 * - `local`: AES-256-GCM with a random 32-byte key in `<userData>/secret-vault.key`
 *   (mode 0600), for when OS encryption is not available. It is weaker (anyone who can read
 *   the key file can decrypt) and `status()` reports it so the UI can warn.
 *
 * A `local` envelope read while `os` is available reads fine and `needsUpgrade` says so; the
 * consumer then re-encrypts it to `os` and stores it (`read(stored, reseal)` does both). An
 * envelope that replaces the only other copy of a secret is read back first
 * (`encryptVerified`).
 *
 * Anything that cannot be decrypted (tampered, another machine or account, a locked keyring,
 * a missing key file, an envelope from a newer version) throws `SecretUnreadableError`. It
 * never decrypts to `''`.
 *
 * ORDERING (architecture-notes §12.23). The vault is lazy: nothing touches `safeStorage` or
 * the key file at import or construction, only on first use, and a use before Electron's
 * `ready` throws `SecretVaultNotReadyError`. On Windows the `safeStorage` key lives in
 * Chromium's `Local State` file inside userData, so the first use must also come after the
 * final userData path is set. Startup order:
 *   1. `app.setPath('userData', …)` (B3, before `ready`)
 *   2. legacy install migration (B3: copy the legacy data folder; never copy `Local State`)
 *   3. vault first use: `migrateLegacySecrets` in `createContainer`, after `ready`
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { SecretState, SecretStorageBackend } from '@shared/types';

/** The four-method subset of Electron's `safeStorage` the vault uses. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  /** Linux only (the vault calls it only when `platform` is `linux`). */
  getSelectedStorageBackend(): string;
}

/** Where the `local` backend's key lives. */
export interface LocalKeyStore {
  /** The key, or null when there is none. Throws `SecretUnreadableError` for a damaged key. */
  read(): Buffer | null;
  /** Creates and stores a new random key. Never replaces an existing one (throws instead). */
  create(): Buffer;
}

/** The logging surface the vault uses (Winston's logger satisfies it). */
export interface VaultLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface SecretVaultOptions {
  safeStorage: SafeStorageLike;
  platform: NodeJS.Platform;
  localKey: LocalKeyStore;
  logger: VaultLogger;
  /** `app.isReady()`. `safeStorage` only works after `ready`, so the vault refuses before it. */
  isReady: () => boolean;
}

export type SecretUnreadableReason =
  'not-an-envelope' | 'newer-version' | 'os-unavailable' | 'key-missing' | 'decrypt-failed';

/** A stored secret that cannot be decrypted. The message never contains the secret. */
export class SecretUnreadableError extends Error {
  constructor(
    readonly reason: SecretUnreadableReason,
    message: string
  ) {
    super(message);
    this.name = 'SecretUnreadableError';
  }
}

/** The vault was used before Electron's `ready` (a startup-order bug, not a user problem). */
export class SecretVaultNotReadyError extends Error {
  constructor() {
    super(
      "The secret vault was used before the app was ready: Electron's safeStorage only works " +
        "after 'ready', once the final userData path is set (architecture-notes §12.23)"
    );
    this.name = 'SecretVaultNotReadyError';
  }
}

/**
 * A new envelope did not decrypt back to the secret it was made from (`encryptVerified`).
 * The caller keeps the value it was about to replace. The message never contains the secret.
 */
export class SecretVerificationError extends Error {
  constructor() {
    super('The new envelope did not decrypt to the original secret');
    this.name = 'SecretVerificationError';
  }
}

/** The result of reading a stored secret. */
export type SecretRead =
  { state: 'ok'; value: string } | { state: Exclude<SecretState, 'ok'>; reason?: string };

const PREFIX = 'vault:';
const VERSION = 'v1';
const BACKENDS: readonly SecretStorageBackend[] = ['os', 'local'];
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const LOCAL_KEY_BYTES = 32;
const LOCAL_IV_BYTES = 12;
const LOCAL_TAG_BYTES = 16;
/** Binds `local` ciphertexts to this envelope version and backend. */
const LOCAL_AAD = Buffer.from(`${PREFIX}${VERSION}:local`);

export class SecretVault {
  private readonly safeStorage: SafeStorageLike;
  private readonly platform: NodeJS.Platform;
  private readonly localKey: LocalKeyStore;
  private readonly logger: VaultLogger;
  private readonly isReady: () => boolean;
  private lastBackend: SecretStorageBackend | null = null;

  constructor(options: SecretVaultOptions) {
    // Nothing here may touch safeStorage or the key file: the vault is used lazily.
    this.safeStorage = options.safeStorage;
    this.platform = options.platform;
    this.localKey = options.localKey;
    this.logger = options.logger;
    this.isReady = options.isReady;
  }

  /** The backend new secrets are encrypted with. */
  status(): { backend: SecretStorageBackend } {
    return { backend: this.backend() };
  }

  /** Whether `value` is a vault envelope (any version or backend). No decryption. */
  isEnvelope(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith(PREFIX);
  }

  encrypt(plaintext: string): string {
    const backend = this.backend();
    const payload =
      backend === 'os'
        ? this.safeStorage.encryptString(plaintext)
        : this.encryptLocal(plaintext, this.localKey.read() ?? this.createLocalKey());
    return `${PREFIX}${VERSION}:${backend}:${payload.toString('base64')}`;
  }

  /**
   * `encrypt`, then decrypts the new envelope and checks that it reads back as `plaintext`.
   * Use it before the envelope replaces the only other copy of a secret (the legacy
   * migration, a reseal). Throws `SecretVerificationError` when it does not read back.
   */
  encryptVerified(plaintext: string): string {
    const envelope = this.encrypt(plaintext);
    let readBack: string;
    try {
      readBack = this.decrypt(envelope);
    } catch (error) {
      if (error instanceof SecretUnreadableError) throw new SecretVerificationError();
      throw error;
    }
    if (readBack !== plaintext) throw new SecretVerificationError();
    return envelope;
  }

  /** Throws `SecretUnreadableError` when the envelope cannot be decrypted. */
  decrypt(envelope: string): string {
    this.assertReady();
    const { backend, payload } = this.parse(envelope);
    if (backend === 'os') {
      if (!this.safeStorage.isEncryptionAvailable()) {
        throw new SecretUnreadableError(
          'os-unavailable',
          'OS encryption is not available (is the keyring locked?)'
        );
      }
      try {
        return this.safeStorage.decryptString(payload);
      } catch {
        throw new SecretUnreadableError(
          'decrypt-failed',
          'The secret was encrypted by another machine or account, or has been changed'
        );
      }
    }

    const key = this.localKey.read();
    if (!key) {
      throw new SecretUnreadableError(
        'key-missing',
        'The local key file (secret-vault.key) is missing'
      );
    }
    return this.decryptLocal(payload, key);
  }

  /** True for a `local` envelope while `os` is available: re-encrypt it to `os`. */
  needsUpgrade(envelope: string): boolean {
    if (!this.isEnvelope(envelope)) return false;
    const [, version, backend] = envelope.split(':');
    return version === VERSION && backend === 'local' && this.backend() === 'os';
  }

  /**
   * Reads a stored secret: `missing` for nothing stored (or an empty secret), `unreadable`
   * when it cannot be decrypted, otherwise `ok`. When the secret was read from a `local`
   * envelope and `os` is now available, `reseal` gets the `os` envelope to store in its
   * place, once it has been read back (`encryptVerified`). A failed reseal is logged and the
   * stored envelope is kept; the secret still reads.
   */
  read(stored: string | null | undefined, reseal?: (envelope: string) => void): SecretRead {
    if (!stored) return { state: 'missing' };
    let value: string;
    try {
      value = this.decrypt(stored);
    } catch (error) {
      if (error instanceof SecretUnreadableError) {
        return { state: 'unreadable', reason: error.message };
      }
      throw error;
    }
    if (value === '') return { state: 'missing' };

    if (reseal && this.needsUpgrade(stored)) {
      try {
        reseal(this.encryptVerified(value));
        this.logger.info('Secret vault: re-encrypted a local secret with OS encryption');
      } catch (error) {
        this.logger.warn(
          `Secret vault: could not re-encrypt a local secret with OS encryption (${errorName(error)})`
        );
      }
    }
    return { state: 'ok', value };
  }

  private backend(): SecretStorageBackend {
    this.assertReady();
    let backend: SecretStorageBackend = 'os';
    let why = '';
    if (!this.safeStorage.isEncryptionAvailable()) {
      backend = 'local';
      why = 'OS encryption is not available';
    } else if (
      this.platform === 'linux' &&
      this.safeStorage.getSelectedStorageBackend() === 'basic_text'
    ) {
      backend = 'local';
      why = 'the Linux password store is basic_text (no keyring)';
    }

    if (backend !== this.lastBackend) {
      if (backend === 'local') {
        this.logger.warn(`Secret vault: ${why}; using the local key file (weaker)`);
      } else {
        this.logger.info('Secret vault: using OS encryption');
      }
      this.lastBackend = backend;
    }
    return backend;
  }

  private assertReady(): void {
    if (!this.isReady()) throw new SecretVaultNotReadyError();
  }

  private parse(envelope: string): { backend: SecretStorageBackend; payload: Buffer } {
    if (!this.isEnvelope(envelope)) {
      throw new SecretUnreadableError('not-an-envelope', 'The stored value is not a vault secret');
    }
    const [, version, backend, data, ...rest] = envelope.split(':');
    if (version !== VERSION || !BACKENDS.includes(backend as SecretStorageBackend)) {
      throw new SecretUnreadableError(
        'newer-version',
        'The secret was created by a newer version of the app'
      );
    }
    if (rest.length > 0 || !data || !BASE64.test(data)) {
      throw new SecretUnreadableError('decrypt-failed', 'The stored secret is damaged');
    }
    return { backend: backend as SecretStorageBackend, payload: Buffer.from(data, 'base64') };
  }

  private createLocalKey(): Buffer {
    const key = this.localKey.create();
    // Never silent: a new key cannot read local secrets saved with a previous one.
    this.logger.warn(
      'Secret vault: created a new local key file; local secrets saved under any earlier key cannot be read'
    );
    return key;
  }

  private encryptLocal(plaintext: string, key: Buffer): Buffer {
    const iv = crypto.randomBytes(LOCAL_IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(LOCAL_AAD);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  private decryptLocal(payload: Buffer, key: Buffer): string {
    if (payload.length < LOCAL_IV_BYTES + LOCAL_TAG_BYTES) {
      throw new SecretUnreadableError('decrypt-failed', 'The stored secret is damaged');
    }
    try {
      const iv = payload.subarray(0, LOCAL_IV_BYTES);
      const tag = payload.subarray(LOCAL_IV_BYTES, LOCAL_IV_BYTES + LOCAL_TAG_BYTES);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(LOCAL_AAD);
      decipher.setAuthTag(tag);
      const ciphertext = payload.subarray(LOCAL_IV_BYTES + LOCAL_TAG_BYTES);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new SecretUnreadableError(
        'decrypt-failed',
        'The secret was encrypted with another local key, or has been changed'
      );
    }
  }
}

/**
 * The `local` backend's key file, `<userData>/secret-vault.key`: 32 random bytes, mode 0600,
 * created only when the first `local` secret is saved. Its contents are never logged.
 */
export class FileLocalKeyStore implements LocalKeyStore {
  constructor(private readonly filePath: string) {}

  read(): Buffer | null {
    let key: Buffer;
    try {
      key = fs.readFileSync(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    if (key.length !== LOCAL_KEY_BYTES) {
      throw new SecretUnreadableError(
        'key-missing',
        'The local key file (secret-vault.key) is damaged'
      );
    }
    return key;
  }

  create(): Buffer {
    const key = crypto.randomBytes(LOCAL_KEY_BYTES);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    // 'wx' fails when the file exists, so an existing key is never replaced
    fs.writeFileSync(this.filePath, key, { mode: 0o600, flag: 'wx' });
    // The mode passed above is reduced by the umask; set it exactly
    if (process.platform !== 'win32') fs.chmodSync(this.filePath, 0o600);
    return key;
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}
