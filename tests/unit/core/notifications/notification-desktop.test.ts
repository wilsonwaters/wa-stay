/**
 * @jest-environment node
 *
 * Desktop notifications (U5; architecture-notes §12.6, §12.31). The OS title names the
 * provider through the registry ("ParkStay · Sites available at Osprey Bay") while the stored
 * title does not; a click restores and focuses the main window and sends `app:navigate` with
 * the notification's in-app page, and never a path outside the allow-list.
 */
import { NotificationService } from '@main/core/notifications/notification.service';
import { openDatabase } from '@main/database/connection';
import { NotificationRepository } from '@main/database/repositories';
import { parkstayFactory } from '@main/providers/parkstay';
import { ProviderRegistry } from '@main/providers/registry';
import { NotificationType, RelatedType } from '@shared/types/common.types';
import type { Watch } from '@shared/types';
import { mockWatch } from '@tests/fixtures/watches';
import { createTestProviderContext } from '@tests/utils/fake-provider';
import type Database from 'better-sqlite3';

type Handler = () => void;
interface FakeDesktopNotification {
  options: { title: string; body: string };
  handlers: Map<string, Handler>;
  show: jest.Mock;
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

describe('desktop notifications', () => {
  let db: Database.Database;
  let repo: NotificationRepository;
  let registry: ProviderRegistry;
  let events: { emit: jest.Mock };
  let showMainWindow: jest.Mock<boolean, []>;
  let service: NotificationService;
  const userId = 1;

  const ospreyBay: Watch = {
    ...mockWatch,
    id: 12,
    userId,
    providerId: 'parkstay',
    locationKey: 'parkstay:34',
    location: { externalId: '34', name: 'Osprey Bay', areaName: 'Cape Range National Park' },
  };
  const match = {
    unitId: '7',
    unitName: 'Site 07',
    arrival: ospreyBay.stay.arrival,
    departure: ospreyBay.stay.departure,
    partial: false,
    priceKnown: false,
  };
  const lastDesktop = () => mockDesktop[mockDesktop.length - 1];
  const click = (desktop = lastDesktop()) => desktop.handlers.get('click')?.();
  const navigations = () => events.emit.mock.calls.filter(([name]) => name === 'app:navigate');

  beforeEach(() => {
    mockDesktop.length = 0;
    mockLog.warn.mockClear();
    db = openDatabase(':memory:');
    repo = new NotificationRepository(db);
    registry = new ProviderRegistry();
    registry.register(parkstayFactory, createTestProviderContext);
    events = { emit: jest.fn() };
    showMainWindow = jest.fn(() => true);
    service = new NotificationService(repo, undefined, events, {
      providerName: (id) => registry.tryGet(id)?.manifest.shortName,
      showMainWindow,
    });
  });

  afterEach(async () => {
    await registry.disposeAll();
    db.close();
  });

  it('a ParkStay watch-found notification is titled "ParkStay · Sites available at Osprey Bay" on the desktop and stored unprefixed', async () => {
    await service.notifyWatchFound(ospreyBay, [match]);

    expect(lastDesktop().options.title).toBe('ParkStay · Sites available at Osprey Bay');
    expect(lastDesktop().show).toHaveBeenCalledTimes(1);
    const [stored] = repo.findByUserId(userId);
    expect(stored).toMatchObject({
      providerId: 'parkstay',
      type: NotificationType.WATCH_FOUND,
      title: 'Sites available at Osprey Bay',
      actionUrl: '/watches/12',
    });
  });

  it('words a partial find as "Some nights available at {location}"', async () => {
    await service.notifyWatchPartialFound(ospreyBay, [{ ...match, partial: true }]);

    expect(repo.findByUserId(userId)[0].title).toBe('Some nights available at Osprey Bay');
    expect(lastDesktop().options.title).toBe('ParkStay · Some nights available at Osprey Bay');
  });

  it('a click brings the window forward first, then emits app:navigate with /watches/12', async () => {
    await service.notifyWatchFound(ospreyBay, [match]);
    expect(showMainWindow).not.toHaveBeenCalled();

    click();

    expect(showMainWindow).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith('app:navigate', { path: '/watches/12' });
    const navigateCall = events.emit.mock.calls.findIndex(([name]) => name === 'app:navigate');
    expect(showMainWindow.mock.invocationCallOrder[0]).toBeLessThan(
      events.emit.mock.invocationCallOrder[navigateCall]
    );
  });

  it('ignores a click while the app is quitting (no window to show)', async () => {
    await service.notifyWatchFound(ospreyBay, [match]);
    showMainWindow.mockReturnValue(false);

    click();

    expect(showMainWindow).toHaveBeenCalledTimes(1);
    expect(navigations()).toEqual([]);
  });

  it('never sends a link outside the allow-list: it warns and falls back to the related page, or to none', async () => {
    await service.notify({
      userId,
      providerId: 'parkstay',
      type: NotificationType.WATCH_FOUND,
      title: 'Sites available at Osprey Bay',
      message: 'x',
      actionUrl: 'https://evil.example',
    });
    click();
    expect(showMainWindow).toHaveBeenCalledTimes(1);
    expect(navigations()).toEqual([]);
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('links outside the allowed in-app pages')
    );
    expect(JSON.stringify(mockLog.warn.mock.calls)).not.toContain('evil.example');

    await service.notify({
      userId,
      providerId: 'parkstay',
      type: NotificationType.SNIPE_HELD,
      title: 'Site held at Osprey Bay',
      message: 'x',
      actionUrl: '/watches/12/../../settings',
      relatedType: RelatedType.SNIPE,
      relatedId: 7,
    });
    click();
    expect(navigations()).toEqual([['app:navigate', { path: '/site-sniper/7' }]]);
  });

  it('an app-wide notification with no link only brings the window forward', async () => {
    await service.notifyInfo(userId, 'Update ready', 'Restart to update');
    expect(lastDesktop().options.title).toBe('Update ready');

    click();

    expect(showMainWindow).toHaveBeenCalledTimes(1);
    expect(navigations()).toEqual([]);
  });
});
