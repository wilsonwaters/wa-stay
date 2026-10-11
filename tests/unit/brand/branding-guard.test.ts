/**
 * @jest-environment node
 *
 * The app is WA Stay. The legacy names (WA ParkStay Bookings, ParkStay Bookings, the
 * `parkstay-bookings` package/folder name and the v1.x database file `parkstay.db`) may appear
 * in source, installer, build and CI files only on a line marked `legacy-name-ok`: an
 * identifier existing installs depend on (the v1.x data folder and database, an encryption
 * constant) or a legacy item the installer cleans up. JSON cannot carry the marker, so
 * package.json and electron-builder.json must have none at all.
 *
 * "ParkStay" on its own names the provider and is not checked, nor is the DBCA host
 * `parkstay.dbca.wa.gov.au`.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const LEGACY_NAME = /WA ParkStay|ParkStay Bookings|parkstay-bookings|parkstay\.db\b/i;
const MARKER = 'legacy-name-ok';

/** Every file under `dir` (relative to the repo root) whose name matches `pattern`. */
function filesUnder(dir: string, pattern: RegExp): string[] {
  const walk = (absolute: string): string[] =>
    fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
      const child = path.join(absolute, entry.name);
      if (entry.isDirectory()) return walk(child);
      return pattern.test(entry.name) ? [child] : [];
    });
  return walk(path.join(ROOT, dir));
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');

const SCANNED = [
  ...filesUnder('src', /\.(ts|tsx|html|css)$/),
  path.join(ROOT, 'resources/installer.nsh'),
  path.join(ROOT, 'package.json'),
  path.join(ROOT, 'electron-builder.json'),
  ...filesUnder('.github/workflows', /\.ya?ml$/),
  ...filesUnder('.claude/commands', /\.md$/),
];

/** `file:line: text` for each line naming the legacy app without the marker. */
function unmarkedLegacyLines(file: string, content = fs.readFileSync(file, 'utf8')): string[] {
  const allowMarker = !file.endsWith('.json');
  return content
    .split(/\r?\n/)
    .map((text, index) => ({ text, line: index + 1 }))
    .filter(({ text }) => LEGACY_NAME.test(text) && !(allowMarker && text.includes(MARKER)))
    .map(({ text, line }) => `${rel(file)}:${line}: ${text.trim()}`);
}

describe('branding guard', () => {
  it('scans the source, installer, build and CI files', () => {
    const scanned = SCANNED.map(rel);
    expect(scanned).toEqual(
      expect.arrayContaining([
        'src/main/index.ts',
        'src/renderer/index.html',
        'src/renderer/styles/tokens.css',
        'resources/installer.nsh',
        'package.json',
        'electron-builder.json',
        '.github/workflows/ci.yml',
        '.github/workflows/build.yml',
        '.claude/commands/release.md',
      ])
    );
    expect(scanned.filter((f) => f.startsWith('src/')).length).toBeGreaterThan(100);
  });

  it('finds no legacy app name outside a line marked legacy-name-ok', () => {
    expect(SCANNED.flatMap((file) => unmarkedLegacyLines(file))).toEqual([]);
  });

  it('connection.ts never names a database file: the caller passes <userData>/wa-stay.db', () => {
    const connection = fs.readFileSync(path.join(ROOT, 'src/main/database/connection.ts'), 'utf8');
    expect(connection).not.toMatch(/parkstay\.db\b|wa-stay\.db/);
  });

  it('accepts the marker on a line, except in JSON files', () => {
    const content =
      'ok\r\nconst dir = "parkstay-bookings"; // legacy-name-ok\r\nWA ParkStay Bookings';
    expect(unmarkedLegacyLines(path.join(ROOT, 'src/x.ts'), content)).toEqual([
      'src/x.ts:3: WA ParkStay Bookings',
    ]);
    expect(unmarkedLegacyLines(path.join(ROOT, 'package.json'), content)).toEqual([
      'package.json:2: const dir = "parkstay-bookings"; // legacy-name-ok',
      'package.json:3: WA ParkStay Bookings',
    ]);
  });

  it('matches every legacy spelling and leaves the provider name alone', () => {
    for (const text of [
      'WA ParkStay Bookings',
      'wa parkstay',
      'ParkStay Bookings App',
      '%APPDATA%\\parkstay-bookings',
      'github.com/wilsonwaters/parkstay-bookings',
      'parkstay.db',
      "path.join(userData, 'parkstay.db')",
      'parkstay.db-wal',
    ]) {
      expect(text).toMatch(LEGACY_NAME);
    }
    for (const text of [
      'ParkStay',
      'View on ParkStay',
      "QUEUE_GROUP = 'parkstayv2'",
      'https://parkstay.dbca.wa.gov.au/api',
      'wa-stay.db',
    ]) {
      expect(text).not.toMatch(LEGACY_NAME);
    }
  });
});
