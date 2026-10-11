import { act, screen, waitFor, within } from '@testing-library/react';
import { SnipeStatus } from '../../../shared/types/common.types';
import { makeHeldSnipe, makeSnipe } from '@tests/fixtures/renderer/snipes';
import { createMockApi, FAKE_MANIFEST, ok } from '@tests/utils/renderer/createMockApi';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';
import { politeAnnouncement, renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { SnipesPage } from './SnipesPage';

const listOf = (...snipes: ReturnType<typeof makeSnipe>[]) => ({
  snipes: { list: jest.fn().mockResolvedValue(ok(snipes)) },
});

describe('SnipesPage', () => {
  afterEach(() => jest.useRealTimers());

  it('keeps the Soon pill and shows the restyled banner and a New snipe button', async () => {
    renderWithApp({ route: '/site-sniper', api: listOf(makeSnipe()) });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Site Sniper' })
    ).toBeInTheDocument();
    // The banner is U3's ComingSoonBanner; this page places it.
    expect(screen.getByText('Site Sniper is still being finalised.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New snipe' })).toHaveAttribute(
      'href',
      '#/site-sniper/new'
    );
    expect(screen.getByRole('link', { name: 'Site Sniper, coming soon' })).toBeInTheDocument();
    expect(await screen.findByRole('article', { name: makeSnipe().name })).toBeInTheDocument();
  });

  it('shows each snipe’s provider, place, stay, status and timeline', async () => {
    renderWithProviders(<SnipesPage />, { api: listOf(makeSnipe()) });
    const card = await screen.findByRole('article', { name: 'Osprey Bay · Fri 11 – Sun 13 Dec' });
    expect(within(card).getByRole('img', { name: 'ParkStay WA' })).toBeInTheDocument();
    expect(within(card).getByText('Osprey Bay · Cape Range National Park')).toBeInTheDocument();
    expect(
      within(card).getByText(/Fri 11 – Sun 13 Dec 2099 · 2 nights · 2 adults/)
    ).toBeInTheDocument();
    expect(within(card).getByText('Armed', { selector: 'span' })).toBeInTheDocument();
    // A card shows only where the snipe is; the detail page lists every step.
    expect(within(card).getByText(/Step 1 of 5: Armed/)).toBeInTheDocument();
    expect(within(card).queryByRole('list', { name: 'Progress' })).toBeNull();
    expect(
      within(card).getByRole('timer', { name: /^Opens in 1 day 2 hours$/ })
    ).toBeInTheDocument();
  });

  it('re-renders only the countdown on each tick, never the page', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2099-06-01T00:00:00Z'));
    const snipe = makeSnipe({ releaseAt: new Date('2099-06-01T00:30:00Z') });
    const Page = jest.fn(SnipesPage);
    renderWithProviders(<Page />, {
      api: listOf(snipe),
      userOptions: { advanceTimers: jest.advanceTimersByTime },
    });
    const timer = await screen.findByRole('timer');
    await waitFor(() => expect(screen.queryByRole('status', { name: /Loading/ })).toBeNull());
    await act(async () => {
      await Promise.resolve();
    });
    const renders = Page.mock.calls.length;
    const texts = new Set<string>();
    for (let s = 0; s < 5; s += 1) {
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      texts.add(timer.textContent ?? '');
    }
    expect([...texts]).toEqual(['29:59', '29:58', '29:57', '29:56', '29:55']);
    expect(Page.mock.calls.length).toBe(renders);
  });

  it('runs one shared ticker for 50 armed snipes', async () => {
    const setInterval = jest.spyOn(global, 'setInterval');
    const snipes = Array.from({ length: 50 }, (_, i) =>
      makeSnipe({ id: i + 1, name: `Snipe ${i + 1}` })
    );
    renderWithProviders(<SnipesPage />, { api: listOf(...snipes) });
    expect(await screen.findAllByRole('timer')).toHaveLength(50);
    expect(setInterval.mock.calls.filter(([, ms]) => ms === 1000)).toHaveLength(1);
    setInterval.mockRestore();
  });

  it('updates a card in place when main pushes a change: no spinner, and an open toast stays', async () => {
    const snipe = makeSnipe();
    const list = jest.fn().mockResolvedValue(ok([snipe]));
    const deactivate = jest.fn().mockResolvedValue(ok(undefined));
    const mock = createMockApi({ snipes: { list, deactivate } });
    const { user } = renderWithProviders(<SnipesPage />, { api: mock });
    const card = await screen.findByRole('article', { name: snipe.name });
    await user.click(within(card).getByRole('button', { name: 'Disarm' }));
    expect(deactivate).toHaveBeenCalledWith(7);
    const toasts = screen.getByRole('region', { name: 'Notifications' });
    expect(await within(toasts).findByText(`Disarmed ${snipe.name}`)).toBeInTheDocument();

    const paused = { ...snipe, status: SnipeStatus.DISABLED, isActive: false };
    list.mockResolvedValue(ok([paused]));
    mock.emit('snipe:updated', paused);
    expect(await within(card).findByRole('button', { name: 'Arm' })).toBeInTheDocument();
    expect(within(card).getByText('Paused', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: snipe.name })).toBe(card);
    expect(screen.queryByRole('status', { name: /Loading snipes/ })).toBeNull();
    expect(within(toasts).getByText(`Disarmed ${snipe.name}`)).toBeInTheDocument();
  });

  it('announces a change once, politely, and a hold as an alert', async () => {
    const snipe = makeSnipe();
    const list = jest.fn().mockResolvedValue(ok([snipe]));
    const mock = createMockApi({ snipes: { list } });
    renderWithProviders(<SnipesPage />, { api: mock });
    await screen.findByRole('article', { name: snipe.name });
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();

    const waiting = { ...snipe, status: SnipeStatus.WAITING_RELEASE };
    list.mockResolvedValue(ok([waiting]));
    mock.emit('snipe:updated', waiting);
    await waitFor(() => expect(politeAnnouncement()).toBe(`${snipe.name}: Waiting for release`));

    const held = makeHeldSnipe(23, { name: snipe.name });
    list.mockResolvedValue(ok([held]));
    mock.emit('snipe:updated', held);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Site held at Osprey Bay. Pay within 23 minutes.'
      )
    );
    expect(politeAnnouncement()).toBe(`${snipe.name}: Waiting for release`);
  });

  it('offers a first snipe when there are none, and none at all without a provider for it', async () => {
    const { unmount } = renderWithProviders(<SnipesPage />);
    expect(await screen.findByRole('heading', { name: 'No snipes yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create your first snipe' })).toBeInTheDocument();
    unmount();

    renderWithProviders(<SnipesPage />, {
      api: { providers: { list: jest.fn().mockResolvedValue(ok([FAKE_MANIFEST])) } },
    });
    expect(
      await screen.findByRole('heading', { name: 'No provider supports Site Sniper yet' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New snipe' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'New snipe' })).toHaveAccessibleDescription(
      'No provider supports Site Sniper yet'
    );
  });

  it('refreshes the accounts once for one account:updated, however many cards listen', async () => {
    const snipes = Array.from({ length: 11 }, (_, i) =>
      makeSnipe({ id: i + 1, name: `Snipe ${i + 1}` })
    );
    const accounts = jest
      .fn()
      .mockResolvedValue(
        ok([{ providerId: 'parkstay', requirement: 'optional', status: 'signed-out' }])
      );
    const mock = createMockApi({ ...listOf(...snipes), accounts: { list: accounts } });
    renderWithProviders(<SnipesPage />, { api: mock });
    expect(await screen.findAllByRole('article')).toHaveLength(11);
    await waitFor(() => expect(accounts).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    const before = accounts.mock.calls.length;

    mock.emit('account:updated', {
      providerId: 'parkstay',
      requirement: 'optional',
      status: 'signed-in',
    });
    await waitFor(() => expect(accounts).toHaveBeenCalledTimes(before + 1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(accounts).toHaveBeenCalledTimes(before + 1);
  });
});
