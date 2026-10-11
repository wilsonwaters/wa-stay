#!/usr/bin/env node
/**
 * CI's check of the Windows build (`.github/workflows/build.yml`, after
 * `electron-builder --win`), on the unpacked app it packaged:
 *
 *   node scripts/check-windows-package.js [release/win-unpacked]
 *
 * - `WA Stay.exe`'s Electron fuses, read back with `@electron/fuses`, are those
 *   `electron-builder.json` sets (the same expectations as `npm run smoke:packaged`);
 * - the exe carries the asar integrity record Electron checks on Windows, and its hash is the
 *   SHA-256 of `resources/app.asar`'s header (`EnableEmbeddedAsarIntegrityValidation` is on, so
 *   a wrong record would stop the app from starting);
 * - app.asar ships exactly one better-sqlite3 binary, `win32-x64` (the Windows targets are x64
 *   only), kept outside the archive, and none of its C sources.
 *
 * It runs on any OS: the files are only read. Exits 1 on the first failed check.
 */

const fs = require('fs');
const path = require('path');
const {
  asarFiles,
  asarHeaderHash,
  betterSqlite3Contents,
  embeddedAsarIntegrity,
  fuseResults,
} = require('./lib/packaged-app');

const ROOT = path.resolve(__dirname, '..');
const EXECUTABLE = 'WA Stay.exe';
const BINARY = 'prebuilds/win32-x64.node';

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`  ok - ${message}`);
}

async function main() {
  const dir = path.resolve(process.argv[2] ?? path.join(ROOT, 'release', 'win-unpacked'));
  const executable = path.join(dir, EXECUTABLE);
  const archive = path.join(dir, 'resources', 'app.asar');
  for (const file of [executable, archive]) {
    if (!fs.existsSync(file)) {
      throw new Error(`${file} is missing: run \`npx electron-builder --win\` first`);
    }
  }

  console.log(`# fuses: ${executable}`);
  for (const { name, on, state, ok } of await fuseResults(executable)) {
    check(ok, `${name} is ${on ? 'on' : 'off'} (read ${state})`);
  }

  console.log(`# asar integrity: ${archive}`);
  const records = embeddedAsarIntegrity(fs.readFileSync(executable));
  const record = records.find((entry) => entry.file === 'resources\\app.asar');
  check(record !== undefined, `${EXECUTABLE} has an integrity record for resources\\app.asar`);
  check(record.alg === 'SHA256', `the record is SHA256 (read ${record.alg})`);
  check(record.value === asarHeaderHash(archive), "it matches app.asar's header");

  console.log(`# better-sqlite3`);
  const sqlite = betterSqlite3Contents(asarFiles(archive));
  check(
    sqlite.prebuilds.length === 1 && sqlite.prebuilds[0] === BINARY,
    `exactly one better-sqlite3 binary ships, ${BINARY} (found ${sqlite.prebuilds.join(', ') || 'none'})`
  );
  check(
    sqlite.unpacked.length === 1 && sqlite.unpacked[0] === BINARY,
    `it is the only better-sqlite3 file outside app.asar (found ${sqlite.unpacked.join(', ')})`
  );
  check(
    fs.existsSync(
      path.join(dir, 'resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3', BINARY)
    ),
    'it is in app.asar.unpacked'
  );
  check(sqlite.sources.length === 0, "none of better-sqlite3's C sources (deps/, src/) ship");
  console.log('Windows package check passed');
}

main().catch((error) => {
  console.error(`Windows package check failed: ${error.message}`);
  process.exit(1);
});
