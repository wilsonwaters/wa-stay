/**
 * U3's structural rules for the rebuilt Bookings feature (#37): the legacy pages and forms are
 * gone, the feature's files stay small, nothing in it reaches for `window.api` or a user id,
 * and there is no fake "Cancel booking" anywhere in it.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../../../src');
const BOOKINGS = path.join(SRC, 'renderer/features/bookings');

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
const hits = (pattern: RegExp) =>
  walk(BOOKINGS).flatMap((file) =>
    lines(file)
      .map((line, i) => ({ line, at: `${relative(file)}:${i + 1}` }))
      .filter(({ line }) => pattern.test(line))
      .map(({ at }) => at)
  );

describe('Bookings feature guards (U3)', () => {
  it('legacy booking files are gone', () => {
    for (const file of [
      'renderer/features/bookings/legacy',
      'renderer/pages',
      'renderer/pages/Dashboard.tsx',
      'renderer/components/forms/ManualBookingForm.tsx',
      'renderer/components/forms/ImportBookingForm.tsx',
      'shared/schemas/booking.schema.ts',
    ]) {
      expect(fs.existsSync(path.join(SRC, file))).toBe(false);
    }
  });

  it('every features/bookings file is ≤ 250 lines', () => {
    const files = walk(BOOKINGS);
    expect(files.length).toBeGreaterThan(10);
    expect(files.filter((f) => lines(f).length > 250).map(relative)).toEqual([]);
  });

  it('no window.api or userId in features/bookings (grep "window.api\\|userId")', () => {
    expect(hits(/window.api|userId/)).toEqual([]);
  });

  it('no "cancel booking" in features/bookings (grep -i)', () => {
    expect(hits(/cancel booking/i)).toEqual([]);
  });

  it('legacy-mapping is gone, booking half and snipe half alike', () => {
    expect(fs.existsSync(path.join(SRC, 'renderer/components/forms/legacy-mapping.ts'))).toBe(
      false
    );
  });
});
