/**
 * @jest-environment node
 *
 * Notifications name their provider (V4; architecture-notes §12.31): watch, snipe and booking
 * notifications store `providerId` and an unprefixed title; only the OS desktop notification
 * title is prefixed with the provider's short name (`Fake · Sites available at Dales
 * Campground`), resolved through the registry; notifiers get the unprefixed title plus
 * `providerId`. Titles are calm sentence case naming the place (U5).
 */
import { desktopTitle, NotificationService } from '@main/core/notifications/notification.service';
import type { NotificationDispatcher } from '@main/core/notifications/notification-dispatcher';
import { openDatabase } from '@main/database/connection';
import { NotificationRepository } from '@main/database/repositories';
import { ProviderRegistry } from '@main/providers/registry';
import { NotificationType } from '@shared/types/common.types';
import type { Watch } from '@shared/types';
import { mockWatch } from '@tests/fixtures/watches';
import { mockSiteSnipe } from '@tests/fixtures/site-sniper';
import { createFakeProvider, createTestProviderContext } from '@tests/utils/fake-provider';
import type Database from 'better-sqlite3';

const mockNotification = jest.fn((_options: Record<string, unknown>) => ({
  on: jest.fn(),
  show: jest.fn(),
}));
jest.mock('electron', () => ({
  Notification: function Notification(options: Record<string, unknown>) {
    return mockNotification(options);
  },
}));
jest.mock('@main/app/paths', () => ({ getBrandIconPath: () => '/brand/icons/icon.png' }));

describe('notifications carry their provider', () => {
  let db: Database.Database;
  let repo: NotificationRepository;
  let dispatch: jest.Mock;
  let service: NotificationService;
  const userId = 1;

  beforeEach(() => {
    db = openDatabase(':memory:');
    repo = new NotificationRepository(db);
    const registry = new ProviderRegistry();
    const fake = createFakeProvider();
    registry.register(fake.factory, createTestProviderContext(fake.manifest));
    dispatch = jest.fn(async () => []);
    service = new NotificationService(
      repo,
      { dispatch } as unknown as NotificationDispatcher,
      undefined,
      { providerName: (id) => registry.tryGet(id)?.manifest.shortName }
    );
    mockNotification.mockClear();
  });

  afterEach(() => db.close());

  const fakeWatch: Watch = { ...mockWatch, providerId: 'fake', userId };
  const fakeSnipe = { ...mockSiteSnipe, providerId: 'fake', userId };

  it('watch, snipe and booking notifications store providerId with an unprefixed title, and the desktop title is "Fake · <title>"', async () => {
    await service.notifyWatchFound(fakeWatch, [
      {
        unitId: 'u1',
        unitName: 'Site u1',
        arrival: fakeWatch.stay.arrival,
        departure: fakeWatch.stay.departure,
        partial: false,
        priceKnown: true,
        total: 60,
      },
    ]);
    await service.notifyWatchHeld(
      fakeWatch,
      {
        reference: 'FAKE-1',
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        unitId: 'u1',
        paymentUrl: 'https://fake.example/pay/FAKE-1',
      },
      'Site u1'
    );
    await service.notifySnipeHeld(fakeSnipe);
    await service.notifySnipeBooked({ ...fakeSnipe, bookedReference: 'FAKE-6' });
    await service.notifyBookingConfirmed({
      id: 7,
      userId,
      providerId: 'fake',
      bookingReference: 'FAKE-7',
      location: { externalId: '20', name: 'Bungarra' },
    });

    const stored = repo.findByUserId(userId).sort((a, b) => a.id - b.id);
    expect(stored.map((n) => [n.providerId, n.title])).toEqual([
      ['fake', 'Sites available at Dales Campground'],
      ['fake', 'Site held at Dales Campground'],
      ['fake', 'Site held at Osprey Bay'],
      ['fake', 'Booked at Osprey Bay'],
      ['fake', 'Booking confirmed at Bungarra'],
    ]);
    expect(stored[1]).toMatchObject({
      type: NotificationType.SNIPE_HELD,
      relatedType: 'watch',
      relatedId: fakeWatch.id,
    });
    expect(stored[4]).toMatchObject({
      type: NotificationType.BOOKING_CONFIRMED,
      relatedType: 'booking',
      relatedId: 7,
      actionUrl: '/bookings/7',
    });
    expect(mockNotification.mock.calls.map(([options]) => options.title)).toEqual([
      'Fake · Sites available at Dales Campground',
      'Fake · Site held at Dales Campground',
      'Fake · Site held at Osprey Bay',
      'Fake · Booked at Osprey Bay',
      'Fake · Booking confirmed at Bungarra',
    ]);
  });

  it('notifiers get the unprefixed title and the providerId', async () => {
    await service.notifySnipeHeld(fakeSnipe);

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Site held at Osprey Bay', providerId: 'fake' })
    );
  });

  it("words a hold's minutes left from the injected clock", async () => {
    const at = new Date('2026-10-04T02:00:00.000Z');
    const clocked = new NotificationService(repo, undefined, undefined, { clock: () => at });
    await clocked.notifyWatchHeld(
      fakeWatch,
      {
        reference: 'FAKE-2',
        expiresAt: new Date(at.getTime() + 25 * 60_000).toISOString(),
        unitId: 'u1',
        paymentUrl: 'https://fake.example/pay/FAKE-2',
      },
      'Site u1'
    );
    expect(repo.findByUserId(userId)[0].message).toContain('within 25 minutes');
  });

  it('app-wide notifications and unknown providers keep the plain desktop title', async () => {
    await service.notifyInfo(userId, 'Update ready', 'Restart to update');
    expect(mockNotification.mock.calls[0][0].title).toBe('Update ready');
    expect(desktopTitle({ title: 'Hi', providerId: 'gone' }, () => undefined)).toBe('Hi');
  });
});
