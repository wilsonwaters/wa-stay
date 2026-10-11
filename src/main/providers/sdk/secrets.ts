/**
 * `ScopedSecretVault`: a provider's secrets (tokens and the like), encrypted at rest.
 *
 * A thin layer over the app's `SecretVault` (`security/secret-vault.ts`: `encrypt`/`decrypt`
 * on Electron `safeStorage`). The composition root builds one per provider over the app's
 * vault. It stores only the ciphertext, in the provider's own `KeyValueStore` under
 * `secret:<key>`, so secrets persist once that store is SQLite-backed (V2). The ciphertext
 * also names the provider and key it was written for, so a value copied to another provider
 * or key does not decrypt as theirs. A secret the vault reports as needing an upgrade (a
 * `local` envelope once OS encryption is available) is re-encrypted when it is read, once
 * the new ciphertext reads back; a failed re-encryption is logged and the secret still reads
 * (as `SecretVault.read` does).
 */

import type { ProviderId } from '@shared/types/provider.types';
import type { KeyValueStore } from './kv-store';

/** The part of P5's `SecretVault` this layer uses. */
export interface SecretVaultLike {
  encrypt(plaintext: string): string;
  /** Throws when the ciphertext cannot be read. */
  decrypt(ciphertext: string): string;
  /** True when the ciphertext should be re-encrypted (stronger backend now available). */
  needsUpgrade?(ciphertext: string): boolean;
}

export interface ScopedSecretVault {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export const SECRET_KEY_PREFIX = 'secret:';

interface SealedSecret {
  provider: ProviderId;
  key: string;
  value: string;
}

export function createScopedSecretVault({
  providerId,
  vault,
  store,
  logger,
}: {
  providerId: ProviderId;
  vault: SecretVaultLike;
  store: KeyValueStore;
  /** Where a failed re-encryption is logged (by key and error name, never a value). */
  logger: { warn(message: string): void };
}): ScopedSecretVault {
  const storeKey = (key: string): string => `${SECRET_KEY_PREFIX}${key}`;

  return {
    async get(key) {
      const ciphertext = await store.get<string>(storeKey(key));
      if (ciphertext === undefined) return undefined;
      const plaintext = vault.decrypt(ciphertext);
      const sealed = parseSealed(plaintext);
      if (!sealed) {
        // Never JSON.parse's own error: its message quotes the decrypted text
        throw new Error(`Secret "${key}" is damaged`);
      }
      if (sealed.provider !== providerId || sealed.key !== key) {
        throw new Error(`Secret "${key}" was not written by ${providerId}`);
      }
      if (vault.needsUpgrade?.(ciphertext)) {
        try {
          const upgraded = vault.encrypt(plaintext);
          // It replaces the only stored copy: store it only once it reads back
          if (vault.decrypt(upgraded) === plaintext) {
            await store.set(storeKey(key), upgraded);
          } else {
            logger.warn(
              `Secret "${key}" was not re-encrypted: the new ciphertext did not read back`
            );
          }
        } catch (error) {
          logger.warn(
            `Secret "${key}" could not be re-encrypted with OS encryption (${errorName(error)})`
          );
        }
      }
      return sealed.value;
    },
    async set(key, value) {
      const sealed: SealedSecret = { provider: providerId, key, value };
      await store.set(storeKey(key), vault.encrypt(JSON.stringify(sealed)));
    },
    async delete(key) {
      await store.delete(storeKey(key));
    },
  };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}

/** The sealed record, or null when `plaintext` is not one. */
function parseSealed(plaintext: string): SealedSecret | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { provider, key, value } = parsed as Record<string, unknown>;
  if (typeof provider !== 'string' || typeof key !== 'string' || typeof value !== 'string') {
    return null;
  }
  return { provider, key, value };
}

/** Tests only: a reversible fake cipher (XOR + base64), so ciphertext never equals plaintext. */
export class FakeSecretVault implements SecretVaultLike {
  private static readonly PREFIX = 'fake-vault:';

  encrypt(plaintext: string): string {
    return (
      FakeSecretVault.PREFIX +
      FakeSecretVault.flip(Buffer.from(plaintext, 'utf8')).toString('base64')
    );
  }

  decrypt(ciphertext: string): string {
    if (!ciphertext.startsWith(FakeSecretVault.PREFIX)) throw new Error('Unreadable secret');
    const bytes = Buffer.from(ciphertext.slice(FakeSecretVault.PREFIX.length), 'base64');
    return FakeSecretVault.flip(bytes).toString('utf8');
  }

  private static flip(bytes: Buffer): Buffer {
    return Buffer.from(bytes.map((b) => b ^ 0x5a));
  }
}
