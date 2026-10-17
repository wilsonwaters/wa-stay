/**
 * `providers.experiments` and `providers.setExperiment` (R17) through the IPC harness: a real
 * container on a database file, so a second container on the same file is a restart of WA
 * Stay. The provider is a FakeProvider whose holds sit behind an experiment (`autoCart`), as
 * RAC's will; ParkStay registers beside it, with no experiments.
 *
 * - a round trip of both methods and the stored row; `active` changes only with a restart;
 * - turning off is `ACCOUNT_BUSY` while a hold needs the provider (a HELD snipe, an unexpired
 *   watch hold), and once off, no new hold is placed before the restart;
 * - `UNKNOWN_PROVIDER`, `NOT_FOUND`, `VALIDATION`;
 * - the provider's own `ctx.state` (the real `provider_state` store) cannot reach the row;
 * - fixture mode applies the stored choice too, so e2e can seed it before launch.
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createContainer, type AppContainer } from '@main/app/container';
import { openDatabase } from '@main/database/connection';
import { registerIpcHandlers } from '@main/ipc';
import { parkstayFactory } from '@main/providers/parkstay';
import type { ProviderExperimentState } from '@shared/contracts';
import type { APIResponse, SiteSnipeInput } from '@shared/types';
import { SnipeReleaseMode, SnipeResult, SnipeStatus } from '@shared/types/common.types';
import type { ProviderExperiment, ProviderManifest } from '@shared/types/provider.types';
import { containerSecrets } from '@tests/utils/fake-safe-storage';
import { createFakeProvider, type FakeProvider } from '@tests/utils/fake-provider';
import { FakeIpcMain, fakeEvent, TEST_LOGS_DIR } from '@tests/utils/ipc-harness';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('node-machine-id', () => ({ machineIdSync: () => 'test-machine-id' }));

const { autoUpdater } = jest.requireMock('electron-updater') as { autoUpdater: EventEmitter };

const AUTO_CART: ProviderExperiment = {
  id: 'autoCart',
  label: 'Hold a stay in the cart',
  description: 'When a watch finds your stay, WA Stay puts it in the cart for you.',
  warning: 'Only after a booking of your own has worked.',
  turnsOn: ['holds'],
};
const BUSY = 'A stay is held on ExpStay. Pay for it or let it go first.';
const OFF: ProviderExperimentState = { id: 'autoCart', enabled: false, active: false };

describe('provider experiments over IPC', () => {
  let dir: string;
  let file: string;
  let container: AppContainer | undefined;
  let ipc: FakeIpcMain;
  let fake: FakeProvider;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-experiments-'));
    file = path.join(dir, 'wa-stay.db');
  });

  afterEach(async () => {
    await container?.dispose();
    container = undefined;
    autoUpdater.removeAllListeners();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Starts WA Stay on the database file (quitting the running one first). */
  async function start(options: { fixtureMode?: boolean } = {}): Promise<AppContainer> {
    await container?.dispose();
    fake = createFakeProvider({
      id: 'expstay',
      shortName: 'ExpStay',
      capabilities: { snipes: false },
      experiments: [AUTO_CART],
      availability: { '1': { u1: 'available' } },
    });
    container = createContainer({
      db: openDatabase(file),
      logsDir: TEST_LOGS_DIR,
      ...containerSecrets(),
      providerFactories: [fake.factory, parkstayFactory],
      ...(options.fixtureMode
        ? {
            fixtureMode: {
              fixturesDir: path.join(dir, 'fixtures'),
              logFile: path.join(dir, 'unexpected-requests.log'),
            },
          }
        : {}),
    });
    container.profile.ensureLocalProfile();
    ipc = new FakeIpcMain();
    registerIpcHandlers(container, { isTrustedSender: () => true, ipc });
    return container;
  }

  const call = <T = ProviderExperimentState[]>(
    channel: string,
    payload?: unknown
  ): Promise<APIResponse<T>> =>
    ipc.invoke(channel, fakeEvent(), payload) as Promise<APIResponse<T>>;
  const experiments = () => call('providers:experiments', { providerId: 'expstay' });
  const setCart = (enabled: boolean) =>
    call('providers:set-experiment', { providerId: 'expstay', experimentId: 'autoCart', enabled });
  const row = (providerId = 'expstay') =>
    (
      container!.db
        .prepare(
          "SELECT value FROM provider_state WHERE provider_id = ? AND key = 'core.experiments'"
        )
        .get(providerId) as { value: string } | undefined
    )?.value;
  const manifest = async () =>
    (await call<ProviderManifest[]>('providers:list')).data!.find((m) => m.id === 'expstay')!;

  it('round trip: the stored choice, and active changes only when WA Stay restarts', async () => {
    await start();
    expect(await experiments()).toEqual({ success: true, data: [OFF] });
    expect(await manifest()).toMatchObject({
      capabilities: { holds: false },
      experiments: [AUTO_CART],
    });
    expect(row()).toBeUndefined();

    expect(await setCart(true)).toEqual({ success: true, data: [{ ...OFF, enabled: true }] });
    expect(row()).toBe('{"autoCart":true}');
    expect(await experiments()).toEqual({ success: true, data: [{ ...OFF, enabled: true }] });
    // Nothing changes in this run
    expect((await manifest()).capabilities.holds).toBe(false);
    expect(container!.providers.get('expstay').holds).toBeUndefined();

    // The restart: a second container on the same database
    await start();
    expect(await experiments()).toEqual({
      success: true,
      data: [{ id: 'autoCart', enabled: true, active: true }],
    });
    expect(await manifest()).toMatchObject({
      capabilities: { holds: true },
      experiments: [{ ...AUTO_CART, applied: true }],
    });
    expect(container!.providers.get('expstay').holds).toBe(fake.holds);

    // Off: still on in this run, off after the next restart
    expect(await setCart(false)).toEqual({
      success: true,
      data: [{ id: 'autoCart', enabled: false, active: true }],
    });
    expect(row()).toBe('{"autoCart":false}');
    expect((await manifest()).capabilities.holds).toBe(true);
    await start();
    expect(await experiments()).toEqual({ success: true, data: [OFF] });
    expect((await manifest()).capabilities.holds).toBe(false);
    // ParkStay declares none
    expect(await call('providers:experiments', { providerId: 'parkstay' })).toEqual({
      success: true,
      data: [],
    });
  });

  it('two calls at once: the last write wins, and each answer is the row it wrote', async () => {
    await start();
    const [first, second] = await Promise.all([setCart(true), setCart(false)]);
    expect(first.data).toEqual([{ ...OFF, enabled: true }]);
    expect(second.data).toEqual([OFF]);
    expect(row()).toBe('{"autoCart":false}');
  });

  describe('with autoCart on (after a restart)', () => {
    let userId: number;

    beforeEach(async () => {
      await start();
      await setCart(true);
      await start();
      userId = container!.profile.requireUserId();
    });

    const snipeInput: SiteSnipeInput = {
      providerId: 'expstay',
      name: 'Banksia snipe',
      location: { externalId: '1', name: 'Banksia Camp' },
      stay: { arrival: '2026-12-01', departure: '2026-12-03', adults: 2 },
      releaseMode: SnipeReleaseMode.CANCELLATION,
    };

    it('turning off is ACCOUNT_BUSY while a snipe holds a stay on the provider', async () => {
      const { snipes } = container!.repositories;
      const snipe = snipes.create(userId, snipeInput);
      snipes.markHeld(snipe.id, 'EXPSTAY-1', new Date(Date.now() + 30 * 60_000));

      expect(await setCart(false)).toMatchObject({
        success: false,
        code: 'ACCOUNT_BUSY',
        error: BUSY,
      });
      expect(row()).toBe('{"autoCart":true}');
      expect(container!.experiments.holdsTurningOff('expstay')).toBe(false);

      // Once the hold is gone (paid for or let go), it turns off
      snipes.finish(snipe.id, SnipeStatus.FAILED, SnipeResult.ERROR, 'Let go');
      expect((await setCart(false)).success).toBe(true);
    });

    it('turning off is ACCOUNT_BUSY while a watch hold has not expired', async () => {
      const { watches } = container!.repositories;
      const watch = watches.create(userId, {
        providerId: 'expstay',
        name: 'Banksia watch',
        location: { externalId: '1', name: 'Banksia Camp' },
        stay: { arrival: '2026-12-01', departure: '2026-12-04', adults: 2 },
        checkIntervalMinutes: 60,
        autoHold: true,
      });
      watches.markHeld(watch.id, {
        reference: 'EXPSTAY-1',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      });

      expect(await setCart(false)).toMatchObject({
        success: false,
        code: 'ACCOUNT_BUSY',
        error: BUSY,
      });
      expect(row()).toBe('{"autoCart":true}');

      // An expired hold no longer needs the provider
      watches.markHeld(watch.id, { reference: 'EXPSTAY-1', expiresAt: new Date(Date.now() - 1) });
      expect((await setCart(false)).success).toBe(true);
    });

    it('once off, an auto-hold watch places no hold before the restart, and says why', async () => {
      const watch = await container!.watchService.create(userId, {
        providerId: 'expstay',
        name: 'Banksia watch',
        location: { externalId: '1', name: 'Banksia Camp' },
        stay: { arrival: '2026-12-01', departure: '2026-12-04', adults: 2 },
        checkIntervalMinutes: 60,
        autoHold: true,
      });
      expect((await setCart(false)).success).toBe(true);
      expect(container!.experiments.holdsTurningOff('expstay')).toBe(true);

      const result = await container!.watchService.execute(watch.id);

      expect(fake.calls.filter((c) => c.module === 'holds')).toEqual([]);
      expect(result).toMatchObject({ success: true, found: true });
      expect(result.hold).toBeUndefined();
      expect(container!.repositories.watches.findById(watch.id)?.lastError).toBe(
        'Automatic holds on ExpStay are turning off. Restart WA Stay.'
      );
      // The watch alerted as usual
      expect(container!.repositories.notifications.findByUserId(userId)).toEqual([
        expect.objectContaining({ providerId: 'expstay', relatedId: watch.id }),
      ]);
    });

    it("the provider's own state cannot read or change the row", async () => {
      const state = fake.ctx!.state;
      await expect(state.get('core.experiments')).rejects.toThrow(/core\.\* is reserved/);
      await expect(state.set('core.experiments', { autoCart: false })).rejects.toThrow(
        /core\.\* is reserved/
      );
      await expect(state.delete('core.experiments')).rejects.toThrow(/core\.\* is reserved/);
      expect((await state.list()).map((e) => e.key)).not.toContain('core.experiments');
      expect(row()).toBe('{"autoCart":true}');
    });
  });

  it('UNKNOWN_PROVIDER for a provider not registered (its row untouched), NOT_FOUND for an undeclared experiment', async () => {
    await start();
    container!.repositories.providerState.set('rac', 'core.experiments', { autoCart: true });

    expect(await call('providers:experiments', { providerId: 'nosuch' })).toMatchObject({
      success: false,
      code: 'UNKNOWN_PROVIDER',
    });
    expect(
      await call('providers:set-experiment', {
        providerId: 'rac',
        experimentId: 'autoCart',
        enabled: false,
      })
    ).toMatchObject({ success: false, code: 'UNKNOWN_PROVIDER' });
    expect(row('rac')).toBe('{"autoCart":true}');

    for (const [providerId, experimentId] of [
      ['expstay', 'nothing'],
      ['parkstay', 'autoCart'],
    ]) {
      expect(
        await call('providers:set-experiment', { providerId, experimentId, enabled: true })
      ).toMatchObject({ success: false, code: 'NOT_FOUND' });
    }
    expect(row()).toBeUndefined();
  });

  it.each<[string, unknown, string[]]>([
    [
      'an experiment id with a hyphen',
      { experimentId: 'auto-cart', enabled: true },
      ['experimentId'],
    ],
    ['enabled as text', { experimentId: 'autoCart', enabled: 'yes' }, ['enabled']],
    ['no enabled', { experimentId: 'autoCart' }, ['enabled']],
    [
      'a bad provider id',
      { providerId: 'Exp Stay', experimentId: 'autoCart', enabled: true },
      ['providerId'],
    ],
  ])('VALIDATION for %s', async (_label, payload, issues) => {
    await start();
    const response = await call('providers:set-experiment', {
      providerId: 'expstay',
      ...(payload as object),
    });
    expect(response).toMatchObject({ success: false, code: 'VALIDATION', issues });
    expect(row()).toBeUndefined();
  });

  it('VALIDATION for providers.experiments without a provider id', async () => {
    await start();
    expect(await call('providers:experiments', {})).toMatchObject({
      success: false,
      code: 'VALIDATION',
      issues: ['providerId'],
    });
  });

  it('fixture mode applies the stored choice as normal (e2e seeds the row before launch)', async () => {
    await start();
    await setCart(true);
    await start({ fixtureMode: true });

    expect(await experiments()).toEqual({
      success: true,
      data: [{ id: 'autoCart', enabled: true, active: true }],
    });
    expect(container!.providers.get('expstay').manifest.capabilities.holds).toBe(true);
  });
});
