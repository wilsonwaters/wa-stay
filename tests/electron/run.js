#!/usr/bin/env node
/**
 * `npm run test:electron`: live Electron tests, outside Jest.
 *
 * Bundles each `tests/electron/*.electron.ts` with esbuild (`electron` and the lazily loaded
 * `playwright-core` stay external) and
 * launches it as Electron's main script. On Linux without a display it runs under
 * `xvfb-run -a`. Exits non-zero when any test fails.
 *
 *   npm run test:electron                 # every *.electron.ts
 *   npm run test:electron -- http-transport
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');
const electronPath = require('electron');

const root = path.resolve(__dirname, '..', '..');
const filter = process.argv[2];
const entries = fs
  .readdirSync(__dirname)
  .filter((file) => file.endsWith('.electron.ts'))
  .filter((file) => !filter || file.includes(filter))
  .sort();

if (entries.length === 0) {
  console.error(`No tests/electron/*.electron.ts matches "${filter}"`);
  process.exit(1);
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-electron-bundle-'));
const needsXvfb = process.platform === 'linux' && !process.env.DISPLAY;
let failed = 0;

for (const entry of entries) {
  const outfile = path.join(outDir, entry.replace(/\.ts$/, '.js'));
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    // playwright-core is loaded lazily, on the first browser automation; these tests never do.
    external: ['electron', 'playwright-core'],
    tsconfig: path.join(root, 'tsconfig.json'),
    sourcemap: 'inline',
    logLevel: 'warning',
  });

  const electronArgs = [outfile, '--no-sandbox', '--disable-gpu'];
  const [command, args] = needsXvfb
    ? ['xvfb-run', ['-a', electronPath, ...electronArgs]]
    : [electronPath, electronArgs];
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  console.log(`\n# ${entry}`);
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) {
    console.error(
      result.error.code === 'ENOENT' && needsXvfb
        ? 'xvfb-run is missing: install xvfb (apt-get install xvfb) or set DISPLAY'
        : result.error.message
    );
    failed++;
  } else if (result.status !== 0) {
    failed++;
  }
}

fs.rmSync(outDir, { recursive: true, force: true });
console.log(`\n# ${entries.length - failed}/${entries.length} Electron test files passed`);
process.exit(failed ? 1 : 0);
