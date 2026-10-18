/**
 * A provider's published booking rules (`stayRules`) through the IPC harness: a real container
 * whose FakeProvider has a `stayRules` module, beside ParkStay, which has none.
 *
 * - `catalog.stayRules` answers the verdict, cleaned (text cut to 200 characters, at most 6
 *   notes and 6 suggestions, a bad field or date dropped), asks the provider nothing, and is
 *   `CAPABILITY` for a provider without rules and `UNKNOWN_PROVIDER` for one not registered;
 *   a module that throws or answers nonsense reads as allowed;
 * - a watch or snipe the rules refuse is `VALIDATION` on the field to change, at create and at
 *   an update of the place, stay, units or stay types (not of its name); ParkStay's are as
 *   before.
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createContainer, type AppContainer } from '@main/app/container';
import { openDatabase } from '@main/database/connection';
import { registerIpcHandlers } from '@main/ipc';
import { parkstayFactory } from '@main/providers/parkstay';
import type { StayRulesInput } from '@main/providers/sdk';
import type { APIResponse, SiteSnipeInput, Watch, WatchInput } from '@shared/types';
import { SnipeReleaseMode } from '@shared/types/common.types';
import type { StayRulesVerdict } from '@shared/types/provider.types';
import { eachNight } from '@shared/utils/calendar-date';
import { containerSecrets } from '@tests/utils/fake-safe-storage';
import { createFakeProvider, type FakeProvider } from '@tests/utils/fake-provider';
import { FakeIpcMain, fakeEvent, TEST_LOGS_DIR } from '@tests/utils/ipc-harness';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('node-machine-id', () => ({ machineIdSync: () => 'test-machine-id' }));

const { autoUpdater } = jest.requireMock('electron-updater') as { autoUpdater: EventEmitter };

const STAY = { arrival: '2027-03-01', departure: '2027-03-03', adults: 2 };
const OPENS_AT = '2026-11-04T00:30:00.000Z';

/** FakeStay's rules: 3 nights at most, 4 people, no u2, Saturdays two nights; June 2027 not open. */
function fakeRules(input: StayRulesInput): StayRulesVerdict {
  const nights = eachNight(input.stay.arrival, input.stay.departure);
  const release =
    input.stay.arrival >= '2027-06-01'
      ? { open: false, opensAt: OPENS_AT, text: 'Opens Wed 4 Nov 2026, 8:30 am.' }
      : { open: true, text: 'On sale.' };
  const notes = ['Saturdays need two nights.'];
  if (nights.length > 3) {
    return {
      ok: false,
      reason: 'FakeStay takes 3 nights at most.',
      field: 'departure',
      notes,
      release,
      suggestions: [{ arrival: input.stay.arrival, departure: '2027-03-04' }],
    };
  }
  if (input.stay.adults > 4) {
    return { ok: false, reason: 'Nothing at Banksia sleeps 5.', field: 'guests', notes, release };
  }
  if (input.unitIds?.includes('u2')) {
    return { ok: false, reason: 'Site 2 is closed.', field: 'units', notes, release };
  }
  if (input.stay.arrival === '2027-03-06' && nights.length === 1) {
    return { ok: false, reason: 'Saturdays need two nights.', field: 'arrival', notes, release };
  }
  return { ok: true, notes, release };
}

describe('provider stay rules over IPC', () => {
  let dir: string;
  let container: AppContainer | undefined;
  let ipc: FakeIpcMain;
  let fake: FakeProvider;
  let check: jest.Mock<StayRulesVerdict, [StayRulesInput]>;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-stay-rules-'));
    fake = createFakeProvider({
      id: 'fakestay',
      shortName: 'FakeStay',
      availability: { '1': { u1: 'available', u2: 'available' } },
    });
    check = jest.fn(fakeRules);
    fake.stayRules = { check };
    container = createContainer({
      db: openDatabase(path.join(dir, 'wa-stay.db')),
      logsDir: TEST_LOGS_DIR,
      ...containerSecrets(),
      providerFactories: [fake.factory, parkstayFactory],
    });
    container.profile.ensureLocalProfile();
    ipc = new FakeIpcMain();
    registerIpcHandlers(container, { isTrustedSender: () => true, ipc });
  });

  afterEach(async () => {
    await container?.dispose();
    container = undefined;
    autoUpdater.removeAllListeners();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const call = <T = StayRulesVerdict>(channel: string, payload?: unknown) =>
    ipc.invoke(channel, fakeEvent(), payload) as Promise<APIResponse<T>>;
  const rules = (payload: Record<string, unknown>) =>
    call('catalog:stay-rules', { key: 'fakestay:1', stay: STAY, ...payload });
  const watchInput = (overrides: Partial<WatchInput> = {}): WatchInput => ({
    providerId: 'fakestay',
    name: 'Banksia',
    location: { externalId: '1', name: 'Banksia Camp' },
    stay: STAY,
    checkIntervalMinutes: 60,
    ...overrides,
  });

  describe('catalog.stayRules', () => {
    it('answers the verdict, with the place, units, stay types and now, and asks the provider nothing', async () => {
      const before = Date.now();
      expect(await rules({})).toEqual({
        success: true,
        data: {
          ok: true,
          notes: ['Saturdays need two nights.'],
          release: { open: true, text: 'On sale.' },
        },
      });
      expect(
        await rules({
          stay: { ...STAY, departure: '2027-03-08' },
          unitIds: ['u1'],
          unitKinds: ['campsite'],
        })
      ).toEqual({
        success: true,
        data: {
          ok: false,
          reason: 'FakeStay takes 3 nights at most.',
          field: 'departure',
          notes: ['Saturdays need two nights.'],
          release: { open: true, text: 'On sale.' },
          suggestions: [{ arrival: '2027-03-01', departure: '2027-03-04' }],
        },
      });
      const input = check.mock.calls[1][0];
      expect(input).toMatchObject({ externalId: '1', unitIds: ['u1'], unitKinds: ['campsite'] });
      expect(input.stay).toMatchObject({
        arrival: '2027-03-01',
        departure: '2027-03-08',
        adults: 2,
      });
      expect(input.now.getTime()).toBeGreaterThanOrEqual(before);
      expect(fake.calls).toEqual([]);
    });

    it('says when a stay is not on sale yet', async () => {
      const answer = await rules({
        stay: { ...STAY, arrival: '2027-06-01', departure: '2027-06-03' },
      });
      expect(answer.data?.release).toEqual({
        open: false,
        opensAt: OPENS_AT,
        text: 'Opens Wed 4 Nov 2026, 8:30 am.',
      });
    });

    it('cleans what the provider says: long text cut, at most 6 notes and suggestions, bad dates and fields dropped', async () => {
      check.mockReturnValueOnce({
        ok: false,
        reason: `${'A very long reason. '.repeat(20)}`,
        field: 'departure',
        notes: ['  One  ', '', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'],
        release: { open: false, opensAt: 'not a date', text: 'Soon.' },
        suggestions: [
          { arrival: '2027-03-01', departure: '2027-03-04' },
          { arrival: '2027-03-01', departure: '2027-03-04' },
          { arrival: '2027-03-05', departure: '2027-03-02' },
          { arrival: 'Friday', departure: '2027-03-04' },
          ...[2, 3, 4, 5, 6, 7, 8].map((day) => ({
            arrival: `2027-03-0${day}`,
            departure: `2027-03-1${day}`,
          })),
        ],
      });
      const { data } = await rules({});
      expect(data).toMatchObject({ ok: false, field: 'departure' });
      if (data?.ok !== false) throw new Error('refused expected');
      expect(data.reason).toHaveLength(200);
      expect(data.reason.endsWith('…')).toBe(true);
      expect(data.notes).toEqual(['One', 'Two', 'Three', 'Four', 'Five', 'Six']);
      expect(data.release).toEqual({ open: false, text: 'Soon.' });
      expect(data.suggestions).toHaveLength(6);
      expect(data.suggestions?.[0]).toEqual({ arrival: '2027-03-01', departure: '2027-03-04' });
      expect(data.suggestions?.[1]).toEqual({ arrival: '2027-03-02', departure: '2027-03-12' });
    });

    it('reads a module that throws, or answers nonsense, as allowed with no notes', async () => {
      check.mockImplementationOnce(() => {
        throw new Error('boom');
      });
      expect((await rules({})).data).toEqual({ ok: true, notes: [] });
      check.mockReturnValueOnce({ ok: false, reason: 'No.', field: 'weather' } as never);
      expect((await rules({})).data).toEqual({ ok: true, notes: [] });
    });

    it('CAPABILITY for a provider without rules, UNKNOWN_PROVIDER for one not registered, VALIDATION for a bad payload', async () => {
      expect(await call('catalog:stay-rules', { key: 'parkstay:20', stay: STAY })).toMatchObject({
        success: false,
        code: 'CAPABILITY',
      });
      expect(await call('catalog:stay-rules', { key: 'nowhere:1', stay: STAY })).toMatchObject({
        success: false,
        code: 'UNKNOWN_PROVIDER',
      });
      expect(await rules({ unitKinds: ['castle'] })).toMatchObject({
        success: false,
        code: 'VALIDATION',
      });
    });
  });

  describe('watches and snipes', () => {
    it.each([
      [
        'departure',
        { stay: { ...STAY, departure: '2027-03-08' } },
        'stay.departure',
        'FakeStay takes 3 nights at most.',
      ],
      ['guests', { stay: { ...STAY, adults: 5 } }, 'stay.adults', 'Nothing at Banksia sleeps 5.'],
      ['units', { unitIds: ['u2'] }, 'unitIds', 'Site 2 is closed.'],
      [
        'arrival',
        { stay: { ...STAY, arrival: '2027-03-06', departure: '2027-03-07' } },
        'stay.arrival',
        'Saturdays need two nights.',
      ],
    ])(
      'a watch the rules refuse on %s is VALIDATION on that field',
      async (_field, overrides, issue, reason) => {
        expect(await call('watches:create', watchInput(overrides as Partial<WatchInput>))).toEqual({
          success: false,
          code: 'VALIDATION',
          error: reason,
          issues: [issue],
        });
      }
    );

    it('a watch the rules allow is created; an edit of what they judge is checked again, of its name not', async () => {
      const created = await call<Watch>('watches:create', watchInput());
      expect(created.success).toBe(true);
      const id = created.data!.id;
      const calls = check.mock.calls.length;

      expect(
        (await call<Watch>('watches:update', { id, updates: { name: 'Renamed' } })).success
      ).toBe(true);
      expect(check.mock.calls.length).toBe(calls);

      expect(
        await call('watches:update', {
          id,
          updates: { stay: { ...STAY, departure: '2027-03-09' } },
        })
      ).toMatchObject({ success: false, code: 'VALIDATION', issues: ['stay.departure'] });
      expect(await call('watches:update', { id, updates: { unitIds: ['u2'] } })).toMatchObject({
        success: false,
        code: 'VALIDATION',
        issues: ['unitIds'],
      });
      // Nothing was saved
      expect(container!.repositories.watches.findById(id)).toMatchObject({
        stay: expect.objectContaining({ departure: '2027-03-03' }),
        unitIds: [],
      });
    });

    it('a snipe the rules refuse is VALIDATION on the field, at create and at an update of its stay', async () => {
      const input: SiteSnipeInput = {
        providerId: 'fakestay',
        name: 'Banksia snipe',
        location: { externalId: '1', name: 'Banksia Camp' },
        stay: STAY,
        releaseMode: SnipeReleaseMode.CANCELLATION,
        action: 'alert',
      };
      expect(await call('snipes:create', { ...input, stay: { ...STAY, adults: 6 } })).toMatchObject(
        { success: false, code: 'VALIDATION', issues: ['stay.adults'] }
      );
      const created = await call<{ id: number }>('snipes:create', input);
      expect(created.success).toBe(true);
      expect(
        await call('snipes:update', {
          id: created.data!.id,
          updates: { stay: { ...STAY, departure: '2027-03-10' } },
        })
      ).toMatchObject({ success: false, code: 'VALIDATION', issues: ['stay.departure'] });
    });

    it('ParkStay, with no rules, creates the watches it did, whatever their length', async () => {
      const parkstay = await call<Watch>('watches:create', {
        ...watchInput(),
        providerId: 'parkstay',
        location: { externalId: '20', name: 'Bungarra' },
        stay: { ...STAY, departure: '2027-03-10' },
      });
      expect(parkstay.success).toBe(true);
    });
  });
});
