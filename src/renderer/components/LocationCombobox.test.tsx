import { useState } from 'react';
import { screen, waitFor } from '@testing-library/react';
import { fail, ok } from '@tests/utils/renderer/createMockApi';
import { makeLocation } from '@tests/fixtures/renderer/watches';
import { politeAnnouncement, renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { LocationCombobox, type LocationChoice } from './LocationCombobox';

const OSPREY = makeLocation({ externalId: '20', name: 'Osprey Bay' });
const NINGALOO = makeLocation({
  externalId: '21',
  name: 'Osprey Hill',
  area: { name: 'Ningaloo Marine Park', region: 'Coral Coast' },
});

function Picker({
  onChange = jest.fn(),
  unavailableReason,
}: {
  onChange?: (l: LocationChoice | null) => void;
  unavailableReason?: (location: { bookingMode: string }) => string | undefined;
}) {
  const [value, setValue] = useState<LocationChoice | null>(null);
  return (
    <>
      <LocationCombobox
        providerId="parkstay"
        providerName="ParkStay"
        unavailableReason={unavailableReason}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
      <p>Chosen: {value?.name ?? 'none'}</p>
    </>
  );
}

function catalog(search: jest.Mock, syncing = false) {
  return {
    catalog: {
      search,
      status: jest.fn().mockResolvedValue(
        ok({
          providers: [{ providerId: 'parkstay', count: syncing ? 0 : 6, stale: false, syncing }],
        })
      ),
    },
  };
}

const results = (items = [OSPREY, NINGALOO], total = items.length) =>
  jest.fn().mockResolvedValue(ok({ items, total }));

describe('LocationCombobox', () => {
  it('searches only the chosen provider, from 2 letters and after a pause', async () => {
    const search = results();
    const { user } = renderWithProviders(<Picker />, { api: catalog(search) });
    const input = screen.getByRole('combobox', { name: 'Location' });

    await user.type(input, 'O');
    await new Promise((r) => setTimeout(r, 400));
    expect(search).not.toHaveBeenCalled();
    expect(await screen.findByText('Type at least 2 letters')).toBeInTheDocument();

    await user.type(input, 'sp');
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search).toHaveBeenCalledWith({
      text: 'Osp',
      providerIds: ['parkstay'],
      limit: 20,
      sort: 'relevance',
    });
    expect(await screen.findByRole('option', { name: /Osprey Bay/ })).toBeInTheDocument();
  });

  it('follows the combobox pattern with Up/Down/Enter/Escape', async () => {
    const onChange = jest.fn();
    const { user } = renderWithProviders(<Picker onChange={onChange} />, {
      api: catalog(results()),
    });
    const input = screen.getByRole('combobox', { name: 'Location' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('aria-controls');

    await user.type(input, 'Osprey');
    await screen.findByRole('option', { name: /Osprey Hill/ });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox').id).toBe(input.getAttribute('aria-controls'));

    await user.keyboard('{ArrowDown}{ArrowDown}');
    const active = input.getAttribute('aria-activedescendant');
    expect(active && document.getElementById(active)).toHaveTextContent('Osprey Hill');
    await user.keyboard('{ArrowUp}');
    expect(
      document.getElementById(input.getAttribute('aria-activedescendant') ?? '')
    ).toHaveTextContent('Osprey Bay');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ externalId: '20', name: 'Osprey Bay' })
    );
    expect(screen.getByText('Chosen: Osprey Bay')).toBeInTheDocument();
    expect(input).toHaveValue('Osprey Bay');
    expect(input).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Chosen: Osprey Bay')).toBeInTheDocument();
  });

  it('announces how many locations matched, politely', async () => {
    const { user } = renderWithProviders(<Picker />, { api: catalog(results()) });
    await user.type(screen.getByRole('combobox', { name: 'Location' }), 'Osprey');
    await waitFor(() => expect(politeAnnouncement()).toBe('2 locations'));
  });

  it('says "20 of 57 locations" when more matched than it lists', async () => {
    const { user } = renderWithProviders(<Picker />, {
      api: catalog(results([OSPREY, NINGALOO], 57)),
    });
    await user.type(screen.getByRole('combobox', { name: 'Location' }), 'Bay');
    await waitFor(() => expect(politeAnnouncement()).toBe('2 of 57 locations'));
  });

  it('says No locations match "{q}" when nothing matches', async () => {
    const { user } = renderWithProviders(<Picker />, { api: catalog(results([])) });
    await user.type(screen.getByRole('combobox', { name: 'Location' }), 'zzz');
    expect(
      await screen.findByRole('option', { name: 'No locations match "zzz"' })
    ).toBeInTheDocument();
    await waitFor(() => expect(politeAnnouncement()).toBe('No locations match "zzz"'));
  });

  it('clears the choice when the text changes again', async () => {
    const onChange = jest.fn();
    const { user } = renderWithProviders(<Picker onChange={onChange} />, {
      api: catalog(results()),
    });
    const input = screen.getByRole('combobox', { name: 'Location' });
    await user.type(input, 'Osprey');
    await user.click(await screen.findByRole('option', { name: /Osprey Bay/ }));
    expect(screen.getByText('Chosen: Osprey Bay')).toBeInTheDocument();
    await user.type(input, 'x');
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByText('Chosen: none')).toBeInTheDocument();
  });

  it('shows an inline error with Retry when the search fails', async () => {
    const search = jest
      .fn()
      .mockResolvedValueOnce(fail('The catalogue is unavailable'))
      .mockResolvedValueOnce(fail('The catalogue is unavailable'))
      .mockResolvedValue(ok({ items: [OSPREY], total: 1 }));
    const { user } = renderWithProviders(<Picker />, { api: catalog(search) });
    await user.type(screen.getByRole('combobox', { name: 'Location' }), 'Osprey');
    const retry = await screen.findByRole('button', { name: 'Retry' }, { timeout: 4000 });
    expect(screen.getByText("Locations couldn't be searched")).toBeInTheDocument();
    await user.click(retry);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull());
  });

  it('says the provider’s locations are still loading while its catalogue syncs', async () => {
    renderWithProviders(<Picker />, { api: catalog(results([]), true) });
    expect(
      await screen.findByText(/Locations from ParkStay are still loading/)
    ).toBeInTheDocument();
  });

  it('lists places that cannot be chosen as disabled, with the reason', async () => {
    const onChange = jest.fn();
    const offline = makeLocation({ externalId: '22', name: 'Osprey Hut', bookingMode: 'offline' });
    const { user } = renderWithProviders(
      <Picker
        onChange={onChange}
        unavailableReason={(l) => (l.bookingMode === 'online' ? undefined : 'Not bookable online')}
      />,
      { api: catalog(results([offline, OSPREY])) }
    );
    await user.type(screen.getByRole('combobox', { name: 'Location' }), 'Osprey');
    const hut = await screen.findByRole('option', { name: /Osprey Hut/ });
    expect(hut).toHaveAttribute('aria-disabled', 'true');
    expect(hut).toHaveTextContent('Not bookable online');
    await user.click(hut);
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ externalId: '22' }));
    expect(screen.getByRole('option', { name: /Osprey Bay/ })).not.toHaveAttribute('aria-disabled');
  });
});

describe('LocationCombobox for a provider searched by map area', () => {
  const LOFT = makeLocation({ providerId: 'search', externalId: 'karri', name: 'Karri Loft' });

  function SearchPicker() {
    const [value, setValue] = useState<LocationChoice | null>(null);
    return (
      <LocationCombobox
        providerId="search"
        providerName="SearchStays"
        value={value}
        onChange={setValue}
      />
    );
  }

  const searchCatalog = (
    search: jest.Mock,
    textSearch: boolean,
    { count = 2, syncing = false }: { count?: number; syncing?: boolean } = {}
  ) => ({
    catalog: {
      search,
      status: jest.fn().mockResolvedValue(
        ok({
          providers: [
            {
              providerId: 'search',
              count,
              stale: false,
              syncing,
              search: { textSearch, searchedAt: '2026-10-10T00:00:00.000Z' },
            },
          ],
        })
      ),
    },
  });

  /** The polite live region's text as it is, repeat marker included. */
  const politeRaw = () =>
    document.querySelector('[aria-live="polite"][aria-atomic="true"]')?.textContent ?? '';

  it('never says its places are "still loading": a searched catalogue does not arrive whole', async () => {
    const { user } = renderWithProviders(<SearchPicker />, {
      api: searchCatalog(results([]), false, { count: 0, syncing: true }),
    });
    await user.type(screen.getByRole('combobox', { name: 'Location' }), 'loft');
    expect(
      await screen.findByRole('option', {
        name: 'Browse SearchStays places on the Explore map to find more',
      })
    ).toBeInTheDocument();
    expect(screen.queryByText(/are still loading/)).toBeNull();
  });

  it('without text search, a name that matches nothing suggests browsing it on the Explore map', async () => {
    const { user } = renderWithProviders(<SearchPicker />, {
      api: searchCatalog(results([]), false),
    });
    await user.type(screen.getByRole('combobox', { name: 'Location' }), 'loft');

    const hint = 'Browse SearchStays places on the Explore map to find more';
    expect(await screen.findByRole('option', { name: hint })).toBeInTheDocument();
    await waitFor(() => expect(politeAnnouncement()).toBe(hint));
    expect(screen.queryByText(/No locations match/)).toBeNull();
  });

  it('without text search, the places already seen still match by name', async () => {
    const { user } = renderWithProviders(<SearchPicker />, {
      api: searchCatalog(results([LOFT]), false),
    });
    await user.type(screen.getByRole('combobox', { name: 'Location' }), 'loft');
    expect(await screen.findByRole('option', { name: /Karri Loft/ })).toBeInTheDocument();
    await waitFor(() => expect(politeAnnouncement()).toBe('1 location'));
  });

  it('with text search, says it is searching the provider until its places arrive (catalog:updated)', async () => {
    const search = jest
      .fn()
      .mockResolvedValueOnce(ok({ items: [], total: 0, pending: ['search'] }))
      .mockResolvedValueOnce(ok({ items: [], total: 0, pending: ['search'] }))
      .mockResolvedValue(ok({ items: [LOFT], total: 1 }));
    const { user, mock } = renderWithProviders(<SearchPicker />, {
      api: searchCatalog(search, true),
    });
    await user.type(screen.getByRole('combobox', { name: 'Location' }), 'loft');

    expect(
      await screen.findByRole('option', { name: 'Searching SearchStays…' })
    ).toBeInTheDocument();
    // Screen readers hear it too, once: the poll a second later says nothing new
    await waitFor(() => expect(politeAnnouncement()).toBe('Searching SearchStays…'));
    const said = politeRaw();
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(politeRaw()).toBe(said);
    mock.emit('catalog:updated', {
      providerId: 'search',
      count: 1,
      syncedAt: '2026-10-10T00:00:01.000Z',
    });

    expect(await screen.findByRole('option', { name: /Karri Loft/ })).toBeInTheDocument();
    await waitFor(() => expect(politeAnnouncement()).toBe('1 location'));
  });

  it('with text search, asks main again while the provider is pending, then says nothing matched', async () => {
    const search = jest
      .fn()
      .mockResolvedValueOnce(ok({ items: [], total: 0, pending: ['search'] }))
      .mockResolvedValue(ok({ items: [], total: 0 }));
    const { user } = renderWithProviders(<SearchPicker />, { api: searchCatalog(search, true) });
    await user.type(screen.getByRole('combobox', { name: 'Location' }), 'zzz');

    expect(
      await screen.findByRole('option', { name: 'Searching SearchStays…' })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('option', { name: 'No locations match "zzz"' }, { timeout: 3000 })
    ).toBeInTheDocument();
    await waitFor(() => expect(politeAnnouncement()).toBe('No locations match "zzz"'));
    expect(search).toHaveBeenCalledTimes(2);
  });
});
