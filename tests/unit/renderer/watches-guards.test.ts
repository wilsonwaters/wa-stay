/**
 * U1's structural rules for the rebuilt Watches feature (#35): the legacy pages are gone, the
 * feature's files stay small, and nothing in it reaches for `window.api`, a user id, `as any`
 * or the browser's own confirm box.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../../../src');
const RENDERER = path.join(SRC, 'renderer');
const WATCHES = path.join(RENDERER, 'features/watches');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const relative = (file: string) => path.relative(SRC, file);
const lines = (file: string) =>
  fs
    .readFileSync(file, 'utf8')
    .replace(/\r?\n$/, '')
    .split(/\r?\n/);

describe('Watches feature guards (U1)', () => {
  it('legacy watch files are gone', () => {
    for (const file of [
      'renderer/features/watches/legacy',
      'renderer/components/forms/WatchForm.tsx',
      'renderer/components/AvailabilityGrid.tsx',
      'shared/schemas/watch.schema.ts',
    ]) {
      expect(fs.existsSync(path.join(SRC, file))).toBe(false);
    }
  });

  it('every features/watches file is ≤ 250 lines', () => {
    const files = walk(WATCHES);
    expect(files.length).toBeGreaterThan(10);
    const long = files.filter((f) => lines(f).length > 250).map(relative);
    expect(long).toEqual([]);
  });

  it('no window.api, userId or "as any" in features/watches', () => {
    const hits = walk(WATCHES).flatMap((file) =>
      lines(file)
        .map((line, i) => ({ line, at: `${relative(file)}:${i + 1}` }))
        .filter(({ line }) => /window\.api|userId|\bas any\b/.test(line))
        .map(({ at }) => at)
    );
    expect(hits).toEqual([]);
  });

  it('no window.confirm in src/renderer', () => {
    const hits = walk(RENDERER)
      .filter((file) => fs.readFileSync(file, 'utf8').includes('window.confirm'))
      .map(relative);
    expect(hits).toEqual([]);
  });
});
