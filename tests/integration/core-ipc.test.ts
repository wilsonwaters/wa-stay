/**
 * The `watches`, `snipes` and `bookings` namespaces through P3's harness, against a real
 * container (built-in ParkStay plus FakeProviders added to its registry): capability errors,
 * field-level validation, list filters, booking import and `manageUrl`, the removed
 * `bookings:sync*` channels, and `*:updated` events reaching the trusted renderer.
 */

import { EventEmitter } from 'events';
import { openDatabase } from '@main/database/connection';
import { createContainer, AppContainer } from '@main/app/container';
import { createAppUrlMatcher } from '@main/app/renderer-entry';
import { registerIpcHandlers } from '@main/ipc';
import { createSenderGuard } from '@main/ipc/sender-guard';
import { SnipeReleaseMode } from '@shared/types/common.types';
import type { APIResponse, Booking, SiteSnipe, Watch } from '@shared/types';
import {
  APP_INDEX_PATH,
  FakeIpcMain,
  fakeEvent,
  fakeWebContents,
  FakeWebContents,
  TEST_LOGS_DIR,
  TRUSTED_SENDER_ID,
} from '@tests/utils/ipc-harness';
import { createFakeProvider, createTestProviderContext } from '@tests/utils/fake-provider';
import { containerSecrets } from '@tests/utils/fake-safe-storage';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('node-machine-id', () => ({ machineIdSync: () => 'test-machine-id' }));

const { autoUpdater } = jest.requireMock('electron-updater') as { autoUpdater: EventEmitter };

describe('watches / snipes / bookings over IPC', () => {
  let container: AppContainer;
  let ipc: FakeIpcMain;
  let mainWindow: FakeWebContents;

  const call = <T = unknown>(channel: string, payload?: unknown): Promise<APIResponse<T>> =>
    ipc.invoke(channel, fakeEvent(), payload) as Promise<APIResponse<T>>;

  beforeEach(() => {
    container = createContainer({
      db: openDatabase(':memory:'),
      logsDir: TEST_LOGS_DIR,
      ...containerSecrets(),
    });
    for (const fake of [
      createFakeProvider(),
      createFakeProvider({ id: 'nowatch', capabilities: { watches: false } }),
    ]) {
      container.providers.register(fake.factory, createTestProviderContext(fake.manifest));
    }
    container.profile.ensureLocalProfile();
    mainWindow = fakeWebContents(TRUSTED_SENDER_ID);
    container.trustedWebContents.register(mainWindow);
    ipc = new FakeIpcMain();
    registerIpcHandlers(container, {
      isTrustedSender: createSenderGuard({
        isTrustedWebContents: (id) => container.trustedWebContents.isTrusted(id),
        isAppUrl: createAppUrlMatcher({ kind: 'file', path: APP_INDEX_PATH }),
      }),
      ipc,
    });
  });

  afterEach(async () => {
    await container.dispose();
    autoUpdater.removeAllListeners();
  });

  const watchInput = (providerId: string) => ({
    providerId,
    name: 'Banksia',
    location: { externalId: '1', name: 'Banksia Camp' },
    stay: { arrival: '2099-12-01', departure: '2099-12-03', adults: 2 },
    checkIntervalMinutes: 30,
  });

  const snipeInput = (extra: Record<string, unknown> = {}) => ({
    providerId: 'fake',
    name: 'Banksia snipe',
    location: { externalId: '1', name: 'Banksia Camp' },
    stay: { arrival: '2099-12-01', departure: '2099-12-03', adults: 2 },
    releaseMode: SnipeReleaseMode.CANCELLATION,
    ...extra,
  });

  it("watches.create on 'fake' succeeds; on a provider without watches it is CAPABILITY", async () => {
    await expect(call<Watch>('watches:create', watchInput('fake'))).resolves.toMatchObject({
      success: true,
      data: { providerId: 'fake', checkIntervalMinutes: 30 },
    });
    await expect(call('watches:create', watchInput('nowatch'))).resolves.toMatchObject({
      success: false,
      code: 'CAPABILITY',
    });
    await expect(call('watches:create', watchInput('gone'))).resolves.toMatchObject({
      success: false,
      code: 'UNKNOWN_PROVIDER',
    });
  });

  it('watches.create accepts only the interval options and rejects autoHold without holds', async () => {
    await expect(
      call('watches:create', { ...watchInput('fake'), checkIntervalMinutes: 5 })
    ).resolves.toMatchObject({
      success: false,
      code: 'VALIDATION',
      issues: ['checkIntervalMinutes'],
    });
    // ParkStay has holds: autoHold is accepted there
    await expect(
      call('watches:create', {
        ...watchInput('parkstay'),
        autoHold: true,
        stayParams: { gearType: 'all' },
      })
    ).resolves.toMatchObject({ success: true, data: { autoHold: true } });
  });

  it('snipes.create rejects an unsupported release mode on its field, and a scheduled release without a time on releaseAt', async () => {
    const fake = container.providers.get('fake');
    jest
      .spyOn(fake.release!, 'supports')
      .mockImplementation((mode) => mode !== SnipeReleaseMode.DAILY_ROLLOVER);

    await expect(
      call('snipes:create', snipeInput({ releaseMode: SnipeReleaseMode.DAILY_ROLLOVER }))
    ).resolves.toMatchObject({ success: false, code: 'VALIDATION', issues: ['releaseMode'] });
    await expect(
      call('snipes:create', snipeInput({ releaseMode: SnipeReleaseMode.SCHEDULED }))
    ).resolves.toMatchObject({
      success: false,
      code: 'VALIDATION',
      issues: ['releaseAt'],
      error: 'A scheduled release needs a time',
    });
    expect(container.repositories.snipes.findAll()).toEqual([]);
  });

  it('list filters by provider and status, with or without a payload', async () => {
    await call('watches:create', watchInput('fake'));
    const parkstay = await call<Watch>('watches:create', {
      ...watchInput('parkstay'),
      stayParams: { gearType: 'all' },
    });
    await call('watches:deactivate', { id: parkstay.data!.id });

    expect((await call<Watch[]>('watches:list')).data).toHaveLength(2);
    expect((await call<Watch[]>('watches:list', { providerId: 'fake' })).data).toHaveLength(1);
    expect(
      (await call<Watch[]>('watches:list', { status: 'inactive' })).data?.map((w) => w.providerId)
    ).toEqual(['parkstay']);
    await expect(call('watches:list', { userId: 1 })).resolves.toMatchObject({ success: true });

    await call('snipes:create', snipeInput());
    expect((await call<SiteSnipe[]>('snipes:list', { providerId: 'parkstay' })).data).toEqual([]);
    expect((await call<SiteSnipe[]>('snipes:list', { status: 'armed' })).data).toHaveLength(1);
    expect((await call<Booking[]>('bookings:list', { providerId: 'fake' })).data).toEqual([]);
  });

  it("bookings.import('parkstay', 'PB123') is CAPABILITY, and booking DTOs carry manageUrl", async () => {
    await expect(
      call('bookings:import', { providerId: 'parkstay', reference: 'PB123' })
    ).resolves.toMatchObject({ success: false, code: 'CAPABILITY' });

    const created = await call<Booking>('bookings:create', {
      providerId: 'parkstay',
      bookingReference: 'PB1',
      location: { name: 'Bungarra', areaName: 'Cape Range National Park' },
      stay: { arrival: '2099-11-10', departure: '2099-11-12', adults: 2 },
    });
    expect(created.data?.manageUrl).toBe('https://parkstay.dbca.wa.gov.au/mybookings/');
    expect((await call<Booking[]>('bookings:list')).data?.[0].manageUrl).toBe(
      'https://parkstay.dbca.wa.gov.au/mybookings/'
    );
  });

  it('a duplicate bookings.create is CONFLICT with a friendly message', async () => {
    const input = {
      providerId: 'parkstay',
      bookingReference: 'PB77',
      location: { name: 'Bungarra' },
      stay: { arrival: '2099-11-10', departure: '2099-11-12', adults: 2 },
    };
    await expect(call('bookings:create', input)).resolves.toMatchObject({ success: true });
    await expect(call('bookings:create', input)).resolves.toEqual({
      success: false,
      code: 'CONFLICT',
      error: 'This booking is already in your bookings',
    });
  });

  it('the placeholder bookings:sync channels are gone', () => {
    expect(ipc.registrations.filter((c) => c.startsWith('bookings:sync'))).toEqual([]);
  });

  it('watch:updated, snipe:updated and booking:updated reach the trusted renderer', async () => {
    await call('watches:create', watchInput('fake'));
    await call('snipes:create', snipeInput());
    await call('bookings:create', {
      providerId: 'fake',
      bookingReference: 'F1',
      location: { name: 'Banksia Camp' },
      stay: { arrival: '2099-11-10', departure: '2099-11-12', adults: 2 },
    });

    const sent = mainWindow.sent.map(([name]) => name);
    expect(sent).toEqual(
      expect.arrayContaining(['watch:updated', 'snipe:updated', 'booking:updated'])
    );
  });
});
