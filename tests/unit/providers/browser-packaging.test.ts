/**
 * The browser automation runtime's dependency and packaging (V7, architecture-notes §10):
 * `playwright-core` is pinned to an exact version, the same as `@playwright/test` (which drives
 * the Electron tests), and must support the Node that Electron runs (Electron 44: Node 24).
 * electron-builder unpacks it from the asar archive so its files exist on disk.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..');
interface PackageJson {
  version: string;
  engines: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface BuilderConfig {
  asar: boolean | { smartUnpack?: boolean };
  asarUnpack?: string[];
  files: string[];
}

const readJson = <T>(file: string): T =>
  JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')) as T;

describe('playwright-core dependency', () => {
  it('is pinned to exactly 1.64.0 in dependencies (not a range, not a devDependency)', () => {
    const pkg = readJson<PackageJson>('package.json');
    expect(pkg.dependencies['playwright-core']).toBe('1.64.0');
    expect(pkg.devDependencies?.['playwright-core']).toBeUndefined();
    expect(pkg.devDependencies?.['@playwright/test']).toBe('1.64.0');
  });

  it('is installed at 1.64.0, which supports Node 20 and later (Electron 44 runs Node 24)', () => {
    const installed = readJson<PackageJson>('node_modules/playwright-core/package.json');
    expect(installed.version).toBe('1.64.0');
    expect(installed.engines.node).toBe('>=20');
  });
});

describe('electron-builder.json', () => {
  const builder = readJson<BuilderConfig>('electron-builder.json');

  it('packs the app in asar and unpacks playwright-core, whose files must exist on disk', () => {
    // An asar archive, with only what asarUnpack lists kept outside it (no smartUnpack)
    expect(builder.asar).toEqual({ smartUnpack: false });
    expect(builder.asarUnpack).toContain('node_modules/playwright-core/**');
  });

  it('ships the production node_modules', () => {
    expect(builder.files).toContain('node_modules/**/*');
  });
});
