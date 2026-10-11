/**
 * The snipe account gate end to end (architecture-notes §12.32): a real container (its
 * ProviderAccountService is the snipe service's gate), the real scheduler, every handler
 * through P3's harness, and no network (ParkStay's `/api/profile` answer is stubbed at
 * `auth.isSignedIn`; FakeProvider answers from `setAccount`).
 *
 * - A FakeProvider declaring `required-for-holds`, signed out: `snipes.create` saves the snipe
 *   paused, `snipes.activate` is `AUTH_REQUIRED` and nothing is armed; once signed in, it arms.
 * - ParkStay (`optional`), signed out: a snipe is created armed, and activates and arms again,
 *   without asking the account at all.
 */

import { EventEmitter } from 'events';
import { openDatabase } from '@main/database/connection';
import { createContainer, AppContainer } from '@main/app/container';
import { registerIpcHandlers } from '@main/ipc';
import { SnipeReleaseMode, SnipeStatus } from '@shared/types/common.types';
import type { APIResponse, SiteSnipe, SiteSnipeInput } from '@shared/types';
import { containerSecrets } from '@tests/utils/fake-safe-storage';
import {
  createFakeProvider,
  createTestProviderContext,
  type FakeProvider,
} from '@tests/utils/fake-provider';
import { FakeIpcMain, fakeEvent, TEST_LOGS_DIR } from '@tests/utils/ipc-harness';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('node-machine-id', () => ({ machineIdSync: () => 'test-machine-id' }));

const { autoUpdater } = jest.requireMock('electron-updater') as { autoUpdater: EventEmitter };

const DAY = 86_400_000;

/** A calendar date `days` from now. */
function dateIn(days: number): string {
  return new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
}

describe('snipe account gate over IPC', () => {
  let container: AppContainer;
  let ipc: FakeIpcMain;
  let gated: FakeProvider;
  let parkstaySignedIn: jest.SpyInstance;

  const call = <T = unknown>(channel: string, payload?: unknown): Promise<APIResponse<T>> =>
    ipc.invoke(channel, fakeEvent(), payload) as Promise<APIResponse<T>>;
  const isArmed = (id: number) => container.scheduler.snipeRunner.isScheduled(id);
  const stored = (id: number) => container.repositories.snipes.findById(id)!;

  /** A snipe released in a week (nothing runs before then), on `providerId`. */
  const snipeInput = (providerId: string): SiteSnipeInput => ({
    providerId,
    name: 'Release night',
    location: { externalId: '1', name: 'Banksia Camp' },
    stay: { arrival: dateIn(60), departure: dateIn(62), adults: 2 },
    releaseMode: SnipeReleaseMode.SCHEDULED,
    releaseAt: new Date(Date.now() + 7 * DAY),
  });

  beforeEach(() => {
    container = createContainer({
      db: openDatabase(':memory:'),
      logsDir: TEST_LOGS_DIR,
      ...containerSecrets(),
    });
    container.profile.ensureLocalProfile();
    gated = createFakeProvider({
      id: 'gated',
      capabilities: { account: 'required-for-holds' },
      account: 'signed-out',
    });
    container.providers.register(gated.factory, createTestProviderContext);
    ipc = new FakeIpcMain();
    registerIpcHandlers(container, { isTrustedSender: () => true, ipc });
    container.scheduler.start();
    parkstaySignedIn = jest
      .spyOn(container.providers.get('parkstay').auth!, 'isSignedIn')
      .mockResolvedValue({ state: 'signed-out' });
  });

  afterEach(async () => {
    await container.dispose();
    autoUpdater.removeAllListeners();
  });

  it('a required-for-holds provider, signed out: create saves it paused and activate is AUTH_REQUIRED, unarmed', async () => {
    const created = await call<SiteSnipe>('snipes:create', snipeInput('gated'));
    expect(created).toMatchObject({
      success: true,
      data: {
        isActive: false,
        status: SnipeStatus.DISABLED,
        lastError: 'Sign in to gated to arm this snipe',
      },
    });
    const id = created.data!.id;
    expect(isArmed(id)).toBe(false);

    await expect(call('snipes:activate', { id })).resolves.toEqual({
      success: false,
      code: 'AUTH_REQUIRED',
      error: 'Sign in to gated first',
    });
    expect(stored(id)).toMatchObject({ isActive: false, status: SnipeStatus.DISABLED });
    expect(isArmed(id)).toBe(false);
    expect(gated.calls.filter((c) => c.module === 'holds')).toEqual([]);

    // Signed in (a sign-in window confirms with a forced check): activate arms it
    gated.setAccount('signed-in');
    await container.accounts.status('gated', { force: true });
    await expect(call('snipes:activate', { id })).resolves.toEqual({
      success: true,
      data: undefined,
    });
    expect(stored(id)).toMatchObject({ isActive: true, status: SnipeStatus.ARMED });
    expect(isArmed(id)).toBe(true);
  });

  it('a ParkStay snipe activates and arms while signed out (its account is optional)', async () => {
    const created = await call<SiteSnipe>('snipes:create', snipeInput('parkstay'));
    expect(created).toMatchObject({
      success: true,
      data: { isActive: true, status: SnipeStatus.ARMED },
    });
    const id = created.data!.id;
    expect(created.data!.lastError).toBeUndefined();
    expect(isArmed(id)).toBe(true);

    await expect(call('snipes:deactivate', { id })).resolves.toMatchObject({ success: true });
    expect(isArmed(id)).toBe(false);
    await expect(call('snipes:activate', { id })).resolves.toEqual({
      success: true,
      data: undefined,
    });
    expect(stored(id)).toMatchObject({ isActive: true, status: SnipeStatus.ARMED });
    expect(isArmed(id)).toBe(true);
    // Nobody asked ParkStay whether the person is signed in
    expect(parkstaySignedIn).not.toHaveBeenCalled();
  });
});
