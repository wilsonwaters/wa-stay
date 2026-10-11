/**
 * The preload's `window.api`, against a mocked `electron`: each method invokes its contract
 * channel with one payload object, and `events.on` subscriptions unsubscribe independently.
 */

import fs from 'fs';
import path from 'path';
import type { EventEmitter } from 'events';
import { contract, WindowApi } from '@shared/contracts';
import type { MethodDef } from '@shared/contracts/define';
import { SnipeReleaseMode } from '@shared/types/common.types';
import { NotifierChannel } from '@shared/types';

const mockExposed: Record<string, unknown> = {};

jest.mock('electron', () => {
  const { EventEmitter: Emitter } = jest.requireActual('events');
  const ipcRenderer = Object.assign(new Emitter(), {
    invoke: jest.fn(() => Promise.resolve({ success: true })),
  });
  return {
    contextBridge: {
      exposeInMainWorld: (key: string, value: unknown) => {
        mockExposed[key] = value;
      },
    },
    ipcRenderer,
  };
});

import '@preload/index';

const { ipcRenderer } = jest.requireMock('electron') as {
  ipcRenderer: EventEmitter & { invoke: jest.Mock };
};
const api = mockExposed.api as WindowApi;

/** Plays a main → renderer event into the preload's listeners. */
function receive(name: string, payload: unknown): void {
  ipcRenderer.emit(name, { sender: {} }, payload);
}

describe('preload window.api', () => {
  beforeEach(() => {
    ipcRenderer.invoke.mockClear();
  });

  it('is exposed as `api` with exactly the contract namespaces and methods, plus events', () => {
    expect(Object.keys(api).sort()).toEqual([...Object.keys(contract), 'events'].sort());
    for (const [namespace, methods] of Object.entries(contract)) {
      const exposed = (api as unknown as Record<string, Record<string, unknown>>)[namespace];
      expect([namespace, Object.keys(exposed).sort()]).toEqual([
        namespace,
        Object.keys(methods).sort(),
      ]);
      for (const fn of Object.values(exposed)) expect(typeof fn).toBe('function');
    }
    expect(typeof api.events.on).toBe('function');
  });

  it('every method invokes its own contract channel', async () => {
    for (const [namespace, methods] of Object.entries(contract)) {
      for (const [method, def] of Object.entries(methods as Record<string, MethodDef>)) {
        ipcRenderer.invoke.mockClear();
        const fn = (api as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)[
          namespace
        ][method];
        await fn();
        expect([namespace, method, ipcRenderer.invoke.mock.calls[0][0]]).toEqual([
          namespace,
          method,
          def.channel,
        ]);
        // Always exactly one payload argument after the channel
        expect(ipcRenderer.invoke.mock.calls[0]).toHaveLength(2);
      }
    }
  });

  it('maps the providers, catalog and accounts arguments to their payloads', async () => {
    const stay = { arrival: '2026-11-10', departure: '2026-11-12', adults: 2 };

    await api.providers.list();
    await api.providers.accessStatus('parkstay');
    await api.catalog.search({ text: 'karri', limit: 50 });
    await api.catalog.get('parkstay:12:3');
    await api.catalog.availability(stay);
    await api.catalog.availability(stay, { providerIds: ['parkstay'], bbox: [115, -35, 117, -33] });
    await api.catalog.checkLocation('parkstay:20', stay);
    await api.catalog.refresh();
    await api.catalog.refresh('parkstay');
    await api.accounts.status('parkstay');
    await api.accounts.openSignInLink('parkstay', 'https://dbcab2c.b2clogin.com/x');

    expect(ipcRenderer.invoke.mock.calls).toEqual([
      ['providers:list', undefined],
      ['providers:access-status', { providerId: 'parkstay' }],
      ['catalog:search', { text: 'karri', limit: 50 }],
      ['catalog:get', { key: 'parkstay:12:3' }],
      ['catalog:availability', { stay }],
      ['catalog:availability', { stay, providerIds: ['parkstay'], bbox: [115, -35, 117, -33] }],
      ['catalog:check-location', { key: 'parkstay:20', stay }],
      ['catalog:refresh', { providerId: undefined }],
      ['catalog:refresh', { providerId: 'parkstay' }],
      ['accounts:status', { providerId: 'parkstay' }],
      [
        'accounts:open-sign-in-link',
        { providerId: 'parkstay', url: 'https://dbcab2c.b2clogin.com/x' },
      ],
    ]);
  });

  it('maps positional arguments to the payload object, with no userId anywhere', async () => {
    const arrivalDate = new Date('2026-12-01T00:00:00Z');

    await api.watches.list();
    await api.watches.get(3);
    await api.watches.update(3, { arrivalDate });
    await api.watches.runNow(3);
    await api.snipes.create({
      name: 'Snipe',
      campgroundId: '34',
      arrivalDate,
      departureDate: arrivalDate,
      releaseMode: SnipeReleaseMode.CANCELLATION,
    });
    await api.notifications.list();
    await api.notifications.list(20);
    await api.notifications.clearAll();
    await api.notifiers.test(NotifierChannel.EMAIL_SMTP);
    await api.settings.set('notifications.desktop', false);
    await api.app.setAutoLaunch(true);
    await api.app.setAutoLaunch(true, false);

    expect(ipcRenderer.invoke.mock.calls).toEqual([
      ['watches:list', undefined],
      ['watches:get', { id: 3 }],
      ['watches:update', { id: 3, updates: { arrivalDate } }],
      ['watches:run-now', { id: 3 }],
      [
        'snipes:create',
        expect.objectContaining({ name: 'Snipe', releaseMode: SnipeReleaseMode.CANCELLATION }),
      ],
      ['notifications:list', { limit: undefined }],
      ['notifications:list', { limit: 20 }],
      ['notifications:clear-all', undefined],
      ['notifiers:test', { channel: 'email_smtp' }],
      ['settings:set', { key: 'notifications.desktop', value: false }],
      // An omitted start minimised keeps the stored choice: the payload leaves it out
      ['app:set-auto-launch', { enabled: true }],
      ['app:set-auto-launch', { enabled: true, startMinimised: false }],
    ]);
    expect(JSON.stringify(ipcRenderer.invoke.mock.calls)).not.toContain('userId');
  });

  describe('events.on', () => {
    afterEach(() => {
      ipcRenderer.removeAllListeners();
    });

    it('two subscribers to one event: unsubscribing one leaves the other receiving', () => {
      const first = jest.fn();
      const second = jest.fn();
      const unsubscribeFirst = api.events.on('provider:access-status', first);
      api.events.on('provider:access-status', second);

      receive('provider:access-status', { providerId: 'parkstay', state: 'waiting' });
      unsubscribeFirst();
      receive('provider:access-status', { providerId: 'parkstay', state: 'active' });

      expect(first.mock.calls).toEqual([[{ providerId: 'parkstay', state: 'waiting' }]]);
      expect(second.mock.calls).toEqual([
        [{ providerId: 'parkstay', state: 'waiting' }],
        [{ providerId: 'parkstay', state: 'active' }],
      ]);
    });

    it('the same callback subscribed twice gets two independent unsubscribers', () => {
      const callback = jest.fn();
      const unsubscribeA = api.events.on('notification:created', callback);
      const unsubscribeB = api.events.on('notification:created', callback);

      receive('notification:created', { id: 1 });
      expect(callback).toHaveBeenCalledTimes(2);

      unsubscribeA();
      unsubscribeA(); // a second call is harmless and removes nothing else
      receive('notification:created', { id: 2 });
      expect(callback).toHaveBeenCalledTimes(3);

      unsubscribeB();
      receive('notification:created', { id: 3 });
      expect(callback).toHaveBeenCalledTimes(3);
      expect(ipcRenderer.listenerCount('notification:created')).toBe(0);
    });

    it('passes only the payload, and refuses names that are not contract events', () => {
      const callback = jest.fn();
      api.events.on('updater:progress', callback);
      receive('updater:progress', { percent: 50, bytesPerSecond: 1, transferred: 1, total: 2 });

      expect(callback).toHaveBeenCalledWith({
        percent: 50,
        bytesPerSecond: 1,
        transferred: 1,
        total: 2,
      });
      expect(() =>
        api.events.on('watches:list' as unknown as 'provider:access-status', jest.fn())
      ).toThrow('Unknown event: watches:list');
      expect(ipcRenderer.listenerCount('watches:list')).toBe(0);
    });
  });

  it('loads no zod at runtime: only electron and the zod-free channels module', () => {
    const runtimeImports = (file: string): string[] =>
      Array.from(
        fs.readFileSync(file, 'utf8').matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gms),
        (match) => match[1]
      );
    const src = path.join(__dirname, '../../../src');

    expect(runtimeImports(path.join(src, 'preload/index.ts')).sort()).toEqual([
      '../shared/contracts/channels',
      'electron',
    ]);
    expect(runtimeImports(path.join(src, 'shared/contracts/channels.ts'))).toEqual([]);
  });
});
