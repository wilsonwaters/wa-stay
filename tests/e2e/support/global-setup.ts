/**
 * Runs once before the Electron smoke tests: they drive the built app, so stop early, with
 * the fix, when the build is missing.
 */

import fs from 'fs';
import path from 'path';
import { REPO_ROOT } from './paths';

const BUILD_OUTPUTS = [
  'dist/main/main/index.js',
  'dist/preload/index.js',
  'dist/renderer/index.html',
];

export default function globalSetup(): void {
  const missing = BUILD_OUTPUTS.filter((file) => !fs.existsSync(path.join(REPO_ROOT, file)));
  if (missing.length > 0) {
    throw new Error(
      `The Electron smoke tests drive the built app, and ${missing.join(', ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} missing: run \`npm run build:e2e\` first.`
    );
  }
}
