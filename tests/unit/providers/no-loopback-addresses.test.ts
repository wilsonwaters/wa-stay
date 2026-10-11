/**
 * @jest-environment node
 *
 * No provider ships pointing at this computer. A browser provider is previewed by pointing its
 * site address at a loopback copy of its pages ("Preview in the app" in
 * docs/providers/browser-providers.md); this guard fails, naming the file and line, if any
 * provider source under `src/main/providers/` still names a loopback address (`127.x.x.x`,
 * `localhost`, `[::1]` or `0.0.0.0`, with or without a scheme or port), so one cannot ship by
 * accident. A generated provider's own test checks its address is https, but only while that
 * test is intact, and the contract suite checks the links its test builds, not the address the
 * app uses.
 *
 * `src/main/providers/sdk/` is not scanned: the SDK names loopback on purpose, as the only
 * hosts `ctx.http` (`isAllowedRequestUrl`, `sdk/http.ts`) and the provider windows'
 * origin patterns (`sdk/url-patterns.ts`) accept over plain http, for tests.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const PROVIDERS = path.join(ROOT, 'src/main/providers');
/** Folders under `src/main/providers/` that may name loopback (see above). */
const NOT_SCANNED = new Set(['sdk']);

/** A loopback host, however it is written: `127.0.0.1:8123`, `http://localhost`, `[::1]`… */
const LOOPBACK = /\b127(?:\.\d{1,3}){3}\b|\blocalhost\b|\[::1\]|\b0\.0\.0\.0\b/i;

/** Every `.ts` file under `dir`, project-relative with forward slashes. */
function sourcesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return dir === PROVIDERS && NOT_SCANNED.has(entry.name) ? [] : sourcesUnder(full);
    }
    return entry.name.endsWith('.ts') ? [path.relative(ROOT, full).split(path.sep).join('/')] : [];
  });
}

/** `file:line: text` for every line of `files` that names a loopback address. */
function loopbackAddresses(files: readonly string[]): string[] {
  return files.flatMap((file) =>
    fs
      .readFileSync(path.join(ROOT, file), 'utf8')
      .split(/\r?\n/)
      .flatMap((line, index) =>
        LOOPBACK.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : []
      )
  );
}

describe('provider sources name no loopback address', () => {
  const files = sourcesUnder(PROVIDERS);

  it('scans every provider, ParkStay included, and the registry, but not the SDK', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'src/main/providers/index.ts',
        'src/main/providers/registry.ts',
        'src/main/providers/parkstay/index.ts',
      ])
    );
    expect(files.filter((file) => file.startsWith('src/main/providers/sdk/'))).toEqual([]);
  });

  it.each([
    "export const ACME_SITE_URL = 'http://127.0.0.1:8123';",
    "const api = 'https://localhost/api';",
    'listen on 127.1.2.3',
    "fetch('http://[::1]:3000/')",
    "const host = '0.0.0.0:80';",
  ])('recognises %s', (line) => {
    expect(LOOPBACK.test(line)).toBe(true);
  });

  it.each([
    "export const ACME_SITE_URL = 'https://www.acme-parks.example';",
    "const version = '1127.0.0.15';",
    "const host = 'localhosting.example';",
  ])('lets %s through', (line) => {
    expect(LOOPBACK.test(line)).toBe(false);
  });

  it('finds none, so no provider ships pointing at this computer', () => {
    expect(loopbackAddresses(files)).toEqual([]);
  });
});
