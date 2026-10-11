/**
 * @jest-environment node
 *
 * NotificationService (B2): OS notifications show the WA Stay icon from `getBrandIconPath`,
 * and the messages it dispatches to notifiers (email) name the provider and the location.
 */
import { NotificationService } from '@main/core/notifications/notification.service';
import type { NotificationDispatcher } from '@main/core/notifications/notification-dispatcher';
import { NotificationRepository } from '@main/database/repositories';
import { NotificationType } from '@shared/types/common.types';
import { insertUser, TestDatabaseHelper } from '@tests/utils/database-helper';
import { mockUserInput } from '@tests/fixtures/users';
import { mockWatch } from '@tests/fixtures/watches';
import { mockSiteSnipe } from '@tests/fixtures/site-sniper';

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

describe('NotificationService branding', () => {
  let dbHelper: TestDatabaseHelper;
  let userId: number;
  let dispatch: jest.Mock;
  let service: NotificationService;

  beforeEach(async () => {
    dbHelper = new TestDatabaseHelper('notification-branding');
    await dbHelper.setup();
    userId = insertUser(dbHelper.getDb(), mockUserInput.email).id;

    dispatch = jest.fn(async () => []);
    service = new NotificationService(new NotificationRepository(dbHelper.getDb()), {
      dispatch,
    } as unknown as NotificationDispatcher);
    mockNotification.mockClear();
  });

  afterEach(async () => {
    await dbHelper.teardown();
  });

  it('shows OS notifications with the WA Stay icon', async () => {
    await service.notify({ userId, type: NotificationType.INFO, title: 'Hello', message: 'x' });

    expect(mockNotification).toHaveBeenCalledTimes(1);
    expect(mockNotification.mock.calls[0][0]).toMatchObject({
      title: 'Hello',
      icon: '/brand/icons/icon.png',
    });
  });

  it('dispatches watch and snipe notifications with their provider and location', async () => {
    const watch = { ...mockWatch, userId };
    const snipe = { ...mockSiteSnipe, userId };

    await service.notifyWatchFound(watch, [{}]);
    await service.notifySnipeHeld(snipe);
    await service.notifySnipeBooked(snipe);

    expect(dispatch.mock.calls.map(([message]) => message)).toEqual([
      expect.objectContaining({ providerId: 'parkstay', locationName: watch.location.name }),
      expect.objectContaining({ providerId: 'parkstay', locationName: snipe.location.name }),
      expect.objectContaining({ providerId: 'parkstay', locationName: snipe.location.name }),
    ]);
  });

  it('dispatches app-wide notifications without a provider', async () => {
    await service.notifyInfo(userId, 'Update ready', 'Restart to update');

    expect(dispatch).toHaveBeenCalledTimes(1);
    const [message] = dispatch.mock.calls[0];
    expect(message).toMatchObject({ title: 'Update ready', message: 'Restart to update' });
    expect(message.providerId).toBeUndefined();
    expect(message.locationName).toBeUndefined();
  });
});
