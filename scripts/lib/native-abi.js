'use strict';

/**
 * Diagnosis for the native-ABI guard (scripts/check-native-abi.js).
 *
 * better-sqlite3 is a native module. Since version 13 it ships prebuilt Node-API binaries in
 * the package, and one binary loads in both Node (Jest) and Electron (the app), so it is no
 * longer built per runtime. An ABI mismatch now means an install from before that upgrade:
 * better-sqlite3 9, which the old postinstall (`electron-builder install-app-deps`) built for
 * Electron 28. These functions turn whatever loading better-sqlite3 threw into an actionable
 * message. They are pure so they can be unit tested without touching a native binary.
 */

/** Electron 28, whose better-sqlite3 9 build `npm ci` installed before better-sqlite3 13. */
const ELECTRON_ABI = 119;

/** NODE_MODULE_VERSION → runtime, for the ABIs this project meets. */
const KNOWN_ABIS = {
  108: 'Node 18',
  115: 'Node 20',
  [ELECTRON_ABI]: 'Electron 28',
  127: 'Node 22',
  137: 'Node 24',
};

const FIX_COMMAND = 'npm rebuild better-sqlite3';

// Node's wording, identical on every platform. It never looks at the module path, which is
// POSIX on Linux/macOS and `\\?\C:\...` on Windows.
const ABI_MISMATCH = /NODE_MODULE_VERSION\s+(\d+)[\s\S]*?requires\s+NODE_MODULE_VERSION\s+(\d+)/;

// `bindings` throws this when the package is present but its .node binary was never built,
// for example after `npm ci --ignore-scripts`.
const BINDING_MISSING = /Could not locate the bindings file/;

/**
 * @param {number} abi
 * @returns {string}
 */
function describeAbi(abi) {
  return KNOWN_ABIS[abi] || 'another runtime';
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function messageOf(error) {
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return String(error);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function originalText(error) {
  if (error && typeof error === 'object' && 'stack' in error && error.stack) {
    return String(error.stack);
  }
  return messageOf(error);
}

/**
 * @typedef {{ modules: string, version: string }} Runtime
 *   `process.versions.modules` and `process.version` of the Node running Jest.
 *
 * @typedef {object} Diagnosis
 * @property {'ok' | 'abi-mismatch' | 'not-installed' | 'load-error'} kind
 * @property {string} message  Text to print. Empty when kind is 'ok'.
 * @property {number} [compiledAbi]  ABI the installed binary was built for (abi-mismatch only).
 * @property {number} [runtimeAbi]  ABI this Node needs (abi-mismatch only).
 */

/**
 * @param {number} compiledAbi
 * @param {Runtime} runtime
 * @returns {string}
 */
function mismatchMessage(compiledAbi, runtime) {
  const builtFor = describeAbi(compiledAbi);
  const why =
    compiledAbi === ELECTRON_ABI
      ? [
          "The installed binary is Electron's build of better-sqlite3 9, from an install made",
          'before better-sqlite3 13, whose one binary loads in both Node and Electron. Jest runs',
          'on plain Node and needs a build it can load.',
        ]
      : [
          `The installed binary was built for ${builtFor}, not for this Node.js (for`,
          'example after switching Node versions). Jest needs a build for this Node.',
        ];

  const installed = 'Installed better_sqlite3.node:';
  const current = `This Node.js (${runtime.version}):`;
  const width = Math.max(installed.length, current.length) + 1;

  return [
    'better-sqlite3 is built for the wrong runtime, so the Jest suite cannot load it.',
    '',
    `  ${installed.padEnd(width)}NODE_MODULE_VERSION ${compiledAbi} (${builtFor})`,
    `  ${current.padEnd(width)}NODE_MODULE_VERSION ${runtime.modules}`,
    '',
    ...why,
    '',
    'Fix:',
    `  ${FIX_COMMAND}`,
    '',
    'Or let the test scripts rebuild it for you: AUTO_REBUILD_NATIVE=1 npm test',
    'If node_modules predates better-sqlite3 13, reinstall instead: npm ci',
  ].join('\n');
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function notInstalledMessage(error) {
  return [
    'better-sqlite3 is not installed, so the Jest suite cannot open a database.',
    '',
    `  ${messageOf(error).split('\n')[0]}`,
    '',
    'Install the dependencies and build the native module for Node:',
    '  npm ci                       (skip this if node_modules is already installed)',
    `  ${FIX_COMMAND}   (builds the binary; needed after \`npm ci --ignore-scripts\`)`,
  ].join('\n');
}

/**
 * Explain what loading better-sqlite3 threw.
 *
 * @param {unknown} error  The error thrown while loading better-sqlite3 and opening
 *   `:memory:`, or null/undefined when that worked.
 * @param {Runtime} runtime
 * @returns {Diagnosis}
 */
function diagnose(error, runtime) {
  if (error === null || error === undefined) {
    return { kind: 'ok', message: '' };
  }

  const message = messageOf(error);

  const mismatch = ABI_MISMATCH.exec(message);
  if (mismatch) {
    const compiledAbi = Number(mismatch[1]);
    return {
      kind: 'abi-mismatch',
      compiledAbi,
      runtimeAbi: Number(runtime.modules),
      message: mismatchMessage(compiledAbi, runtime),
    };
  }

  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 'MODULE_NOT_FOUND' || BINDING_MISSING.test(message)) {
    return { kind: 'not-installed', message: notInstalledMessage(error) };
  }

  // Anything else (a missing libc symbol, a corrupt file, ...) is printed as it was thrown.
  return {
    kind: 'load-error',
    message: `better-sqlite3 failed to load. The original error follows.\n\n${originalText(error)}`,
  };
}

module.exports = { diagnose, FIX_COMMAND };
