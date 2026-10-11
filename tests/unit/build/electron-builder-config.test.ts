/**
 * @jest-environment node
 *
 * The packaged identity (B2): WA Stay everywhere a user or the update feed sees a name, while
 * the appId stays `com.parkstay.bookings` so the NSIS installer upgrades v1.x installs in place
 * and auto-update keeps working (architecture-notes §6).
 */
import fs from 'fs';
import path from 'path';
import { APP_DESCRIPTION } from '@shared/constants';

const ROOT = path.resolve(__dirname, '../../..');
const builder = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron-builder.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

type Json = Record<string, unknown>;

/** Every value stored under `key` anywhere in the config, with its JSON path. */
function findKey(node: unknown, key: string, at = ''): Array<{ at: string; value: unknown }> {
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node as Json).flatMap(([k, v]) => [
    ...(k === key ? [{ at: `${at}.${k}`, value: v }] : []),
    ...findKey(v, key, `${at}.${k}`),
  ]);
}

describe('electron-builder.json', () => {
  it('keeps the appId (in-place upgrade, auto-update) and pins no NSIS GUID', () => {
    expect(builder.appId).toBe('com.parkstay.bookings');
    expect(findKey(builder, 'guid')).toEqual([]);
  });

  it('is called WA Stay, the same productName Electron reads from package.json', () => {
    expect(builder.productName).toBe('WA Stay');
    expect(builder.productName).toBe(pkg.productName);
    expect(builder.copyright).toBe('© 2025-2026 Wilson Waters');
  });

  it('publishes to wilsonwaters/wa-stay from all four publish blocks', () => {
    const blocks = findKey(builder, 'publish');
    expect(blocks.map((b) => b.at).sort()).toEqual([
      '.linux.publish',
      '.mac.publish',
      '.publish',
      '.win.publish',
    ]);
    for (const { value } of blocks) {
      expect(value).toEqual({ provider: 'github', owner: 'wilsonwaters', repo: 'wa-stay' });
    }
  });

  it('names artifacts with hyphens, never ${productName} or a space', () => {
    const names = findKey(builder, 'artifactName');
    expect(names).toHaveLength(7);
    for (const { at, value } of names) {
      expect(`${at}: ${value}`).not.toContain('${productName}');
      expect(`${value}`).not.toMatch(/\s/);
    }
    expect(builder.win.artifactName).toBe('WA-Stay-Setup-${version}.${ext}');
    expect(builder.portable.artifactName).toBe('WA-Stay-Portable-${version}.${ext}');
    for (const target of ['mac', 'linux', 'appImage', 'deb', 'rpm']) {
      expect(builder[target].artifactName).toBe('WA-Stay-${version}-${arch}.${ext}');
    }
  });

  it('describes WA Stay in the Linux desktop entry and package metadata', () => {
    // electron-builder 26 takes the [Desktop Entry] keys under `desktop.entry`
    expect(builder.linux.desktop.entry).toEqual({
      Name: 'WA Stay',
      Comment: 'Find and book places to stay across Western Australia',
      Categories: 'Utility;Office;',
      Keywords: 'camping;caravan;holiday;accommodation;parkstay;booking;',
      // Electron sets WM_CLASS from the app name (`productName`); checked with xprop under xvfb
      StartupWMClass: pkg.productName,
    });
    expect(builder.linux.synopsis).toBe('Find and book places to stay across Western Australia');
    expect(builder.linux.description).toMatch(/^WA Stay /);
    expect(builder.linux.vendor).toBe('WA Stay');
  });

  it('ships the built JavaScript without declarations or source maps', () => {
    // electron-builder already leaves out `*.d.ts` (its default excludedExts), but not the
    // `*.d.ts.map` beside them. The source maps are not used at run time: Node applies them to
    // stack traces only with --enable-source-maps or process.setSourceMapsEnabled(), which the
    // app never sets, so the logger and the crash policy (app/crash-policy.ts) log the compiled
    // positions either way; the preload's map is read only by DevTools. `npm run
    // smoke:packaged` checks the real app.asar.
    expect(builder.files).toEqual(
      expect.arrayContaining([
        'dist/**/*',
        '!dist/**/*.d.ts',
        '!dist/**/*.map',
        'package.json',
        'node_modules/**/*',
      ])
    );
  });

  it("ships one better-sqlite3 binary, the target's, and none of its C sources", () => {
    // better-sqlite3 13 ships prebuilt Node-API binaries for 8 platforms, plus SQLite's and its
    // own C sources (for builds from source, which the app never does). Only the target's
    // binary is packaged, unpacked from app.asar (a native module cannot load from inside it);
    // its JavaScript stays in the archive, under asar integrity. `${platform}` and `${arch}` are
    // the build's: electron-builder expands `${platform}` to the build machine's platform, so
    // each OS packages its own target (no cross-builds; per-target `win.files` does not work in
    // electron-builder 26). `npm run smoke:packaged` checks the real package.
    expect(builder.files.slice(-3)).toEqual([
      '!node_modules/better-sqlite3/{deps,src}/**',
      '!node_modules/better-sqlite3/prebuilds/*.node',
      'node_modules/better-sqlite3/prebuilds/${platform}-${arch}.node',
    ]);
    expect(builder.asar).toEqual({ smartUnpack: false });
    expect(builder.asarUnpack).toEqual([
      'node_modules/playwright-core/**',
      'node_modules/better-sqlite3/prebuilds/*.node',
    ]);
  });

  it('asks for the macOS version Electron 44 needs', () => {
    expect(builder.mac.minimumSystemVersion).toBe('13.0.0');
  });
});

describe('package.json', () => {
  it('names the package wa-stay and the product WA Stay', () => {
    expect(pkg.name).toBe('wa-stay');
    expect(pkg.productName).toBe('WA Stay');
    expect(pkg.description).toBe('Find and book places to stay across Western Australia');
    // The About dialog's tagline
    expect(APP_DESCRIPTION).toBe(pkg.description);
  });

  it('credits the author, who is the installer Publisher', () => {
    expect(pkg.author).toEqual({
      name: 'Wilson Waters',
      email: 'wilsonwaters@users.noreply.github.com',
    });
  });

  it('links the wa-stay repository', () => {
    expect(pkg.repository).toEqual({
      type: 'git',
      url: 'https://github.com/wilsonwaters/wa-stay.git',
    });
    expect(pkg.homepage).toMatch(/\/wa-stay$/);
    expect(pkg.bugs).toEqual({ url: 'https://github.com/wilsonwaters/wa-stay/issues' });
    expect(pkg.keywords).toEqual([
      'accommodation',
      'camping',
      'western-australia',
      'parkstay',
      'booking',
      'electron',
    ]);
  });

  it('keeps the lockfile root name in step', () => {
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
    expect(lock.name).toBe(pkg.name);
    expect(lock.packages[''].name).toBe(pkg.name);
  });
});
