/**
 * The rewired WatchService against the real ParkStay module and a fixture server: real
 * nightly prices from Bungarra's live sample, and partial matches from the same single
 * availability request. And the alert end to end (R7): a found ParkStay watch emails
 * ParkStay's public booking page, through the real notification service, dispatcher and SMTP
 * notifier (nodemailer's transport replaced), storing and logging nothing of it.
 */

import type Database from 'better-sqlite3';
import type Mail from 'nodemailer/lib/mailer';
import { NotificationDispatcher } from '@main/core/notifications/notification-dispatcher';
import { NotificationService } from '@main/core/notifications/notification.service';
import { SmtpEmailNotifier } from '@main/core/notifications/notifiers/email-smtp.notifier';
import { openDatabase } from '@main/database/connection';
import {
  NotificationRepository,
  NotifierRepository,
  WatchRepository,
} from '@main/database/repositories';
import { insertUser } from '@tests/utils/database-helper';
import { NightGuard } from '@main/core/holds/night-guard';
import { WatchService } from '@main/core/watches/watch.service';
import { SiteSniperRepository } from '@main/database/repositories';
import { WatchResult } from '@shared/types/common.types';
import { NotifierChannel, type WatchInput } from '@shared/types';
import { FIXED_NOW } from '@tests/utils/fake-provider';
import { testVault } from '@tests/utils/fake-safe-storage';
import {
  parkStayFixture,
  startParkStayFixtureServer,
  type ParkStayFixtureServer,
} from '@tests/utils/parkstay-fixture-server';
import {
  createTestParkStay,
  LUCKY_BAY_CLASS,
  LUCKY_BAY_STAY,
  luckyBayView,
} from '@tests/utils/parkstay-provider';

const mockSendMail = jest.fn(async (_options: Mail.Options) => ({ messageId: 'message-1' }));
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail: mockSendMail, verify: jest.fn() })) },
}));

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

// Only `Date` is faked (2 Oct 2026), so the fixture's November stay is in the future.
const REAL_TIMERS = [
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
] as const;

describe('WatchService on ParkStay (fixture server)', () => {
  let server: ParkStayFixtureServer;
  let db: Database.Database;
  let notifications: { notifyWatchFound: jest.Mock; notifyWatchPartialFound: jest.Mock };
  let service: WatchService;
  let userId: number;

  beforeAll(async () => {
    server = await startParkStayFixtureServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    jest.useFakeTimers({ now: FIXED_NOW, doNotFake: [...REAL_TIMERS] });
    server.requests.length = 0;
    server.views.clear();
    db = openDatabase(':memory:');
    userId = insertUser(db, 'me@example.com').id;
    notifications = {
      notifyWatchFound: jest.fn().mockResolvedValue(undefined),
      notifyWatchPartialFound: jest.fn().mockResolvedValue(undefined),
    };
    const watches = new WatchRepository(db);
    service = new WatchService({
      watches,
      providers: createTestParkStay(server).registry,
      notifications: { ...notifications, notifyWatchHeld: jest.fn() },
      nightGuard: new NightGuard(new SiteSniperRepository(db), watches),
    });
  });

  afterEach(() => {
    db.close();
    jest.useRealTimers();
  });

  const bungarra = (overrides: Partial<WatchInput> = {}): WatchInput => ({
    providerId: 'parkstay',
    name: 'Bungarra',
    location: { externalId: '20', name: 'Bungarra', areaName: 'Cape Range National Park' },
    stay: { arrival: '2026-11-10', departure: '2026-11-12', adults: 1 },
    stayParams: { gearType: 'all' },
    ...overrides,
  });

  it('finds the free sites with their real nightly price ($30, not 0)', async () => {
    const watch = await service.create(userId, bungarra());

    const result = await service.execute(watch.id);

    expect(result.found).toBe(true);
    expect(result.matches).toEqual(
      ['3', '4', '5'].map((id) => ({
        unitId: id,
        unitName: `CAMPSITE 0${id}`,
        arrival: '2026-11-10',
        departure: '2026-11-12',
        partial: false,
        priceKnown: true,
        total: 60,
      }))
    );
    expect(server.requestsTo('/api/campsite_availablity_view/20/')).toHaveLength(1);
    expect((await service.get(watch.id))?.lastResult).toBe(WatchResult.FOUND);
  });

  describe('at Lucky Bay, listed by site class (#21)', () => {
    const luckyBay = (unitIds: string[]): WatchInput => ({
      providerId: 'parkstay',
      name: 'Lucky Bay',
      location: { externalId: '43', name: 'Lucky Bay (Cape Le Grand)' },
      stay: LUCKY_BAY_STAY,
      stayParams: { gearType: 'all' },
      unitIds,
    });

    beforeEach(() => {
      // A site is free for the whole stay; the view names site 330.
      server.views.set('43', luckyBayView(330));
    });

    it.each([
      ['the class unit id', LUCKY_BAY_CLASS],
      ['a site id kept from before #21 that no view named', '350'],
      ['the site id an earlier view named', '309'],
    ])('a watch on %s finds the class free', async (_name, unitId) => {
      const watch = await service.create(userId, luckyBay([unitId]));

      const result = await service.execute(watch.id);

      expect(result.found).toBe(true);
      expect(result.matches).toEqual([
        expect.objectContaining({ unitId: LUCKY_BAY_CLASS, partial: false, total: 60 }),
      ]);
      // The watch's ids reach the provider, which recognises them without filtering.
      const [check] = server.requestsTo('/api/campsite_availablity_view/43/');
      expect(check.query.get('arrival')).toBe('2026/11/06');
    });

    it('a watch on a site id still finds nothing while no site is free for the stay', async () => {
      server.views.set('43', luckyBayView());
      const watch = await service.create(userId, luckyBay(['309']));
      expect((await service.execute(watch.id)).found).toBe(false);
    });
  });

  it('applies the price limit to the real prices', async () => {
    const watch = await service.create(userId, bungarra({ maxPrice: 25 }));
    expect((await service.execute(watch.id)).found).toBe(false);
  });

  it('reports partial matches from the same single request', async () => {
    // Site 1 is free on the first night only; the others are booked both nights.
    const view = parkStayFixture('campsite_availablity_view_20.json');
    const free = [true, '$30.00', '30.00', null, null, '2026-11-10'];
    const booked = (date: string) => [false, 'Unavailable', '30.00', null, null, date];
    server.views.set('20', {
      ...view,
      sites: view.sites.map((site: { id: number }) => ({
        ...site,
        availability:
          site.id === 1
            ? [free, booked('2026-11-11')]
            : [booked('2026-11-10'), booked('2026-11-11')],
      })),
    });
    const watch = await service.create(userId, bungarra({ allowPartialMatch: true }));

    const result = await service.execute(watch.id);

    expect(result.found).toBe(true);
    expect(result.matches).toEqual([
      {
        unitId: '1',
        unitName: 'CAMPSITE 01',
        arrival: '2026-11-10',
        departure: '2026-11-11',
        partial: true,
        priceKnown: true,
        total: 30,
      },
    ]);
    expect(server.requestsTo('/api/campsite_availablity_view/20/')).toHaveLength(1);
    expect(notifications.notifyWatchPartialFound).toHaveBeenCalledTimes(1);
    expect((await service.get(watch.id))?.lastResult).toBe(WatchResult.PARTIAL_FOUND);
  });

  describe('the alert email (R7)', () => {
    /** ParkStay's public search page for Bungarra and the stay, as `parkstay/links.ts` builds it. */
    const BOOKING_URL =
      'https://parkstay.dbca.wa.gov.au/search-availability/information/?campground_id=20&arrival=2026/11/10&departure=2026/11/12';

    it('a found ParkStay watch emails its booking page, in the HTML and the text, and stores none of it', async () => {
      mockSendMail.mockClear();
      for (const level of ['info', 'warn', 'error', 'debug']) mockLog[level].mockClear();
      const parkstay = createTestParkStay(server);
      const providerName = (id: string) => parkstay.registry.tryGet(id)?.manifest.shortName;
      const dispatcher = new NotificationDispatcher(new NotifierRepository(db, testVault().vault), [
        new SmtpEmailNotifier({ providerName }),
      ]);
      dispatcher.configureNotifier(
        NotifierChannel.EMAIL_SMTP,
        {
          host: 'smtp.example.com',
          port: 587,
          secure: false,
          auth: { user: 'me@example.com', pass: 'pw' },
        },
        true
      );
      const notifier = new NotificationService(
        new NotificationRepository(db),
        dispatcher,
        undefined,
        {
          providerName,
          providerManifest: (id) => parkstay.registry.tryGet(id)?.manifest,
          preferences: () => ({ desktop: false, sound: false }),
        }
      );
      const watches = new WatchRepository(db);
      const emailing = new WatchService({
        watches,
        providers: parkstay.registry,
        notifications: notifier,
        nightGuard: new NightGuard(new SiteSniperRepository(db), watches),
      });
      const watch = await emailing.create(userId, bungarra());

      expect((await emailing.execute(watch.id)).found).toBe(true);

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const mail = mockSendMail.mock.calls[0][0];
      expect(mail.subject).toBe('WA Stay: Sites available at Bungarra · ParkStay');
      expect(mail.text).toContain(`Book on ParkStay: ${BOOKING_URL}`);
      expect(String(mail.html)).toContain(`href="${BOOKING_URL.replaceAll('&', '&amp;')}"`);
      expect(String(mail.html).replaceAll('&amp;', '&')).toContain(BOOKING_URL);
      expect(mail.html).toMatch(/>Book on ParkStay<\/a>/);
      // The watch's page has the same link
      expect((await emailing.get(watch.id))?.bookingLink).toEqual({
        url: BOOKING_URL,
        arrival: '2026-11-10',
        departure: '2026-11-12',
      });

      // Nothing new is stored: no booking URL in the notification or its delivery log
      const stored = JSON.stringify([
        db.prepare('SELECT * FROM notifications').all(),
        db.prepare('SELECT * FROM notification_delivery_logs').all(),
      ]);
      expect(db.prepare('SELECT COUNT(*) AS n FROM notification_delivery_logs').get()).toEqual({
        n: 1,
      });
      expect(stored).not.toMatch(/search-availability|campground_id/);
      // And no log line carries its path or query
      const logged = JSON.stringify([
        ['info', 'warn', 'error', 'debug'].map((level) => mockLog[level].mock.calls),
        parkstay.logger,
      ]);
      expect(logged).not.toMatch(/search-availability|campground_id/);
    });
  });
});
