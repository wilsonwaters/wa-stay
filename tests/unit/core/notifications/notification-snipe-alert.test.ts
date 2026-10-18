/**
 * @jest-environment node
 *
 * A snipe's alert (R12, `notifySnipeAlert`) and a held snipe's notification (brief R7):
 * - the alert is stored with its `providerId`, the type `snipe_alert` and an unprefixed title
 *   "A {noun} is free at {place}"; the desktop title is "Fake · …";
 * - its message gives the unit, the dates and the note, and never says held, secured or
 *   reserved;
 * - a desktop click opens the snipe in the app (`/site-sniper/:id`), then the booking page in
 *   the browser through the shell port; the email dispatch carries the link ("Book on Fake");
 *   a link off the provider's site is dropped;
 * - a held snipe's email says the hold is in WA Stay on the computer and gives the public link,
 *   and its desktop click opens the snipe only.
 */
import type Mail from 'nodemailer/lib/mailer';
import { NotificationService } from '@main/core/notifications/notification.service';
import type { NotificationDispatcher } from '@main/core/notifications/notification-dispatcher';
import { SmtpEmailNotifier } from '@main/core/notifications/notifiers/email-smtp.notifier';
import { openDatabase } from '@main/database/connection';
import { NotificationRepository } from '@main/database/repositories';
import { ProviderRegistry } from '@main/providers/registry';
import type { NotificationMessage, SiteSnipe } from '@shared/types';
import {
  NotificationType,
  RelatedType,
  SnipeResult,
  SnipeStatus,
} from '@shared/types/common.types';
import { providerUnitKinds } from '@shared/utils/unit-noun';
import { mockSiteSnipe } from '@tests/fixtures/site-sniper';
import { createFakeProvider, createTestProviderContext } from '@tests/utils/fake-provider';
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

const mockSendMail = jest.fn(async (_options: Mail.Options) => ({ messageId: 'message-1' }));
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail: mockSendMail, verify: jest.fn() })) },
}));

const BOOKING_URL = 'https://book.fake.example/1/u1?arrival=2026-12-01&departure=2026-12-03';
const NOT_HELD = /\b(held|hold|holds|secured?|reserved?)\b/i;

describe('snipe alert notifications', () => {
  let db: Database.Database;
  let repo: NotificationRepository;
  let registry: ProviderRegistry;
  let events: { emit: jest.Mock };
  let dispatch: jest.Mock<Promise<[]>, [NotificationMessage]>;
  let openExternal: jest.Mock<Promise<void>, [string]>;
  let service: NotificationService;

  const alerted = (overrides: Partial<SiteSnipe> = {}): SiteSnipe => ({
    ...mockSiteSnipe,
    id: 7,
    userId: 1,
    providerId: 'fake',
    locationKey: 'fake:1',
    location: { externalId: '1', name: 'Banksia Camp' },
    stay: { ...mockSiteSnipe.stay, arrival: '2026-12-01', departure: '2026-12-03' },
    unitIds: [],
    unitKinds: [],
    action: 'alert',
    status: SnipeStatus.ALERTED,
    isActive: false,
    lastResult: SnipeResult.ALERTED,
    alert: {
      at: new Date('2026-10-04T16:00:20.000Z'),
      unitId: 'u1',
      unitName: 'Site u1',
      bookingUrl: BOOKING_URL,
    },
    ...overrides,
  });
  const lastDesktop = () => mockDesktop[mockDesktop.length - 1];
  const click = () => lastDesktop().handlers.get('click')?.();
  const navigations = () => events.emit.mock.calls.filter(([name]) => name === 'app:navigate');
  const dispatched = (): NotificationMessage => dispatch.mock.calls[0][0];
  const dates = (arrival: string, departure: string) =>
    [arrival, departure].map((d) =>
      new Date(`${d}T00:00:00.000Z`).toLocaleDateString(undefined, { timeZone: 'UTC' })
    );

  /** The email the SMTP notifier would send for what was dispatched. */
  async function email(message: NotificationMessage): Promise<Mail.Options> {
    const notifier = new SmtpEmailNotifier({
      providerName: (id) => registry.tryGet(id)?.manifest.shortName,
    });
    notifier.configure({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'me@example.com', pass: 'app-password' },
    });
    await notifier.send(message);
    return mockSendMail.mock.calls[mockSendMail.mock.calls.length - 1][0];
  }

  beforeEach(() => {
    mockDesktop.length = 0;
    mockSendMail.mockClear();
    db = openDatabase(':memory:');
    repo = new NotificationRepository(db);
    registry = new ProviderRegistry();
    // Holds off: the provider an alert snipe is for
    const fake = createFakeProvider({ capabilities: { holds: false } });
    registry.register(fake.factory, createTestProviderContext(fake.manifest));
    events = { emit: jest.fn() };
    dispatch = jest.fn(async () => [] as []);
    openExternal = jest.fn(() => Promise.resolve());
    service = new NotificationService(
      repo,
      { dispatch } as unknown as NotificationDispatcher,
      events,
      {
        providerName: (id) => registry.tryGet(id)?.manifest.shortName,
        providerManifest: (id) => registry.tryGet(id)?.manifest,
        providerUnitKinds: (id) => providerUnitKinds(registry.tryGet(id)?.manifest),
        showMainWindow: () => true,
        openExternal,
      }
    );
  });

  afterEach(async () => {
    await registry.disposeAll();
    db.close();
  });

  it('stores providerId, the type snipe_alert and an unprefixed title; the desktop title is "Fake · …"', async () => {
    await service.notifySnipeAlert(alerted());

    const [arrival, departure] = dates('2026-12-01', '2026-12-03');
    const [stored] = repo.findByUserId(1);
    expect(stored).toMatchObject({
      providerId: 'fake',
      type: NotificationType.SNIPE_ALERT,
      title: 'A site is free at Banksia Camp',
      message: `Site u1 is free at Banksia Camp for ${arrival}–${departure}.`,
      relatedType: RelatedType.SNIPE,
      relatedId: 7,
      actionUrl: '/site-sniper/7',
    });
    expect(lastDesktop().options.title).toBe('Fake · A site is free at Banksia Camp');
    expect(lastDesktop().options.body).toBe(stored.message);
    expect(events.emit).toHaveBeenCalledWith('notification:created', stored);
  });

  it('names the free unit by its kind, "spot" when its kinds are mixed, and adds the note', async () => {
    await service.notifySnipeAlert(alerted(), 'cabin');
    await service.notifySnipeAlert(
      alerted({
        unitKinds: ['campsite', 'cabin'],
        alert: { at: new Date(), unitId: 'class:4', note: 'A note for the person.' },
      })
    );

    const all = repo.findByUserId(1);
    const cabin = all.find((n) => n.message.startsWith('Site u1'))!;
    const mixed = all.find((n) => n.message.startsWith('A spot'))!;
    expect(cabin.title).toBe('A cabin is free at Banksia Camp');
    expect(mixed.title).toBe('A spot is free at Banksia Camp');
    expect(mixed.message).toMatch(
      /^A spot is free at Banksia Camp for .+\. A note for the person\.$/
    );
  });

  it('never says held, secured or reserved, even with either note', async () => {
    for (const note of [
      undefined,
      'Automatic holds are off for Fake, so Site Sniper alerted you instead.',
      'The units this snipe could hold are of more than one stay type: choose one stay type or units for it.',
    ]) {
      await service.notifySnipeAlert(
        alerted({ alert: { at: new Date(), unitId: 'u1', unitName: 'Site u1', note } })
      );
    }
    for (const n of repo.findByUserId(1)) {
      expect(n.title).not.toMatch(NOT_HELD);
      // The notes name automatic holds, never something held, secured or reserved
      expect(n.message.replace(/automatic holds|could hold/gi, '')).not.toMatch(NOT_HELD);
    }
  });

  it('a desktop click opens the snipe in the app, then the booking page through the shell port', async () => {
    await service.notifySnipeAlert(alerted());
    click();

    expect(navigations()).toEqual([['app:navigate', { path: '/site-sniper/7' }]]);
    await Promise.resolve();
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith(BOOKING_URL);
  });

  it('the email dispatch carries the link, and the email says "Book on Fake"', async () => {
    await service.notifySnipeAlert(alerted());

    expect(dispatched()).toMatchObject({
      title: 'A site is free at Banksia Camp',
      type: NotificationType.SNIPE_ALERT,
      providerId: 'fake',
      actionUrl: '/site-sniper/7',
      locationName: 'Banksia Camp',
      bookingUrl: BOOKING_URL,
    });
    expect(dispatched()).not.toHaveProperty('heldInApp');

    const mail = await email(dispatched());
    expect(mail.subject).toBe('WA Stay: A site is free at Banksia Camp · Fake');
    expect(mail.text).toContain(`Book on Fake: ${BOOKING_URL}`);
    expect(String(mail.text)).not.toMatch(/This hold is in WA Stay/);
    expect(String(mail.html)).toContain('Book on Fake');
  });

  it('without a link (none, or one off the provider’s site) a click opens only the snipe, and the email has no "Book on"', async () => {
    await service.notifySnipeAlert(
      alerted({ alert: { at: new Date(), unitId: 'u1', unitName: 'Site u1' } })
    );
    await service.notifySnipeAlert(
      alerted({
        alert: { at: new Date(), unitId: 'u1', bookingUrl: 'https://evil.example/book/1' },
      })
    );

    for (const desktop of mockDesktop) desktop.handlers.get('click')?.();
    await Promise.resolve();
    expect(navigations()).toHaveLength(2);
    expect(openExternal).not.toHaveBeenCalled();
    for (const [message] of dispatch.mock.calls) {
      expect(message).not.toHaveProperty('bookingUrl');
      expect(String((await email(message)).text)).not.toContain('Book on');
    }
  });

  describe('an Open Day plan’s reminders (§12.38)', () => {
    const planned = (id: number, name: string): SiteSnipe =>
      alerted({
        id,
        action: 'remind',
        status: SnipeStatus.ARMED,
        isActive: true,
        lastResult: undefined,
        alert: undefined,
        location: { externalId: String(id), name },
      });
    const step = { title: 'Open Day tomorrow', body: 'The waiting room opens at 6 am.' };

    it('one plan: the provider’s words and the plan, typed snipe_reminder; a click opens the plan, then the page', async () => {
      await service.notifySnipeReminders([
        { snipe: planned(7, 'Banksia Camp'), step, bookingUrl: BOOKING_URL },
      ]);
      const [stored] = repo.findByUserId(1);
      const [arrival, departure] = dates('2026-12-01', '2026-12-03');
      expect(stored).toMatchObject({
        type: NotificationType.SNIPE_REMINDER,
        providerId: 'fake',
        title: 'Open Day tomorrow',
        message: `The waiting room opens at 6 am. Your plan: Banksia Camp, ${arrival}–${departure}.`,
        relatedType: RelatedType.SNIPE,
        relatedId: 7,
      });
      expect(lastDesktop().options.title).toBe('Fake · Open Day tomorrow');
      click();
      expect(navigations()).toEqual([['app:navigate', { path: '/site-sniper/7' }]]);
      await Promise.resolve();
      expect(openExternal).toHaveBeenCalledWith(BOOKING_URL);
      expect(dispatched()).toMatchObject({ locationName: 'Banksia Camp', bookingUrl: BOOKING_URL });
      // Nothing was checked: it never says anything is free, found or held
      expect(stored.message).not.toMatch(/\b(free|found|held|secured)\b/i);
    });

    it('several plans due together: one notification naming each, opening the first', async () => {
      await service.notifySnipeReminders([
        { snipe: planned(7, 'Banksia Camp'), step, bookingUrl: BOOKING_URL },
        { snipe: planned(8, 'Lucky Bay'), step },
      ]);
      const all = repo.findByUserId(1);
      expect(all).toHaveLength(1);
      expect(all[0].message).toMatch(
        /^The waiting room opens at 6 am\. Your plans: Banksia Camp, .+; Lucky Bay, .+\.$/
      );
      expect(dispatched().locationName).toBeUndefined();
      click();
      expect(navigations()).toEqual([['app:navigate', { path: '/site-sniper/7' }]]);
    });

    it('nothing to send, nothing sent', async () => {
      await service.notifySnipeReminders([]);
      expect(repo.findByUserId(1)).toEqual([]);
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  describe('a held snipe (brief R7)', () => {
    const held = (): SiteSnipe =>
      alerted({
        action: 'hold',
        status: SnipeStatus.HELD,
        lastResult: SnipeResult.HELD,
        alert: undefined,
        holdReference: 'FAKE-1',
        holdExpiresAt: new Date(Date.now() + 30 * 60_000),
        holdUnitId: 'u1',
      });

    it('its email says the hold is in WA Stay on the computer and gives the public link', async () => {
      await service.notifySnipeHeld(held(), undefined, BOOKING_URL);

      expect(dispatched()).toMatchObject({
        type: NotificationType.SNIPE_HELD,
        bookingUrl: BOOKING_URL,
        heldInApp: true,
      });
      const mail = await email(dispatched());
      const text = String(mail.text);
      expect(text).toContain(
        'This hold is in WA Stay on the computer that placed it. Open WA Stay there to pay before it expires.'
      );
      expect(text).toContain('Away from that computer? You can book on Fake instead.');
      expect(text).toContain(`Book on Fake: ${BOOKING_URL}`);
    });

    it('its desktop click opens the snipe only', async () => {
      await service.notifySnipeHeld(held(), undefined, BOOKING_URL);
      click();
      await Promise.resolve();

      expect(navigations()).toEqual([['app:navigate', { path: '/site-sniper/7' }]]);
      expect(openExternal).not.toHaveBeenCalled();
    });

    it('without a link its email still says where the hold is', async () => {
      await service.notifySnipeHeld(held());

      expect(dispatched()).toMatchObject({ heldInApp: true });
      expect(dispatched()).not.toHaveProperty('bookingUrl');
      const text = String((await email(dispatched())).text);
      expect(text).toContain('This hold is in WA Stay on the computer that placed it.');
      expect(text).not.toContain('Book on');
    });
  });
});
