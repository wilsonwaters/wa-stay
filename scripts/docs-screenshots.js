#!/usr/bin/env node
/**
 * `npm run docs:screenshots`: rebuilds the app and retakes the documentation screenshots in
 * `docs/images/` (Explore, a place's detail page, Watches).
 *
 * 1. Looks for a public Mapbox token (`MAPBOX_ACCESS_TOKEN` in the environment, else `.env`).
 *    The token is never printed. With one, the build bundles it and the screenshots show the
 *    map, with only Mapbox's host let through; without one, Explore is list-only and the run
 *    is entirely network-free.
 * 2. `npm run build`, then the `@docs` Playwright spec (`tests/docs`,
 *    `playwright.docs.config.ts`) against the built app in fixture mode, as for
 *    `npm run test:e2e`. On Linux without a display it runs under `xvfb-run`.
 * 3. Optimises each capture (a 256-colour palette at full compression) into `docs/images/`.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const rawDir = path.join(root, 'test-results', 'docs');
const outDir = path.join(root, 'docs', 'images');

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
  for (const name of fs.readdirSync(rawDir).filter((file) => file.endsWith('.png'))) {
    const target = path.join(outDir, name);
    await sharp(path.join(rawDir, name))
      .png({ palette: true, colours: 256, compressionLevel: 9, effort: 10 })
      .toFile(target);
    console.log(`docs/images/${name}: ${Math.round(fs.statSync(target).size / 1024)} KB`);
  }
}

async function main() {
  const token = process.env.MAPBOX_ACCESS_TOKEN ?? tokenFromDotEnv() ?? '';
  const map = token.startsWith('pk.');
  console.log(
    map
      ? 'docs:screenshots: Mapbox token found; the map is shown (only api.mapbox.com is reached).'
      : 'docs:screenshots: no Mapbox token; Explore is list-only and nothing is downloaded.'
  );

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  run(npm, ['run', 'build'], process.env);

  fs.rmSync(rawDir, { recursive: true, force: true });
  const env = { ...process.env, DOCS_MAP: map ? '1' : '0', DOCS_SCREENSHOTS_DIR: rawDir };
  const playwright = ['playwright', 'test', '-c', 'playwright.docs.config.ts'];
  const needsXvfb = process.platform === 'linux' && !process.env.DISPLAY;
  if (needsXvfb) run('xvfb-run', ['-a', 'npx', ...playwright], env);
  else run(process.platform === 'win32' ? 'npx.cmd' : 'npx', playwright, env);

  await optimise();
}

main().catch((error) => {
  console.error(`docs:screenshots: ${error.message}`);
  process.exit(1);
});
