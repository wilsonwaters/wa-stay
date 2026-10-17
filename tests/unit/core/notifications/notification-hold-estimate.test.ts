/**
 * @jest-environment node
 *
 * A hold whose expiry is the provider's guess (R18, `HoldSuccess.expiresAtEstimated`) is
 * "about" in its held notification and its email: "Complete payment within about 10 minutes."
 * An exact expiry keeps today's words. The email is the real SMTP notifier's, given what the
 * service dispatches (nodemailer's transport replaced).
 */
import type Mail from 'nodemailer/lib/mailer';
import { NotificationService } from '@main/core/notifications/notification.service';
import type { NotificationDispatcher } from '@main/core/notifications/notification-dispatcher';
import { SmtpEmailNotifier } from '@main/core/notifications/notifiers/email-smtp.notifier';
import { openDatabase } from '@main/database/connection';
import { NotificationRepository } from '@main/database/repositories';
import type { NotificationMessage, SiteSnipe, Watch, WatchHold } from '@shared/types';
import { mockSiteSnipe } from '@tests/fixtures/site-sniper';
import { mockWatch } from '@tests/fixtures/watches';
import type Database from 'better-sqlite3';

const mockSendMail = jest.fn(async (_options: Mail.Options) => ({ messageId: 'message-1' }));
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(() => ({ sendMail: mockSendMail, verify: jest.fn() })),
  },
}));
jest.mock('electron', () => ({
  Notification: function Notification() {
    return { on: jest.fn(), show: jest.fn() };
  },
}));
jest.mock('@main/app/paths', () => ({ getBrandIconPath: () => '/brand/icons/icon.png' }));

const NOW = new Date('2026-11-20T02:00:00.000Z');
const IN_10_MINUTES = new Date(NOW.getTime() + 10 * 60_000);

describe('held notifications with an estimated expiry', () => {
  let db: Database.Database;
  let service: NotificationService;
  let dispatched: NotificationMessage[];

  beforeEach(() => {
    db = openDatabase(':memory:');
    mockSendMail.mockClear();
    dispatched = [];
    const email = new SmtpEmailNotifier({ providerName: () => 'ParkStay' });
    email.configure({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'me@example.com', pass: 'app-password' },
    });
    const dispatcher = {
      dispatch: async (message: NotificationMessage) => {
        dispatched.push(message);
        await email.send(message);
        return [];
      },
    } as unknown as NotificationDispatcher;
    service = new NotificationService(new NotificationRepository(db), dispatcher, undefined, {
      clock: () => NOW,
      preferences: () => ({ desktop: false, sound: false }),
    });
  });

  afterEach(() => db.close());

  const watch: Watch = { ...mockWatch, userId: 1 };
  const hold = (expiresEstimated?: boolean): WatchHold => ({
    reference: 'H-1',
    expiresAt: IN_10_MINUTES.toISOString(),
    ...(expiresEstimated ? { expiresEstimated } : {}),
    unitId: '12',
    paymentUrl: 'https://parkstay.dbca.wa.gov.au/booking/',
  });
  const snipe = (holdExpiresEstimated?: boolean): SiteSnipe => ({
    ...mockSiteSnipe,
    userId: 1,
    holdExpiresAt: IN_10_MINUTES,
    ...(holdExpiresEstimated ? { holdExpiresEstimated } : {}),
  });
  const email = () => mockSendMail.mock.calls[0][0];

  it('a watch hold: "within about 10 minutes" in the notification and its email', async () => {
    await service.notifyWatchHeld(watch, hold(true), { unitName: 'Site 12' });

    expect(dispatched[0].message).toMatch(/\. Complete payment within about 10 minutes\.$/);
    expect(String(email().text)).toContain('Complete payment within about 10 minutes.');
    expect(String(email().html)).toContain('Complete payment within about 10 minutes.');
  });

  it('a snipe hold: "within about 10 minutes" in the notification and its email', async () => {
    await service.notifySnipeHeld(snipe(true));

    expect(dispatched[0].message).toMatch(/\. Complete payment within about 10 minutes\.$/);
    expect(String(email().text)).toContain('Complete payment within about 10 minutes.');
    expect(String(email().html)).toContain('Complete payment within about 10 minutes.');
  });

  it('an exact expiry keeps the words it had', async () => {
    await service.notifyWatchHeld(watch, hold(), { unitName: 'Site 12' });
    await service.notifySnipeHeld(snipe());

    for (const { message } of dispatched) {
      expect(message).toMatch(/\. Complete payment within 10 minutes\.$/);
    }
    expect(mockSendMail.mock.calls.map(([mail]) => String(mail.text))).toEqual([
      expect.not.stringContaining('about'),
      expect.not.stringContaining('about'),
    ]);
  });
});
