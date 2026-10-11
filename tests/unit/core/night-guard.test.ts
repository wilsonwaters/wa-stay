/**
 * One booking per night (`core/holds/night-guard.ts`): HELD (unexpired) and BOOKED snipes,
 * held (unexpired) and booked auto-hold watches and holds still in flight block a hold on any
 * shared night of the same provider; an expired hold does not.
 */

import { openDatabase } from '@main/database/connection';
import { SiteSniperRepository, WatchRepository } from '@main/database/repositories';
import { NightGuard } from '@main/core/holds/night-guard';
import { SnipeReleaseMode, SnipeStatus, WatchResult } from '@shared/types/common.types';
import type Database from 'better-sqlite3';

const NOW = new Date('2026-10-04T02:00:00.000Z');

describe('NightGuard', () => {
  let db: Database.Database;
  let snipes: SiteSniperRepository;
  let watches: WatchRepository;
  let guard: NightGuard;
  const userId = 1;

  const stay = (arrival: string, departure: string) => ({ arrival, departure, adults: 2 });
  const request = (arrival: string, departure: string, providerId = 'fake', id = 99) => ({
    providerId,
    userId,
    arrival,
    departure,
    owner: { kind: 'snipe' as const, id },
  });

  function snipe(arrival: string, departure: string, providerId = 'fake') {
    return snipes.create(userId, {
      providerId,
      name: 'S',
      location: { externalId: '1', name: 'Banksia' },
      stay: stay(arrival, departure),
      releaseMode: SnipeReleaseMode.CANCELLATION,
    });
  }

  beforeEach(() => {
    db = openDatabase(':memory:');
    snipes = new SiteSniperRepository(db);
    watches = new WatchRepository(db);
    guard = new NightGuard(snipes, watches, () => NOW);
  });

  afterEach(() => db.close());

  it('blocks a night held by another snipe of the provider until the hold expires, and BOOKED always', () => {
    const held = snipe('2026-12-01', '2026-12-03');
    snipes.markHeld(held.id, 'H1', new Date(NOW.getTime() + 30 * 60_000));
    // Shares the night of 2 Dec
    expect(guard.tryReserve(request('2026-12-02', '2026-12-04')).ok).toBe(false);
    // Departure day is free (no shared night), and another provider is not blocked
    expect(guard.tryReserve(request('2026-12-03', '2026-12-05')).ok).toBe(true);
    expect(guard.tryReserve(request('2026-12-02', '2026-12-04', 'other')).ok).toBe(true);
    // The owner itself is never blocked by its own row
    expect(guard.tryReserve(request('2026-12-01', '2026-12-03', 'fake', held.id)).ok).toBe(true);

    const lapsed = new NightGuard(snipes, watches, () => new Date(NOW.getTime() + 31 * 60_000));
    expect(lapsed.tryReserve(request('2026-12-02', '2026-12-04')).ok).toBe(true);

    snipes.setBooked(held.id, 'B1');
    expect(lapsed.tryReserve(request('2026-12-02', '2026-12-04')).ok).toBe(false);
    expect(snipes.findById(held.id)?.status).toBe(SnipeStatus.BOOKED);
  });

  it('blocks the nights of a watch whose auto-hold placed a hold', () => {
    const watch = watches.create(userId, {
      providerId: 'fake',
      name: 'W',
      location: { externalId: '1', name: 'Banksia' },
      stay: stay('2026-12-01', '2026-12-04'),
    });
    expect(guard.tryReserve(request('2026-12-03', '2026-12-05')).ok).toBe(true);
    watches.markHeld(watch.id, {
      reference: '41',
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
      unitId: 'u1',
      paymentUrl: 'https://fake.example/pay/41',
    });
    const result = guard.tryReserve(request('2026-12-03', '2026-12-05'));
    expect(result).toEqual({
      ok: false,
      transient: false,
      reason: expect.stringContaining('one booking per night'),
    });
  });

  it('ignores a watch hold past hold_expires_at, and a booked watch blocks for good', () => {
    const watch = watches.create(userId, {
      providerId: 'fake',
      name: 'W',
      location: { externalId: '1', name: 'Banksia' },
      stay: stay('2026-12-01', '2026-12-04'),
    });
    watches.markHeld(watch.id, {
      reference: '41',
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
    });
    const lapsed = new NightGuard(snipes, watches, () => new Date(NOW.getTime() + 31 * 60_000));
    expect(guard.tryReserve(request('2026-12-03', '2026-12-05')).ok).toBe(false);
    expect(lapsed.tryReserve(request('2026-12-03', '2026-12-05')).ok).toBe(true);

    watches.setBooked(watch.id);
    expect(watches.findById(watch.id)?.lastResult).toBe(WatchResult.BOOKED);
    expect(lapsed.tryReserve(request('2026-12-03', '2026-12-05')).ok).toBe(false);
  });

  it('a held watch row from before v9 (no hold_expires_at) blocks nothing', () => {
    const watch = watches.create(userId, {
      providerId: 'fake',
      name: 'W',
      location: { externalId: '1', name: 'Banksia' },
      stay: stay('2026-12-01', '2026-12-04'),
    });
    db.prepare("UPDATE watches SET last_result = 'held' WHERE id = ?").run(watch.id);
    expect(guard.tryReserve(request('2026-12-03', '2026-12-05')).ok).toBe(true);
  });

  it('blocks a second hold for the same nights while the first is in flight, until released', () => {
    const first = guard.tryReserve(request('2026-12-01', '2026-12-03', 'fake', 1));
    expect(first.ok).toBe(true);
    // Transient: the hold in flight may yet fail
    expect(guard.tryReserve(request('2026-12-02', '2026-12-04', 'fake', 2))).toEqual({
      ok: false,
      transient: true,
      reason: expect.stringContaining('being placed'),
    });
    if (first.ok) first.reservation.release();
    expect(guard.tryReserve(request('2026-12-02', '2026-12-04', 'fake', 2)).ok).toBe(true);
  });
});
