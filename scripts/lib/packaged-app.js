'use strict';

/**
 * Checks of a packaged WA Stay, shared by `scripts/packaged-smoke.js` (the Linux package) and
 * `scripts/check-windows-package.js` (CI's Windows build): the executable's Electron fuses,
 * app.asar's index, the asar integrity record electron-builder embeds in a Windows executable,
 * and the one better-sqlite3 binary. Nothing here needs a dependency but `@electron/fuses`.
 */

const crypto = require('crypto');
const fs = require('fs');

/**
 * The fuses `electron-builder.json` (`electronFuses`) flips, by `FuseV1Options` name: true is
 * on. The others keep Electron's defaults. `tests/scripts/packaged-app.test.ts` keeps this in
 * step with the config.
 */
const EXPECTED_FUSES = Object.freeze({
  RunAsNode: false,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  OnlyLoadAppFromAsar: true,
  EnableCookieEncryption: true,
  EnableEmbeddedAsarIntegrityValidation: true,
});

/** `@electron/fuses` is an ES module. */
function loadFuses() {
  return import('@electron/fuses');
}

/**
 * Each expected fuse as the executable has it: `{ name, on, state, ok }`, where `state` is the
 * `FuseState` name read back (`ENABLE`, `DISABLE`, …).
 *
 * @param {string} executable
 */
async function fuseResults(executable) {
  const { FuseState, FuseV1Options, getCurrentFuseWire } = await loadFuses();
  const wire = await getCurrentFuseWire(executable);
  return Object.entries(EXPECTED_FUSES).map(([name, on]) => {
    const value = wire[FuseV1Options[name]];
    return {
      name,
      on,
      state: FuseState[value] ?? String(value),
      ok: value === (on ? FuseState.ENABLE : FuseState.DISABLE),
    };
  });
}

/**
 * An asar archive's header: a Chromium pickle holding the header's size, then a pickle holding
 * the header JSON. `headerString` is the JSON text, which the integrity record hashes.
 *
 * @param {string} archive
 */
function readAsarHeader(archive) {
  const fd = fs.openSync(archive, 'r');
  try {
    const sizePickle = Buffer.alloc(8);
    fs.readSync(fd, sizePickle, 0, 8, 0);
    const headerPickle = Buffer.alloc(sizePickle.readUInt32LE(4));
    fs.readSync(fd, headerPickle, 0, headerPickle.length, 8);
    const headerString = headerPickle.toString('utf8', 8, 8 + headerPickle.readUInt32LE(4));
    return { headerString, header: JSON.parse(headerString) };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Every file in an asar archive, from its header (a tree of `files`), as
 * `{ path, unpacked, integrity }`; files kept outside the archive are `unpacked`.
 *
 * @param {string} archive
 */
function asarFiles(archive) {
  const files = [];
  const walk = (node, prefix) => {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const at = prefix ? `${prefix}/${name}` : name;
      if (entry.files) walk(entry, at);
      else if (!entry.link) {
        files.push({ path: at, unpacked: entry.unpacked === true, integrity: entry.integrity });
      }
    }
  };
  walk(readAsarHeader(archive).header, '');
  return files;
}

/** The SHA-256 of an archive's header, as Electron's asar integrity check computes it. */
function asarHeaderHash(archive) {
  return crypto.createHash('sha256').update(readAsarHeader(archive).headerString).digest('hex');
}

/**
 * The asar integrity records electron-builder embeds in a Windows executable: a resource
 * (`INTEGRITY`/`ELECTRONASAR`) holding the JSON list `[{ file, alg, value }]`, stored as plain
 * text, so it is found by scanning the file's bytes instead of parsing its resource table.
 *
 * @param {Buffer} executable  The executable's contents.
 * @returns {Array<{ file: string, alg: string, value: string }>}
 */
function embeddedAsarIntegrity(executable) {
  const text = executable.toString('latin1');
  const pattern = /\{"file":"(?:[^"\\]|\\.)*","alg":"[A-Za-z0-9]+","value":"[0-9a-f]+"\}/g;
  return [...text.matchAll(pattern)].map((match) => JSON.parse(match[0]));
}

const BETTER_SQLITE3 = 'node_modules/better-sqlite3/';

/**
 * What app.asar holds of better-sqlite3: its prebuilt binaries, the files of it kept outside
 * the archive, and any of its C sources (`deps/`, `src/`).
 *
 * @param {Array<{ path: string, unpacked: boolean }>} entries  `asarFiles`.
 */
function betterSqlite3Contents(entries) {
  const own = entries.filter((entry) => entry.path.startsWith(BETTER_SQLITE3));
  const relative = (entry) => entry.path.slice(BETTER_SQLITE3.length);
  return {
    prebuilds: own.filter((e) => relative(e).startsWith('prebuilds/')).map(relative),
    unpacked: own.filter((e) => e.unpacked).map(relative),
    sources: own.filter((e) => /^(deps|src)\//.test(relative(e))).map(relative),
  };
}

module.exports = {
  EXPECTED_FUSES,
  asarFiles,
  asarHeaderHash,
  betterSqlite3Contents,
  embeddedAsarIntegrity,
  fuseResults,
  loadFuses,
  readAsarHeader,
};
