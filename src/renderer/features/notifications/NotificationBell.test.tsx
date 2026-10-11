import { screen, waitFor, within } from '@testing-library/react';
import { createMockApi, fail } from '@tests/utils/renderer/createMockApi';
import { notification, notificationsBackend } from '@tests/utils/renderer/notifications';
import { getBanners, renderWithApp } from '@tests/utils/renderer/renderWithApp';

const findBell = (name: string | RegExp = /^Notifications/) =>
  screen.findByRole('button', { name });
const politeRegion = () => document.querySelector('[aria-live="polite"][aria-atomic="true"]');

/** 25 notifications, the 2 oldest read: main counts 23 unread, the list shows the newest 20. */
function twentyFive() {
  return Array.from({ length: 25 }, (_, i) =>
    notification({ id: 25 - i, isRead: i >= 23, title: `Sites available at Camp ${25 - i}` })
  );
}

describe('NotificationBell', () => {
  it("is named from main's unread count, not from the loaded page", async () => {
    const backend = notificationsBackend(twentyFive());
    const { user } = renderWithApp({ api: { notifications: backend.stubs } });

    const bell = await findBell('Notifications, 23 unread');
    // The list loads only when it opens.
    expect(backend.stubs.list).not.toHaveBeenCalled();

    await user.click(bell);
    const list = await screen.findByRole('dialog', { name: 'Notifications' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(20));
    expect(backend.stubs.list).toHaveBeenCalledWith(20);
    // 20 loaded, all unread, but the name still says 23.
    expect(bell).toHaveAccessibleName('Notifications, 23 unread');
  });

  it('opens a popover: aria-expanded and aria-controls, focus on its heading; Escape returns focus', async () => {
    const backend = notificationsBackend([notification({ id: 1 })]);
    const { user } = renderWithApp({ api: { notifications: backend.stubs } });
    const bell = await findBell('Notifications, 1 unread');
    expect(bell).toHaveAttribute('aria-expanded', 'false');
    expect(bell).toHaveAttribute('aria-haspopup', 'dialog');

    await user.click(bell);
    const popover = screen.getByRole('dialog', { name: 'Notifications' });
    expect(bell).toHaveAttribute('aria-expanded', 'true');
    expect(bell).toHaveAttribute('aria-controls', popover.id);
    expect(within(popover).getByRole('heading', { level: 2, name: 'Notifications' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
    expect(bell).toHaveAttribute('aria-expanded', 'false');
    expect(bell).toHaveFocus();
  });

  it('closes on an outside click and returns focus to the bell', async () => {
    const { user } = renderWithApp({ api: { notifications: notificationsBackend().stubs } });
    const bell = await findBell('Notifications');
    await user.click(bell);
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument();

    // Somewhere that cannot take focus itself (the header's background).
    const [banner] = getBanners();
    await user.click(banner);
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
    await waitFor(() => expect(bell).toHaveFocus());
  });

  it('shows "You\'re all caught up" when there is nothing', async () => {
    const { user } = renderWithApp({ api: { notifications: notificationsBackend().stubs } });
    await user.click(await findBell('Notifications'));
    expect(
      await screen.findByRole('heading', { name: "You're all caught up" })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).toBeNull();
  });

  it('a failed list shows an error with Retry, and the badge keeps its value', async () => {
    const backend = notificationsBackend([notification({ id: 1 }), notification({ id: 2 })]);
    const list = jest
      .fn()
      .mockResolvedValueOnce(fail('The database is locked'))
      .mockResolvedValueOnce(fail('The database is locked'))
      .mockImplementation(backend.stubs.list);
    const { user } = renderWithApp({
      api: { notifications: { ...backend.stubs, list } },
    });
    const bell = await findBell('Notifications, 2 unread');
    await user.click(bell);

    // After one retry (INTERNAL is retryable).
    const alert = await screen.findByRole('alert', {}, { timeout: 4000 });
    expect(alert).toHaveTextContent("Notifications couldn't be loaded");
    expect(alert).toHaveTextContent('The database is locked');
    expect(bell).toHaveAccessibleName('Notifications, 2 unread');

    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    const popover = screen.getByRole('dialog', { name: 'Notifications' });
    await waitFor(() => expect(within(popover).getAllByRole('listitem')).toHaveLength(2));
  });

  it('updates live on notification:created, without remounting, announcing it politely', async () => {
    const backend = notificationsBackend([notification({ id: 1 })]);
    const mock = createMockApi({ notifications: backend.stubs });
    renderWithApp({ api: mock });
    const bell = await findBell('Notifications, 1 unread');

    mock.emit(
      'notification:created',
      backend.add(notification({ id: 2, title: 'Site held at Osprey Bay' }))
    );
    expect(await findBell('Notifications, 2 unread')).toBe(bell);
    await waitFor(() =>
      expect(politeRegion()).toHaveTextContent('New ParkStay notification: Site held at Osprey Bay')
    );
  });

  it('prepends a notification that arrives while the list is open, without stealing focus', async () => {
    const backend = notificationsBackend([notification({ id: 1, title: 'Older one' })]);
    const mock = createMockApi({ notifications: backend.stubs });
    const { user } = renderWithApp({ api: mock });
    await user.click(await findBell('Notifications, 1 unread'));
    const popover = screen.getByRole('dialog', { name: 'Notifications' });
    const remove = await within(popover).findByRole('button', {
      name: 'Delete notification: Older one',
    });
    remove.focus();

    mock.emit('notification:created', backend.add(notification({ id: 2, title: 'Newer one' })));
    await waitFor(() =>
      expect(
        within(popover)
          .getAllByRole('listitem')
          .map((li) => li.textContent)
      ).toEqual([expect.stringContaining('Newer one'), expect.stringContaining('Older one')])
    );
    expect(remove).toHaveFocus();
  });
});
