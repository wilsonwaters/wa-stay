import { screen, waitFor, within } from '@testing-library/react';
import { ok } from '@tests/utils/renderer/createMockApi';
import { currentRoute, renderWithApp } from '@tests/utils/renderer/renderWithApp';
import { PARKSTAY, SIGNED_IN } from '@tests/fixtures/renderer/settings';
import { isSettingsSection, SETTINGS_SECTIONS, settingsSection } from './sections';

const api = () => ({
  providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY])) },
  accounts: {
    list: jest.fn().mockResolvedValue(ok([SIGNED_IN])),
    status: jest.fn().mockResolvedValue(ok(SIGNED_IN)),
  },
  settings: { get: jest.fn().mockResolvedValue(ok(true)) },
  app: {
    getAutoLaunch: jest.fn().mockResolvedValue(ok({ enabled: false, startMinimised: false })),
  },
});

const subNav = () => screen.getByRole('navigation', { name: 'Settings sections' });

describe('SettingsPage', () => {
  it('redirects /settings to /settings/accounts', async () => {
    renderWithApp({ route: '/settings', api: api() });

    expect(await screen.findByRole('heading', { level: 2, name: 'Accounts' })).toBeInTheDocument();
    expect(currentRoute()).toBe('/settings/accounts');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  });

  it('keeps ?provider when it redirects', async () => {
    renderWithApp({ route: '/settings?provider=parkstay', api: api() });

    await screen.findByRole('heading', { level: 2, name: 'Accounts' });
    expect(currentRoute()).toBe('/settings/accounts?provider=parkstay');
  });

  it('lists Accounts, Notifications, App and About in the Settings sections nav, and no Gmail', async () => {
    renderWithApp({ route: '/settings/accounts', api: api() });
    await screen.findByRole('heading', { level: 2, name: 'Accounts' });

    const links = within(subNav()).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Accounts',
      'Notifications',
      'App',
      'About',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#/settings/accounts',
      '#/settings/notifications',
      '#/settings/app',
      '#/settings/about',
    ]);
  });

  it('marks the current section aria-current=page, and only that one', async () => {
    renderWithApp({ route: '/settings/notifications', api: api() });
    await screen.findByRole('heading', { level: 2, name: 'Notifications' });

    const current = within(subNav())
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.map((link) => link.textContent)).toEqual(['Notifications']);
    // Nothing in the primary navigation is current on Settings
    const primary = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(primary).queryAllByRole('link', { current: 'page' })).toEqual([]);
  });

  it.each(SETTINGS_SECTIONS.map(({ id }) => [id, settingsSection(id).heading]))(
    'loads %s directly by URL (heading "%s")',
    async (id, heading) => {
      renderWithApp({ route: `/settings/${id}`, api: api() });

      expect(await screen.findByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
      expect(currentRoute()).toBe(`/settings/${id}`);
    }
  );

  it('an unknown section redirects to accounts', async () => {
    renderWithApp({ route: '/settings/gmail', api: api() });

    await screen.findByRole('heading', { level: 2, name: 'Accounts' });
    expect(currentRoute()).toBe('/settings/accounts');
  });

  it('changing section moves focus to that section’s h2', async () => {
    const { user } = renderWithApp({ route: '/settings/accounts', api: api() });
    await screen.findByRole('heading', { level: 2, name: 'Accounts' });

    await user.click(within(subNav()).getByRole('link', { name: 'App' }));

    const heading = await screen.findByRole('heading', { level: 2, name: 'App' });
    await waitFor(() => expect(heading).toHaveFocus());
    // The page heading did not take it back
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(heading).toHaveFocus();
  });
});

describe('isSettingsSection', () => {
  it('accepts the four sections only', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual([
      'accounts',
      'notifications',
      'app',
      'about',
    ]);
    expect(isSettingsSection('about')).toBe(true);
    expect(isSettingsSection('gmail')).toBe(false);
    expect(isSettingsSection(undefined)).toBe(false);
  });
});
