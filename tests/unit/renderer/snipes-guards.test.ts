/**
 * @jest-environment node
 *
 * U2's static criteria: the legacy Site Sniper pages, form and schema are gone, and the snipes
 * feature reaches main only through renderer/api (no `window.api`, no user id), never opens a
 * browser window itself (`window.open`; payment goes through `snipes.openPayment`), and keeps
 * every file to 250 lines. The scans read every file in the folder, tests included, as
 * `grep -rn` would.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../../../src');
const RENDERER = path.join(SRC, 'renderer');
const FEATURE = path.join(RENDERER, 'features/snipes');

function walk(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]
    );
}

const read = (file: string) => fs.readFileSync(file, 'utf8');
const rel = (file: string) => path.relative(RENDERER, file);

describe('Site Sniper (U2)', () => {
  it.each([
    'renderer/pages/SiteSniper',
    'renderer/features/snipes/legacy',
    'renderer/components/forms/SiteSniperForm.tsx',
    'shared/schemas/site-sniper.schema.ts',
  ])('the legacy %s is deleted', (file) => {
    expect(fs.existsSync(path.join(SRC, file))).toBe(false);
  });

  it('has no window.open, window.api or userId in features/snipes', () => {
    const hits = walk(FEATURE).filter((file) => /window\.open|window\.api|userId/.test(read(file)));
    expect(hits.map(rel)).toEqual([]);
  });

  it('keeps every file in the feature to 250 lines', () => {
    const long = walk(FEATURE)
      .map((file) => [rel(file), read(file).split('\n').length] as const)
      .filter(([, lines]) => lines > 250);
    expect(long).toEqual([]);
  });

  it('has no free-text site id input left anywhere in the renderer', () => {
    const hits = walk(RENDERER).filter((file) => /targetSiteIds|campgroundId/.test(read(file)));
    expect(hits.map(rel)).toEqual([]);
  });
});
