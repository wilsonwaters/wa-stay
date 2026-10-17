/**
 * The repositories' side of R18 (v12's `hold_expires_estimated`, no new migration):
 * - `markHeld` writes the estimate flag from the hold, with and without it; reads round-trip it
 *   as `Watch.hold.expiresEstimated` / `SiteSnipe.holdExpiresEstimated` (absent, so false,
 *   otherwise); a row v12 migrated (the column's default 0) reads false;
 * - `endHold` ends a hold now with its message (a snipe EXPIRED, a watch still held), exact
 *   from then on, and only while the row holds that same hold: a booked row, another hold or a
 *   missing row is left alone.
 */

import type Database from 'better-sqlite3';
import { SiteSniperRepository, WatchRepository } from '@main/database/repositories';
import { SnipeResult, SnipeStatus, WatchResult } from '@shared/types/common.types';
import { createMockSiteSnipeInput } from '@tests/fixtures/site-sniper';
import { mockUserInput } from '@tests/fixtures/users';
import { createMockWatchInput } from '@tests/fixtures/watches';
import { insertUser, TestDatabaseHelper } from '@tests/utils/database-helper';

const EXPIRES = new Date('2026-12-01T02:30:00.000Z');
const ENDED = new Date('2026-12-01T02:12:00.000Z');

describe('hold expiry estimates and ended holds (R18)', () => {
  let dbHelper: TestDatabaseHelper;
  let db: Database.Database;
  let watches: WatchRepository;
  let snipes: SiteSniperRepository;
  let userId: number;

  beforeEach(async () => {
    dbHelper = new TestDatabaseHelper('hold-release-repo');
    await dbHelper.setup();
    db = dbHelper.getDb();
    userId = insertUser(db, mockUserInput.email).id;
    watches = new WatchRepository(db);
    snipes = new SiteSniperRepository(db);
  });

  afterEach(async () => {
    await dbHelper.teardown();
  });

  const column = (table: string, id: number) =>
    (
      db.prepare(`SELECT hold_expires_estimated AS v FROM ${table} WHERE id = ?`).get(id) as {
        v: number;
      }
    ).v;

  describe('WatchRepository', () => {
    const heldWatch = (expiresEstimated?: boolean) => {
      const watch = watches.create(userId, createMockWatchInput({ autoHold: true }));
      watches.markHeld(watch.id, {
        reference: 'H-1',
        expiresAt: EXPIRES,
        unitId: 'u1',
        ...(expiresEstimated === undefined ? {} : { expiresEstimated }),
      });
      return watch.id;
    };

    it('markHeld with an estimated expiry stores 1 and reads expiresEstimated: true', () => {
      const id = heldWatch(true);
      expect(column('watches', id)).toBe(1);
      expect(watches.findById(id)?.hold).toEqual({
        reference: 'H-1',
        expiresAt: EXPIRES,
        expiresEstimated: true,
        unitId: 'u1',
      });
    });

    it('markHeld without one (or false) stores 0 and reads no flag', () => {
      for (const flag of [undefined, false]) {
        const id = heldWatch(flag);
        expect(column('watches', id)).toBe(0);
        expect(watches.findById(id)?.hold).toEqual({
          reference: 'H-1',
          expiresAt: EXPIRES,
          unitId: 'u1',
        });
      }
    });

    it('a held row v12 migrated (the column default) reads false', () => {
      const watch = watches.create(userId, createMockWatchInput());
      // As a v11 install wrote it: no hold_expires_estimated in the statement
      db.prepare(
        `UPDATE watches SET last_result = 'held', hold_reference = 'H-OLD', hold_expires_at = ?
         WHERE id = ?`
      ).run(EXPIRES.toISOString(), watch.id);
      expect(column('watches', watch.id)).toBe(0);
      expect(watches.findById(watch.id)?.hold?.expiresEstimated ?? false).toBe(false);
    });

    it('endHold ends the hold now with the message, exact, and keeps last_result held', () => {
      const id = heldWatch(true);
      expect(watches.endHold(id, 'H-1', ENDED, 'You let it go.')).toBe(true);
      expect(watches.findById(id)).toMatchObject({
        lastResult: WatchResult.HELD,
        isActive: false,
        lastError: 'You let it go.',
        hold: { reference: 'H-1', expiresAt: ENDED, unitId: 'u1' },
      });
      expect(watches.findById(id)?.hold?.expiresEstimated).toBeUndefined();
      // Expired from then on: it holds no night, and does not keep the provider busy
      expect(
        watches.findHeldOverlapping('parkstay', userId, '2000-01-01', '2100-01-01', ENDED)
      ).toEqual([]);
      expect(watches.countUnexpiredHolds('parkstay', ENDED)).toBe(0);
    });

    it('endHold leaves a booked watch, another hold and a missing row alone', () => {
      const booked = heldWatch();
      watches.setBooked(booked);
      expect(watches.endHold(booked, 'H-1', ENDED, 'You let it go.')).toBe(false);
      expect(watches.findById(booked)).toMatchObject({ lastResult: WatchResult.BOOKED });
      expect(watches.findById(booked)?.lastError).toBeUndefined();

      const other = heldWatch();
      expect(watches.endHold(other, 'H-2', ENDED, 'You let it go.')).toBe(false);
      expect(watches.findById(other)?.hold?.expiresAt).toEqual(EXPIRES);

      expect(watches.endHold(9999, 'H-1', ENDED, 'You let it go.')).toBe(false);
    });
  });

  describe('SiteSniperRepository', () => {
    const heldSnipe = (estimated?: boolean) => {
      const snipe = snipes.create(userId, createMockSiteSnipeInput());
      if (estimated === undefined) {
        snipes.markHeld(snipe.id, 'S-1', EXPIRES, 'https://pay.example/S-1', '12');
      } else {
        snipes.markHeld(snipe.id, 'S-1', EXPIRES, 'https://pay.example/S-1', '12', estimated);
      }
      return snipe.id;
    };

    it('markHeld with an estimated expiry stores 1 and reads holdExpiresEstimated: true', () => {
      const id = heldSnipe(true);
      expect(column('site_snipes', id)).toBe(1);
      expect(snipes.findById(id)).toMatchObject({
        status: SnipeStatus.HELD,
        holdReference: 'S-1',
        holdExpiresAt: EXPIRES,
        holdExpiresEstimated: true,
      });
    });

    it('markHeld without one (or false) stores 0 and reads no flag', () => {
      for (const flag of [undefined, false]) {
        const id = heldSnipe(flag);
        expect(column('site_snipes', id)).toBe(0);
        expect(snipes.findById(id)).not.toHaveProperty('holdExpiresEstimated');
      }
    });

    it('a held row v12 migrated (the column default) reads false', () => {
      const snipe = snipes.create(userId, createMockSiteSnipeInput());
      db.prepare(
        `UPDATE site_snipes SET status = 'held', hold_reference = 'S-OLD', hold_expires_at = ?
         WHERE id = ?`
      ).run(EXPIRES.toISOString(), snipe.id);
      expect(snipes.findById(snipe.id)?.holdExpiresEstimated ?? false).toBe(false);
    });

    it('endHold makes a HELD snipe EXPIRED now with the message, and frees its nights', () => {
      const id = heldSnipe(true);
      expect(snipes.endHold(id, 'S-1', ENDED, 'You let it go.')).toBe(true);
      const ended = snipes.findById(id)!;
      expect(ended).toMatchObject({
        status: SnipeStatus.EXPIRED,
        lastResult: SnipeResult.EXPIRED,
        isActive: false,
        lastError: 'You let it go.',
        holdReference: 'S-1',
        holdExpiresAt: ENDED,
      });
      expect(ended.holdExpiresEstimated).toBeUndefined();
      expect(
        snipes.findHeldOverlapping('parkstay', userId, '2000-01-01', '2100-01-01', ENDED)
      ).toEqual([]);
      expect(snipes.countByStatus('parkstay', [SnipeStatus.HELD])).toBe(0);
    });

    it('endHold leaves a booked snipe, another hold and a missing row alone', () => {
      const booked = heldSnipe();
      snipes.setBooked(booked, 'PB1');
      expect(snipes.endHold(booked, 'S-1', ENDED, 'You let it go.')).toBe(false);
      expect(snipes.findById(booked)?.status).toBe(SnipeStatus.BOOKED);

      const other = heldSnipe();
      expect(snipes.endHold(other, 'S-2', ENDED, 'You let it go.')).toBe(false);
      expect(snipes.findById(other)?.status).toBe(SnipeStatus.HELD);

      expect(snipes.endHold(9999, 'S-1', ENDED, 'You let it go.')).toBe(false);
    });
  });
});
