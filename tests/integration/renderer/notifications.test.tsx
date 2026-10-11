/**
 * Notifications end to end in the renderer (U5): main stores a notification and sends
 * `notification:created`; the bell's count goes up; the person opens the list and clicks the
 * new item; the app opens its watch, and main has it marked read.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { createMockApi, fail } from '../../utils/renderer/createMockApi';
import { notification, notificationsBackend } from '../../utils/renderer/notifications';
import { currentRoute, renderWithApp } from '../../utils/renderer/renderWithApp';

describe('notification flow', () => {
  it('notification:created → badge goes up → open the list → click the item → /watches/12, marked read', async () => {
    const backend = notificationsBackend([
      notification({ id: 3, title: 'Some nights available at Bungarra', isRead: true }),
    ]);
    const mock = createMockApi({
      notifications: backend.stubs,
      watches: { get: jest.fn().mockResolvedValue(fail('Watch not found', 'NOT_FOUND')) },
    });
    const { user } = renderWithApp({ api: mock });
    const bell = await screen.findByRole('button', { name: 'Notifications' });

    const created = backend.add(
      notification({ id: 12, relatedId: 12, title: 'Sites available at Osprey Bay' })
    );
    mock.emit('notification:created', created);
    await waitFor(() => expect(bell).toHaveAccessibleName('Notifications, 1 unread'));

    await user.click(bell);
    const list = screen.getByRole('dialog', { name: 'Notifications' });
    const item = await within(list).findByRole('link', { name: 'Sites available at Osprey Bay' });
    expect(within(list).getAllByRole('listitem')[0]).toContainElement(item);

    await user.click(item);

    await waitFor(() => expect(currentRoute()).toBe('/watches/12'));
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
    expect(backend.stubs.markRead).toHaveBeenCalledWith(12);
    expect(backend.items.find((n) => n.id === 12)?.isRead).toBe(true);
    await waitFor(() => expect(bell).toHaveAccessibleName('Notifications'));
    // The watch page itself loads (U1 owns its not-found state).
    expect(mock.api.watches.get).toHaveBeenCalledWith(12);
  });
});
