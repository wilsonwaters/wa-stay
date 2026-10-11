import { screen, waitFor, within } from '@testing-library/react';
import { NotificationType, RelatedType } from '../../../shared/types/common.types';
import { createMockApi, fail } from '@tests/utils/renderer/createMockApi';
import { notification, notificationsBackend } from '@tests/utils/renderer/notifications';
import { currentRoute, renderWithApp } from '@tests/utils/renderer/renderWithApp';

const popover = () => screen.getByRole('dialog', { name: 'Notifications' });
const items = () => within(popover()).getAllByRole('listitem');
const item = (title: string) =>
  items().find((li) => li.textContent?.includes(title)) as HTMLElement;

async function openWith(backend: ReturnType<typeof notificationsBackend>, route = '/') {
  const mock = createMockApi({ notifications: backend.stubs });
  const result = renderWithApp({ route, api: mock });
  await result.user.click(await screen.findByRole('button', { name: /^Notifications/ }));
  await waitFor(() => expect(items()).toHaveLength(backend.items.length));
  return { ...result, mock };
}

describe('NotificationList', () => {
  it('marks each item with its provider badge, or the WA Stay glyph, and says "Unread" in words', async () => {
    await openWith(
      notificationsBackend([
        notification({ id: 1, title: 'Sites available at Osprey Bay' }),
        notification({
          id: 2,
          providerId: undefined,
          type: NotificationType.INFO,
          title: 'Welcome to WA Stay',
          relatedType: undefined,
          relatedId: undefined,
          actionUrl: undefined,
          isRead: true,
        }),
        notification({ id: 3, providerId: 'gone', title: 'From a removed provider' }),
      ])
    );

    const parkstay = item('Sites available at Osprey Bay');
    expect(within(parkstay).getByRole('img', { name: 'ParkStay WA' })).toBeInTheDocument();
    expect(within(parkstay).getByText('Unread')).toBeInTheDocument();
    expect(within(parkstay).getByText('5 min ago')).toBeInTheDocument();
    // A lucide type icon, never an emoji.
    expect(parkstay.querySelector('svg.lucide-bell-ring')).not.toBeNull();

    const appWide = item('Welcome to WA Stay');
    expect(within(appWide).getByRole('img', { name: 'WA Stay' })).toBeInTheDocument();
    expect(within(appWide).queryByRole('img', { name: 'ParkStay WA' })).toBeNull();
    expect(within(appWide).queryByText('Unread')).toBeNull();

    expect(
      within(item('From a removed provider')).getByRole('img', { name: 'Unknown provider' })
    ).toBeInTheDocument();
  });

  it.each([
    [{ id: 12, relatedType: RelatedType.WATCH, actionUrl: '/watches/12' }, '/watches/12'],
    [{ id: 7, relatedType: RelatedType.SNIPE, actionUrl: '/site-sniper/7' }, '/site-sniper/7'],
    [{ id: 3, relatedType: RelatedType.BOOKING, actionUrl: undefined }, '/bookings/3'],
  ])('clicking %o goes to %s, marks it read and closes the list', async (fields, route) => {
    const backend = notificationsBackend([
      notification({ ...fields, relatedId: fields.id, title: 'Open me' }),
    ]);
    const { user } = await openWith(backend, '/settings/accounts');

    await user.click(within(item('Open me')).getByRole('link', { name: 'Open me' }));

    await waitFor(() => expect(currentRoute()).toBe(route));
    expect(backend.stubs.markRead).toHaveBeenCalledWith(fields.id);
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
    expect(
      await screen.findByRole('button', { name: 'Notifications' }, { timeout: 2000 })
    ).toBeInTheDocument();
  });

  it('an item whose actionUrl is https://evil.example has no link and goes nowhere', async () => {
    const backend = notificationsBackend([
      notification({
        id: 4,
        title: 'Suspicious',
        actionUrl: 'https://evil.example',
        relatedType: undefined,
        relatedId: undefined,
      }),
    ]);
    const { user } = await openWith(backend, '/settings/accounts');

    expect(within(item('Suspicious')).queryByRole('link')).toBeNull();
    await user.click(within(item('Suspicious')).getByText('Suspicious'));
    expect(currentRoute()).toBe('/settings/accounts');
    expect(popover()).toBeInTheDocument();
    expect(backend.stubs.markRead).not.toHaveBeenCalled();
  });

  it('names its icon buttons with the title, and they mark read and delete', async () => {
    const backend = notificationsBackend([
      notification({ id: 1, title: 'Site held at Osprey Bay' }),
      notification({ id: 2, title: 'Booked at Bungarra', isRead: true }),
    ]);
    const { user } = await openWith(backend);
    expect(
      within(item('Booked at Bungarra')).queryByRole('button', { name: /^Mark as read/ })
    ).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Mark as read: Site held at Osprey Bay' }));
    expect(backend.stubs.markRead).toHaveBeenCalledWith(1);
    await waitFor(() =>
      expect(within(item('Site held at Osprey Bay')).queryByText('Unread')).toBeNull()
    );
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Delete notification: Booked at Bungarra' })
    );
    expect(backend.stubs.delete).toHaveBeenCalledWith(2);
    await waitFor(() => expect(items()).toHaveLength(1));
    // Focus goes back to the list's heading, not to the page.
    expect(within(popover()).getByRole('heading', { name: 'Notifications' })).toHaveFocus();
  });

  it('"Mark all as read" calls markAllRead and the badge goes', async () => {
    const backend = notificationsBackend([notification({ id: 1 }), notification({ id: 2 })]);
    const { user } = await openWith(backend);
    expect(screen.getByRole('button', { name: 'Notifications, 2 unread' })).toBeInTheDocument();

    await user.click(within(popover()).getByRole('button', { name: 'Mark all as read' }));

    expect(backend.stubs.markAllRead).toHaveBeenCalledTimes(1);
    const bell = await screen.findByRole('button', { name: 'Notifications' });
    expect(within(bell).queryByTestId('notification-badge')).toBeNull();
    expect(within(popover()).queryAllByText('Unread')).toHaveLength(0);
  });

  it('"Clear all" asks first; Cancel keeps them, Clear all calls clearAll', async () => {
    const backend = notificationsBackend([notification({ id: 1 }), notification({ id: 2 })]);
    const { user } = await openWith(backend);

    await user.click(within(popover()).getByRole('button', { name: 'Clear all' }));
    let confirm = screen.getByRole('alertdialog', { name: 'Clear all notifications?' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(backend.stubs.clearAll).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Notifications, 2 unread' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Notifications, 2 unread' }));
    await user.click(within(popover()).getByRole('button', { name: 'Clear all' }));
    confirm = screen.getByRole('alertdialog', { name: 'Clear all notifications?' });
    await user.click(within(confirm).getByRole('button', { name: 'Clear all' }));

    expect(backend.stubs.clearAll).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(backend.items).toEqual([]);
  });

  it('rolls an optimistic mark-read or delete back when main refuses, with an error toast', async () => {
    const backend = notificationsBackend([notification({ id: 1, title: 'Keep me' })]);
    backend.stubs.markRead.mockResolvedValueOnce(fail('The database is busy'));
    backend.stubs.delete.mockResolvedValueOnce(fail('The database is busy'));
    const { user } = await openWith(backend);

    await user.click(screen.getByRole('button', { name: 'Mark as read: Keep me' }));
    expect(
      await screen.findByText("That notification couldn't be marked as read. Try again.")
    ).toBeInTheDocument();
    expect(within(item('Keep me')).getByText('Unread')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete notification: Keep me' }));
    expect(
      await screen.findByText("That notification couldn't be deleted. Try again.")
    ).toBeInTheDocument();
    expect(items()).toHaveLength(1);
  });
});
