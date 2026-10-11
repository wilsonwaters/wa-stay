/**
 * @jest-environment node
 *
 * U5's static criteria: the five legacy system surfaces are gone, and the notifications feature
 * reaches main only through renderer/api (no `window.api`, no user id), never polls, uses no
 * emoji, and keeps every file to 250 lines. The scans read every file in the folders, tests
 * included, as `grep -rn` would.
 */
import fs from 'fs';
import path from 'path';

const RENDERER = path.resolve(__dirname, '../../../src/renderer');
const FEATURE = path.join(RENDERER, 'features/notifications');

function walk(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]
    );
}

const read = (file: string) => fs.readFileSync(file, 'utf8');
const rel = (file: string) => path.relative(RENDERER, file);

describe('notifications and system surfaces (U5)', () => {
  it.each([
    'NotificationBell.tsx',
    'NotificationList.tsx',
    'QueueStatus.tsx',
    'UpdateNotification.tsx',
    'AboutDialog.tsx',
  ])('the legacy components/%s is deleted', (file) => {
    expect(fs.existsSync(path.join(RENDERER, 'components', file))).toBe(false);
  });

  it('has no window.api and no userId in features/notifications', () => {
    const hits = walk(FEATURE).filter((file) => /window\.api|userId/.test(read(file)));
    expect(hits.map(rel)).toEqual([]);
  });

  it('never polls: no queue.getStatus and no setInterval in features/notifications', () => {
    const hits = walk(FEATURE).filter((file) => /queue\.getStatus|setInterval/.test(read(file)));
    expect(hits.map(rel)).toEqual([]);
  });

  it('uses no emoji in features/notifications', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    const hits = walk(FEATURE).filter((file) =>
      read(file)
        .split('\n')
        // © ® ™ are typographic symbols, not emoji (design-language.md, token guard)
        .some((line) => emoji.test(line.replace(/[©®™]/g, '')))
    );
    expect(hits.map(rel)).toEqual([]);
  });

  it('keeps every file in the feature, About and the notifications hooks to 250 lines', () => {
    const files = [
      ...walk(FEATURE),
      ...walk(path.join(RENDERER, 'features/settings/about')),
      path.join(RENDERER, 'api/notifications.ts'),
    ];
    const long = files
      .map((file) => [rel(file), read(file).split('\n').length] as const)
      .filter(([, lines]) => lines > 250);
    expect(long).toEqual([]);
  });
});
