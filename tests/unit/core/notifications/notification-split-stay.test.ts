/**
 * @jest-environment node
 *
 * The split-stay alert (`notifyWatchSplitFound`): "Free if you move {sites} at {place}", in the
 * noun of the units it uses; a message that names the reporting units and says to contact the
 * place, or lists the parts (the first four) and says to book each; a watch alert, so its click
 * opens the watch, and only the watch (no booking link on the desktop path); and an email that
 * gets "How to book", every link checked again against the provider's site. No link is stored.
 */
import { NotificationService } from '@main/core/notifications/notification.service';
import type { NotificationDispatcher } from '@main/core/notifications/notification-dispatcher';
import { openDatabase } from '@main/database/connection';
import { NotificationRepository } from '@main/database/repositories';
import { NotificationType, RelatedType } from '@shared/types/common.types';
import type {
  LocationKind,
  NotificationMessage,
  SplitStay,
  SplitStayPart,
  Watch,
} from '@shared/types';
import { providerUnitKinds } from '@shared/utils/unit-noun';
import { mockWatch } from '@tests/fixtures/watches';
import type Database from 'better-sqlite3';

type Handler = () => void;
interface FakeDesktopNotification {
  options: { title: string; body: string };
  handlers: Map<string, Handler>;
}
const mockDesktop: FakeDesktopNotification[] = [];
jest.mock('electron', () => ({
  Notification: function Notification(options: { title: string; body: string }) {
    const handlers = new Map<string, Handler>();
    const fake = {
      options,
      handlers,
      show: jest.fn(),
      on: (event: string, handler: Handler) => handlers.set(event, handler),
    };
    mockDesktop.push(fake);
    return fake;
  },
}));
jest.mock('@main/app/paths', () => ({ getBrandIconPath: () => '/brand/icons/icon.png' }));

jest.mock('@main/utils/logger', () => {
  const log: Record<string, unknown> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  log.child = () => log;
  return { logger: log };
});
const mockLog = (jest.requireMock('@main/utils/logger') as { logger: Record<string, jest.Mock> })
  .logger;

/** Each test provider: its short name, website and location kinds. */
const PROVIDERS: Record<string, { shortName: string; website: string; kinds: LocationKind[] }> = {
  rac: { shortName: 'RAC', website: 'https://parks.rac.example', kinds: ['holiday-park'] },
  parkstay: { shortName: 'ParkStay', website: 'https://parkstay.example', kinds: ['campground'] },
  cabins: { shortName: 'Cabins', website: 'https://cabins.example', kinds: ['cabin'] },
};

/** Calendar dates as the alerts show them. */
const day = (date: string) =>
  new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, { timeZone: 'UTC' });

describe('the split-stay alert', () => {
  let db: Database.Database;
  let repo: NotificationRepository;
  let events: { emit: jest.Mock };
  let dispatch: jest.Mock<Promise<void>, [NotificationMessage]>;
  let showMainWindow: jest.Mock<boolean, []>;
  let openExternal: jest.Mock<Promise<void>, [string]>;
  let service: NotificationService;

  const watchAt = (providerId: string, name: string, overrides: Partial<Watch> = {}): Watch => ({
    ...mockWatch,
    id: 21,
    userId: 1,
    providerId,
    location: { externalId: 'busselton', name },
    stay: { ...mockWatch.stay, arrival: '2027-07-01', departure: '2027-07-06' },
    unitKinds: [],
    ...overrides,
  });

  /** A part of `nights` nights on `unitName`, from `arrival` (July 2027). */
  const part = (
    unitName: string,
    arrival: string,
    departure: string,
    bookingUrl?: string
  ): SplitStayPart => ({
    unitId: unitName.toLowerCase().replace(/\s+/g, '-'),
    unitName,
    arrival,
    departure,
    ...(bookingUrl ? { bookingUrl } : {}),
  });

  const contactStay = (unitName: string, contactUrl?: string): SplitStay => ({
    unitKind: 'campsite',
    booking: 'contact',
    unitId: `cat:${unitName}`,
    unitName,
    total: 450,
    ...(contactUrl ? { contactUrl } : {}),
  });

  const lastStored = () => repo.findByUserId(1).reduce((a, b) => (b.id > a.id ? b : a));
  const lastDispatched = () => dispatch.mock.calls[dispatch.mock.calls.length - 1][0];

  beforeEach(() => {
    mockDesktop.length = 0;
    for (const level of ['info', 'warn', 'error', 'debug']) mockLog[level].mockClear();
    db = openDatabase(':memory:');
    repo = new NotificationRepository(db);
    events = { emit: jest.fn() };
    dispatch = jest.fn(async () => undefined);
    showMainWindow = jest.fn(() => true);
    openExternal = jest.fn(() => Promise.resolve());
    service = new NotificationService(
      repo,
      { dispatch } as unknown as NotificationDispatcher,
      events,
      {
        providerName: (id) => PROVIDERS[id]?.shortName,
        providerManifest: (id) =>
          PROVIDERS[id] ? { id, website: PROVIDERS[id].website } : undefined,
        providerUnitKinds: (id) =>
          providerUnitKinds(PROVIDERS[id] ? { locationKinds: PROVIDERS[id].kinds } : undefined),
        showMainWindow,
        openExternal,
      }
    );
  });

  afterEach(() => db.close());

  describe('booked through the place (contact)', () => {
    it('one category: names it, says to contact the place, and the email gets the contact page', async () => {
      const contactUrl = 'https://parks.rac.example/busselton/contact-us/';
      await service.notifyWatchSplitFound(watchAt('rac', 'RAC Busselton Holiday Park'), [
        contactStay('Powered Site', contactUrl),
      ]);

      expect(lastStored()).toMatchObject({
        providerId: 'rac',
        type: NotificationType.WATCH_FOUND,
        title: 'Free if you move sites at RAC Busselton Holiday Park',
        message:
          `Every night from ${day('2027-07-01')} - ${day('2027-07-06')} is free at RAC Busselton Holiday Park (Powered Site), ` +
          'but not on one site. Contact RAC Busselton Holiday Park to book it as separate stays.',
        relatedType: RelatedType.WATCH,
        relatedId: 21,
        actionUrl: '/watches/21',
      });
      expect(lastDispatched()).toMatchObject({
        title: 'Free if you move sites at RAC Busselton Holiday Park',
        locationName: 'RAC Busselton Holiday Park',
        splitStay: { contact: { label: 'Contact RAC Busselton Holiday Park', url: contactUrl } },
      });
      expect(lastDispatched().bookingUrl).toBeUndefined();
    });

    it('three categories: "A, B and C"; a fourth is "and 1 more"', async () => {
      const watch = watchAt('rac', 'RAC Busselton Holiday Park');
      await service.notifyWatchSplitFound(watch, [
        contactStay('Powered Site'),
        contactStay('Ensuite Site'),
        contactStay('Drive Thru Site'),
      ]);
      expect(lastStored().message).toContain(
        'is free at RAC Busselton Holiday Park (Powered Site, Ensuite Site and Drive Thru Site), but not on one site.'
      );

      await service.notifyWatchSplitFound(watch, [
        contactStay('Powered Site'),
        contactStay('Ensuite Site'),
        contactStay('Drive Thru Site'),
        contactStay('Grass Site'),
      ]);
      expect(lastStored().message).toContain(
        '(Powered Site, Ensuite Site, Drive Thru Site and 1 more)'
      );
    });

    it('with no contact page, says to contact the place and the email has no button', async () => {
      await service.notifyWatchSplitFound(watchAt('rac', 'RAC Busselton Holiday Park'), [
        contactStay('Powered Site'),
      ]);
      expect(lastStored().message).toMatch(/Contact RAC Busselton Holiday Park to book it/);
      expect(lastDispatched().splitStay).toBeUndefined();
    });
  });

  describe('booked a part at a time (separate)', () => {
    const url = (from: string, to: string) =>
      `https://parkstay.example/search?arrival=${from}&departure=${to}`;

    it('2 parts: "Free across 2 sites at …: A for 2 nights, then B for 3 nights. Book each part on ParkStay."', async () => {
      await service.notifyWatchSplitFound(watchAt('parkstay', 'Lucky Bay'), [
        {
          unitKind: 'campsite',
          booking: 'separate',
          units: 2,
          parts: [
            part('CAMPSITE 03', '2027-07-01', '2027-07-03', url('2027-07-01', '2027-07-03')),
            part('CAMPSITE 04', '2027-07-03', '2027-07-06', url('2027-07-03', '2027-07-06')),
          ],
        },
      ]);

      expect(lastStored()).toMatchObject({
        title: 'Free if you move sites at Lucky Bay',
        message:
          `Free across 2 sites at Lucky Bay for ${day('2027-07-01')} - ${day('2027-07-06')}: ` +
          'CAMPSITE 03 for 2 nights, then CAMPSITE 04 for 3 nights. Book each part on ParkStay.',
      });
      expect(lastDispatched().splitStay).toEqual({
        parts: [
          {
            label: `CAMPSITE 03, ${day('2027-07-01')}, 2 nights`,
            url: url('2027-07-01', '2027-07-03'),
          },
          {
            label: `CAMPSITE 04, ${day('2027-07-03')}, 3 nights`,
            url: url('2027-07-03', '2027-07-06'),
          },
        ],
      });
    });

    it('6 parts: the first four, then "and 2 more"; a night is "1 night"', async () => {
      const dates = ['01', '02', '03', '04', '05', '06', '07'].map((d) => `2027-07-${d}`);
      const parts = dates
        .slice(0, 6)
        .map((from, i) => part(`CAMPSITE 0${(i % 2) + 1}`, from, dates[i + 1]));
      await service.notifyWatchSplitFound(
        watchAt('parkstay', 'Lucky Bay', {
          stay: { ...mockWatch.stay, arrival: dates[0], departure: dates[6] },
        }),
        [{ unitKind: 'campsite', booking: 'separate', units: 2, parts }]
      );

      expect(lastStored().message).toBe(
        `Free across 2 sites at Lucky Bay for ${day(dates[0])} - ${day(dates[6])}: ` +
          'CAMPSITE 01 for 1 night, then CAMPSITE 02 for 1 night, then CAMPSITE 01 for 1 night, ' +
          'then CAMPSITE 02 for 1 night, and 2 more. Book each part on ParkStay.'
      );
      // The email lists every part
      expect(lastDispatched().splitStay?.parts).toHaveLength(6);
    });

    it('a reported one with no count reads "Free if you move sites"', async () => {
      await service.notifyWatchSplitFound(watchAt('parkstay', 'Lucky Bay'), [
        {
          unitKind: 'campsite',
          booking: 'separate',
          unitId: 'class:117',
          unitName: 'Campsite',
          parts: [
            part('Campsite', '2027-07-01', '2027-07-02'),
            part('Campsite', '2027-07-02', '2027-07-06'),
          ],
        },
      ]);
      expect(lastStored().message).toMatch(
        /^Free if you move sites at Lucky Bay for .*: Campsite for 1 night, then Campsite for 4 nights\. Book each part on ParkStay\.$/
      );
    });
  });

  it('adds its note, such as that nothing is held automatically', async () => {
    await service.notifyWatchSplitFound(
      watchAt('rac', 'RAC Busselton Holiday Park'),
      [contactStay('Powered Site')],
      "WA Stay doesn't hold these automatically."
    );
    expect(lastStored().message).toMatch(
      /as separate stays\. WA Stay doesn't hold these automatically\.$/
    );
  });

  it.each<[string, Partial<SplitStay>, Partial<Watch>, string]>([
    ['the units it uses', { unitKind: 'cabin' }, {}, 'cabins'],
    ['the watch’s stay types', { unitKind: undefined }, { unitKinds: ['cabin'] }, 'cabins'],
    ['the provider’s default', { unitKind: undefined }, {}, 'sites'],
    ['units of no one kind', { unitKind: 'other' }, {}, 'spots'],
  ])('names units by %s: "%s"', async (_source, split, watch, noun) => {
    await service.notifyWatchSplitFound(watchAt('parkstay', 'Lucky Bay', watch), [
      { ...contactStay('Unit'), ...split },
    ]);
    expect(lastStored().title).toBe(`Free if you move ${noun} at Lucky Bay`);
  });

  it('a cabin-only provider’s split stay is in cabins, its message too', async () => {
    await service.notifyWatchSplitFound(watchAt('cabins', 'Gum Tree Cabins'), [
      {
        booking: 'separate',
        units: 3,
        parts: [
          part('Cabin 1', '2027-07-01', '2027-07-03'),
          part('Cabin 2', '2027-07-03', '2027-07-06'),
        ],
      },
    ]);
    expect(lastStored()).toMatchObject({
      title: 'Free if you move cabins at Gum Tree Cabins',
      message: expect.stringMatching(/^Free across 3 cabins at Gum Tree Cabins for /),
    });
  });

  it('a desktop click opens the watch only: no booking page in the browser', async () => {
    await service.notifyWatchSplitFound(watchAt('rac', 'RAC Busselton Holiday Park'), [
      contactStay('Powered Site', 'https://parks.rac.example/busselton/contact-us/'),
    ]);
    const desktop = mockDesktop[mockDesktop.length - 1];
    expect(desktop.options.title).toBe(
      'RAC · Free if you move sites at RAC Busselton Holiday Park'
    );
    desktop.handlers.get('click')?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(showMainWindow).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith('app:navigate', { path: '/watches/21' });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('drops a link off the provider’s site (logged by origin), keeps the rest, and stores none', async () => {
    await service.notifyWatchSplitFound(watchAt('parkstay', 'Lucky Bay'), [
      {
        booking: 'separate',
        units: 2,
        parts: [
          part('CAMPSITE 03', '2027-07-01', '2027-07-03', 'https://evil.example/pay?card=1'),
          part('CAMPSITE 04', '2027-07-03', '2027-07-06', 'https://parkstay.example/search'),
        ],
      },
    ]);
    expect(lastDispatched().splitStay?.parts).toEqual([
      { label: `CAMPSITE 03, ${day('2027-07-01')}, 2 nights` },
      {
        label: `CAMPSITE 04, ${day('2027-07-03')}, 3 nights`,
        url: 'https://parkstay.example/search',
      },
    ]);
    const warned = mockLog.warn.mock.calls.map(([line]) => String(line)).join('\n');
    expect(warned).toContain('https://evil.example');
    expect(warned).not.toContain('card=1');

    await service.notifyWatchSplitFound(watchAt('rac', 'RAC Busselton Holiday Park'), [
      contactStay('Powered Site', 'http://parks.rac.example/busselton/contact-us/'),
    ]);
    expect(lastDispatched().splitStay).toBeUndefined();

    // Nothing of the links is stored
    const stored = JSON.stringify(db.prepare('SELECT * FROM notifications').all());
    expect(stored).not.toMatch(/https:|http:/);
  });

  it('an unknown provider gets no links, and "the provider’s website" to book each part on', async () => {
    await service.notifyWatchSplitFound(watchAt('gone', 'Somewhere'), [
      {
        booking: 'separate',
        units: 2,
        parts: [
          part('A', '2027-07-01', '2027-07-03', 'https://gone.example/a'),
          part('B', '2027-07-03', '2027-07-06', 'https://gone.example/b'),
        ],
      },
    ]);
    expect(lastStored().message).toMatch(/Book each part on the provider's website\.$/);
    expect(lastDispatched().splitStay?.parts?.every((p) => p.url === undefined)).toBe(true);
  });

  it('sends nothing for no split stays', async () => {
    await service.notifyWatchSplitFound(watchAt('rac', 'RAC Busselton Holiday Park'), []);
    expect(repo.findByUserId(1)).toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
