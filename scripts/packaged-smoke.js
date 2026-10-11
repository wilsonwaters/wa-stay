#!/usr/bin/env node
/**
 * `npm run smoke:packaged`: starts the packaged Linux app (`electron-builder --linux dir`) the
 * way an installed copy starts, and checks that it opens its window and quits cleanly. The
 * Electron smoke tests (`tests/e2e`) drive the app from source; this is the one check of what
 * electron-builder actually ships (app.asar, the native module, the preload, the fuses).
 *
 *   npx electron-builder --linux dir --publish never
 *   xvfb-run -a npm run smoke:packaged [-- <path to the executable>]
 *
 * First, what was packaged:
 *
 * - app.asar's own index: it holds the main, preload and renderer builds, no `.d.ts` or `.map`
 *   file under `dist/` (unused at run time; `electron-builder.json` leaves them out), and an
 *   integrity hash for every file packed in it (`EnableEmbeddedAsarIntegrityValidation` needs
 *   them where Electron checks them, Windows and macOS; Linux has no such check), and exactly
 *   one better-sqlite3 binary, this platform's, the only file of it kept outside the archive;
 * - the executable's Electron fuses (`electronFuses` in `electron-builder.json`), read back with
 *   `@electron/fuses`: `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect` are ignored, the app
 *   loads only from an integrity-checked app.asar, and cookies are encrypted.
 *
 * The checks of the package itself live in `lib/packaged-app.js`, shared with CI's check of
 * the Windows build (`check-windows-package.js`).
 *
 * Each start gets a temp `XDG_CONFIG_HOME`, so the data folder is `<temp>/WA Stay` and no real
 * profile is touched. The test-only and development hooks are set on purpose
 * (`WA_STAY_USER_DATA_DIR`, `WA_STAY_E2E_FIXTURES_DIR`, `WA_STAY_PROVIDERS`,
 * `ELECTRON_RENDERER_URL`, `NODE_ENV=development`): a packaged app must ignore them
 * (architecture-notes §12.14). `WA_STAY_PROVIDERS` names a provider that is not built in, which
 * would stop an app that read it at start-up. Three starts:
 *
 * 1. the executable as shipped, given `--inspect=0` and `--remote-debugging-port=0`: Node's
 *    inspector stays off (the fuse), and through Chromium's DevTools endpoint the window shows
 *    the built page from app.asar; closing it quits the app with exit code 0 within 10 s.
 * 2. the executable driven by Playwright: `app.isPackaged` is true, and the window's
 *    `providers.list()` has the built-in providers;
 * 3. a copy named `electron`, which Electron reports as unpackaged (it decides by the
 *    executable's name) while the code still comes from `resources/app.asar`.
 *
 * Playwright's Electron launcher reaches the main process through Node's inspector, which the
 * shipped executable refuses. Starts 2 and 3 therefore use copies whose only change is
 * `EnableNodeCliInspectArguments` turned back on. For each: userData is the temp data folder,
 * the window shows the built page from app.asar with its `h1`, and `app.quit()` ends the
 * process with exit code 0 within 10 s.
 *
 * Not in fixture mode, so the app may make its usual start-up requests (the update check); it
 * is closed before the catalogue sync and account check (5 s after the window opens) start.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('@playwright/test');
const { asarFiles, betterSqlite3Contents, fuseResults, loadFuses } = require('./lib/packaged-app');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_EXECUTABLE = path.join(ROOT, 'release', 'linux-unpacked', 'wa-stay');
const STARTUP_TIMEOUT_MS = 30_000;
const QUIT_TIMEOUT_MS = 10_000;
/** `WA_STAY_PROVIDERS` for every start: not a built-in provider, so honouring it fails start-up. */
const IGNORED_PROVIDER = 'not-a-built-in-provider';

function within(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took more than ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`  ok - ${message}`);
}

/** The environment of an installed start, plus every hook a packaged app must ignore. */
function launchEnv(configHome, hookDir) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || name === 'ELECTRON_RUN_AS_NODE' || name.startsWith('WA_STAY_')) {
      continue;
    }
    env[name] = value;
  }
  return {
    ...env,
    XDG_CONFIG_HOME: configHome,
    WA_STAY_USER_DATA_DIR: path.join(hookDir, 'user-data'),
    WA_STAY_LEGACY_DATA_DIR: path.join(hookDir, 'legacy'),
    WA_STAY_E2E_FIXTURES_DIR: path.join(ROOT, 'tests', 'e2e', 'fixtures', 'http'),
    WA_STAY_PROVIDERS: IGNORED_PROVIDER,
    ELECTRON_RENDERER_URL: 'http://127.0.0.1:9/',
    NODE_ENV: 'development',
  };
}

async function checkFuses(executable) {
  console.log(`# fuses: ${executable}`);
  for (const { name, on, state, ok } of await fuseResults(executable)) {
    check(ok, `${name} is ${on ? 'on' : 'off'} (read ${state})`);
  }
}

/**
 * A copy of the executable that Playwright can drive: `EnableNodeCliInspectArguments` back on,
 * every other fuse as shipped. Named `name`, next to the original (it needs its resources).
 */
async function inspectableCopy(executable, name) {
  const { FuseV1Options, FuseVersion, flipFuses } = await loadFuses();
  const copy = path.join(path.dirname(executable), name);
  fs.copyFileSync(executable, copy);
  fs.chmodSync(copy, 0o755);
  await flipFuses(copy, {
    version: FuseVersion.V1,
    [FuseV1Options.EnableNodeCliInspectArguments]: true,
  });
  return copy;
}

function checkContents(executable) {
  const archive = path.join(path.dirname(executable), 'resources', 'app.asar');
  console.log(`# contents: ${archive}`);
  const entries = asarFiles(archive);
  const dist = entries.map((entry) => entry.path).filter((file) => file.startsWith('dist/'));
  check(
    ['dist/main/main/index.js', 'dist/preload/index.js', 'dist/renderer/index.html'].every((file) =>
      dist.includes(file)
    ),
    'app.asar has the main, preload and renderer builds'
  );
  const unused = dist.filter((file) => /\.(d\.ts|map)$/.test(file));
  check(
    unused.length === 0,
    unused.length === 0
      ? 'dist/ in app.asar has no declarations or source maps'
      : `dist/ in app.asar has ${unused.length} declaration or source map file(s): ${unused.slice(0, 5).join(', ')}`
  );
  const unhashed = entries
    .filter((entry) => !entry.unpacked && !(entry.integrity?.algorithm && entry.integrity.hash))
    .map((entry) => entry.path);
  check(
    unhashed.length === 0,
    unhashed.length === 0
      ? 'every file packed in app.asar has an integrity hash'
      : `${unhashed.length} file(s) in app.asar have no integrity hash: ${unhashed.slice(0, 5).join(', ')}`
  );

  // One better-sqlite3 binary, this platform's (electron-builder.json `files`), kept outside the
  // archive; its JavaScript inside it, under integrity; none of its C sources
  const binary = `prebuilds/${process.platform}-${process.arch}.node`;
  const sqlite = betterSqlite3Contents(entries);
  check(
    sqlite.prebuilds.length === 1 && sqlite.prebuilds[0] === binary,
    `exactly one better-sqlite3 binary ships, ${binary} (found ${sqlite.prebuilds.join(', ') || 'none'})`
  );
  check(
    sqlite.unpacked.length === 1 && sqlite.unpacked[0] === binary,
    `it is the only better-sqlite3 file outside app.asar (found ${sqlite.unpacked.join(', ')})`
  );
  check(
    fs.existsSync(
      path.join(
        path.dirname(archive),
        'app.asar.unpacked',
        'node_modules',
        'better-sqlite3',
        binary
      )
    ),
    'it is in app.asar.unpacked'
  );
  check(sqlite.sources.length === 0, "none of better-sqlite3's C sources (deps/, src/) ship");
}

/** The output lines seen so far, and a way to wait for one that matches. */
function collectOutput(proc) {
  const lines = [];
  const add = (chunk) => lines.push(String(chunk));
  proc.stdout?.on('data', add);
  proc.stderr?.on('data', add);
  return {
    text: () => lines.join(''),
    async waitFor(pattern, ms, what) {
      const deadline = Date.now() + ms;
      for (;;) {
        const match = pattern.exec(lines.join(''));
        if (match) return match;
        if (Date.now() > deadline) throw new Error(`${what} took more than ${ms} ms`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
  };
}

/** The app's window as Chromium's DevTools endpoint lists it, once it shows index.html. */
async function waitForPageTarget(port, ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page' && /index\.html/.test(t.url));
      if (page) return page;
    } catch {
      // the endpoint is not answering yet
    }
    if (Date.now() > deadline) throw new Error(`The window took more than ${ms} ms to appear`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/**
 * Start 1: the executable exactly as shipped. Playwright cannot drive it (no Node inspector), so
 * it is checked through Chromium's DevTools endpoint, and quit by closing its window.
 */
async function smokeAsShipped(executable) {
  console.log(`# as shipped: ${executable}`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-packaged-smoke-'));
  const configHome = path.join(work, 'config');
  const hookDir = path.join(work, 'hooks');
  const proc = spawn(executable, ['--no-sandbox', '--inspect=0', '--remote-debugging-port=0'], {
    env: launchEnv(configHome, hookDir),
  });
  const output = collectOutput(proc);
  const exited = new Promise((resolve) => proc.once('exit', (code) => resolve(code)));
  try {
    const [, port] = await output.waitFor(
      /DevTools listening on ws:\/\/[^:/]+:(\d+)\//,
      STARTUP_TIMEOUT_MS,
      'Starting Chromium'
    );
    const page = await waitForPageTarget(port, STARTUP_TIMEOUT_MS);
    check(
      page.url.startsWith('file://') && page.url.includes('/app.asar/dist/renderer/index.html'),
      'the window shows the built page from app.asar, not ELECTRON_RENDERER_URL'
    );
    check(
      !/Debugger listening on/.test(output.text()),
      "--inspect is ignored: Node's inspector did not start"
    );
    const userData = path.join(configHome, 'WA Stay');
    check(fs.existsSync(path.join(userData, 'wa-stay.db')), 'the database is in the data folder');
    check(!fs.existsSync(hookDir), 'no hook folder was created');
    check(
      !fs.existsSync(path.join(userData, 'e2e-unexpected-requests.log')),
      'fixture mode is off'
    );

    const closing = await fetch(`http://127.0.0.1:${port}/json/close/${page.id}`);
    check(closing.ok, 'its window closes');
    const code = await within(exited, QUIT_TIMEOUT_MS, 'Quitting WA Stay');
    check(code === 0, `quit within ${QUIT_TIMEOUT_MS / 1000} s with exit code 0`);
  } catch (error) {
    console.error(`--- app output (tail) ---\n${output.text().split('\n').slice(-60).join('\n')}`);
    throw error;
  } finally {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function smoke(executable, label, expectPackaged) {
  console.log(`# ${label}: ${executable}`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-packaged-smoke-'));
  const configHome = path.join(work, 'config');
  const hookDir = path.join(work, 'hooks');
  const output = [];
  let app;
  try {
    app = await electron.launch({
      executablePath: executable,
      args: ['--no-sandbox'],
      env: launchEnv(configHome, hookDir),
      timeout: STARTUP_TIMEOUT_MS,
    });
    const proc = app.process();
    proc.stdout?.on('data', (chunk) => output.push(String(chunk)));
    proc.stderr?.on('data', (chunk) => output.push(String(chunk)));
    const exited = new Promise((resolve) => proc.once('exit', (code) => resolve(code)));

    const info = await app.evaluate(({ app: electronApp }) => ({
      isPackaged: electronApp.isPackaged,
      appPath: electronApp.getAppPath(),
      userData: electronApp.getPath('userData'),
    }));
    check(info.isPackaged === expectPackaged, `app.isPackaged is ${expectPackaged}`);
    check(/\.asar$/.test(info.appPath), `the app is loaded from app.asar (${info.appPath})`);
    const userData = path.join(configHome, 'WA Stay');
    check(info.userData === userData, `userData is the temp data folder, not the hook's`);

    const window = await app.firstWindow({ timeout: STARTUP_TIMEOUT_MS });
    await window
      .getByRole('heading', { level: 1 })
      .first()
      .waitFor({ timeout: STARTUP_TIMEOUT_MS });
    const url = window.url();
    check(
      url.startsWith('file://') && url.includes('/app.asar/dist/renderer/index.html'),
      `the window shows the built page from app.asar, not ELECTRON_RENDERER_URL`
    );
    check(fs.existsSync(path.join(userData, 'wa-stay.db')), 'the database is in the data folder');
    check(!fs.existsSync(hookDir), 'no hook folder was created');
    check(
      !fs.existsSync(path.join(userData, 'e2e-unexpected-requests.log')),
      'fixture mode is off'
    );
    // The window asks main for its providers, as Explore does (`window.api`, the preload's)
    const providers = await window.evaluate(async () =>
      (await globalThis.api.providers.list()).data?.map((manifest) => manifest.id)
    );
    check(
      Array.isArray(providers) && providers.includes('parkstay'),
      `WA_STAY_PROVIDERS is ignored: the built-in providers registered (${providers})`
    );

    const quitting = app.close();
    const code = await within(exited, QUIT_TIMEOUT_MS, 'Quitting WA Stay');
    await quitting.catch(() => undefined);
    app = undefined;
    check(code === 0, `quit within ${QUIT_TIMEOUT_MS / 1000} s with exit code 0`);
  } catch (error) {
    console.error(
      `--- app output (tail) ---\n${output.join('').split('\n').slice(-60).join('\n')}`
    );
    throw error;
  } finally {
    if (app) app.process().kill('SIGKILL');
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function main() {
  if (process.platform !== 'linux') {
    throw new Error('The packaged smoke check runs the Linux build (electron-builder --linux dir)');
  }
  const executable = path.resolve(process.argv[2] ?? DEFAULT_EXECUTABLE);
  if (!fs.existsSync(executable)) {
    throw new Error(
      `${executable} is missing: run \`npx electron-builder --linux dir --publish never\` first`
    );
  }
  checkContents(executable);
  await checkFuses(executable);
  await smokeAsShipped(executable);

  // Playwright needs Node's inspector: copies with that one fuse back on. Electron reports any
  // executable not named `electron` as packaged; the second copy says it is not.
  for (const [name, label, expectPackaged] of [
    [`${path.basename(executable)}-inspectable`, 'packaged', true],
    ['electron', 'renamed to electron', false],
  ]) {
    const copy = await inspectableCopy(executable, name);
    try {
      await smoke(copy, label, expectPackaged);
    } finally {
      fs.rmSync(copy, { force: true });
    }
  }
  console.log('Packaged smoke check passed');
}

main().catch((error) => {
  console.error(`Packaged smoke check failed: ${error.message}`);
  process.exit(1);
});
