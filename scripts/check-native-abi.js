#!/usr/bin/env node
'use strict';

/**
 * Native-ABI guard for the Jest scripts (wired as pretest, pretest:coverage, pretest:watch).
 *
 * Loads better-sqlite3 and opens an in-memory database. If that works it exits 0 silently.
 * Otherwise it explains why (see lib/native-abi.js) and exits 1, so a wrong-ABI binary
 * produces one clear message instead of a dlopen error in every database test.
 *
 * AUTO_REBUILD_NATIVE=1: on an ABI mismatch, run `npm rebuild better-sqlite3` and check
 * again in a fresh process.
 */

const path = require('path');
const { spawnSync } = require('child_process');
const { diagnose, FIX_COMMAND } = require('./lib/native-abi');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function loadBetterSqlite3() {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.close();
    return null;
  } catch (error) {
    return error;
  }
}

function rebuildAndRecheck(diagnosis) {
  console.error(
    `[check-native-abi] better-sqlite3 is built for NODE_MODULE_VERSION ${diagnosis.compiledAbi}, ` +
      `this Node.js needs ${diagnosis.runtimeAbi}. AUTO_REBUILD_NATIVE=1, running \`${FIX_COMMAND}\`.`
  );

  const rebuild = spawnSync('npm', ['rebuild', 'better-sqlite3'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (rebuild.error) {
    console.error(`[check-native-abi] Could not run \`${FIX_COMMAND}\`: ${rebuild.error.message}`);
    return 1;
  }
  if (rebuild.status !== 0) {
    console.error(`[check-native-abi] \`${FIX_COMMAND}\` failed.`);
    return rebuild.status === null ? 1 : rebuild.status;
  }

  // This process has already tried the old binary, so check the new one in a fresh process.
  // AUTO_REBUILD_NATIVE is cleared there, so a rebuild that did not help reports and stops.
  const recheck = spawnSync(process.execPath, [__filename], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    env: { ...process.env, AUTO_REBUILD_NATIVE: '' },
  });
  return recheck.status === null ? 1 : recheck.status;
}

function main() {
  const diagnosis = diagnose(loadBetterSqlite3(), {
    modules: process.versions.modules,
    version: process.version,
  });

  if (diagnosis.kind === 'ok') {
    return 0;
  }
  if (diagnosis.kind === 'abi-mismatch' && process.env.AUTO_REBUILD_NATIVE === '1') {
    return rebuildAndRecheck(diagnosis);
  }

  console.error(`\n${diagnosis.message}\n`);
  return 1;
}

process.exitCode = main();
