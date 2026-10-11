/**
 * D(col), migration v8's calendar-date normalisation (tech-review #14), evaluated by SQLite
 * itself: legacy ISO instants round to the nearest UTC midnight, which is the day a
 * calendar-date picker meant whether it wrote UTC midnight or local midnight anywhere from
 * UTC-11 to UTC+12, including AWST. Anything it cannot read is copied unchanged.
 */

import Database from 'better-sqlite3';
import { calendarDateSql } from '@main/database/connection';

describe('migration v8 calendar-date normalisation D(col)', () => {
  let db: Database.Database;
  let normalise: (value: string | null) => string | null;

  beforeAll(() => {
    db = new Database(':memory:');
    const stmt = db.prepare(`SELECT ${calendarDateSql('v')} AS d FROM (SELECT ? AS v)`);
    normalise = (value) => (stmt.get(value) as { d: string | null }).d;
  });

  afterAll(() => db.close());

  it('reads UTC-midnight writes (toISOString of a date input) as that day', () => {
    expect(normalise('2026-12-13T00:00:00.000Z')).toBe('2026-12-13');
    expect(normalise('2026-12-14T00:00:00.000Z')).toBe('2026-12-14');
  });

  it('reads AWST-midnight writes as the AWST day, at both ends of the stay', () => {
    // 00:00 AWST on 13 Dec and on 14 Dec
    expect(normalise('2026-12-12T16:00:00.000Z')).toBe('2026-12-13');
    expect(normalise('2026-12-13T16:00:00.000Z')).toBe('2026-12-14');
    // The same instants written with their offset
    expect(normalise('2026-12-13T00:00:00.000+08:00')).toBe('2026-12-13');
    expect(normalise('2026-12-14T00:00:00+08:00')).toBe('2026-12-14');
  });

  it('reads local-midnight writes from UTC-11 to UTC+12 as the local day', () => {
    expect(normalise('2026-12-13T11:00:00.000Z')).toBe('2026-12-13'); // UTC-11
    expect(normalise('2026-12-13T05:00:00.000Z')).toBe('2026-12-13'); // UTC-5
    expect(normalise('2026-12-12T13:00:00.000Z')).toBe('2026-12-13'); // UTC+11 (Sydney, summer)
    expect(normalise('2026-12-12T12:00:00.000Z')).toBe('2026-12-13'); // UTC+12
  });

  it('rounds at noon UTC: the cut-over between two days', () => {
    expect(normalise('2026-12-12T11:59:59.999Z')).toBe('2026-12-12');
    expect(normalise('2026-12-12T12:00:00.000Z')).toBe('2026-12-13');
  });

  it('crosses month ends, year ends and leap days', () => {
    expect(normalise('2026-01-31T16:00:00.000Z')).toBe('2026-02-01');
    expect(normalise('2028-02-28T16:00:00.000Z')).toBe('2028-02-29');
    expect(normalise('2026-12-31T16:00:00.000Z')).toBe('2027-01-01');
  });

  it('copies values that are already calendar dates, empty or NULL unchanged', () => {
    expect(normalise('2026-12-13')).toBe('2026-12-13');
    expect(normalise('')).toBe('');
    expect(normalise(null)).toBeNull();
  });

  it('copies values it cannot read unchanged, never truncating them into another value', () => {
    expect(normalise('garbage')).toBe('garbage');
    expect(normalise('not a date at all')).toBe('not a date at all');
    expect(normalise('2026-02-30T00:00:00.000Z')).toBe('2026-02-30T00:00:00.000Z');
    // A real date followed by a time SQLite cannot read keeps its date
    expect(normalise('2026-12-13 sometime')).toBe('2026-12-13');
  });
});
