#!/usr/bin/env node
/**
 * `npm run site:screenshots`: rebuilds the app and retakes the product website's screenshots in
 * `site/assets/screens/`: Explore and its map, the South West's map, a place's availability and
 * notices, a watch's card and the notifications panel.
 *
 * 1. Needs a public Mapbox token (`MAPBOX_ACCESS_TOKEN` in the environment, else `.env`): the
 *    map is the point of most shots. The token is never printed. The build bundles it, and only
 *    Mapbox's API host is let through the network guard.
 * 2. `npm run build`, then the `@site` Playwright spec (`tests/site`,
 *    `playwright.site.config.ts`) against the built app in fixture mode, with all 169 ParkStay
 *    campgrounds (`tests/site/support/site-fixtures.ts`). The window is 1440 × 900 at 2×, so the
 *    display must be at least 2880 × 1800 pixels; on Linux without a display it runs under
 *    `xvfb-run` with a screen that size or larger. The raw PNGs stay in `test-results/site/`.
 * 3. Writes each capture as WebP (quality 82) into `site/assets/screens/`: `<name>.webp` at the
 *    full 2× size and `<name>-1x.webp` at half, and prints each file's size.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const rawDir = path.join(root, 'test-results', 'site');
const outDir = path.join(root, 'site', 'assets', 'screens');
const QUALITY = 82;
/** xvfb's screen: the 2880 × 1800 window, and taller for shots of long sections. */
const XVFB_SCREEN = '3840x4320x24';

function tokenFromDotEnv() {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return undefined;
  const line = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => /^\s*MAPBOX_ACCESS_TOKEN\s*=/.test(l));
  return line?.replace(/^\s*MAPBOX_ACCESS_TOKEN\s*=\s*/, '').replace(/^["']|["']$/g, '');
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function optimise() {
  const sharp = require('sharp');
  fs.mkdirSync(outDir, { recursive: true });
  const names = fs
    .readdirSync(rawDir)
    .filter((file) => file.endsWith('.png'))
    .sort();
  if (names.length === 0) throw new Error(`no captures in ${path.relative(root, rawDir)}`);
  for (const name of names) {
    const source = path.join(rawDir, name);
    const { width } = await sharp(source).metadata();
    const base = name.replace(/\.png$/, '');
    const outputs = [
      { file: `${base}.webp`, width },
      { file: `${base}-1x.webp`, width: Math.round(width / 2) },
    ];
    for (const output of outputs) {
      const target = path.join(outDir, output.file);
      const info = await sharp(source)
        .resize({ width: output.width, kernel: 'lanczos3' })
        .webp({ quality: QUALITY, effort: 6, smartSubsample: true })
        .toFile(target);
      const kb = Math.round(fs.statSync(target).size / 1024);
      console.log(`site/assets/screens/${output.file}: ${info.width} × ${info.height}, ${kb} KB`);
    }
  }
}

async function main() {
  const token = process.env.MAPBOX_ACCESS_TOKEN ?? tokenFromDotEnv() ?? '';
  if (!token.startsWith('pk.')) {
    console.error(
      'site:screenshots: needs a public Mapbox token (MAPBOX_ACCESS_TOKEN, pk.…) in the environment or .env.'
    );
    process.exit(1);
  }
  console.log('site:screenshots: Mapbox token found; only api.mapbox.com is reached.');

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  run(npm, ['run', 'build'], process.env);

  fs.rmSync(rawDir, { recursive: true, force: true });
  const env = { ...process.env, SITE_SCREENSHOTS_DIR: rawDir };
  const playwright = ['playwright', 'test', '-c', 'playwright.site.config.ts'];
  const needsXvfb = process.platform === 'linux' && !process.env.DISPLAY;
  if (needsXvfb)
    run('xvfb-run', ['-a', '-s', `-screen 0 ${XVFB_SCREEN}`, 'npx', ...playwright], env);
  else run(process.platform === 'win32' ? 'npx.cmd' : 'npx', playwright, env);

  await optimise();
}

main().catch((error) => {
  console.error(`site:screenshots: ${error.message}`);
  process.exit(1);
});
