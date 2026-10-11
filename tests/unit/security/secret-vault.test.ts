/**
 * SecretVault: the versioned envelope, backend choice (OS `safeStorage` or the local key
 * file), the local → os upgrade, explicit unreadable errors, laziness and the before-ready
 * guard. `safeStorage` is a deterministic fake (no keyring in CI).
 */

import fs from 'fs';
import {
  SecretUnreadableError,
  SecretVaultNotReadyError,
  SecretVerificationError,
  FileLocalKeyStore,
} from '@main/security/secret-vault';
import {
  FakeSafeStorage,
  FOREIGN_OS_KEY,
  removeUserData,
  testVault,
  type TestVault,
} from '@tests/utils/fake-safe-storage';

const SECRET = 'Sëcret-pässword-✓';

/** Faulty `safeStorage.encryptString`s: the envelope decrypts to another value, or not at all. */
const faultyEncryptions: [string, (safeStorage: FakeSafeStorage) => void][] = [
  [
    'decrypts to another value',
    (safeStorage) => {
      const real = safeStorage.encryptString.bind(safeStorage);
      jest.spyOn(safeStorage, 'encryptString').mockImplementation((text) => real(`${text}!`));
    },
  ],
  [
    'does not decrypt',
    (safeStorage) => {
      jest.spyOn(safeStorage, 'encryptString').mockReturnValue(Buffer.from('not-a-ciphertext'));
    },
  ],
];

/** Flips one character inside the base64 payload of an envelope. */
function tamper(envelope: string): string {
  const at = envelope.length - 6;
  const swapped = envelope[at] === 'A' ? 'B' : 'A';
  return envelope.slice(0, at) + swapped + envelope.slice(at + 1);
}

function unreadable(run: () => unknown): SecretUnreadableError {
  let error: unknown;
  try {
    const value = run();
    throw new Error(`expected SecretUnreadableError, got ${JSON.stringify(value)}`);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(SecretUnreadableError);
  return error as SecretUnreadableError;
}

describe('SecretVault', () => {
  const made: TestVault[] = [];
  const vaultWith = (options: Parameters<typeof testVault>[0] = {}): TestVault => {
    const t = testVault(options);
    made.push(t);
    return t;
  };

  afterEach(() => {
    for (const t of made.splice(0)) removeUserData(t.userDataDir);
  });

  describe('os backend (safeStorage available)', () => {
    it('round-trips; envelopes start vault:v1:os: and differ every time', () => {
      const { vault } = vaultWith();

      const first = vault.encrypt(SECRET);
      const second = vault.encrypt(SECRET);

      expect(first.startsWith('vault:v1:os:')).toBe(true);
      expect(second.startsWith('vault:v1:os:')).toBe(true);
      expect(first).not.toBe(second);
      expect(first).not.toContain(SECRET);
      expect(vault.decrypt(first)).toBe(SECRET);
      expect(vault.decrypt(second)).toBe(SECRET);
      expect(vault.decrypt(vault.encrypt(''))).toBe('');
      expect(vault.status()).toEqual({ backend: 'os' });
    });

    it('creates no key file', () => {
      const { vault, keyFile } = vaultWith();
      vault.decrypt(vault.encrypt(SECRET));
      expect(fs.existsSync(keyFile)).toBe(false);
    });

    it('uses os on Windows and macOS without asking for the Linux backend', () => {
      for (const platform of ['win32', 'darwin'] as const) {
        const safeStorage = new FakeSafeStorage();
        safeStorage.backend = 'basic_text'; // would mean "no keyring" on Linux only
        const { vault } = vaultWith({ safeStorage, platform });

        expect(vault.encrypt(SECRET).startsWith('vault:v1:os:')).toBe(true);
        expect(safeStorage.calls).not.toContain('getSelectedStorageBackend');
      }
    });
  });

  describe('local fallback', () => {
    it('is used when isEncryptionAvailable() is false: 0600 key file, round-trips, status local', () => {
      const safeStorage = new FakeSafeStorage();
      safeStorage.available = false;
      const { vault, keyFile, logger } = vaultWith({ safeStorage });

      expect(vault.status()).toEqual({ backend: 'local' });
      expect(fs.existsSync(keyFile)).toBe(false); // created on first save, not on status

      const envelope = vault.encrypt(SECRET);
      expect(envelope.startsWith('vault:v1:local:')).toBe(true);
      expect(vault.encrypt(SECRET)).not.toBe(envelope);
      expect(vault.decrypt(envelope)).toBe(SECRET);

      expect(fs.readFileSync(keyFile)).toHaveLength(32);
      if (process.platform !== 'win32') {
        expect(fs.statSync(keyFile).mode & 0o777).toBe(0o600);
      }
      expect(safeStorage.calls).not.toContain('encryptString');
      expect(logger.lines).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^warn: Secret vault: OS encryption is not available/),
        ])
      );
    });

    it('is used on Linux when the backend is basic_text', () => {
      const safeStorage = new FakeSafeStorage();
      safeStorage.backend = 'basic_text';
      const { vault, keyFile } = vaultWith({ safeStorage, platform: 'linux' });

      expect(vault.status()).toEqual({ backend: 'local' });
      const envelope = vault.encrypt(SECRET);
      expect(envelope.startsWith('vault:v1:local:')).toBe(true);
      expect(vault.decrypt(envelope)).toBe(SECRET);
      expect(fs.existsSync(keyFile)).toBe(true);
      expect(safeStorage.calls).not.toContain('encryptString');
    });

    it('never logs the key or a secret', () => {
      const safeStorage = new FakeSafeStorage();
      safeStorage.available = false;
      const { vault, keyFile, logger } = vaultWith({ safeStorage });
      vault.decrypt(vault.encrypt(SECRET));

      const logs = logger.lines.join('\n');
      const key = fs.readFileSync(keyFile);
      expect(logs).not.toContain(SECRET);
      expect(logs).not.toContain(key.toString('hex'));
      expect(logs).not.toContain(key.toString('base64'));
    });
  });

  describe('upgrade local → os', () => {
    it('reads a local envelope once os is available, and reseals it as os', () => {
      const safeStorage = new FakeSafeStorage();
      safeStorage.available = false;
      const { vault } = vaultWith({ safeStorage });
      const local = vault.encrypt(SECRET);
      expect(vault.needsUpgrade(local)).toBe(false); // os still unavailable

      safeStorage.available = true;
      expect(vault.status()).toEqual({ backend: 'os' });
      expect(vault.needsUpgrade(local)).toBe(true);

      const resealed: string[] = [];
      expect(vault.read(local, (envelope) => resealed.push(envelope))).toEqual({
        state: 'ok',
        value: SECRET,
      });
      expect(resealed).toHaveLength(1);
      expect(resealed[0].startsWith('vault:v1:os:')).toBe(true);
      expect(vault.decrypt(resealed[0])).toBe(SECRET);
      expect(vault.needsUpgrade(resealed[0])).toBe(false);
    });

    it('a failed reseal is logged and the secret still reads', () => {
      const safeStorage = new FakeSafeStorage();
      safeStorage.available = false;
      const { vault, logger } = vaultWith({ safeStorage });
      const local = vault.encrypt(SECRET);
      safeStorage.available = true;

      const read = vault.read(local, () => {
        throw new Error('database is locked');
      });

      expect(read).toEqual({ state: 'ok', value: SECRET });
      expect(logger.lines.join('\n')).toMatch(/could not re-encrypt a local secret/);
    });

    it.each(faultyEncryptions)(
      'a reseal that does not read back (%s) is never stored: the local envelope is kept',
      (_fault, fault) => {
        const safeStorage = new FakeSafeStorage();
        safeStorage.available = false;
        const { vault, logger } = vaultWith({ safeStorage });
        const local = vault.encrypt(SECRET);
        safeStorage.available = true;
        fault(safeStorage);

        const reseal = jest.fn();
        expect(vault.read(local, reseal)).toEqual({ state: 'ok', value: SECRET });

        expect(reseal).not.toHaveBeenCalled();
        const logs = logger.lines.join('\n');
        expect(logs).toMatch(/could not re-encrypt a local secret .*SecretVerificationError/);
        expect(logs).not.toContain(SECRET);
      }
    );
  });

  describe('encryptVerified (read-back before replacing the only copy)', () => {
    it('returns an envelope that decrypts back to the plaintext', () => {
      const { vault } = vaultWith();
      const envelope = vault.encryptVerified(SECRET);
      expect(envelope.startsWith('vault:v1:os:')).toBe(true);
      expect(vault.decrypt(envelope)).toBe(SECRET);
    });

    it.each(faultyEncryptions)(
      'throws SecretVerificationError, without the secret, when encrypt is faulty (%s)',
      (_fault, fault) => {
        const { vault, safeStorage } = vaultWith();
        fault(safeStorage);

        let error: unknown;
        try {
          vault.encryptVerified(SECRET);
        } catch (caught) {
          error = caught;
        }
        expect(error).toBeInstanceOf(SecretVerificationError);
        expect((error as Error).message).not.toContain(SECRET);
      }
    );
  });

  describe('unreadable, never empty', () => {
    it('a tampered os or local envelope throws SecretUnreadableError', () => {
      const { vault } = vaultWith();
      expect(unreadable(() => vault.decrypt(tamper(vault.encrypt(SECRET)))).reason).toBe(
        'decrypt-failed'
      );

      const offline = new FakeSafeStorage();
      offline.available = false;
      const local = vaultWith({ safeStorage: offline }).vault;
      expect(unreadable(() => local.decrypt(tamper(local.encrypt(SECRET)))).reason).toBe(
        'decrypt-failed'
      );
      expect(unreadable(() => local.decrypt('vault:v1:local:AAAA')).reason).toBe('decrypt-failed');
      expect(unreadable(() => local.decrypt('vault:v1:local:not*base64')).reason).toBe(
        'decrypt-failed'
      );
    });

    it('an envelope from another machine or account (foreign OS key) is unreadable', () => {
      const other = vaultWith({ safeStorage: new FakeSafeStorage(FOREIGN_OS_KEY) }).vault;
      const { vault } = vaultWith();

      const error = unreadable(() => vault.decrypt(other.encrypt(SECRET)));
      expect(error.message).toMatch(/another machine or account/);
      expect(error.message).not.toContain(SECRET);
    });

    it('a local envelope under another key file is unreadable', () => {
      const offline = (): FakeSafeStorage =>
        Object.assign(new FakeSafeStorage(), { available: false });
      const a = vaultWith({ safeStorage: offline() }).vault;
      const b = vaultWith({ safeStorage: offline() }).vault;
      b.encrypt('creates b’s own key');

      expect(unreadable(() => b.decrypt(a.encrypt(SECRET))).reason).toBe('decrypt-failed');
    });

    it('an unknown version or backend is unreadable: "created by a newer version"', () => {
      const { vault } = vaultWith();
      const payload = vault.encrypt(SECRET).split(':')[3];

      for (const envelope of [`vault:v2:os:${payload}`, `vault:v1:tpm:${payload}`]) {
        const error = unreadable(() => vault.decrypt(envelope));
        expect(error.reason).toBe('newer-version');
        expect(error.message).toMatch(/created by a newer version/);
      }
    });

    it('a value that is not an envelope (a legacy ciphertext) is unreadable', () => {
      const { vault } = vaultWith();
      expect(vault.isEnvelope('a0b1c2:d3e4:ff')).toBe(false);
      expect(unreadable(() => vault.decrypt('a0b1c2d3e4f5:00ff:abcd')).reason).toBe(
        'not-an-envelope'
      );
      expect(vault.read('a0b1c2d3e4f5:00ff:abcd')).toMatchObject({ state: 'unreadable' });
    });

    it('an os envelope while OS encryption is unavailable (locked keyring) is unreadable', () => {
      const safeStorage = new FakeSafeStorage();
      const { vault } = vaultWith({ safeStorage });
      const envelope = vault.encrypt(SECRET);
      safeStorage.available = false;

      expect(unreadable(() => vault.decrypt(envelope)).reason).toBe('os-unavailable');
      safeStorage.available = true; // unlocked on a later start
      expect(vault.decrypt(envelope)).toBe(SECRET);
    });

    it('a deleted key file makes local envelopes unreadable; a new key is created with a warning, never over an existing one', () => {
      const safeStorage = new FakeSafeStorage();
      safeStorage.available = false;
      const { vault, keyFile, logger } = vaultWith({ safeStorage });
      const envelope = vault.encrypt(SECRET);
      const firstKey = fs.readFileSync(keyFile);

      fs.rmSync(keyFile);
      expect(unreadable(() => vault.decrypt(envelope)).reason).toBe('key-missing');

      logger.lines.length = 0;
      const next = vault.encrypt('a new save');
      expect(logger.lines).toEqual([
        expect.stringMatching(
          /^warn: Secret vault: created a new local key file; local secrets saved under any earlier key cannot be read$/
        ),
      ]);
      expect(fs.readFileSync(keyFile).equals(firstKey)).toBe(false);
      expect(vault.decrypt(next)).toBe('a new save');
      expect(unreadable(() => vault.decrypt(envelope)).reason).toBe('decrypt-failed');

      // The key store refuses to replace an existing key
      expect(() => new FileLocalKeyStore(keyFile).create()).toThrow(/EEXIST/);
    });

    it('a damaged key file is unreadable, not replaced', () => {
      const safeStorage = new FakeSafeStorage();
      safeStorage.available = false;
      const { vault, keyFile } = vaultWith({ safeStorage });
      const envelope = vault.encrypt(SECRET);
      fs.writeFileSync(keyFile, 'short');

      expect(unreadable(() => vault.decrypt(envelope)).reason).toBe('key-missing');
      expect(() => vault.encrypt(SECRET)).toThrow(SecretUnreadableError);
      expect(fs.readFileSync(keyFile, 'utf8')).toBe('short');
    });
  });

  describe('read()', () => {
    it('reports missing, ok and unreadable', () => {
      const { vault } = vaultWith();
      expect(vault.read('')).toEqual({ state: 'missing' });
      expect(vault.read(null)).toEqual({ state: 'missing' });
      expect(vault.read(undefined)).toEqual({ state: 'missing' });
      expect(vault.read(vault.encrypt(''))).toEqual({ state: 'missing' });
      expect(vault.read(vault.encrypt(SECRET))).toEqual({ state: 'ok', value: SECRET });
      expect(vault.read('vault:v9:os:AAAA')).toEqual({
        state: 'unreadable',
        reason: 'The secret was created by a newer version of the app',
      });
    });
  });

  describe('laziness and the before-ready guard', () => {
    it('construction touches neither safeStorage nor the key file', () => {
      const safeStorage = new FakeSafeStorage();
      const { keyFile } = vaultWith({ safeStorage });

      expect(safeStorage.calls).toEqual([]);
      expect(fs.existsSync(keyFile)).toBe(false);
    });

    it('before ready, every use throws a clear SecretVaultNotReadyError and nothing falls back to local', () => {
      const safeStorage = new FakeSafeStorage();
      safeStorage.available = false; // what Windows reports before ready
      const { vault, keyFile, ready } = vaultWith({ safeStorage, ready: false });

      for (const use of [
        () => vault.status(),
        () => vault.encrypt(SECRET),
        () => vault.decrypt('vault:v1:os:AAAA'),
        () => vault.needsUpgrade('vault:v1:local:AAAA'),
        () => vault.read('vault:v1:os:AAAA'),
      ]) {
        expect(use).toThrow(SecretVaultNotReadyError);
        expect(use).toThrow(/before the app was ready/);
      }
      expect(safeStorage.calls).toEqual([]);
      expect(fs.existsSync(keyFile)).toBe(false);
      expect(vault.isEnvelope('vault:v1:os:AAAA')).toBe(true); // no safeStorage needed

      ready.value = true;
      safeStorage.available = true;
      expect(vault.status()).toEqual({ backend: 'os' });
    });
  });
});
