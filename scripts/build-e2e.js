#!/usr/bin/env node
/**
 * `npm run build:e2e`: the normal build (`npm run build`) for the Electron smoke tests, with
 * `MAPBOX_ACCESS_TOKEN` set to an empty string in the environment.
 *
 * The renderer resolves the token as `process.env.MAPBOX_ACCESS_TOKEN ?? <.env> ?? ''`, so the
 * empty string wins over a developer's `.env`: the e2e build never has a token, and Explore is
 * deterministically list-only. Set here rather than on the command line so it works the same
 * in every shell.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const env = { ...process.env, MAPBOX_ACCESS_TOKEN: '' };

// Under `npm run`, npm_execpath is npm's own CLI script: run it with this Node, no shell needed.
const npmCli = process.env.npm_execpath;
const result = npmCli
  ? spawnSync(process.execPath, [npmCli, 'run', 'build'], { cwd: root, env, stdio: 'inherit' })
  : spawnSync('npm', ['run', 'build'], {
      cwd: root,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

if (result.error) {
  console.error(`build:e2e: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
