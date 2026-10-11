/**
 * V4's module layout: the watch, snipe and booking services (and notifications) live in
 * `core/`, nothing in `core/` or `scheduler/` reaches into a provider module, and the
 * scheduler uses chained timers only (no `setInterval`).
 */

import fs from 'fs';
import path from 'path';

const MAIN = path.resolve(__dirname, '../../../src/main');

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(file);
    return /\.ts$/.test(entry.name) ? [file] : [];
  });
}

describe('core services and scheduler layout', () => {
  it('services/{watch,sitesniper,booking,notification} are gone; the services are in core/', () => {
    for (const old of ['watch', 'sitesniper', 'booking', 'notification']) {
      expect(fs.existsSync(path.join(MAIN, 'services', old))).toBe(false);
    }
    for (const moved of [
      'core/watches/watch.service.ts',
      'core/snipes/snipe.service.ts',
      'core/bookings/booking.service.ts',
      'core/notifications/notification.service.ts',
    ]) {
      expect(fs.existsSync(path.join(MAIN, moved))).toBe(true);
    }
  });

  it('nothing in core/ or scheduler/ imports a provider module (providers/parkstay)', () => {
    const offenders = [
      ...sources(path.join(MAIN, 'core')),
      ...sources(path.join(MAIN, 'scheduler')),
    ]
      .filter((file) => /providers\/parkstay/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(MAIN, file));
    expect(offenders).toEqual([]);
  });

  it('the scheduler has no setInterval', () => {
    const offenders = sources(path.join(MAIN, 'scheduler')).filter((file) =>
      /setInterval/.test(fs.readFileSync(file, 'utf8'))
    );
    expect(offenders).toEqual([]);
  });
});
