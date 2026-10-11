import { act, screen, waitFor, within } from '@testing-library/react';
import { activeAccess, createMockApi, fail, ok } from '@tests/utils/renderer/createMockApi';
import { currentRoute, getBanners, renderWithApp } from '@tests/utils/renderer/renderWithApp';
import { NotificationType } from '../../shared/types';

const nav = () => screen.getByRole('navigation', { name: 'Primary' });
const navLink = (name: string) => within(nav()).getByRole('link', { name });

describe('App shell', () => {
  describe('startup', () => {
    it('opens on Explore with no login screen and no session check', async () => {
      const { mock } = renderWithApp();
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Explore places to stay' })
      ).toBeInTheDocument();
      // Explore (E1): the search pill, and the catalogue (still syncing in the default mock).
      expect(screen.getByRole('search', { name: 'Search places' })).toBeInTheDocument();
      expect(
        await screen.findByRole('heading', { level: 2, name: 'Getting places ready' })
      ).toBeVisible();
      expect(currentRoute()).toBe('/');
      expect(screen.queryByRole('button', { name: /log ?in|sign in|log ?out/i })).toBeNull();
      expect(screen.queryByLabelText(/password/i)).toBeNull();
      expect(mock?.api.accounts.signIn).not.toHaveBeenCalled();
      expect(mock?.api.accounts.status).not.toHaveBeenCalled();
    });

    it('renders a deep link straight into its page on cold start', async () => {
      renderWithApp({ route: '/watches' });
      expect(await screen.findByRole('heading', { level: 1, name: 'Watches' })).toBeInTheDocument();
      expect(navLink('Watches')).toHaveAttribute('aria-current', 'page');
    });
  });

  describe('header', () => {
    it('has the lockup, four nav links, the bell and the account menu', async () => {
      renderWithApp();
      const [banner] = getBanners();
      expect(within(banner).getByRole('link', { name: 'WA Stay, Explore' })).toHaveAttribute(
        'href',
        '#/'
      );
      expect(
        within(nav())
          .getAllByRole('link')
          .map((link) => link.textContent && link.getAttribute('href'))
      ).toEqual(['#/', '#/watches', '#/site-sniper', '#/bookings']);
      expect(navLink('Explore')).toBeInTheDocument();
      expect(navLink('Watches')).toBeInTheDocument();
      expect(within(banner).getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
      expect(
        within(banner).getByRole('button', { name: 'Account and settings' })
      ).toBeInTheDocument();
      await screen.findByRole('heading', { level: 1, name: 'Explore places to stay' });
    });

    it.each([
      ['/watches/12', 'Watches'],
      ['/watches/new', 'Watches'],
      ['/places/parkstay/1', 'Explore'],
      ['/', 'Explore'],
      ['/site-sniper/new', 'Site Sniper, coming soon'],
      ['/bookings/3', 'Bookings, coming soon'],
    ])('on %s only "%s" is the current page', async (route, current) => {
      renderWithApp({ route });
      await screen.findByRole('main');
      const links = within(nav()).getAllByRole('link');
      const currentLinks = links.filter((l) => l.getAttribute('aria-current') === 'page');
      expect(currentLinks).toEqual([navLink(current)]);
    });

    it('marks no nav link current on Settings, which lives in the account menu', async () => {
      renderWithApp({ route: '/settings' });
      await screen.findByRole('heading', { level: 1, name: 'Settings' });
      expect(within(nav()).queryByRole('link', { current: 'page' })).toBeNull();
    });

    it('hides the active brushstroke from assistive technology', async () => {
      renderWithApp({ route: '/watches' });
      const active = navLink('Watches');
      const stroke = active.querySelector('svg');
      expect(stroke).toHaveAttribute('aria-hidden', 'true');
      expect(navLink('Explore').querySelector('svg')).toBeNull();
      await screen.findByRole('heading', { level: 1, name: 'Watches' });
    });

    it('sizes the active brushstroke to the label, not the link or its Soon pill', async () => {
      renderWithApp({ route: '/site-sniper' });
      await screen.findByRole('heading', { level: 1, name: 'Site Sniper' });
      const stroke = navLink('Site Sniper, coming soon').querySelector('svg');
      expect(stroke).toHaveClass('w-full');
      expect(stroke).toHaveAttribute('preserveAspectRatio', 'none');
      // Its box is the label's own wrapper, which holds the label and nothing else.
      const box = stroke?.parentElement;
      expect(box).toHaveClass('relative');
      expect(box?.textContent).toBe('Site SniperSite Sniper');
    });

    describe('notification bell', () => {
      const notification = (id: number, isRead: boolean) => ({
        id,
        userId: 1,
        type: NotificationType.WATCH_FOUND,
        title: `Notification ${id}`,
        message: 'Sites are available',
        isRead,
        createdAt: new Date('2026-10-02T10:00:00Z'),
      });

      it('is an icon button named "Notifications" with no badge when all are read', async () => {
        renderWithApp({
          api: { notifications: { unreadCount: jest.fn().mockResolvedValue(ok(0)) } },
        });
        const [banner] = getBanners();
        const bell = within(banner).getByRole('button', { name: 'Notifications' });
        expect(bell).toHaveAttribute('aria-expanded', 'false');
        // The lucide Bell, not an emoji.
        expect(bell.querySelector('svg.lucide-bell')).not.toBeNull();
        expect(bell.textContent).toBe('');
        expect(within(bell).queryByTestId('notification-badge')).toBeNull();
        await screen.findByRole('heading', { level: 1, name: 'Explore places to stay' });
      });

      it("puts main's unread count in its name and shows it in a decorative badge", async () => {
        const unreadCount = jest.fn().mockResolvedValue(ok(3));
        const list = jest.fn().mockResolvedValue(ok([notification(5, false)]));
        const mock = createMockApi({ notifications: { unreadCount, list } });
        const { user } = renderWithApp({ api: mock });
        const bell = await screen.findByRole('button', { name: 'Notifications, 3 unread' });
        const badge = within(bell).getByTestId('notification-badge');
        expect(badge).toHaveTextContent('3');
        expect(badge).toHaveAttribute('aria-hidden', 'true');
        expect(badge).toHaveClass('bg-accent', 'text-accent-fg');

        unreadCount.mockResolvedValue(ok(4));
        mock.emit('notification:created', notification(5, false));
        expect(await screen.findByRole('button', { name: 'Notifications, 4 unread' })).toBe(bell);

        await user.click(bell);
        expect(bell).toHaveAttribute('aria-expanded', 'true');
        expect(await screen.findByText('Notification 5')).toBeInTheDocument();
      });

      it('caps the badge at 99+ but names the full count', async () => {
        renderWithApp({
          api: { notifications: { unreadCount: jest.fn().mockResolvedValue(ok(120)) } },
        });
        const bell = await screen.findByRole('button', { name: 'Notifications, 120 unread' });
        expect(within(bell).getByTestId('notification-badge')).toHaveTextContent('99+');
      });
    });

    it.each([
      ['Site Sniper, coming soon', '/site-sniper', 'Site Sniper'],
      ['Bookings, coming soon', '/bookings', 'Bookings'],
    ])('"%s" navigates to its page', async (name, route, heading) => {
      const { user } = renderWithApp();
      await user.click(screen.getByRole('link', { name }));
      expect(currentRoute()).toBe(route);
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
      expect(screen.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
    });
  });

  describe('account menu', () => {
    it('opens with Enter; Settings goes to /settings', async () => {
      const { user } = renderWithApp({ route: '/watches' });
      const button = screen.getByRole('button', { name: 'Account and settings' });
      act(() => button.focus());
      await user.keyboard('{Enter}');
      const menu = screen.getByRole('menu', { name: 'Account and settings' });
      expect(
        within(menu)
          .getAllByRole('menuitem')
          .map((i) => i.textContent)
      ).toEqual(['Settings', 'About WA Stay']);
      expect(within(menu).getByRole('menuitem', { name: 'Settings' })).toHaveFocus();
      await user.keyboard('{Enter}');
      // The menu links to /settings, which opens its first section
      await waitFor(() => expect(currentRoute()).toBe('/settings/accounts'));
      await waitFor(() =>
        expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
      );
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('About WA Stay opens a named dialog and returns focus to the menu button', async () => {
      const { user } = renderWithApp();
      const button = screen.getByRole('button', { name: 'Account and settings' });
      act(() => button.focus());
      await user.keyboard('{Enter}');
      await user.keyboard('{ArrowDown}{Enter}');

      const dialog = await screen.findByRole('dialog', { name: 'About WA Stay' });
      expect(await within(dialog).findByText('Version 2.0.0-test')).toBeVisible();
      expect(
        within(dialog).getByText('Find and book places to stay across Western Australia')
      ).toBeVisible();
      // The runtime versions are folded away under "Technical details"
      await user.click(within(dialog).getByRole('button', { name: 'Technical details' }));
      expect(within(dialog).getByText('28.3.3')).toBeVisible();
      expect(
        within(dialog).getByRole('link', { name: 'GitHub (opens in your browser)' })
      ).toHaveAttribute('href', 'https://github.com/wilsonwaters/wa-stay');
      expect(
        within(dialog).getByRole('link', { name: 'Report an issue (opens in your browser)' })
      ).toHaveAttribute('href', 'https://github.com/wilsonwaters/wa-stay/issues');

      await user.click(within(dialog).getByRole('button', { name: 'Done' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(button).toHaveFocus();
    });
  });

  describe('routes', () => {
    it.each([
      ['/', 'Explore places to stay'],
      ['/watches', 'Watches'],
      ['/watches/new', 'New watch'],
      ['/site-sniper', 'Site Sniper'],
      ['/site-sniper/new', 'New snipe'],
      ['/bookings', 'Bookings'],
      ['/settings', 'Settings'],
      ['/settings/notifications', 'Settings'],
      ['/places/nowhere/1', "This place isn't available"],
      ['/does-not-exist', 'Page not found'],
    ])('%s renders "%s" inside the shell', async (route, heading) => {
      renderWithApp({ route });
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
      expect(getBanners()).toHaveLength(1);
      expect(screen.getByRole('main')).toContainElement(
        screen.getByRole('heading', { name: heading })
      );
    });

    it.each([
      ['/watches/12', 'watches', 'get', 'Watch not found'],
      ['/site-sniper/4', 'snipes', 'get', 'Snipe not found'],
      ['/watches/12/edit', 'watches', 'get', 'Watch not found'],
      ['/bookings/3', 'bookings', 'get', 'Booking not found'],
    ])('%s renders its page with its data', async (route, namespace, method, text) => {
      const get = jest.fn().mockResolvedValue(fail(text, 'NOT_FOUND'));
      renderWithApp({ route, api: { [namespace]: { [method]: get } } });
      expect(await screen.findByText(text)).toBeInTheDocument();
      expect(get).toHaveBeenCalled();
    });

    it('/__design renders the design preview outside the shell in development', async () => {
      renderWithApp({ route: '/__design' });
      expect(
        await screen.findByRole(
          'heading',
          { level: 1, name: 'Design language' },
          { timeout: 15000 }
        )
      ).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
    }, 30000);

    it('shows NotFound with a way back to Explore', async () => {
      const { user } = renderWithApp({ route: '/does-not-exist' });
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByText('/does-not-exist')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Back to Explore' }));
      expect(currentRoute()).toBe('/');
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Explore places to stay' })
      ).toBeInTheDocument();
    });

    it.each([
      ['/watches/create?location=1&adults=2', '/watches/new?location=1&adults=2'],
      [
        '/site-sniper/create?provider=parkstay&location=9',
        '/site-sniper/new?provider=parkstay&location=9',
      ],
    ])('redirects %s to %s, keeping the query', async (from, to) => {
      renderWithApp({ route: from });
      await waitFor(() => expect(currentRoute()).toBe(to));
      expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('makes "Skip to content" the first Tab stop, and it focuses main', async () => {
      const { user } = renderWithApp();
      await screen.findByRole('heading', { level: 1, name: 'Explore places to stay' });
      await user.tab();
      const skip = screen.getByRole('link', { name: 'Skip to content' });
      expect(skip).toHaveFocus();
      await user.keyboard('{Enter}');
      expect(screen.getByRole('main')).toHaveFocus();
      expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
      expect(currentRoute()).toBe('/');
    });

    it('has one banner, one main and one navigation named Primary', async () => {
      renderWithApp();
      await screen.findByRole('heading', { level: 1, name: 'Explore places to stay' });
      expect(getBanners()).toHaveLength(1);
      expect(screen.getAllByRole('main')).toHaveLength(1);
      expect(screen.getAllByRole('navigation', { name: 'Primary' })).toHaveLength(1);
    });

    it.each([
      ['/', 'Explore places to stay'],
      ['/does-not-exist', 'Page not found'],
      ['/settings', 'Settings'],
    ])('%s has exactly one h1', async (route, name) => {
      renderWithApp({ route });
      await screen.findByRole('heading', { level: 1, name });
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });

    it('moves focus to the new page h1 and announces it, but not on query changes', async () => {
      const { user } = renderWithApp({ route: '/does-not-exist' });
      await screen.findByRole('heading', { level: 1, name: 'Page not found' });
      await user.click(navLink('Explore'));

      const heading = await screen.findByRole('heading', {
        level: 1,
        name: 'Explore places to stay',
      });
      await waitFor(() => expect(heading).toHaveFocus());
      await waitFor(() =>
        expect(
          document.querySelector('[aria-live="polite"][aria-atomic="true"]')
        ).toHaveTextContent('Explore')
      );

      // A query-string change on the same page leaves focus where the person put it.
      const skip = screen.getByRole('link', { name: 'Skip to content' });
      act(() => skip.focus());
      window.location.hash = '#/?arrival=2026-12-01';
      await waitFor(() => expect(currentRoute()).toBe('/?arrival=2026-12-01'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(skip).toHaveFocus();
    });

    it('focuses a loading page h1 once it appears', async () => {
      const { user } = renderWithApp();
      await screen.findByRole('heading', { level: 1, name: 'Explore places to stay' });
      await user.click(navLink('Watches'));
      const heading = await screen.findByRole('heading', { level: 1, name: 'Watches' });
      await waitFor(() => expect(heading).toHaveFocus());
    });

    it('focuses only the last page of a quick run of navigations', async () => {
      const { user } = renderWithApp();
      await screen.findByRole('heading', { level: 1, name: 'Explore places to stay' });
      await user.click(navLink('Watches'));
      await user.click(navLink('Explore'));
      const heading = await screen.findByRole('heading', {
        level: 1,
        name: 'Explore places to stay',
      });
      await waitFor(() => expect(heading).toHaveFocus());
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(heading).toHaveFocus();
    });
  });

  describe('tray', () => {
    it('stacks a toast, the update card and the access chip in that order in one container', async () => {
      const mock = createMockApi({
        providers: { accessStatus: jest.fn().mockResolvedValue(ok(activeAccess())) },
        notifications: {
          unreadCount: jest.fn().mockResolvedValue(ok(1)),
          list: jest.fn().mockResolvedValue(
            ok([
              {
                id: 1,
                userId: 1,
                providerId: 'parkstay',
                type: NotificationType.WATCH_FOUND,
                title: 'Sites available at Osprey Bay',
                message: '2 sites',
                isRead: false,
                createdAt: new Date(),
              },
            ])
          ),
          markRead: jest.fn().mockResolvedValue(fail('The database is busy')),
        },
      });
      const { user } = renderWithApp({ api: mock });
      // A failed action raises an error toast.
      await user.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
      await user.click(
        await screen.findByRole('button', { name: 'Mark as read: Sites available at Osprey Bay' })
      );
      const toast = await screen.findByRole('alert');
      expect(toast).toHaveTextContent("That notification couldn't be marked as read.");
      await user.keyboard('{Escape}');
      mock.emit('updater:available', { version: '2.1.0' });
      const update = await screen.findByText('Update available');
      const queue = await screen.findByRole('region', { name: 'ParkStay queue' });
      expect(queue).toHaveTextContent('ParkStay · access granted · 15 min left');

      const tray = screen.getByTestId('tray');
      expect(tray).toContainElement(toast);
      expect(tray).toContainElement(update);
      expect(tray).toContainElement(queue);
      // Outside #root, so a modal's inert never reaches it.
      expect(document.getElementById('root')).not.toContainElement(tray);
      const follows = (a: Node, b: Node) =>
        Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      expect(follows(toast, update)).toBe(true);
      expect(follows(update, queue)).toBe(true);
      // One width for every card: the column stretches them, and the toast region fills it.
      expect(tray).toHaveClass('flex-col', 'items-stretch');
      expect(screen.getByRole('region', { name: 'Notifications' })).toHaveClass('w-full');
    });

    it('collapses to nothing but the toast region when idle', async () => {
      renderWithApp();
      await screen.findByRole('heading', { level: 1, name: 'Explore places to stay' });
      const tray = screen.getByTestId('tray');
      const region = within(tray).getByRole('region', { name: 'Notifications' });
      expect(within(region).queryAllByRole('listitem')).toHaveLength(0);
      // Idle cards render nothing, and their slots add no box of their own.
      expect(tray.textContent).toBe('');
      expect(tray.querySelectorAll('[role="alert"], [role="status"], button')).toHaveLength(0);
    });

    it('keeps toasts usable above a modal and sets the other cards aside until it closes', async () => {
      const mock = createMockApi();
      const { user } = renderWithApp({ api: mock });
      mock.emit('updater:available', { version: '2.1.0' });
      const update = await screen.findByText('Update available');
      const tray = screen.getByTestId('tray');

      await user.click(screen.getByRole('button', { name: 'Account and settings' }));
      await user.click(screen.getByRole('menuitem', { name: 'About WA Stay' }));
      await screen.findByRole('dialog', { name: 'About WA Stay' });
      await waitFor(() => expect(tray).toHaveAttribute('data-modal-open'));
      expect(update.closest('[inert]')).not.toBeNull();
      expect(
        within(tray).getByRole('region', { name: 'Notifications' }).closest('[inert]')
      ).toBeNull();

      await user.keyboard('{Escape}');
      await waitFor(() => expect(tray).not.toHaveAttribute('data-modal-open'));
      expect(update.closest('[inert]')).toBeNull();
    });

    it('sets the update card aside while the notification list is open, so they never overlap', async () => {
      const mock = createMockApi();
      const { user } = renderWithApp({ api: mock });
      mock.emit('updater:available', { version: '2.1.0' });
      const update = await screen.findByText('Update available');
      const tray = screen.getByTestId('tray');

      await user.click(screen.getByRole('button', { name: 'Notifications' }));
      expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeInTheDocument();
      await waitFor(() => expect(update.closest('[inert]')).not.toBeNull());
      expect(tray).toHaveAttribute('data-set-aside');
      expect(
        within(tray).getByRole('region', { name: 'Notifications' }).closest('[inert]')
      ).toBeNull();

      await user.keyboard('{Escape}');
      await waitFor(() => expect(update.closest('[inert]')).toBeNull());
      expect(tray).not.toHaveAttribute('data-set-aside');
    });

    it('raises one error toast, without retry loops, when providers cannot be loaded', async () => {
      const list = jest.fn().mockResolvedValue(fail('Registry offline', 'INTERNAL'));
      renderWithApp({ api: { providers: { list } } });
      expect(await screen.findByRole('alert', {}, { timeout: 4000 })).toHaveTextContent(
        'Registry offline'
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      // One retry (INTERNAL is retryable), then it stops.
      expect(list).toHaveBeenCalledTimes(2);
    });
  });

  describe('without window.api', () => {
    it('renders the shell with a notice instead of crashing', async () => {
      const { user } = renderWithApp({ api: null });
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Explore places to stay' })
      ).toBeVisible();
      expect(screen.getByText('Running outside the WA Stay app')).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Notifications' })).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Account and settings' }));
      expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
    });
  });
});
