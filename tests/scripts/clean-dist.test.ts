/**
 * `npm run build` starts from an empty `dist/` (m2): electron-builder packages `dist/**`, and
 * tsc and esbuild never delete what they wrote before, so a stale module would otherwise ship.
 * The script runs on a temp folder here; the build's own wiring is read from package.json.
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { cleanDist } from '../../scripts/clean-dist';

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/clean-dist.js');
const scripts = (
  JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  }
).scripts;

/** A project folder whose dist/ holds the last build plus a module whose source is gone. */
function staleProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-clean-dist-'));
  for (const file of [
    'dist/main/main/index.js',
    'dist/main/main/retired/old-service.js',
    'dist/main/main/retired/old-service.js.map',
    'dist/preload/index.js',
    'dist/renderer/index.html',
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), '// built\n');
  }
  fs.writeFileSync(path.join(root, 'package.json'), '{}\n');
  return root;
}

describe('scripts/clean-dist.js', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('removes dist/ with every stale file in it, and nothing beside it', () => {
    const root = staleProject();
    roots.push(root);
    expect(cleanDist(root)).toBe(path.join(root, 'dist'));
    expect(fs.existsSync(path.join(root, 'dist'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'package.json'))).toBe(true);
  });

  it('does nothing when there is no dist/ yet', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-clean-dist-'));
    roots.push(root);
    expect(() => cleanDist(root)).not.toThrow();
  });

  it('works from the command line, as npm run build calls it', () => {
    const root = staleProject();
    roots.push(root);
    const result = spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(root, 'dist/main/main/retired/old-service.js'))).toBe(false);
  });

  it('runs first in npm run build, which build:e2e runs', () => {
    const steps = scripts.build.split('&&').map((step) => step.trim());
    expect(steps[0]).toBe('node scripts/clean-dist.js');
    expect(steps.slice(1)).toEqual([
      'npm run build:main',
      'npm run build:preload',
      'npm run build:renderer',
    ]);
    expect(scripts['build:e2e']).toBe('node scripts/build-e2e.js');
    expect(fs.readFileSync(path.join(ROOT, 'scripts/build-e2e.js'), 'utf8')).toMatch(
      /\[npmCli, 'run', 'build'\]/
    );
  });
});
