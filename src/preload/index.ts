/**
 * Preload Script
 * Exposes `window.api`, implementing `WindowApi` from `shared/contracts`.
 *
 * Each method maps its positional arguments to the single payload object its contract
 * method expects and invokes that method's channel. Only the zod-free `channels` module is
 * imported at runtime; everything else from the contract is types only, so zod never loads
 * here. `events.on` returns a function that removes just that subscription.
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { CHANNELS, isEventName } from '../shared/contracts/channels';
import type {
  Contract,
  ContractNamespace,
  EventName,
  EventPayloads,
  MethodDef,
  RequestInput,
  WindowApi,
} from '../shared/contracts';

/** For each method of namespace `N`: turns the preload method's arguments into its payload. */
type PayloadMappers<N extends ContractNamespace> = {
  [M in keyof Contract[N]]: Contract[N][M] extends MethodDef
    ? (...args: Contract[N][M]['args']) => RequestInput<Contract[N][M]>
    : never;
};

function bind<N extends ContractNamespace>(namespace: N, mappers: PayloadMappers<N>): WindowApi[N] {
  const channels = CHANNELS[namespace] as Record<string, string>;
  const methods: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const [method, toPayload] of Object.entries(mappers) as [
    string,
    (...args: unknown[]) => unknown,
  ][]) {
    const channel = channels[method];
    methods[method] = (...args) => ipcRenderer.invoke(channel, toPayload(...args));
  }
  return methods as unknown as WindowApi[N];
}

const none = (): undefined => undefined;

const api: WindowApi = {
  bookings: bind('bookings', {
    list: (filter) => filter,
    get: (id) => ({ id }),
    create: (input) => input,
    update: (id, updates) => ({ id, updates }),
    delete: (id) => ({ id }),
    import: (providerId, reference) => ({ providerId, reference }),
  }),

  watches: bind('watches', {
    list: (filter) => filter,
    get: (id) => ({ id }),
    create: (input) => input,
    update: (id, updates) => ({ id, updates }),
    delete: (id) => ({ id }),
    activate: (id) => ({ id }),
    deactivate: (id) => ({ id }),
    runNow: (id) => ({ id }),
    openPayment: (id) => ({ id }),
  }),

  snipes: bind('snipes', {
    list: (filter) => filter,
    get: (id) => ({ id }),
    create: (input) => input,
    update: (id, updates) => ({ id, updates }),
    delete: (id) => ({ id }),
    activate: (id) => ({ id }),
    deactivate: (id) => ({ id }),
    runNow: (id) => ({ id }),
    openPayment: (id) => ({ id }),
  }),

  notifications: bind('notifications', {
    list: (limit) => ({ limit }),
    markRead: (id) => ({ id }),
    markAllRead: none,
    unreadCount: none,
    delete: (id) => ({ id }),
    clearAll: none,
  }),

  notifiers: bind('notifiers', {
    list: none,
    get: (channel) => ({ channel }),
    configure: (input) => input,
    enable: (channel) => ({ channel }),
    disable: (channel) => ({ channel }),
    test: (channel) => ({ channel }),
  }),

  settings: bind('settings', {
    get: (key) => ({ key }),
    set: (key, value) => ({ key, value }),
    getAll: none,
  }),

  app: bind('app', {
    getInfo: none,
    openLogsFolder: none,
    setAutoLaunch: (enabled, startMinimised) =>
      startMinimised === undefined ? { enabled } : { enabled, startMinimised },
    getAutoLaunch: none,
  }),

  updater: bind('updater', {
    checkForUpdates: none,
    downloadUpdate: none,
    installUpdate: none,
    getStatus: none,
  }),

  providers: bind('providers', {
    list: none,
    accessStatus: (providerId) => ({ providerId }),
  }),

  catalog: bind('catalog', {
    search: (query) => query,
    get: (key) => ({ key }),
    availability: (stay, options) => ({ stay, ...options }),
    checkLocation: (key, stay) => ({ key, stay }),
    refresh: (providerId) => ({ providerId }),
    status: none,
    openDocument: (locationKey, documentId) => ({ locationKey, documentId }),
  }),

  accounts: bind('accounts', {
    list: none,
    status: (providerId) => ({ providerId }),
    signIn: (providerId) => ({ providerId }),
    signOut: (providerId) => ({ providerId }),
    openSignInLink: (providerId, url) => ({ providerId, url }),
  }),

  events: {
    on<E extends EventName>(name: E, callback: (payload: EventPayloads[E]) => void): () => void {
      if (!isEventName(name)) {
        throw new Error(`Unknown event: ${String(name)}`);
      }
      // One wrapper per subscription, so unsubscribing removes only this one.
      const listener = (_event: IpcRendererEvent, payload: EventPayloads[E]): void =>
        callback(payload);
      ipcRenderer.on(name, listener);
      return () => {
        ipcRenderer.removeListener(name, listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld('api', api);
