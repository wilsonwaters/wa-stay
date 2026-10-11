// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- a global declaration: window.api
/// <reference path="../../../src/preload/window.d.ts" />
/**
 * A `window.api` for renderer tests that renders the whole app: built on the strict mock from
 * tests/utils/window-api.ts (an un-stubbed method rejects with an error naming it), with the
 * calls the shell, Explore and the legacy list pages make on load answered by default, and a working
 * `events.on` you can drive:
 *
 *   const mock = createMockApi({ providers: { list: jest.fn().mockResolvedValue(fail('x')) } });
 *   mock.emit('updater:available', { version: '2.0.0' });
 *
 * Pass stubs per namespace to replace or add methods. Every method is a `jest.fn()`.
 */
import type { AppInfo, EventName, EventPayloads, WindowApi } from '../../../src/shared/contracts';
import type { APIResponse } from '../../../src/shared/types/api.types';
import type { AccessStatus } from '../../../src/shared/types/provider.types';
import { act } from '@testing-library/react';
import { createMockWindowApi } from '../window-api';
import { PARKSTAY_MANIFEST } from './manifests';

export { BROWSE_ONLY_MANIFEST, FAKE_MANIFEST, PARKSTAY_MANIFEST } from './manifests';

/** A successful `APIResponse`. */
export function ok<T>(data: T): APIResponse<T> {
  return { success: true, data };
}

/** A failed `APIResponse`, as main's `handle()` returns it. */
export function fail(error: string, code = 'INTERNAL'): APIResponse<never> {
  return { success: false, error, code } as APIResponse<never>;
}

export const APP_INFO: AppInfo = {
  name: 'WA Stay',
  version: '2.0.0-test',
  electronVersion: '28.3.3',
  chromeVersion: '120.0.6099.291',
  nodeVersion: '18.18.2',
  os: 'win32 10.0.22631',
  arch: 'x64',
  userDataPath: 'C:\\Users\\test\\AppData\\Roaming\\WA Stay',
  logsPath: 'C:\\Users\\test\\AppData\\Roaming\\WA Stay\\logs',
};

/** ParkStay's queue gate while no snipe uses it: no access chip shows. */
export const IDLE_ACCESS: AccessStatus = {
  providerId: 'parkstay',
  state: 'idle',
  updatedAt: '2026-10-02T10:00:00.000Z',
};

/** An active DBCA queue session (`providers.accessStatus('parkstay')`), so its access chip shows. */
export function activeAccess(): AccessStatus {
  return {
    providerId: 'parkstay',
    state: 'active',
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

type Method = (...args: never[]) => unknown;
export type ApiStubs = Partial<Record<keyof WindowApi | string, Record<string, Method>>>;

/** What each call returns unless a test says otherwise. */
function defaultStubs(): ApiStubs {
  const resolve = (value: unknown) => jest.fn().mockResolvedValue(value);
  return {
    providers: {
      list: resolve(ok([PARKSTAY_MANIFEST])),
      accessStatus: resolve(ok(IDLE_ACCESS)),
    },
    // Explore, the home page: an empty catalogue that is still syncing. Explore tests answer
    // with the ParkStay fixture instead (tests/utils/renderer/catalog.ts).
    catalog: {
      search: resolve(ok({ items: [], total: 0 })),
      status: resolve(
        ok({ providers: [{ providerId: 'parkstay', count: 0, stale: true, syncing: true }] })
      ),
    },
    app: {
      getInfo: resolve(ok(APP_INFO)),
      openLogsFolder: resolve(ok(true)),
      getAutoLaunch: resolve(ok({ enabled: false, startMinimised: false, supported: true })),
    },
    notifications: { list: resolve(ok([])), unreadCount: resolve(ok(0)) },
    // The legacy pages' first reads, so any route can be rendered.
    watches: { list: resolve(ok([])) },
    snipes: { list: resolve(ok([])) },
    bookings: { list: resolve(ok([])) },
    accounts: { list: resolve(ok([])) },
    notifiers: { get: resolve(ok(null)) },
  };
}

export interface MockApi {
  api: Window['api'];
  /**
   * Calls every live subscriber to `name`, as main's `rendererEvents.emit` would, inside `act`
   * so the updates it causes are applied before the next assertion.
   */
  emit<E extends EventName>(name: E, payload: EventPayloads[E]): void;
  /** How many subscriptions to `name` are live. */
  subscriberCount(name: EventName): number;
  /** The unsubscribe spies `events.on` has handed out, in order. */
  unsubscribes: jest.Mock[];
}

export function createMockApi(stubs: ApiStubs = {}): MockApi {
  const api = createMockWindowApi() as unknown as Record<string, Record<string, unknown>>;
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const unsubscribes: jest.Mock[] = [];

  const on = jest.fn((name: string, callback: (payload: unknown) => void) => {
    const set = listeners.get(name) ?? new Set();
    listeners.set(name, set);
    // Wrap, so the same callback subscribed twice is two subscriptions (as in the preload).
    const listener = (payload: unknown) => callback(payload);
    set.add(listener);
    const unsubscribe = jest.fn(() => {
      set.delete(listener);
    });
    unsubscribes.push(unsubscribe);
    return unsubscribe;
  });
  api.events = { on };

  const all = defaultStubs();
  for (const [namespace, methods] of Object.entries(stubs)) {
    all[namespace] = { ...all[namespace], ...methods };
  }
  for (const [namespace, methods] of Object.entries(all)) {
    for (const [method, fn] of Object.entries(methods ?? {})) {
      api[namespace][method] = fn;
    }
  }

  return {
    api: api as unknown as Window['api'],
    emit(name, payload) {
      act(() => {
        for (const listener of [...(listeners.get(name) ?? [])]) listener(payload);
      });
    },
    subscriberCount: (name) => listeners.get(name)?.size ?? 0,
    unsubscribes,
  };
}
