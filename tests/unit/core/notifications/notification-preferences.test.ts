/**
 * @jest-environment node
 *
 * Settings → Notifications in main (U4): `NotificationService` reads the person's preferences
 * on every notification. Desktop off shows no OS notification (the in-app list, the event and
 * email are unaffected); sound off makes the OS notification silent. The container reads the
 * stored `notifications.desktop` and `notifications.sound` settings, with their defaults.
 */
import {
  NotificationService,
  type NotificationPreferences,
} from '@main/core/notifications/notification.service';
import type { NotificationDispatcher } from '@main/core/notifications/notification-dispatcher';
import { NotificationRepository } from '@main/database/repositories';
import { openDatabase } from '@main/database/connection';
import { createContainer, type AppContainer } from '@main/app/container';
import { SETTING_KEYS } from '@shared/contracts/settings';
import { NotificationType } from '@shared/types/common.types';
import { insertUser, TestDatabaseHelper } from '@tests/utils/database-helper';
import { mockUserInput } from '@tests/fixtures/users';
import { containerSecrets } from '@tests/utils/fake-safe-storage';
import { TEST_LOGS_DIR } from '@tests/utils/ipc-harness';

const mockNotification = jest.fn((_options: Record<string, unknown>) => ({
  on: jest.fn(),
  show: jest.fn(),
}));
jest.mock('electron', () => ({
  ...jest.requireActual('@tests/utils/electron-mocks').electron(),
  Notification: function Notification(options: Record<string, unknown>) {
    return mockNotification(options);
  },
}));
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('node-machine-id', () => ({ machineIdSync: () => 'test-machine-id' }));
jest.mock('@main/app/paths', () => ({
  ...jest.requireActual('@main/app/paths'),
  getBrandIconPath: () => '/brand/icons/icon.png',
}));

const INFO = { type: NotificationType.INFO, title: 'Hello', message: 'x' };

describe('NotificationService preferences', () => {
  let dbHelper: TestDatabaseHelper;
  let userId: number;
  let dispatch: jest.Mock;
  let emit: jest.Mock;
  let preferences: NotificationPreferences;

  beforeEach(async () => {
    dbHelper = new TestDatabaseHelper('notification-preferences');
    await dbHelper.setup();
    userId = insertUser(dbHelper.getDb(), mockUserInput.email).id;
    dispatch = jest.fn(async () => []);
    emit = jest.fn();
    preferences = { desktop: true, sound: true };
    mockNotification.mockClear();
  });

  afterEach(async () => {
    await dbHelper.teardown();
  });

  const service = () =>
    new NotificationService(
      new NotificationRepository(dbHelper.getDb()),
      { dispatch } as unknown as NotificationDispatcher,
      { emit },
      { preferences: () => preferences }
    );

  it('desktop false: no OS notification; the in-app list, event and email still happen', async () => {
    preferences = { desktop: false, sound: true };

    const stored = await service().notify({ userId, ...INFO });

    expect(mockNotification).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('notification:created', stored);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(stored.id).toBeDefined();
  });

  it('sound false: the OS notification is silent; sound true: it is not', async () => {
    const notifications = service();

    preferences = { desktop: true, sound: false };
    await notifications.notify({ userId, ...INFO });
    preferences = { desktop: true, sound: true };
    await notifications.notify({ userId, ...INFO });

    expect(mockNotification.mock.calls.map(([options]) => options.silent)).toEqual([true, false]);
  });

  it('a change applies to the next notification, with no restart', async () => {
    const notifications = service();

    await notifications.notify({ userId, ...INFO });
    preferences = { desktop: false, sound: true };
    await notifications.notify({ userId, ...INFO });
    preferences = { desktop: true, sound: true };
    await notifications.notify({ userId, ...INFO });

    expect(mockNotification).toHaveBeenCalledTimes(2);
  });

  it('without preferences, desktop notifications with sound (a fresh install)', async () => {
    const notifications = new NotificationService(new NotificationRepository(dbHelper.getDb()));

    await notifications.notify({ userId, ...INFO });

    expect(mockNotification).toHaveBeenCalledWith(expect.objectContaining({ silent: false }));
  });
});

describe('the container reads the stored notification settings', () => {
  let container: AppContainer;

  beforeEach(() => {
    container = createContainer({
      db: openDatabase(':memory:'),
      logsDir: TEST_LOGS_DIR,
      ...containerSecrets(),
    });
    container.profile.ensureLocalProfile();
    mockNotification.mockClear();
  });

  afterEach(async () => {
    await container.dispose();
  });

  const store = (key: 'notifications.desktop' | 'notifications.sound', value: boolean) => {
    const { valueType, category } = SETTING_KEYS[key];
    container.repositories.settings.set(key, value, valueType, category);
  };
  const notify = () =>
    container.notificationService.notify({ userId: container.profile.requireUserId(), ...INFO });

  it('nothing stored: the defaults, desktop with sound', async () => {
    await notify();

    expect(mockNotification).toHaveBeenCalledWith(expect.objectContaining({ silent: false }));
  });

  it('notifications.desktop false (as Settings stores it): no OS notification', async () => {
    store('notifications.desktop', false);

    await notify();

    expect(mockNotification).not.toHaveBeenCalled();
  });

  it('notifications.sound false: silent, and back on at the next notification once changed', async () => {
    store('notifications.sound', false);
    await notify();
    store('notifications.sound', true);
    await notify();

    expect(mockNotification.mock.calls.map(([options]) => options.silent)).toEqual([true, false]);
  });
});
