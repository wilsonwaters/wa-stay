/**
 * The legacy ParkStay "credentials" are gone (V6, architecture-notes §12.32): no
 * `AuthService`, no `window.api.auth`, no `auth:*` channels in the source. ParkStay sign-in
 * is the in-app window (`accounts.*`); the never-used password was dropped by migration v9.
 */

import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../../../src');
const LEGACY = /AuthService|window\.api\.auth|auth:store/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js)$/.test(entry.name) ? [full] : [];
  });
}

describe('legacy ParkStay credentials', () => {
  it('no AuthService, window.api.auth or auth:store in src', () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      fs
        .readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((line, index) => ({ line, at: `${path.relative(SRC, file)}:${index + 1}` }))
        .filter(({ line }) => LEGACY.test(line))
        .map(({ at }) => at)
    );

    expect(offenders).toEqual([]);
  });

  it('the services/auth folder and the auth contract are gone', () => {
    expect(fs.existsSync(path.join(SRC, 'main/services/auth'))).toBe(false);
    expect(fs.existsSync(path.join(SRC, 'shared/contracts/auth.ts'))).toBe(false);
    expect(fs.existsSync(path.join(SRC, 'main/ipc/handlers/auth.handlers.ts'))).toBe(false);
  });
});
