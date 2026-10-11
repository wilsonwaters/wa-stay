/**
 * Quit with a job in flight (V4 addendum from V7): `AppContainer.dispose` (run by the quit
 * hold) aborts the scheduler's checks and its retention run and waits for them, with a bound,
 * before it closes the database, so no job writes to a closed database.
 */

import { EventEmitter } from 'events';
import { openDatabase } from '@main/database/connection';
import { createContainer, AppContainer } from '@main/app/container';
import { SCHEDULER_STOP_GRACE_MS } from '@main/scheduler/job-scheduler';
import { RETENTION_BATCH_SIZE, RETENTION_FIRST_RUN_DELAY_MS } from '@main/scheduler/retention-job';
import { QUIT_GRACE_MS } from '@main/app/quit-hold';
import { TEST_LOGS_DIR } from '@tests/utils/ipc-harness';
import {
  createFakeProvider,
  createTestProviderContext,
  type FakeProvider,
} from '@tests/utils/fake-provider';
import { containerSecrets } from '@tests/utils/fake-safe-storage';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('node-machine-id', () => ({ machineIdSync: () => 'test-machine-id' }));

const { autoUpdater } = jest.requireMock('electron-updater') as { autoUpdater: EventEmitter };
const NOW = new Date('2026-10-04T02:00:00.000Z');

describe('quit with a job in flight', () => {
  let container: AppContainer;
  let fake: FakeProvider;
  let order: string[];

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    container = createContainer({
      db: openDatabase(':memory:'),
      logsDir: TEST_LOGS_DIR,
      ...containerSecrets(),
    });
    fake = createFakeProvider({ delays: { availability: 60_000 } });
    container.providers.register(
      fake.factory,
      createTestProviderContext(fake.manifest, { clock: () => new Date() })
    );
    container.profile.ensureLocalProfile();
    order = [];
    const close = container.db.close.bind(container.db);
    jest.spyOn(container.db, 'close').mockImplementation(() => {
      order.push('database closed');
      return close();
    });
  });

  afterEach(async () => {
    const disposing = container.dispose();
    await jest.advanceTimersByTimeAsync(QUIT_GRACE_MS);
    await disposing;
    autoUpdater.removeAllListeners();
    jest.useRealTimers();
  });

  /** A watch on `fake`, checked by the scheduler now; resolves to its check in flight. */
  async function slowCheck(): Promise<{ job: Promise<unknown> }> {
    const watch = await container.watchService.create(container.profile.requireUserId(), {
      providerId: 'fake',
      name: 'Slow',
      location: { externalId: '1', name: 'Banksia Camp' },
      stay: { arrival: '2026-12-01', departure: '2026-12-03', adults: 2 },
    });
    container.scheduler.start();
    await jest.advanceTimersByTimeAsync(1_000);
    const job = container.scheduler.runWatchNow(watch.id).then((result) => {
      order.push('job settled');
      return result;
    });
    // Wrapped, so awaiting this function does not wait for the check itself
    return { job };
  }

  it('aborts a slow in-flight check, waits for it, and only then closes the database', async () => {
    const recordRun = jest.spyOn(container.repositories.watches, 'recordRun');
    const { job } = await slowCheck();
    const [check] = fake.calls.filter((c) => c.module === 'availability');
    expect(check.signal?.aborted).toBe(false);

    const disposing = container.dispose();
    expect(check.signal?.aborted).toBe(true);
    // Not closed yet: the check has not settled
    expect(container.db.open).toBe(true);

    // The aborted check settles at once, then the database closes: well inside the bound
    await jest.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['job settled', 'database closed']);
    // The providers finish closing alongside (their browsers get up to 5 s)
    await jest.advanceTimersByTimeAsync(QUIT_GRACE_MS);
    await disposing;

    await expect(job).resolves.toMatchObject({ success: false, error: 'The check was stopped' });
    expect(recordRun).not.toHaveBeenCalled();
    expect(container.db.open).toBe(false);
  });

  it('a job that ignores the abort is cut off at the bound, and never writes to the closed database', async () => {
    const recordRun = jest.spyOn(container.repositories.watches, 'recordRun');
    const units = { key: 'fake:1', checkedAt: NOW.toISOString(), units: [] };
    // A provider that does not honour its signal: answers after 10 s regardless
    jest
      .spyOn(fake.availability!, 'check')
      .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(units), 10_000)));
    const { job } = await slowCheck();

    const disposing = container.dispose();
    await jest.advanceTimersByTimeAsync(SCHEDULER_STOP_GRACE_MS - 1);
    expect(container.db.open).toBe(true);
    await jest.advanceTimersByTimeAsync(1);
    expect(container.db.open).toBe(false);
    expect(order).toEqual(['database closed']);

    // The check answers after the database closed: the run sees its abort and writes nothing
    await jest.advanceTimersByTimeAsync(10_000);
    await disposing;
    await expect(job).resolves.toMatchObject({ error: 'The check was stopped' });
    expect(recordRun).not.toHaveBeenCalled();
    // The bound fits inside the quit hold, with the browsers closing alongside
    expect(SCHEDULER_STOP_GRACE_MS).toBeLessThan(QUIT_GRACE_MS);
  });

  it('a retention run in flight stops between batches and settles before the database closes', async () => {
    // Always a full batch: the run would go on by itself
    const deletes = jest
      .spyOn(container.repositories.notifications, 'deleteCreatedBefore')
      .mockImplementation(() => {
        order.push('batch');
        return RETENTION_BATCH_SIZE;
      });
    container.scheduler.start();
    await jest.advanceTimersByTimeAsync(RETENTION_FIRST_RUN_DELAY_MS);
    // The first batch is done; the run waits for its yield
    expect(deletes).toHaveBeenCalledTimes(1);
    const run = container.scheduler.runCleanup().then((result) => {
      order.push('retention settled');
      return result;
    });

    const disposing = container.dispose();
    expect(container.db.open).toBe(true);
    await jest.advanceTimersByTimeAsync(1);
    expect(order).toEqual(['batch', 'retention settled', 'database closed']);
    await jest.advanceTimersByTimeAsync(QUIT_GRACE_MS);
    await disposing;

    await expect(run).resolves.toMatchObject({ complete: false });
    expect(deletes).toHaveBeenCalledTimes(1);
  });
});
