/**
 * @jest-environment node
 *
 * Code blocks in the docs that copy a source region stay word for word what the source says.
 * A synced block is a fenced block right after a marker naming the file and region:
 *
 *   <!-- region: tests/fixtures/providers/example-api/index.ts#api-manifest -->
 *   ```ts
 *   …
 *   ```
 *
 * and the region is the lines between `// #region docs:api-manifest` and the next
 * `// #endregion` in that file, with their common indentation removed. Every region of the
 * guide's example providers appears in the guide.
 */

import fs from 'fs';
import path from 'path';
import { docFiles, readDoc, ROOT } from './markdown';

const GUIDE = 'docs/providers/adding-a-provider.md';
const EXAMPLES = [
  'tests/fixtures/providers/example-api/index.ts',
  'tests/fixtures/providers/example-api/holds.ts',
  'tests/fixtures/providers/example-api/auth.ts',
  'tests/fixtures/providers/example-browser/index.ts',
];

interface SyncedBlock {
  doc: string;
  file: string;
  region: string;
  code: string;
}

function dedent(lines: string[]): string {
  const indents = lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(cut)).join('\n');
}

/** Every `// #region docs:<name>` of `file`, by name. */
function regionsOf(file: string): Map<string, string> {
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n').split('\n');
  const regions = new Map<string, string>();
  for (let i = 0; i < lines.length; i++) {
    const name = /^\s*\/\/ #region docs:([\w-]+)\s*$/.exec(lines[i])?.[1];
    if (!name) continue;
    const end = lines.findIndex((line, j) => j > i && /^\s*\/\/ #endregion\s*$/.test(line));
    if (end < 0) throw new Error(`${file}: region ${name} has no #endregion`);
    if (regions.has(name)) throw new Error(`${file}: region ${name} appears twice`);
    regions.set(name, dedent(lines.slice(i + 1, end)));
  }
  return regions;
}

/** Every synced block of `doc`. */
function syncedBlocks(doc: string): SyncedBlock[] {
  const lines = readDoc(doc).split('\n');
  const blocks: SyncedBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const marker = /^<!-- region: (\S+)#([\w-]+) -->$/.exec(lines[i].trim());
    if (!marker) continue;
    const open = lines.findIndex((line, j) => j > i && line.trim() !== '');
    const fence = /^(`{3,})\w*$/.exec(lines[open] ?? '')?.[1];
    if (!fence)
      throw new Error(`${doc}:${i + 1}: a region marker must be followed by a code block`);
    const close = lines.findIndex((line, j) => j > open && line.trim() === fence);
    blocks.push({
      doc,
      file: marker[1],
      region: marker[2],
      code: lines.slice(open + 1, close).join('\n'),
    });
  }
  return blocks;
}

describe('synced code blocks in the docs', () => {
  const blocks = docFiles().flatMap(syncedBlocks);

  it('finds the guide and its blocks', () => {
    expect(blocks.filter((b) => b.doc === GUIDE).length).toBeGreaterThanOrEqual(10);
  });

  it.each(blocks.map((b) => [`${b.doc} ← ${b.file}#${b.region}`, b] as const))(
    '%s matches its source region',
    (_name, block) => {
      const regions = regionsOf(block.file);
      expect(regions.has(block.region)).toBe(true);
      expect(block.code).toBe(regions.get(block.region));
    }
  );

  it.each(EXAMPLES)('every region of %s is in the guide', (file) => {
    const shown = new Set(
      blocks.filter((b) => b.doc === GUIDE && b.file === file).map((b) => b.region)
    );
    expect([...regionsOf(file).keys()].filter((region) => !shown.has(region))).toEqual([]);
  });
});
