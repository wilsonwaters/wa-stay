import { screen, waitFor, within } from '@testing-library/react';
import type { Watch } from '../../../../shared/types/watch.types';
import { PARKSTAY_MANIFEST, ok } from '@tests/utils/renderer/createMockApi';
import { catalogGet, makeMixedDetail, makeWatch } from '@tests/fixtures/renderer/watches';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';

function api(watch: Watch, detail = makeMixedDetail()) {
  return {
    providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST])) },
    catalog: {
      get: catalogGet(detail),
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
          Promise.resolve(ok({ ...watch, ...updates }))
        ),
    },
    accounts: { list: jest.fn().mockResolvedValue(ok([])) },
  };
}

const stayTypes = () => screen.findByRole('group', { name: 'Stay type' });

describe('EditWatchPage: stay types', () => {
  it('shows the stored stay types pressed, and a change sends only unitKinds', async () => {
    const mock = api(makeWatch({ id: 5, unitKinds: ['cabin'] }));
    const { user } = renderWithApp({ route: '/watches/5/edit', api: mock });
    const group = await stayTypes();
    expect(within(group).getByRole('button', { name: 'Cabins & villas' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    const camping = within(group).getByRole('button', { name: 'Camping' });
    expect(camping).toHaveAttribute('aria-pressed', 'false');

    await user.click(camping);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mock.watches.update).toHaveBeenCalledTimes(1));
    expect(mock.watches.update).toHaveBeenCalledWith(5, { unitKinds: ['campsite', 'cabin'] });
  });

  it('keeps a stored stay type the place no longer has on offer, pressed, so it can be turned off', async () => {
    const mock = api(makeWatch({ id: 5, unitKinds: ['glamping'] }));
    const { user } = renderWithApp({ route: '/watches/5/edit', api: mock });
    const group = await stayTypes();
    expect(
      within(group)
        .getAllByRole('button')
        .map((chip) => chip.textContent)
    ).toEqual(['Camping', 'Cabins & villas', 'Glamping']);
    const glamping = within(group).getByRole('button', { name: 'Glamping' });
    expect(glamping).toHaveAttribute('aria-pressed', 'true');
    // Glamping chosen: the units it lists would be tents (R9)
    expect(screen.getByText('No tents listed.')).toBeInTheDocument();

    await user.click(glamping);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mock.watches.update).toHaveBeenCalledWith(5, { unitKinds: [] }));
  });

  it('keeps a stored stay type’s chip, and the focus, when it is turned off, so it can be turned back on', async () => {
    // A place of one kind: without the stored stay type there would be no chips at all.
    const mock = api(makeWatch({ id: 5, unitKinds: ['cabin'] }), makeMixedDetail({}, 'campsite'));
    const { user } = renderWithApp({ route: '/watches/5/edit', api: mock });
    const cabins = within(await stayTypes()).getByRole('button', { name: 'Cabins & villas' });
    expect(cabins).toHaveAttribute('aria-pressed', 'true');

    cabins.focus();
    await user.keyboard('{Enter}');
    expect(cabins).toHaveAttribute('aria-pressed', 'false');
    expect(cabins).toBeInTheDocument();
    expect(cabins).toHaveFocus();
    expect(screen.getByRole('group', { name: 'Stay type' })).toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(cabins).toHaveAttribute('aria-pressed', 'true');
    expect(cabins).toHaveFocus();
  });

  it('will not save an automatic hold at a mixed place with neither a stay type nor a site', async () => {
    const mock = api(
      makeWatch({
        id: 5,
        autoHold: true,
        stayParams: { gearType: 'all', numVehicles: 1, postcode: '6000' },
      })
    );
    const { user } = renderWithApp({ route: '/watches/5/edit', api: mock });
    await stayTypes();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    // Sites and cabins: "spot" (R9)
    const hold = screen.getByRole('checkbox', { name: 'Hold a spot automatically when found' });
    await waitFor(() => expect(hold).toHaveFocus());
    expect(hold).toHaveAccessibleDescription(
      expect.stringContaining('Osprey Bay has more than one stay type.')
    );
    expect(mock.watches.update).not.toHaveBeenCalled();
  });
});
