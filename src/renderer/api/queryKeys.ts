/**
 * React Query keys, built only here so invalidation always matches what was cached.
 * Each namespace has an `all` prefix: `invalidateQueries({ queryKey: queryKeys.catalog.all })`
 * clears everything under it.
 */

const providers = ['providers'] as const;
const catalog = ['catalog'] as const;
const notifications = ['notifications'] as const;
const app = ['app'] as const;
const updater = ['updater'] as const;
const watches = ['watches'] as const;
const accounts = ['accounts'] as const;
const bookings = ['bookings'] as const;
const accountChecks = ['account-checks'] as const;
const settings = ['settings'] as const;
const notifiers = ['notifiers'] as const;
const snipes = ['snipes'] as const;

export const queryKeys = {
  providers: {
    all: providers,
    list: () => [...providers, 'list'] as const,
    /** A provider's access gate (queue) status. */
    access: (providerId: string) => [...providers, 'access', providerId] as const,
  },
  catalog: {
    all: catalog,
    search: (query: unknown) => [...catalog, 'search', query] as const,
    /** Explore's map area, asked of the search-mode catalogues (`catalogSearchArea` key). */
    area: (areaKey: string, providerIds: readonly string[]) =>
      [...catalog, 'area', areaKey, providerIds] as const,
    detail: (key: string) => [...catalog, 'detail', key] as const,
    /** One location's availability for one stay (`catalog.checkLocation`). */
    check: (key: string, stay: unknown) => [...catalog, 'check', key, stay] as const,
    /** One provider's bulk availability for one stay (`catalog.availability`), by stay key. */
    availability: (stayKey: string, providerId: string) =>
      [...catalog, 'availability', stayKey, providerId] as const,
    status: () => [...catalog, 'status'] as const,
  },
  notifications: {
    all: notifications,
    list: (limit?: number) => [...notifications, 'list', { limit }] as const,
    unreadCount: () => [...notifications, 'unread-count'] as const,
  },
  app: {
    all: app,
    info: () => [...app, 'info'] as const,
    launchAtLogin: () => [...app, 'launch-at-login'] as const,
  },
  updater: {
    all: updater,
    status: () => [...updater, 'status'] as const,
  },
  watches: {
    all: watches,
    list: () => [...watches, 'list'] as const,
    detail: (id: number) => [...watches, 'detail', id] as const,
  },
  accounts: {
    all: accounts,
    list: () => [...accounts, 'list'] as const,
  },
  bookings: {
    all: bookings,
    list: () => [...bookings, 'list'] as const,
    detail: (id: number) => [...bookings, 'detail', id] as const,
  },
  /**
   * A live signed-in check (`accounts.status`), apart from `accounts` so that `account:updated`
   * (which a check can cause) reloads the stored list without asking the provider again.
   */
  accountChecks: {
    all: accountChecks,
    check: (providerId: string) => [...accountChecks, providerId] as const,
  },
  settings: {
    all: settings,
    value: (key: string) => [...settings, 'value', key] as const,
  },
  notifiers: {
    all: notifiers,
    detail: (channel: string) => [...notifiers, 'detail', channel] as const,
  },
  snipes: {
    all: snipes,
    list: () => [...snipes, 'list'] as const,
    detail: (id: number) => [...snipes, 'detail', id] as const,
  },
} as const;
