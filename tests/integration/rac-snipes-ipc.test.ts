/**
 * RAC snipes over IPC (`snipes:create`), through P3's harness against a real container with the
 * built-in RAC module, at 10 am Perth on 17 Oct 2026: a stay its release policy times is
 * created as an alert at that instant, with RAC's cadence and window; each refusal of the
 * policy is VALIDATION on `releaseAt` with its message; there is no cancellation mode
 * (`releaseMode`), and no hold (`action`). Nothing is sent: the policy reads no page.
 */

import { EventEmitter } from 'events';
import { openDatabase } from '@main/database/connection';
import { createContainer, AppContainer } from '@main/app/container';
import { createAppUrlMatcher } from '@main/app/renderer-entry';
import { registerIpcHandlers } from '@main/ipc';
import { createSenderGuard } from '@main/ipc/sender-guard';
import { SnipeReleaseMode } from '@shared/types/common.types';
import type { APIResponse, SiteSnipe } from '@shared/types';
import { fakeDateOnly } from '@tests/utils/core-harness';
import {
  APP_INDEX_PATH,
  FakeIpcMain,
  fakeEvent,
  fakeWebContents,
  TEST_LOGS_DIR,
  TRUSTED_SENDER_ID,
} from '@tests/utils/ipc-harness';
import { containerSecrets } from '@tests/utils/fake-safe-storage';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('node-machine-id', () => ({ machineIdSync: () => 'test-machine-id' }));

const { autoUpdater } = jest.requireMock('electron-updater') as { autoUpdater: EventEmitter };

/** 10 am in Perth, 17 Oct 2026. */
const NOW = new Date('2026-10-17T02:00:00.000Z');
const SET_A_WATCH = 'Set a watch, or choose a time you set.';

describe('RAC snipes over IPC', () => {
  let container: AppContainer;
  let ipc: FakeIpcMain;

  const call = <T = unknown>(channel: string, payload?: unknown): Promise<APIResponse<T>> =>
    ipc.invoke(channel, fakeEvent(), payload) as Promise<APIResponse<T>>;

  /** A Busselton snipe for `arrival`–`departure`, when the dates open. */
  const busselton = (arrival: string, departure: string, extra: Record<string, unknown> = {}) => ({
    providerId: 'rac',
    name: 'Busselton',
    location: { externalId: 'busselton', name: 'RAC Busselton Holiday Park' },
    stay: { arrival, departure, adults: 2 },
    releaseMode: SnipeReleaseMode.DAILY_ROLLOVER,
    ...extra,
  });

  beforeEach(() => {
    fakeDateOnly(NOW);
    container = createContainer({
      db: openDatabase(':memory:'),
      logsDir: TEST_LOGS_DIR,
      ...containerSecrets(),
    });
    container.profile.ensureLocalProfile();
    const mainWindow = fakeWebContents(TRUSTED_SENDER_ID);
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
    jest.useRealTimers();
  });

  it('creates an alert at the school-holiday release, checking every 10 s for at most 30 minutes', async () => {
    const created = await call<SiteSnipe>(
      'snipes:create',
      busselton('2027-12-20', '2027-12-23', { pollIntervalMs: 1500, windowDurationMs: 3_600_000 })
    );
    expect(created).toMatchObject({
      success: true,
      data: {
        providerId: 'rac',
        action: 'alert',
        pollIntervalMs: 10_000,
        windowDurationMs: 1_800_000,
      },
    });
    // 8 am Perth on 5 Feb 2027, the public release (no member number yet)
    expect(new Date(created.data!.releaseAt!).toISOString()).toBe('2027-02-05T00:00:00.000Z');
  });

  it.each([
    [
      'a night in holidays RAC has not announced',
      busselton('2028-07-02', '2028-07-05'),
      `RAC hasn't announced when these school holidays open at RAC Busselton Holiday Park. ${SET_A_WATCH}`,
    ],
    [
      'a night after the calendar',
      busselton('2029-02-10', '2029-02-12'),
      `WA Stay doesn't know RAC's release dates for 2029 yet. ${SET_A_WATCH}`,
    ],
    [
      'a stay already open',
      busselton('2026-11-06', '2026-11-08'),
      'These dates are already open on RAC. Set a watch to hear about cancellations.',
    ],
    [
      'a scheduled release without a time',
      busselton('2027-08-01', '2027-08-03', { releaseMode: SnipeReleaseMode.SCHEDULED }),
      'A scheduled release needs a time',
    ],
  ])('refuses %s: VALIDATION on releaseAt, with why', async (_, input, error) => {
    await expect(call('snipes:create', input)).resolves.toEqual({
      success: false,
      code: 'VALIDATION',
      error,
      issues: ['releaseAt'],
    });
    expect(container.repositories.snipes.findAll()).toEqual([]);
  });

  it('has no cancellation mode: VALIDATION on releaseMode', async () => {
    await expect(
      call(
        'snipes:create',
        busselton('2027-12-20', '2027-12-23', { releaseMode: SnipeReleaseMode.CANCELLATION })
      )
    ).resolves.toMatchObject({ success: false, code: 'VALIDATION', issues: ['releaseMode'] });
  });

  it('never holds: VALIDATION on action for hold', async () => {
    await expect(
      call('snipes:create', busselton('2027-12-20', '2027-12-23', { action: 'hold' }))
    ).resolves.toMatchObject({ success: false, code: 'VALIDATION', issues: ['action'] });
    expect(container.repositories.snipes.findAll()).toEqual([]);
  });

  it('takes a scheduled time it is given, for seasonal dates at Cable Beach', async () => {
    const releaseAt = '2027-03-01T01:00:00.000Z';
    const created = await call<SiteSnipe>('snipes:create', {
      ...busselton('2027-08-01', '2027-08-03', { releaseMode: SnipeReleaseMode.SCHEDULED }),
      location: { externalId: 'cable-beach', name: 'RAC Cable Beach Holiday Park' },
      // Over IPC a Date is structured-cloned as a Date
      releaseAt: new Date(releaseAt),
    });
    expect(created).toMatchObject({ success: true });
    expect(new Date(created.data!.releaseAt!).toISOString()).toBe(releaseAt);
  });
});
