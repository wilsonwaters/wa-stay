#!/usr/bin/env node
'use strict';

/**
 * Removes `dist/` at the start of `npm run build` (and so of `build:e2e`, which runs it).
 *
 * electron-builder packages `dist/**`, but only Vite empties its own folder (`dist/renderer`):
 * tsc (`dist/main`) and esbuild (`dist/preload`) only add and overwrite. Without this, a module
 * whose source was deleted or moved would stay in `dist/main` and ship in a local `dist:win`.
 * Plain `fs.rmSync`, so it works the same in every shell and on Windows.
 *
 *   node scripts/clean-dist.js            removes <repo>/dist
 *   node scripts/clean-dist.js <root>     removes <root>/dist (tests)
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

/** Removes `<root>/dist` and everything in it; nothing to do when it is not there. */
function cleanDist(root = PROJECT_ROOT) {
  const dist = path.join(root, 'dist');
  // Retries ride out a file briefly held open on Windows (an indexer, an antivirus scan).
  fs.rmSync(dist, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  return dist;
}

if (require.main === module) {
  try {
    const removed = cleanDist(process.argv[2] ? path.resolve(process.argv[2]) : PROJECT_ROOT);
    console.log(`clean-dist: removed ${path.relative(process.cwd(), removed) || removed}`);
  } catch (error) {
    console.error(`clean-dist: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { cleanDist };
