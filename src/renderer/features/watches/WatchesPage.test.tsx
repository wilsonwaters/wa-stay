import { screen, waitFor, within } from '@testing-library/react';
import { WatchResult } from '../../../shared/types/common.types';
import {
  BROWSE_ONLY_MANIFEST,
  FAKE_MANIFEST,
  PARKSTAY_MANIFEST,
  fail,
  ok,
} from '@tests/utils/renderer/createMockApi';
import { makeLocation, makeWatch } from '@tests/fixtures/renderer/watches';
import { currentRoute } from '@tests/utils/renderer/renderWithApp';
import { politeAnnouncement, renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { WatchesPage } from './WatchesPage';

const OSPREY = makeWatch({ id: 1, name: 'Osprey Bay summer' });
const LUCKY = makeWatch({
  id: 2,
  name: 'Lucky Bay long weekend',
  providerId: 'fakestay',
  isActive: false,
  location: { externalId: 'lb', name: 'Lucky Bay', areaName: 'Cape Le Grand' },
});

function setup(
  route = '/watches',
  watches = [OSPREY, LUCKY],
  manifests = [PARKSTAY_MANIFEST, FAKE_MANIFEST]
) {
  return renderWithProviders(<WatchesPage />, {
    route,
    api: {
      providers: { list: jest.fn().mockResolvedValue(ok(manifests)) },
      watches: { list: jest.fn().mockResolvedValue(ok(watches)) },
    },
  });
}

const cards = () => screen.queryAllByRole('article');
const cardNames = () => cards().map((card) => within(card).getByRole('heading').textContent);

describe('WatchesPage', () => {
  it('shows one h1 "Watches" and one "New watch"', async () => {
    setup();
    expect(await screen.findAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Watches' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'New watch' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'New watch' })).toHaveAttribute(
      'href',
      '#/watches/new'
    );
    await waitFor(() => expect(cards()).toHaveLength(2));
  });

  it('filters by provider and status; ?provider=parkstay&status=active restores both', async () => {
    const { user } = setup('/watches?provider=parkstay&status=active');
    await waitFor(() => expect(cardNames()).toEqual(['Osprey Bay summer']));
    const provider = screen.getByRole('radiogroup', { name: 'Provider' });
    expect(
      within(provider)
        .getAllByRole('radio')
        .map((r) => r.closest('label')?.textContent)
    ).toEqual(['All', 'ParkStay', 'Fake Stay']);
    expect(within(provider).getByRole('radio', { name: 'ParkStay' })).toBeChecked();
    expect(
      within(screen.getByRole('radiogroup', { name: 'Status' })).getByRole('radio', {
        name: 'Active',
      })
    ).toBeChecked();

    await user.click(within(provider).getByRole('radio', { name: 'Fake Stay' }));
    expect(currentRoute()).toBe('/watches?provider=fakestay&status=active');
    expect(screen.getByText('No watches match these filters')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Paused' }));
    expect(cardNames()).toEqual(['Lucky Bay long weekend']);
    await waitFor(() => expect(politeAnnouncement()).toBe('1 watch'));

    await user.click(within(provider).getByRole('radio', { name: 'All' }));
    await user.click(screen.getByRole('radio', { name: 'All', checked: false }));
    expect(currentRoute()).toBe('/watches');
    expect(cards()).toHaveLength(2);
  });

  it('shows the provider filter even with one provider (§12.9)', async () => {
    setup('/watches', [OSPREY], [PARKSTAY_MANIFEST]);
    const provider = await screen.findByRole('radiogroup', { name: 'Provider' });
    expect(within(provider).getAllByRole('radio')).toHaveLength(2);
  });

  it('waits for the providers before offering a provider filter: no "Unknown provider" flash', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    const pending = new Promise((r) => (resolve = r));
    renderWithProviders(<WatchesPage />, {
      route: '/watches',
      api: {
        providers: { list: jest.fn().mockReturnValue(pending) },
        watches: { list: jest.fn().mockResolvedValue(ok([OSPREY, LUCKY])) },
      },
    });
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(screen.queryByRole('radiogroup', { name: 'Provider' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Unknown provider/)).not.toBeInTheDocument();
    resolve(ok([PARKSTAY_MANIFEST, FAKE_MANIFEST]));
    const provider = await screen.findByRole('radiogroup', { name: 'Provider' });
    expect(within(provider).getByRole('radio', { name: /ParkStay/ })).toBeInTheDocument();
    expect(screen.queryByText(/Unknown provider/)).not.toBeInTheDocument();
  });

  it('shows each place’s photo from one catalogue search, named by the place', async () => {
    const search = jest.fn().mockResolvedValue(
      ok({
        items: [makeLocation({ imageUrls: ['https://example.org/osprey.jpg'] })],
        total: 1,
      })
    );
    renderWithProviders(<WatchesPage />, {
      route: '/watches',
      api: {
        providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST, FAKE_MANIFEST])) },
        watches: {
          list: jest
            .fn()
            .mockResolvedValue(ok([OSPREY, LUCKY, makeWatch({ id: 3, name: 'Again' })])),
        },
        catalog: { search },
      },
    });
    const osprey = await screen.findByRole('article', { name: 'Osprey Bay summer' });
    const photo = await within(osprey).findByRole('img', { name: 'Osprey Bay' });
    expect(photo).toHaveAttribute('src', 'https://example.org/osprey.jpg');
    // A place the catalogue doesn't have (Fake Stay's here) shows the placeholder.
    const lucky = screen.getByRole('article', { name: 'Lucky Bay long weekend' });
    expect(
      within(lucky).getByRole('img', { name: 'No photo available for Lucky Bay' })
    ).toBeInTheDocument();
    // Three cards, one request: main's local catalogue, never one per watch.
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('picks up the photos when a first catalogue sync finishes after the list opened', async () => {
    const search = jest.fn().mockResolvedValue(ok({ items: [], total: 0 }));
    const { mock } = renderWithProviders(<WatchesPage />, {
      route: '/watches',
      api: {
        providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST])) },
        watches: { list: jest.fn().mockResolvedValue(ok([OSPREY])) },
        catalog: { search },
      },
    });
    const card = await screen.findByRole('article', { name: 'Osprey Bay summer' });
    expect(
      await within(card).findByRole('img', { name: 'No photo available for Osprey Bay' })
    ).toBeInTheDocument();
    search.mockResolvedValue(
      ok({ items: [makeLocation({ imageUrls: ['https://example.org/osprey.jpg'] })], total: 1 })
    );
    mock.emit('catalog:updated', {
      providerId: 'parkstay',
      count: 1,
      syncedAt: '2099-01-01T00:00:00Z',
    });
    expect(await within(card).findByRole('img', { name: 'Osprey Bay' })).toHaveAttribute(
      'src',
      'https://example.org/osprey.jpg'
    );
  });

  it('no watches: Create your first watch', async () => {
    setup('/watches', []);
    expect(await screen.findByRole('heading', { name: 'No watches yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create your first watch' })).toHaveAttribute(
      'href',
      '#/watches/new'
    );
    expect(screen.queryByRole('radiogroup', { name: 'Status' })).toBeNull();
  });

  it('no matches: Clear filters', async () => {
    const { user } = setup('/watches?status=paused&provider=parkstay');
    expect(
      await screen.findByRole('heading', { name: 'No watches match these filters' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(currentRoute()).toBe('/watches');
    expect(cards()).toHaveLength(2);
  });

  it('disables New watch with the reason when no provider supports watches', async () => {
    setup('/watches', [], [BROWSE_ONLY_MANIFEST]);
    const button = await screen.findByRole('button', { name: 'New watch' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('No provider supports watches yet');
    expect(screen.queryByRole('link', { name: 'Create your first watch' })).toBeNull();
  });

  it('still lists watches with unknown badges when providers fail, with a retry', async () => {
    renderWithProviders(<WatchesPage />, {
      route: '/watches',
      api: {
        providers: { list: jest.fn().mockResolvedValue(fail('Main is busy')) },
        watches: { list: jest.fn().mockResolvedValue(ok([OSPREY])) },
      },
    });
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(
      await screen.findByText("Provider details couldn't be loaded", {}, { timeout: 4000 })
    ).toBeInTheDocument();
    expect(within(cards()[0]).getByRole('img', { name: 'Unknown provider' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Provider' })).toBeNull();
    expect(within(cards()[0]).getByRole('button', { name: 'Check now' })).toBeDisabled();
  });

  it('says when watches cannot be loaded, with Try again', async () => {
    const list = jest.fn().mockResolvedValue(fail('Database is locked'));
    renderWithProviders(<WatchesPage />, { route: '/watches', api: { watches: { list } } });
    expect(
      await screen.findByText("Watches couldn't be loaded", {}, { timeout: 4000 })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('puts held watches first and ended ones last', async () => {
    setup('/watches', [
      makeWatch({
        id: 1,
        name: 'Ended',
        stay: { ...OSPREY.stay, arrival: '2000-01-01', departure: '2000-01-02' },
      }),
      makeWatch({ id: 2, name: 'Plain' }),
      makeWatch({
        id: 3,
        name: 'Held',
        lastResult: WatchResult.HELD,
        hold: { reference: 'PB1', expiresAt: new Date(Date.now() + 600_000), unitId: '12' },
      }),
    ]);
    await waitFor(() => expect(cardNames()).toEqual(['Held', 'Plain', 'Ended']));
  });
});
