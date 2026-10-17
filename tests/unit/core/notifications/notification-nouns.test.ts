/**
 * What alerts call units (R9): the noun of the units they are about (found or held), else the
 * watch's or snipe's stay types, else the provider's default (its first location kind), else
 * "spot". ParkStay's alerts keep "Sites available at …" and "Site held at …"; a cabin-only
 * provider's read "Cabins available at …"; units of more than one kind read "spots".
 */
import { NotificationService } from '@main/core/notifications/notification.service';
import { NotificationRepository } from '@main/database/repositories';
import type { LocationKind, SiteSnipe, Watch, WatchMatch } from '@shared/types';
import { providerUnitKinds } from '@shared/utils/unit-noun';
import { mockSiteSnipe } from '@tests/fixtures/site-sniper';
import { mockWatch } from '@tests/fixtures/watches';
import { insertUser, TestDatabaseHelper } from '@tests/utils/database-helper';

jest.mock('electron', () => ({
  Notification: function Notification() {
    return { on: jest.fn(), show: jest.fn() };
  },
}));
jest.mock('@main/app/paths', () => ({ getBrandIconPath: () => '/brand/icons/icon.png' }));

/** Each test provider's location kinds: ParkStay's campgrounds, a cabin-only and a mixed one. */
const LOCATION_KINDS: Record<string, LocationKind[]> = {
  parkstay: ['campground'],
  cabins: ['cabin'],
  parks: ['holiday-park'],
};

describe('alert nouns', () => {
  let dbHelper: TestDatabaseHelper;
  let service: NotificationService;
  let userId: number;

  beforeEach(async () => {
    dbHelper = new TestDatabaseHelper('notification-nouns');
    await dbHelper.setup();
    userId = insertUser(dbHelper.getDb(), 'nouns@example.com').id;
    service = new NotificationService(
      new NotificationRepository(dbHelper.getDb()),
      undefined,
      undefined,
      {
        providerUnitKinds: (id) =>
          providerUnitKinds(LOCATION_KINDS[id] ? { locationKinds: LOCATION_KINDS[id] } : undefined),
      }
    );
  });

  afterEach(async () => {
    await dbHelper.teardown();
  });

  const watchAt = (providerId: string, name: string, overrides: Partial<Watch> = {}): Watch => ({
    ...mockWatch,
    userId,
    providerId,
    location: { externalId: '1', name },
    ...overrides,
  });
  const match = (unitId: string, unitKind?: WatchMatch['unitKind']): WatchMatch => ({
    unitId,
    unitName: `Unit ${unitId}`,
    ...(unitKind ? { unitKind } : {}),
    arrival: mockWatch.stay.arrival,
    departure: mockWatch.stay.departure,
    partial: false,
    priceKnown: false,
  });
  const hold = {
    reference: 'H-1',
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    unitId: '4',
    paymentUrl: 'https://example.test/pay',
  };
  const snipeAt = (providerId: string, name: string): SiteSnipe => ({
    ...mockSiteSnipe,
    userId,
    providerId,
    location: { externalId: '1', name },
    holdExpiresAt: new Date(Date.now() + 20 * 60_000),
  });
  /** The newest notification (several share a second, so by id). */
  const last = async () =>
    (await service.getNotifications(userId)).reduce((a, b) => (b.id > a.id ? b : a));

  it('keeps ParkStay’s words: "Sites available at …", "Found 2 sites …", "Site held at …"', async () => {
    const watch = watchAt('parkstay', 'Osprey Bay');
    await service.notifyWatchFound(watch, [match('1', 'campsite'), match('2', 'campsite')]);
    expect(await last()).toMatchObject({
      title: 'Sites available at Osprey Bay',
      message: expect.stringMatching(/^Found 2 sites available at Osprey Bay for /),
    });

    await service.notifyWatchHeld(watch, hold, { unitName: 'CAMPSITE 04', unitKind: 'campsite' });
    expect(await last()).toMatchObject({
      title: 'Site held at Osprey Bay',
      message: expect.stringMatching(/^CAMPSITE 04 held at Osprey Bay for /),
    });

    // A ParkStay match stored before kinds: the provider's default
    await service.notifyWatchFound(watch, [match('1')]);
    expect((await last()).title).toBe('Sites available at Osprey Bay');
    await service.notifySnipeHeld(snipeAt('parkstay', 'Osprey Bay'));
    expect(await last()).toMatchObject({
      title: 'Site held at Osprey Bay',
      message: expect.stringMatching(/^Site held at Osprey Bay for /),
    });
  });

  it('names a cabin-only provider’s units cabins: found, held and sniped', async () => {
    const watch = watchAt('cabins', 'Lakeside');
    await service.notifyWatchFound(watch, [match('4', 'cabin')]);
    expect(await last()).toMatchObject({
      title: 'Cabins available at Lakeside',
      message: expect.stringMatching(/^Found 1 cabin available at Lakeside for /),
    });

    await service.notifyWatchHeld(watch, hold, { unitName: 'Cabin 4', unitKind: 'cabin' });
    expect(await last()).toMatchObject({
      title: 'Cabin held at Lakeside',
      message: expect.stringMatching(/^Cabin 4 held at Lakeside for /),
    });

    await service.notifySnipeHeld(snipeAt('cabins', 'Lakeside'), 'cabin');
    expect(await last()).toMatchObject({
      title: 'Cabin held at Lakeside',
      message: expect.stringMatching(/^Cabin held at Lakeside for .*Complete payment within/),
    });
  });

  it('reads "spots" for matched units of more than one kind', async () => {
    const watch = watchAt('parks', 'Busselton', { unitKinds: ['cabin'] });
    await service.notifyWatchFound(watch, [
      match('1', 'campsite'),
      match('2', 'cabin'),
      match('3', 'cabin'),
    ]);
    expect(await last()).toMatchObject({
      title: 'Spots available at Busselton',
      message: expect.stringMatching(/^Found 3 spots available at Busselton for /),
    });
  });

  it('falls back from the units to the stay types, then to the provider’s default', async () => {
    // Units with no kind: the watch's stay types
    await service.notifyWatchFound(watchAt('parks', 'Busselton', { unitKinds: ['room'] }), [
      match('1'),
    ]);
    expect((await last()).title).toBe('Rooms available at Busselton');

    // No stay types either: a holiday park has sites and cabins, so "spots"
    await service.notifyWatchFound(watchAt('parks', 'Busselton'), [match('1'), match('2')]);
    expect((await last()).message).toMatch(/^Found 2 spots available at Busselton/);

    // A held unit the check gave no kind: the snipe's stay types
    await service.notifySnipeHeld({ ...snipeAt('parks', 'Busselton'), unitKinds: ['glamping'] });
    expect((await last()).title).toBe('Tent held at Busselton');
  });

  it('says "spot" for a provider that is not registered, or with no resolver at all', async () => {
    await service.notifyWatchFound(watchAt('gone', 'Elsewhere'), [match('1')]);
    expect((await last()).title).toBe('Spots available at Elsewhere');

    const bare = new NotificationService(new NotificationRepository(dbHelper.getDb()));
    await bare.notifySnipeHeld(snipeAt('parkstay', 'Osprey Bay'));
    expect((await last()).title).toBe('Spot held at Osprey Bay');
  });
});
