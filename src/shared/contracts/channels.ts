/**
 * IPC channel and event names: the zod-free half of the contract.
 *
 * The preload imports this module at runtime, so it must not import zod or any module that
 * does. Every channel is `<namespace>:<kebab-case-method>`. `index.ts` pairs each one with a
 * request schema and a response type, and a parity test keeps the two in step.
 */

export const CHANNELS = {
  bookings: {
    list: 'bookings:list',
    get: 'bookings:get',
    create: 'bookings:create',
    update: 'bookings:update',
    delete: 'bookings:delete',
    import: 'bookings:import',
  },
  watches: {
    list: 'watches:list',
    get: 'watches:get',
    create: 'watches:create',
    update: 'watches:update',
    delete: 'watches:delete',
    activate: 'watches:activate',
    deactivate: 'watches:deactivate',
    runNow: 'watches:run-now',
    openPayment: 'watches:open-payment',
  },
  snipes: {
    list: 'snipes:list',
    get: 'snipes:get',
    create: 'snipes:create',
    update: 'snipes:update',
    delete: 'snipes:delete',
    activate: 'snipes:activate',
    deactivate: 'snipes:deactivate',
    runNow: 'snipes:run-now',
    openPayment: 'snipes:open-payment',
  },
  notifications: {
    list: 'notifications:list',
    markRead: 'notifications:mark-read',
    markAllRead: 'notifications:mark-all-read',
    unreadCount: 'notifications:unread-count',
    delete: 'notifications:delete',
    clearAll: 'notifications:clear-all',
  },
  notifiers: {
    list: 'notifiers:list',
    get: 'notifiers:get',
    configure: 'notifiers:configure',
    enable: 'notifiers:enable',
    disable: 'notifiers:disable',
    test: 'notifiers:test',
  },
  settings: {
    get: 'settings:get',
    set: 'settings:set',
    getAll: 'settings:get-all',
  },
  app: {
    getInfo: 'app:get-info',
    openLogsFolder: 'app:open-logs-folder',
    setAutoLaunch: 'app:set-auto-launch',
    getAutoLaunch: 'app:get-auto-launch',
  },
  updater: {
    checkForUpdates: 'updater:check-for-updates',
    downloadUpdate: 'updater:download-update',
    installUpdate: 'updater:install-update',
    getStatus: 'updater:get-status',
  },
  providers: {
    list: 'providers:list',
    accessStatus: 'providers:access-status',
  },
  catalog: {
    search: 'catalog:search',
    get: 'catalog:get',
    availability: 'catalog:availability',
    checkLocation: 'catalog:check-location',
    refresh: 'catalog:refresh',
    status: 'catalog:status',
    openDocument: 'catalog:open-document',
  },
  accounts: {
    list: 'accounts:list',
    status: 'accounts:status',
    signIn: 'accounts:sign-in',
    signOut: 'accounts:sign-out',
    openSignInLink: 'accounts:open-sign-in-link',
  },
} as const;

export type Channels = typeof CHANNELS;
export type NamespaceName = keyof Channels;

/** Events main sends to the renderer. Payload types are in `events.ts`. */
export const EVENT_NAMES = [
  'notification:created',
  'watch:updated',
  'snipe:updated',
  'booking:updated',
  'updater:available',
  'updater:not-available',
  'updater:downloaded',
  'updater:progress',
  'updater:error',
  // Main emits it when an OS notification is clicked (U5); the renderer follows allow-listed paths only.
  'app:navigate',
  'provider:access-status',
  'catalog:updated',
  'account:updated',
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export function isEventName(name: unknown): name is EventName {
  return typeof name === 'string' && (EVENT_NAMES as readonly string[]).includes(name);
}
