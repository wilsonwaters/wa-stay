import { screen, waitFor, within } from '@testing-library/react';
import type { LocationDetail } from '../../../../shared/types/catalog.types';
import type { WatchInput } from '../../../../shared/types/watch.types';
import { FAKE_MANIFEST, PARKSTAY_MANIFEST, ok } from '@tests/utils/renderer/createMockApi';
import {
  catalogGet,
  makeLocation,
  makeMixedDetail,
  makeWatch,
} from '@tests/fixtures/renderer/watches';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';

const PREFILL =
  '/watches/new?provider=parkstay&location=20&arrival=2099-12-11&departure=2099-12-13&adults=2';

function api(detail: LocationDetail = makeMixedDetail()) {
  return {
    providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST, FAKE_MANIFEST])) },
    catalog: {
      get: catalogGet(detail),
      search: jest.fn().mockResolvedValue(ok({ items: [makeLocation()], total: 1 })),
      status: jest
        .fn()
        .mockResolvedValue(
          ok({ providers: [{ providerId: 'parkstay', count: 6, stale: false, syncing: false }] })
        ),
    },
    watches: {
      list: jest.fn().mockResolvedValue(ok([])),
      create: jest.fn().mockResolvedValue(ok(makeWatch({ id: 42 }))),
      get: jest.fn().mockResolvedValue(ok(makeWatch({ id: 42 }))),
    },
  };
}

const button = (name: string) => screen.getByRole('button', { name });
const step = (name: RegExp) => screen.findByRole('heading', { level: 2, name });
const sentInput = (mock: jest.Mock): WatchInput => mock.mock.calls[0][0];
const stayTypes = () => screen.findByRole('group', { name: 'Stay type' });
const linkNotice = () => screen.queryByText("Some of the link couldn't be used");

describe('NewWatchPage: the stay types in a link from Explore', () => {
  it('stay=cabin chooses "Cabins & villas"', async () => {
    renderWithApp({ route: `${PREFILL}&stay=cabin`, api: api() });
    const group = await stayTypes();
    expect(within(group).getByRole('button', { name: 'Cabins & villas' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(group).getByRole('button', { name: 'Camping' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(linkNotice()).toBeNull();
  });

  it('stay=bogus says the link’s stay type could not be used', async () => {
    renderWithApp({ route: `${PREFILL}&stay=bogus`, api: api() });
    const group = await stayTypes();
    expect(within(group).queryByRole('button', { pressed: true })).toBeNull();
    expect(
      screen.getByText("The link's stay type couldn't be used, so choose one.")
    ).toBeInTheDocument();
  });

  it('stay=cabin at a place with sites only is dropped without a word', async () => {
    const mock = api(makeMixedDetail({}, 'campsite'));
    const { user } = renderWithApp({ route: `${PREFILL}&stay=cabin`, api: mock });
    await screen.findByText('Preferred sites');
    expect(screen.queryByRole('group', { name: 'Stay type' })).toBeNull();
    expect(linkNotice()).toBeNull();
    for (const name of ['Continue', 'Continue', 'Create watch']) {
      await user.click(button(name));
    }
    await waitFor(() => expect(mock.watches.create).toHaveBeenCalled());
    expect(sentInput(mock.watches.create)).not.toHaveProperty('unitKinds');
  });

  it('stay=cabin at a mixed place without cabins is dropped, saying so', async () => {
    renderWithApp({ route: `${PREFILL}&stay=cabin`, api: api(makeMixedDetail({}, 'dorm')) });
    const group = await stayTypes();
    expect(
      within(group)
        .getAllByRole('button')
        .map((chip) => chip.textContent)
    ).toEqual(['Camping', 'Dorms']);
    expect(within(group).queryByRole('button', { pressed: true })).toBeNull();
    expect(
      await screen.findByText('Osprey Bay has no Cabins & villas, so choose a stay type.')
    ).toBeInTheDocument();
  });

  it('choosing another place clears the stay types', async () => {
    const other = makeMixedDetail({ key: 'parkstay:30', externalId: '30', name: 'Lucky Bay' });
    const mock = api();
    mock.catalog.get = jest.fn(async (key: string) =>
      ok(key === other.key ? other : makeMixedDetail())
    );
    mock.catalog.search = jest.fn().mockResolvedValue(ok({ items: [other], total: 1 }));
    const { user } = renderWithApp({ route: `${PREFILL}&stay=cabin`, api: mock });
    const group = await stayTypes();
    expect(within(group).getByRole('button', { name: 'Cabins & villas' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    await user.click(button('Back'));
    const location = await screen.findByRole('combobox', { name: 'Location' });
    await user.clear(location);
    await user.type(location, 'Lucky');
    await user.click(await screen.findByRole('option', { name: /Lucky Bay/ }));
    await user.click(button('Continue'));
    await step(/Your stay$/);
    const next = await stayTypes();
    expect(within(next).queryByRole('button', { pressed: true })).toBeNull();
  });
});
