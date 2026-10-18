/**
 * Provider notices (§12.36) through the IPC harness: a real container on a database file, so
 * a second container on the same file is a restart of WA Stay. The provider is a FakeProvider
 * that declares a notice, as Stay Rottnest does; ParkStay registers beside it, with none.
 *
 * - `providers.notice`, `acceptNotice` and `withdrawNotice`, and the stored row;
 * - the gate: while the notice is not accepted, a place's check, Explore's bulk search, a new
 *   or re-armed watch or snipe, a watch's run and a snipe's poll send the provider nothing,
 *   and each is refused, reported or recorded with its own words; once accepted they run;
 * - withdrawing stops them at once, cached answers included; a new version asks again;
 * - `NOT_FOUND`, `VALIDATION`, `UNKNOWN_PROVIDER`, an unreadable row, and the provider's own
 *   `ctx.state` cannot reach the row.
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createContainer, type AppContainer } from '@main/app/container';
import { openDatabase } from '@main/database/connection';
import { registerIpcHandlers } from '@main/ipc';
import { parkstayFactory } from '@main/providers/parkstay';
import type { ProviderNoticeStatus } from '@shared/contracts';
import type { APIResponse, SiteSnipeInput, WatchInput } from '@shared/types';
import type { CatalogAvailabilityResult } from '@shared/types/catalog.types';
import {
  SnipeReleaseMode,
  SnipeResult,
  SnipeStatus,
  WatchResult,
} from '@shared/types/common.types';
import type { ProviderManifest, ProviderNotice } from '@shared/types/provider.types';
import { containerSecrets } from '@tests/utils/fake-safe-storage';
import { createFakeProvider, type FakeProvider } from '@tests/utils/fake-provider';
import { FakeIpcMain, fakeEvent, TEST_LOGS_DIR } from '@tests/utils/ipc-harness';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('node-machine-id', () => ({ machineIdSync: () => 'test-machine-id' }));

const { autoUpdater } = jest.requireMock('electron-updater') as { autoUpdater: EventEmitter };

const NOTICE: ProviderNotice = {
  version: 1,
  title: 'Before WA Stay checks NoticeStay',
  body: "NoticeStay's terms say bookings may not be assisted by automated software.",
  points: ['NoticeStay may cancel such a booking without a refund.', 'The risk is yours.'],
  confirmLabel: 'I understand',
};
const REQUIRED = "Read and accept NoticeStay's notice in WA Stay first.";
const PAUSED = "Paused: read and accept NoticeStay's notice in WA Stay.";
const NOT_ACCEPTED: ProviderNoticeStatus = {
  providerId: 'noticestay',
  required: true,
  accepted: false,
  version: 1,
};
const STAY = { arrival: '2027-03-01', departure: '2027-03-03', adults: 2 };

describe('provider notices over IPC', () => {
  let dir: string;
  let file: string;
  let container: AppContainer | undefined;
  let ipc: FakeIpcMain;
  let fake: FakeProvider;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-notices-'));
    file = path.join(dir, 'wa-stay.db');
  });

  afterEach(async () => {
    await container?.dispose();
    container = undefined;
    autoUpdater.removeAllListeners();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Starts WA Stay on the database file (quitting the running one first). */
  async function start(notice: ProviderNotice = NOTICE): Promise<AppContainer> {
    await container?.dispose();
    fake = createFakeProvider({
      id: 'noticestay',
      shortName: 'NoticeStay',
      notice,
      // A notice gates every request: no account to check and no queue (MANIFEST_RULES)
      capabilities: { account: 'none', accessGate: false },
      availability: { '1': { u1: 'available' } },
    });
    container = createContainer({
      db: openDatabase(file),
      logsDir: TEST_LOGS_DIR,
      ...containerSecrets(),
      providerFactories: [fake.factory, parkstayFactory],
    });
    container.profile.ensureLocalProfile();
    ipc = new FakeIpcMain();
    registerIpcHandlers(container, { isTrustedSender: () => true, ipc });
    return container;
  }

  const call = <T = ProviderNoticeStatus>(
    channel: string,
    payload?: unknown
  ): Promise<APIResponse<T>> =>
    ipc.invoke(channel, fakeEvent(), payload) as Promise<APIResponse<T>>;
  const status = (providerId = 'noticestay') => call('providers:notice', { providerId });
  const accept = (version = 1, providerId = 'noticestay') =>
    call('providers:accept-notice', { providerId, version });
  const withdraw = () => call('providers:withdraw-notice', { providerId: 'noticestay' });
  const row = () =>
    (
      container!.db
        .prepare(
          "SELECT value FROM provider_state WHERE provider_id = 'noticestay' AND key = 'core.notice'"
        )
        .get() as { value: string } | undefined
    )?.value;
  /** What WA Stay asked the provider for availability. */
  const asked = () => fake.calls.filter((c) => c.module === 'availability');
  const check = () =>
    call('catalog:check-location', { key: 'noticestay:1', stay: STAY }) as Promise<APIResponse>;
  const bulk = () =>
    call<CatalogAvailabilityResult>('catalog:availability', {
      stay: STAY,
      providerIds: ['noticestay'],
    });
  const watchInput: WatchInput = {
    providerId: 'noticestay',
    name: 'Bay watch',
    location: { externalId: '1', name: 'Bay' },
    stay: STAY,
    checkIntervalMinutes: 60,
  };
  const snipeInput: SiteSnipeInput = {
    providerId: 'noticestay',
    name: 'Bay snipe',
    location: { externalId: '1', name: 'Bay' },
    stay: STAY,
    releaseMode: SnipeReleaseMode.CANCELLATION,
    action: 'alert',
  };

  it('round trip: not accepted, accepted at the version, withdrawn; ParkStay needs none', async () => {
    await start();
    expect(await status()).toEqual({ success: true, data: NOT_ACCEPTED });
    const manifests = (await call<ProviderManifest[]>('providers:list')).data!;
    expect(manifests.find((m) => m.id === 'noticestay')?.notice).toEqual(NOTICE);
    expect(row()).toBeUndefined();

    const accepted = await accept();
    expect(accepted).toEqual({
      success: true,
      data: { ...NOT_ACCEPTED, accepted: true, acceptedAt: expect.any(String) },
    });
    const acceptedAt = accepted.data!.acceptedAt!;
    expect(Date.parse(acceptedAt)).toBeGreaterThan(Date.now() - 60_000);
    expect(JSON.parse(row()!)).toEqual({ version: 1, acceptedAt });
    // Accepting again keeps the first time; a restart keeps it too
    expect((await accept()).data?.acceptedAt).toBe(acceptedAt);
    await start();
    expect((await status()).data).toEqual({ ...NOT_ACCEPTED, accepted: true, acceptedAt });

    expect(await withdraw()).toEqual({ success: true, data: NOT_ACCEPTED });
    expect(row()).toBeUndefined();
    expect((await withdraw()).data).toEqual(NOT_ACCEPTED);

    expect(await status('parkstay')).toEqual({
      success: true,
      data: { providerId: 'parkstay', required: false, accepted: true },
    });
  });

  it('not accepted: a check, a bulk search, a watch and a snipe send nothing, each refused in its own words', async () => {
    await start();
    const userId = container!.profile.requireUserId();

    expect(await check()).toMatchObject({
      success: false,
      code: 'NOTICE_REQUIRED',
      error: REQUIRED,
    });
    expect(await bulk()).toEqual({
      success: true,
      data: {
        entries: [],
        errors: [{ providerId: 'noticestay', code: 'notice', message: REQUIRED }],
      },
    });
    expect(await call('watches:create', watchInput)).toMatchObject({
      success: false,
      code: 'NOTICE_REQUIRED',
      error: REQUIRED,
    });
    expect(await call('snipes:create', snipeInput)).toMatchObject({
      success: false,
      code: 'NOTICE_REQUIRED',
    });

    // A watch and a snipe from before (a seeded row, or a withdrawal): a run asks nothing
    const watch = container!.repositories.watches.create(userId, watchInput);
    const run = await container!.watchService.execute(watch.id);
    expect(run).toMatchObject({ success: false, error: PAUSED, errorCode: 'NOTICE_REQUIRED' });
    expect(container!.repositories.watches.findById(watch.id)).toMatchObject({
      isActive: true,
      lastResult: WatchResult.ERROR,
      lastError: PAUSED,
    });
    expect(await call('watches:activate', { id: watch.id })).toMatchObject({
      code: 'NOTICE_REQUIRED',
    });

    const snipe = container!.repositories.snipes.create(userId, snipeInput);
    expect(container!.siteSniperService.plan(snipe)?.gate).toBeUndefined();
    const poll = await container!.siteSniperService.execute(snipe.id, { manual: true });
    expect(poll).toMatchObject({
      next: 'done',
      result: { result: SnipeResult.ERROR, error: REQUIRED },
    });
    expect(container!.repositories.snipes.findById(snipe.id)).toMatchObject({
      status: SnipeStatus.FAILED,
      lastError: REQUIRED,
    });
    expect(await call('snipes:activate', { id: snipe.id })).toMatchObject({
      code: 'NOTICE_REQUIRED',
    });

    expect(asked()).toEqual([]);
    // Other providers are not held back
    expect((await status('parkstay')).data?.accepted).toBe(true);
  });

  it('accepted: each of them asks the provider', async () => {
    await start();
    await accept();

    expect(await check()).toMatchObject({ success: true, data: { key: 'noticestay:1' } });
    expect((await bulk()).data?.errors).toEqual([]);
    const created = await call<{ id: number }>('watches:create', watchInput);
    expect(created.success).toBe(true);
    expect(await container!.watchService.execute(created.data!.id)).toMatchObject({
      success: true,
      found: true,
    });
    const snipe = await call<{ id: number }>('snipes:create', snipeInput);
    expect(snipe.success).toBe(true);
    const poll = await container!.siteSniperService.execute(snipe.data!.id, { manual: true });
    expect(poll.result.result).toBe(SnipeResult.ALERTED);
    expect(asked().length).toBeGreaterThanOrEqual(4);
    expect(container!.repositories.watches.findById(created.data!.id)?.lastResult).toBe(
      WatchResult.FOUND
    );
  });

  it('withdrawing stops every check at once, cached answers included, until accepted again', async () => {
    await start();
    const userId = container!.profile.requireUserId();
    await accept();
    expect((await check()).success).toBe(true);
    const watch = await container!.watchService.create(userId, watchInput);
    const sent = asked().length;

    await withdraw();
    // The check answered a moment ago is not reused
    expect(await check()).toMatchObject({ code: 'NOTICE_REQUIRED' });
    expect((await bulk()).data?.errors).toEqual([
      { providerId: 'noticestay', code: 'notice', message: REQUIRED },
    ]);
    expect(await container!.watchService.execute(watch.id)).toMatchObject({
      errorCode: 'NOTICE_REQUIRED',
    });
    expect(asked()).toHaveLength(sent);

    // Accepted again: the paused watch runs at its next check, no re-arming needed
    await accept();
    expect(await container!.watchService.execute(watch.id)).toMatchObject({ success: true });
    expect(container!.repositories.watches.findById(watch.id)?.lastError).toBeUndefined();
  });

  it('a new version asks again: the old acceptance no longer counts, and accepting the old one is VALIDATION', async () => {
    await start();
    await accept();
    await start({ ...NOTICE, version: 2, points: [...NOTICE.points, 'Something new.'] });

    expect((await status()).data).toEqual({ ...NOT_ACCEPTED, version: 2 });
    expect(await check()).toMatchObject({ code: 'NOTICE_REQUIRED' });
    expect(await accept(1)).toMatchObject({
      success: false,
      code: 'VALIDATION',
      error: "NoticeStay's notice has changed. Read it again.",
      issues: ['version'],
    });
    expect((await accept(2)).data).toMatchObject({ accepted: true, version: 2 });
    expect((await check()).success).toBe(true);
  });

  it('NOT_FOUND for a provider with no notice, UNKNOWN_PROVIDER for one not registered, VALIDATION for a bad payload', async () => {
    await start();
    expect(await accept(1, 'parkstay')).toMatchObject({
      success: false,
      code: 'NOT_FOUND',
      error: 'ParkStay has no notice',
    });
    expect(await status('nowhere')).toMatchObject({ success: false, code: 'UNKNOWN_PROVIDER' });
    expect(await accept(1, 'nowhere')).toMatchObject({ success: false, code: 'UNKNOWN_PROVIDER' });
    expect(await call('providers:accept-notice', { providerId: 'noticestay' })).toMatchObject({
      success: false,
      code: 'VALIDATION',
    });
    expect(row()).toBeUndefined();
  });

  it('an unreadable row counts as not accepted, and accepting rewrites it', async () => {
    await start();
    container!.repositories.providerState.set('noticestay', 'core.notice', { version: '1' });
    expect((await status()).data).toEqual(NOT_ACCEPTED);
    expect(await check()).toMatchObject({ code: 'NOTICE_REQUIRED' });
    expect((await accept()).data?.accepted).toBe(true);
    expect(JSON.parse(row()!)).toMatchObject({ version: 1 });
  });

  it("the provider's own state cannot read or change the row", async () => {
    await start();
    await accept();
    const state = fake.ctx!.state;
    await expect(state.get('core.notice')).rejects.toThrow(/core\.\* is reserved/);
    await expect(state.set('core.notice', { version: 1, acceptedAt: 'x' })).rejects.toThrow(
      /core\.\* is reserved/
    );
    await expect(state.delete('core.notice')).rejects.toThrow(/core\.\* is reserved/);
    expect((await status()).data?.accepted).toBe(true);
  });
});
