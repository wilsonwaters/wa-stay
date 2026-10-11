import { queryKeys } from './queryKeys';

describe('queryKeys', () => {
  it('has one namespace per data area', () => {
    expect(Object.keys(queryKeys).sort()).toEqual(
      [
        'accountChecks',
        'accounts',
        'app',
        'bookings',
        'catalog',
        'notifications',
        'notifiers',
        'providers',
        'settings',
        'snipes',
        'updater',
        'watches',
      ].sort()
    );
  });

  it('starts every key with its namespace prefix, so invalidating `all` reaches it', () => {
    const keys = [
      [queryKeys.providers.all, queryKeys.providers.list()],
      [queryKeys.catalog.all, queryKeys.catalog.search({ text: 'bay' })],
      [queryKeys.catalog.all, queryKeys.catalog.area('8/112,-40,136,-8', ['search'])],
      [queryKeys.catalog.all, queryKeys.catalog.detail('parkstay:1')],
      [queryKeys.catalog.all, queryKeys.catalog.check('parkstay:1', { arrival: '2026-12-01' })],
      [
        queryKeys.catalog.all,
        queryKeys.catalog.availability('2026-12-01_2026-12-03_2_0_0', 'parkstay'),
      ],
      [queryKeys.catalog.all, queryKeys.catalog.status()],
      [queryKeys.notifications.all, queryKeys.notifications.list(20)],
      [queryKeys.notifications.all, queryKeys.notifications.unreadCount()],
      [queryKeys.app.all, queryKeys.app.info()],
      [queryKeys.updater.all, queryKeys.updater.status()],
      [queryKeys.watches.all, queryKeys.watches.list()],
      [queryKeys.watches.all, queryKeys.watches.detail(3)],
      [queryKeys.accounts.all, queryKeys.accounts.list()],
      [queryKeys.bookings.all, queryKeys.bookings.list()],
      [queryKeys.bookings.all, queryKeys.bookings.detail(3)],
      [queryKeys.app.all, queryKeys.app.launchAtLogin()],
      [queryKeys.accountChecks.all, queryKeys.accountChecks.check('parkstay')],
      [queryKeys.settings.all, queryKeys.settings.value('notifications.desktop')],
      [queryKeys.notifiers.all, queryKeys.notifiers.detail('email_smtp')],
      [queryKeys.snipes.all, queryKeys.snipes.list()],
      [queryKeys.snipes.all, queryKeys.snipes.detail(7)],
    ] as const;
    for (const [prefix, key] of keys) {
      expect(key.slice(0, prefix.length)).toEqual([...prefix]);
      expect(key.length).toBeGreaterThan(prefix.length);
    }
  });

  it('builds equal keys for equal inputs and different keys for different ones', () => {
    expect(queryKeys.catalog.search({ text: 'bay' })).toEqual(
      queryKeys.catalog.search({ text: 'bay' })
    );
    expect(queryKeys.catalog.detail('a')).not.toEqual(queryKeys.catalog.detail('b'));
    expect(queryKeys.providers.list()).toEqual(['providers', 'list']);
  });

  it('keeps live account checks out of the accounts namespace (account:updated reloads only the list)', () => {
    const check = queryKeys.accountChecks.check('parkstay');
    expect(check.slice(0, queryKeys.accounts.all.length)).not.toEqual([...queryKeys.accounts.all]);
  });
});
