import { screen, waitFor, within } from '@testing-library/react';
import type { Watch } from '../../../../shared/types/watch.types';
import { PARKSTAY_MANIFEST, fail, ok } from '@tests/utils/renderer/createMockApi';
import { catalogGet, makeWatch } from '@tests/fixtures/renderer/watches';
import { currentRoute, renderWithApp } from '@tests/utils/renderer/renderWithApp';

const LEGACY = makeWatch({
  id: 5,
  name: 'Easter at Osprey',
  stayParams: { parkId: '17', gearType: 'tent,caravan' },
  unitIds: ['Site 3'],
  maxPrice: 40,
  checkIntervalMinutes: 240,
  allowPartialMatch: true,
  notes: 'Bring the kayak',
});

function api(watch: Watch | null = LEGACY, extra: Record<string, jest.Mock> = {}) {
  return {
    providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST])) },
    catalog: {
      get: catalogGet(),
      search: jest.fn().mockResolvedValue(ok({ items: [], total: 0 })),
      status: jest
        .fn()
        .mockResolvedValue(
          ok({ providers: [{ providerId: 'parkstay', count: 6, stale: false, syncing: false }] })
        ),
    },
    watches: {
      get: jest.fn().mockResolvedValue(ok(watch)),
      list: jest.fn().mockResolvedValue(ok([])),
      update: jest
        .fn()
        .mockImplementation((_id: number, updates: Partial<Watch>) =>
          Promise.resolve(ok({ ...LEGACY, ...updates }))
        ),
      ...extra,
    },
    accounts: { list: jest.fn().mockResolvedValue(ok([])) },
  };
}

describe('EditWatchPage', () => {
  it('shows the provider read-only and pre-fills every field (legacy gear CSV, unit names)', async () => {
    const { user } = renderWithApp({ route: '/watches/5/edit', api: api() });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Edit Easter at Osprey' })
    ).toBeInTheDocument();
    const provider = screen.getByRole('region', { name: 'Provider' });
    expect(await within(provider).findByRole('img', { name: 'ParkStay WA' })).toBeInTheDocument();
    expect(within(provider).queryByRole('radio')).toBeNull();
    expect(within(provider).getByText('A watch stays with its provider.')).toBeInTheDocument();

    expect(screen.getByRole('combobox', { name: 'Location' })).toHaveValue('Osprey Bay');
    expect(screen.getByRole('button', { name: 'Dates Fri 11 – Sun 13 Dec' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Guests 2 adults/ })).toBeInTheDocument();
    const gear = screen.getByRole('combobox', { name: 'Camping with' });
    expect(gear).toHaveValue('all');
    expect(gear).toHaveAccessibleDescription(/was saved as "Tent, Caravan".*now Any/);
    expect(screen.getByRole('textbox', { name: /Max price per night/ })).toHaveValue('40');
    expect(screen.getByRole('combobox', { name: /Check every/ })).toHaveValue('240');
    expect(screen.getByRole('checkbox', { name: 'Alert on partial availability' })).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Easter at Osprey');
    expect(screen.getByRole('textbox', { name: /Notes/ })).toHaveValue('Bring the kayak');

    // The stored unit is a name ("Site 3", as older watches kept them): it matches the place's
    // site by name.
    expect(await screen.findByText(/1 site chosen/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Choose sites' }));
    expect(screen.getByRole('checkbox', { name: 'Site 3' })).toBeChecked();
    expect(screen.queryByText('Sites no longer listed')).toBeNull();
  });

  it('Save changes sends the changed fields to watches.update, then opens the watch', async () => {
    const mock = api();
    const { user } = renderWithApp({ route: '/watches/5/edit', api: mock });
    const price = await screen.findByRole('textbox', { name: /Max price per night/ });
    await user.clear(price);
    await user.selectOptions(screen.getByRole('combobox', { name: /Check every/ }), '60');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mock.watches.update).toHaveBeenCalledTimes(1));
    expect(mock.watches.update).toHaveBeenCalledWith(5, { maxPrice: 0, checkIntervalMinutes: 60 });
    await waitFor(() => expect(currentRoute()).toBe('/watches/5'));
  });

  it('sends nothing when nothing changed, and does not re-check an old stay', async () => {
    const mock = api({
      ...LEGACY,
      stay: { ...LEGACY.stay, arrival: '2000-01-01', departure: '2000-01-03' },
    });
    const { user } = renderWithApp({ route: '/watches/5/edit', api: mock });
    await user.click(await screen.findByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(currentRoute()).toBe('/watches/5'));
    expect(mock.watches.update).not.toHaveBeenCalled();
  });

  it('a 1.x site type ("Unpowered") shows as Any with what it was, and a rename keeps it', async () => {
    const mock = api({ ...LEGACY, stayParams: { parkId: '17', gearType: 'Unpowered' } });
    const { user } = renderWithApp({ route: '/watches/5/edit', api: mock });
    const gear = await screen.findByRole('combobox', { name: 'Camping with' });
    expect(gear).toHaveValue('all');
    expect(gear).toHaveAccessibleDescription(
      'Camping with was saved as "Unpowered", which can\'t be checked any more, so it is now Any.'
    );
    const name = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    // Only the name: the stored "Unpowered" is not replaced by the Any the form shows.
    await waitFor(() => expect(mock.watches.update).toHaveBeenCalledWith(5, { name: 'Renamed' }));
  });

  it('rename a legacy 5-minute watch saves without changing the interval', async () => {
    const mock = api({ ...LEGACY, checkIntervalMinutes: 5 });
    const { user } = renderWithApp({ route: '/watches/5/edit', api: mock });
    const name = await screen.findByRole('textbox', { name: 'Name' });
    const interval = screen.getByRole('combobox', { name: /Check every/ });
    expect(interval).toHaveValue('5');
    expect(within(interval).getByRole('option', { selected: true })).toHaveTextContent(
      'Every 5 minutes (checks run every 15)'
    );
    await user.clear(name);
    await user.type(name, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mock.watches.update).toHaveBeenCalledTimes(1));
    expect(mock.watches.update).toHaveBeenCalledWith(5, { name: 'Renamed' });
    expect(screen.queryByText('Choose how often to check')).toBeNull();
    await waitFor(() => expect(currentRoute()).toBe('/watches/5'));
  });

  it('lets a legacy 5-minute watch move to an interval from the list', async () => {
    const mock = api({ ...LEGACY, checkIntervalMinutes: 5 });
    const { user } = renderWithApp({ route: '/watches/5/edit', api: mock });
    await user.selectOptions(await screen.findByRole('combobox', { name: /Check every/ }), '15');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(mock.watches.update).toHaveBeenCalledWith(5, { checkIntervalMinutes: 15 })
    );
  });

  it('focuses the first invalid field when the form cannot be saved', async () => {
    const mock = api();
    const { user } = renderWithApp({ route: '/watches/5/edit', api: mock });
    const name = await screen.findByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveAccessibleDescription('Give the watch a name');
    expect(mock.watches.update).not.toHaveBeenCalled();
  });

  it('Delete watch confirms, then returns to /watches', async () => {
    const remove = jest.fn().mockResolvedValue(ok(true));
    const { user } = renderWithApp({
      route: '/watches/5/edit',
      api: api(LEGACY, { delete: remove }),
    });
    await user.click(await screen.findByRole('button', { name: 'Delete watch' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete Easter at Osprey?' });
    expect(remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Delete watch' }));
    await waitFor(() => expect(currentRoute()).toBe('/watches'));
    expect(remove).toHaveBeenCalledWith(5);
  });

  it('keeps the dialog open with main’s reason when the delete is refused', async () => {
    const remove = jest.fn().mockResolvedValue(fail('This watch holds a site'));
    const { user } = renderWithApp({
      route: '/watches/5/edit',
      api: api(LEGACY, { delete: remove }),
    });
    await user.click(await screen.findByRole('button', { name: 'Delete watch' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete Easter at Osprey?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete watch' }));
    expect(await within(dialog).findByText('This watch holds a site')).toBeInTheDocument();
    expect(currentRoute()).toBe('/watches/5/edit');
  });
});
