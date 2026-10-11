/**
 * @jest-environment node
 *
 * B1 wiring outside the asset folders: electron-builder image keys, the CI asset check, the
 * old rasters, the README header images and the contrast values recorded for the logo.
 */
import fs from 'fs';
import path from 'path';
import { BRAND_DIR, ROOT, read, rel } from './brand-files';
import { contrastRatio } from '../../../src/renderer/styles/contrast';
import { readPalette } from '../../../scripts/brand/logo';

const builder = JSON.parse(read(path.join(ROOT, 'electron-builder.json')));

/** Every file under `dir`. */
function walk(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

describe('electron-builder.json', () => {
  it('points the three NSIS images at the 24-bit BMPs', () => {
    expect(builder.nsis.installerHeader).toBe('resources/icons/installer-header.bmp');
    expect(builder.nsis.installerSidebar).toBe('resources/icons/installer-sidebar.bmp');
    expect(builder.nsis.uninstallerSidebar).toBe('resources/icons/installer-sidebar.bmp');
    for (const key of ['installerHeader', 'installerSidebar', 'uninstallerSidebar']) {
      expect(fs.existsSync(path.join(ROOT, builder.nsis[key]))).toBe(true);
    }
  });

  it('uses the 1024 PNG for macOS and lets the DMG fall back to the app icon', () => {
    expect(builder.mac.icon).toBe('resources/icons/icon.png');
    expect(builder.dmg).not.toHaveProperty('icon');
  });

  it('references no PNG installer images and no missing icon files', () => {
    const text = read(path.join(ROOT, 'electron-builder.json'));
    expect(text).not.toMatch(/installer-(header|sidebar)\.png/);
    for (const icon of [
      builder.win.icon,
      builder.nsis.installerIcon,
      builder.nsis.uninstallerIcon,
    ]) {
      expect(fs.existsSync(path.join(ROOT, icon))).toBe(true);
    }
    expect(fs.statSync(path.join(ROOT, builder.linux.icon)).isDirectory()).toBe(true);
  });

  it('ships only the icons the running app loads as extra resources', () => {
    expect(builder.extraResources).toEqual([
      { from: 'resources/icons', to: 'icons', filter: ['icon.png', 'icon.ico', 'email-logo.png'] },
    ]);
    for (const file of builder.extraResources[0].filter) {
      expect(fs.existsSync(path.join(ROOT, 'resources/icons', file))).toBe(true);
    }
  });

  it('the main process names no icon that is left out of the package', () => {
    const shipped: string[] = builder.extraResources[0].filter;
    const left = fs
      .readdirSync(path.join(ROOT, 'resources/icons'))
      .filter((f) => !shipped.includes(f));
    const named = walk(path.join(ROOT, 'src/main'))
      .filter((f) => /\.tsx?$/.test(f))
      .flatMap((file) =>
        left.filter((icon) => read(file).includes(icon)).map((icon) => `${rel(file)}: ${icon}`)
      );
    expect(named).toEqual([]);
  });
});

describe('CI asset check (.github/workflows/build.yml)', () => {
  it('checks all five committed assets exist', () => {
    const workflow = read(path.join(ROOT, '.github/workflows/build.yml'));
    const step = /- name: Verify icon assets exist[\s\S]*?shell: pwsh/.exec(workflow)?.[0] ?? '';
    for (const file of [
      'resources/icons/icon.ico',
      'resources/icons/icon.png',
      'resources/icons/256x256.png',
      'resources/icons/installer-header.bmp',
      'resources/icons/installer-sidebar.bmp',
    ]) {
      expect(step).toContain(`"${file}"`);
    }
    expect(step).toMatch(/exit 1/);
  });
});

describe('repository', () => {
  it('has deleted the old icon and banner rasters', () => {
    for (const file of ['icon-source.png', 'banner-source.png', 'banner.png']) {
      expect(fs.existsSync(path.join(ROOT, 'resources', file))).toBe(false);
    }
  });

  it('README header images resolve to the banner and the mark', () => {
    const header = read(path.join(ROOT, 'README.md')).split(/\r?\n/).slice(0, 8).join('\n');
    const images = Array.from(header.matchAll(/<img src="([^"]+)"[^>]*\swidth="(\d+)"/g), (m) => ({
      src: m[1],
      width: Number(m[2]),
    }));
    expect(images.map((i) => i.src)).toEqual([
      'resources/brand/readme-banner.png',
      'resources/brand/wa-stay-mark-small.svg',
    ]);
    for (const { src } of images) expect(fs.existsSync(path.join(ROOT, src))).toBe(true);
    // The logo rule in resources/README.md: at 32 px and below, always the small mark.
    for (const { src, width } of images.filter((i) => /wa-stay-mark/.test(i.src))) {
      if (width <= 32) expect(src).toBe('resources/brand/wa-stay-mark-small.svg');
    }
  });

  it('has an npm run icons script', () => {
    const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));
    expect(pkg.scripts.icons).toBe('node scripts/generate-icons.js');
  });

  it('resources/README.md states the logo rules and that WA Stay is not affiliated', () => {
    const doc = read(path.join(ROOT, 'resources/README.md'));
    expect(doc).toContain('npm run icons');
    expect(doc).toMatch(/clear space/i);
    expect(doc).toContain('16 px');
    expect(doc).toContain('96 px');
    expect(doc).toContain('SIL Open Font License 1.1');
    expect(doc).toContain('Not affiliated with Tourism WA or DBCA');
  });
});

describe('logo contrast (recorded in resources/brand/README.md)', () => {
  const palette = readPalette();
  const doc = read(path.join(BRAND_DIR, 'README.md'));
  const ratio = (fg: string, bg: string) => contrastRatio(palette[fg], palette[bg]);

  it.each([
    ['ink-900', 'sand-50', 'lockup ink on sand'],
    ['ink-900', 'sand-0', 'lockup ink on white'],
    ['sand-0', 'ocean-500', 'mono reversed on ocean blue'],
    ['sand-0', 'ocean-600', 'mono reversed on brand'],
    ['ink-900', 'ocean-500', 'mono in ink on ocean blue'],
    ['ocean-500', 'sand-50', 'ocean stroke on the sand plate'],
  ])('%s on %s (%s) meets 3:1 and the README records it', (fg, bg) => {
    const value = ratio(fg, bg);
    expect(value).toBeGreaterThanOrEqual(3);
    const row = doc
      .split(/\r?\n/)
      .find((line) => line.includes(`\`${fg}\``) && line.includes(`\`${bg}\``));
    expect(row).toBeDefined();
    expect(row).toContain(`${value.toFixed(2)}:1`);
  });
});
