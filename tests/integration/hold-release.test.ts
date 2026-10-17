/**
 * Letting a hold go over IPC (R18) through the harness: a real container and database, a
 * FakeProvider `relstay` whose holds can be let go (`holdRelease`, `holds.release`), and the
 * built-in ParkStay beside it, which cannot. Holds are seeded rows (never a live hold, §12.33).
 *
 * - `watches.releaseHold` and `snipes.releaseHold` answer the row with its hold ended and why,
 *   and send `watch:updated` / `snipe:updated`; afterwards the night guard lets another hold
 *   take the same nights;
 * - every error code: `VALIDATION`, `NOT_FOUND`, `CAPABILITY` (ParkStay), `HOLD_EXPIRED`,
 *   `PROVIDER_ERROR` (the hold stays);
 * - deleting a held watch or snipe on `relstay` lets its hold go first; a rejection still
 *   deletes, and is logged; deleting ParkStay's sends nothing;
 * - sign-out and turning off a holds experiment are `ACCOUNT_BUSY` while a release runs.
 */

import { EventEmitter } from 'events';
import { createContainer, type AppContainer } from '@main/app/container';
import { RELEASED_MESSAGE, holdGoneMessage } from '@main/core/holds/hold-payment.service';
import { openDatabase } from '@main/database/connection';
import { registerIpcHandlers } from '@main/ipc';
import { parkstayFactory } from '@main/providers/parkstay';
import type { HttpClient } from '@main/providers/sdk';
import { logger } from '@main/utils/logger';
import type { APIResponse, SiteSnipe, Watch } from '@shared/types';
import {
  SnipeReleaseMode,
  SnipeResult,
  SnipeStatus,
  WatchResult,
} from '@shared/types/common.types';
import { containerSecrets } from '@tests/utils/fake-safe-storage';
import { createFakeProvider, type FakeProvider } from '@tests/utils/fake-provider';
import {
  FakeIpcMain,
  fakeEvent,
  fakeWebContents,
  TEST_LOGS_DIR,
  TRUSTED_SENDER_ID,
  type FakeWebContents,
} from '@tests/utils/ipc-harness';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('node-machine-id', () => ({ machineIdSync: () => 'test-machine-id' }));

const { autoUpdater } = jest.requireMock('electron-updater') as { autoUpdater: EventEmitter };

const MINUTE = 60_000;
const ARRIVAL = '2026-12-01';
const DEPARTURE = '2026-12-04';

describe('letting a hold go over IPC', () => {
  let container: AppContainer;
  let ipc: FakeIpcMain;
  let renderer: FakeWebContents;
  let fake: FakeProvider;
  let userId: number;
  let holdLogWarn: jest.SpyInstance;

  function start(options: { holdDelayMs?: number } = {}): void {
    fake = createFakeProvider({
      id: 'relstay',
      shortName: 'RelStay',
      holdRelease: { onPaymentClose: true },
      availability: { '1': { u1: 'available' } },
      ...(options.holdDelayMs ? { delays: { holds: options.holdDelayMs } } : {}),
    });
    // The hold payment service's own logger, to see what it logs
    const child = jest.spyOn(logger, 'child');
    container = createContainer({
      db: openDatabase(':memory:'),
      logsDir: TEST_LOGS_DIR,
      ...containerSecrets(),
      providerFactories: [fake.factory, parkstayFactory],
    });
    const index = child.mock.calls.findIndex(([meta]) => meta?.module === 'hold-payment');
    holdLogWarn = jest.spyOn(child.mock.results[index].value as typeof logger, 'warn');
    child.mockRestore();
    userId = container.profile.ensureLocalProfile();
    renderer = fakeWebContents(TRUSTED_SENDER_ID);
    container.trustedWebContents.register(renderer);
    ipc = new FakeIpcMain();
    registerIpcHandlers(container, { isTrustedSender: () => true, ipc });
  }

  afterEach(async () => {
    await container.dispose();
    autoUpdater.removeAllListeners();
    jest.restoreAllMocks();
  });

  const call = <T = unknown>(channel: string, payload?: unknown): Promise<APIResponse<T>> =>
    ipc.invoke(channel, fakeEvent(), payload) as Promise<APIResponse<T>>;
  const snipes = () => container.repositories.snipes;
  const watches = () => container.repositories.watches;
  const releases = () => fake.calls.filter((c) => c.module === 'holds' && c.method === 'release');
  const sent = (name: string) => renderer.sent.filter(([event]) => event === name);

  /** A snipe of `providerId` holding a unit for `minutes` more (a seeded row). */
  function heldSnipe(providerId = 'relstay', minutes = 20): SiteSnipe {
    const snipe = snipes().create(userId, {
      providerId,
      name: 'Banksia snipe',
      location: { externalId: '1', name: 'Banksia Camp' },
      stay: { arrival: ARRIVAL, departure: DEPARTURE, adults: 2 },
      releaseMode: SnipeReleaseMode.CANCELLATION,
    });
    snipes().markHeld(
      snipe.id,
      `${providerId.toUpperCase()}-S`,
      new Date(Date.now() + minutes * MINUTE),
      undefined,
      'u1'
    );
    return snipes().findById(snipe.id)!;
  }

  /** A watch of `providerId` whose auto-hold holds a unit for `minutes` more (a seeded row). */
  function heldWatch(providerId = 'relstay', minutes = 20): Watch {
    const watch = watches().create(userId, {
      providerId,
      name: 'Banksia watch',
      location: { externalId: '1', name: 'Banksia Camp' },
      stay: { arrival: ARRIVAL, departure: DEPARTURE, adults: 2 },
      checkIntervalMinutes: 60,
      autoHold: true,
    });
    watches().markHeld(watch.id, {
      reference: `${providerId.toUpperCase()}-W`,
      expiresAt: new Date(Date.now() + minutes * MINUTE),
      unitId: 'u1',
    });
    return watches().findById(watch.id)!;
  }

  describe('snipes.releaseHold and watches.releaseHold', () => {
    it('a snipe: released, EXPIRED with "You let it go.", snipe:updated sent', async () => {
      start();
      const snipe = heldSnipe();

      const answer = await call<SiteSnipe>('snipes:release-hold', { id: snipe.id });

      expect(answer).toMatchObject({
        success: true,
        data: {
          id: snipe.id,
          status: SnipeStatus.EXPIRED,
          lastResult: SnipeResult.EXPIRED,
          lastError: RELEASED_MESSAGE,
        },
      });
      expect(releases()).toHaveLength(1);
      expect(sent('snipe:updated')).toEqual([
        ['snipe:updated', expect.objectContaining({ id: snipe.id, status: SnipeStatus.EXPIRED })],
      ]);
      expect(container.repositories.notifications.findByUserId(userId)).toEqual([]);
    });

    it('a watch: gone, still held with its hold ended, watch:updated sent; then the night guard lets a new hold take the nights', async () => {
      start();
      fake.scriptRelease('gone');
      const watch = heldWatch();

      const answer = await call<Watch>('watches:release-hold', { id: watch.id });

      expect(answer.success).toBe(true);
      expect(answer.data).toMatchObject({
        lastResult: WatchResult.HELD,
        lastError: holdGoneMessage('RelStay'),
        hold: { reference: 'RELSTAY-W' },
      });
      expect(new Date(answer.data!.hold!.expiresAt).getTime()).toBeLessThanOrEqual(Date.now());
      expect(sent('watch:updated')).toHaveLength(1);

      // The same nights: another watch's automatic hold is placed now
      const another = await container.watchService.create(userId, {
        providerId: 'relstay',
        name: 'Second watch',
        location: { externalId: '1', name: 'Banksia Camp' },
        stay: { arrival: ARRIVAL, departure: DEPARTURE, adults: 2 },
        checkIntervalMinutes: 60,
        autoHold: true,
      });
      const result = await container.watchService.execute(another.id);
      expect(result.hold).toEqual(expect.objectContaining({ reference: 'RELSTAY-1' }));
    });

    it('every error: VALIDATION, NOT_FOUND, CAPABILITY (ParkStay), HOLD_EXPIRED, PROVIDER_ERROR', async () => {
      start();
      for (const channel of ['snipes:release-hold', 'watches:release-hold']) {
        expect(await call(channel, { id: 'one' })).toMatchObject({
          success: false,
          code: 'VALIDATION',
        });
        expect(await call(channel, { id: 404 })).toMatchObject({
          success: false,
          code: 'NOT_FOUND',
        });
      }

      // ParkStay cannot let a hold go: its hold stays as it is
      const parkstaySnipe = heldSnipe('parkstay');
      const parkstayWatch = heldWatch('parkstay');
      expect(container.providers.get('parkstay').manifest.holdRelease).toBeUndefined();
      expect(await call('snipes:release-hold', { id: parkstaySnipe.id })).toMatchObject({
        success: false,
        code: 'CAPABILITY',
      });
      expect(await call('watches:release-hold', { id: parkstayWatch.id })).toMatchObject({
        success: false,
        code: 'CAPABILITY',
      });
      expect(snipes().findById(parkstaySnipe.id)).toEqual(parkstaySnipe);
      expect(watches().findById(parkstayWatch.id)).toEqual(parkstayWatch);

      const lapsed = heldSnipe('relstay', -1);
      expect(await call('snipes:release-hold', { id: lapsed.id })).toMatchObject({
        success: false,
        code: 'HOLD_EXPIRED',
      });
      expect(releases()).toEqual([]);

      const watch = heldWatch();
      fake.failNext('holds', new Error('offline'));
      expect(await call('watches:release-hold', { id: watch.id })).toMatchObject({
        success: false,
        code: 'PROVIDER_ERROR',
        error:
          "RelStay couldn't be asked to let the hold go, so it stays until it runs out. You can still pay for it.",
      });
      expect(watches().findById(watch.id)).toEqual(watch);
      expect(sent('watch:updated')).toEqual([]);
    });
  });

  describe('deleting a held watch or snipe', () => {
    it('on a provider that can, its hold is let go first, then the row goes', async () => {
      start();
      const snipe = heldSnipe();
      const watch = heldWatch();

      expect(await call('snipes:delete', { id: snipe.id })).toEqual({ success: true, data: true });
      expect(await call('watches:delete', { id: watch.id })).toEqual({ success: true, data: true });

      expect(releases().map((c) => (c.args[0] as { reference: string }).reference)).toEqual([
        'RELSTAY-S',
        'RELSTAY-W',
      ]);
      expect(snipes().findById(snipe.id)).toBeNull();
      expect(watches().findById(watch.id)).toBeNull();
    });

    it('a release that fails is logged, and the delete goes ahead', async () => {
      start();
      const snipe = heldSnipe();
      fake.failNext('holds', new Error('offline'));

      expect(await call('snipes:delete', { id: snipe.id })).toEqual({ success: true, data: true });

      expect(releases()).toHaveLength(1);
      expect(snipes().findById(snipe.id)).toBeNull();
      expect(holdLogWarn).toHaveBeenCalledWith(
        'snipe 1: RelStay could not let its hold go (INTERNAL, delete); it stays until it runs out'
      );
    });

    it('an expired hold, or ParkStay (no release), asks nothing and sends no request', async () => {
      start();
      const parkstayHttp: HttpClient = container.providers.httpOf('parkstay');
      const request = jest.spyOn(parkstayHttp, 'request');
      const lapsed = heldWatch('relstay', -1);
      const parkstaySnipe = heldSnipe('parkstay');
      const parkstayWatch = heldWatch('parkstay');

      for (const [channel, id] of [
        ['watches:delete', lapsed.id],
        ['snipes:delete', parkstaySnipe.id],
        ['watches:delete', parkstayWatch.id],
      ] as const) {
        expect(await call(channel, { id })).toEqual({ success: true, data: true });
      }

      expect(fake.calls.filter((c) => c.module === 'holds')).toEqual([]);
      expect(request).not.toHaveBeenCalled();
    });
  });

  it('sign-out is ACCOUNT_BUSY while a release runs, even once the hold it lets go has passed its expiry', async () => {
    start({ holdDelayMs: 600 });
    // Held for 0.2 s more: the release starts before that, and runs past it
    const watch = heldWatch('relstay', 0.2 / 60);
    const declining = call<Watch>('watches:release-hold', { id: watch.id });
    for (let i = 0; i < 100 && releases().length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(releases()).toHaveLength(1);
    while (Date.now() <= watch.hold!.expiresAt.getTime()) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    // No unexpired hold is left in the database: only the release in flight keeps it busy
    expect(watches().countUnexpiredHolds('relstay', new Date())).toBe(0);
    expect(container.holdPayments.releasing('relstay')).toBe(true);

    expect(await call('accounts:sign-out', { providerId: 'relstay' })).toMatchObject({
      success: false,
      code: 'ACCOUNT_BUSY',
    });

    expect((await declining).success).toBe(true);
    expect(container.holdPayments.releasing('relstay')).toBe(false);
    expect((await call('accounts:sign-out', { providerId: 'relstay' })).success).toBe(true);
  });
});
