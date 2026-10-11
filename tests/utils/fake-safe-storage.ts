/**
 * Test doubles for Electron's `safeStorage` and helpers to build a real `SecretVault` (and
 * the container's secret options) on top of it. There is no keyring in CI, so the fake is a
 * deterministic AES-256-GCM cipher with a fixed key, the way `safeStorage` behaves with a
 * real OS key: random IV per call, authenticated, and a different key cannot decrypt.
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { SafeStorageLike, VaultLogger } from '@main/security/secret-vault';
import { FileLocalKeyStore, SecretVault } from '@main/security/secret-vault';

/** The fixed key of the default fake ("this machine's OS key"). */
export const FAKE_OS_KEY = Buffer.alloc(32, 7);
/** Another machine's or account's OS key. */
export const FOREIGN_OS_KEY = Buffer.alloc(32, 9);

const MAGIC = Buffer.from('fakeos');

export class FakeSafeStorage implements SafeStorageLike {
  /** `isEncryptionAvailable()`: false is a Linux box without a keyring (or before ready). */
  available = true;
  /** `getSelectedStorageBackend()` on Linux. */
  backend: string = 'gnome_libsecret';
  readonly calls: string[] = [];

  constructor(private readonly key: Buffer = FAKE_OS_KEY) {}

  isEncryptionAvailable(): boolean {
    this.calls.push('isEncryptionAvailable');
    return this.available;
  }

  getSelectedStorageBackend(): string {
    this.calls.push('getSelectedStorageBackend');
    return this.backend;
  }

  encryptString(plainText: string): Buffer {
    this.calls.push('encryptString');
    if (!this.available) throw new Error('Encryption is not available.');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
  }

  decryptString(encrypted: Buffer): string {
    this.calls.push('decryptString');
    if (!this.available) throw new Error('Decryption is not available.');
    if (!encrypted.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error(
        'Error while decrypting the ciphertext provided to safeStorage.decryptString.'
      );
    }
    const iv = encrypted.subarray(MAGIC.length, MAGIC.length + 12);
    const tag = encrypted.subarray(MAGIC.length + 12, MAGIC.length + 28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encrypted.subarray(MAGIC.length + 28)),
      decipher.final(),
    ]).toString('utf8');
  }
}

/** A logger that records what the vault logs. */
export function recordingLogger(): VaultLogger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (message) => lines.push(`info: ${message}`),
    warn: (message) => lines.push(`warn: ${message}`),
  };
}

/** A fresh temp folder standing in for userData. Remove it with `removeUserData`. */
export function tempUserData(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-userdata-'));
}

/**
 * A unique userData path that is not created: the vault creates it only if it writes the
 * local key file, so a test on an available fake `safeStorage` leaves nothing behind.
 */
export function unusedUserData(): string {
  return path.join(os.tmpdir(), `wa-stay-userdata-${crypto.randomBytes(6).toString('hex')}`);
}

export function removeUserData(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

export interface TestVault {
  vault: SecretVault;
  safeStorage: FakeSafeStorage;
  logger: VaultLogger & { lines: string[] };
  keyFile: string;
  userDataDir: string;
  ready: { value: boolean };
}

/**
 * A real SecretVault on a fake `safeStorage`, with its key file in `userDataDir` (by default
 * an `unusedUserData()` path, created only if the key file is written).
 */
export function testVault(
  options: {
    safeStorage?: FakeSafeStorage;
    userDataDir?: string;
    platform?: NodeJS.Platform;
    ready?: boolean;
  } = {}
): TestVault {
  const safeStorage = options.safeStorage ?? new FakeSafeStorage();
  const userDataDir = options.userDataDir ?? unusedUserData();
  const keyFile = path.join(userDataDir, 'secret-vault.key');
  const logger = recordingLogger();
  const ready = { value: options.ready ?? true };
  const vault = new SecretVault({
    safeStorage,
    platform: options.platform ?? 'linux',
    localKey: new FileLocalKeyStore(keyFile),
    logger,
    isReady: () => ready.value,
  });
  return { vault, safeStorage, logger, keyFile, userDataDir, ready };
}

/**
 * The secret options `createContainer` needs: a userData path (by default an
 * `unusedUserData()` one: remove it with `removeUserData` if the test saves a secret there)
 * and a ready, available fake `safeStorage`.
 */
export function containerSecrets(
  safeStorage: FakeSafeStorage = new FakeSafeStorage(),
  userDataDir: string = unusedUserData()
): { userDataDir: string; safeStorage: FakeSafeStorage; isReady: () => boolean } {
  return { userDataDir, safeStorage, isReady: () => true };
}
