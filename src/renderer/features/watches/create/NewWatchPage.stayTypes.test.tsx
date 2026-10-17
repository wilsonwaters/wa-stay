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
/** A review section's items, label to value, by their term and definition roles. */
function items(region: HTMLElement): Record<string, string | null> {
  const values = within(region).getAllByRole('definition');
  return Object.fromEntries(
    within(region)
      .getAllByRole('term')
      .map((term, i) => [term.textContent, values[i].textContent])
  );
}

describe('NewWatchPage at a place with sites and cabins', () => {
  it('offers its stay types; "Cabins & villas" narrows the units and is sent as unitKinds', async () => {
    const mock = api();
    const { user } = renderWithApp({ route: PREFILL, api: mock });
    await step(/Your stay$/);
    const group = await stayTypes();
    expect(group).toHaveAccessibleDescription('Leave all off for any stay type.');
    expect(
      within(group)
        .getAllByRole('button')
        .map((chip) => chip.textContent)
    ).toEqual(['Camping', 'Cabins & villas']);
    const cabins = within(group).getByRole('button', { name: 'Cabins & villas' });
    expect(cabins).toHaveAttribute('aria-pressed', 'false');

    await user.click(cabins);
    expect(cabins).toHaveAttribute('aria-pressed', 'true');
    await user.click(button('Choose sites'));
    expect(screen.getByRole('checkbox', { name: 'Cabin 1' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Site 1' })).toBeNull();

    await user.click(button('Continue'));
    await step(/Alerts$/);
    await user.click(button('Continue'));
    await step(/Review$/);
    expect(items(screen.getByRole('region', { name: 'Who' }))).toMatchObject({
      'Stay type': 'Cabins & villas',
    });
    await user.click(button('Create watch'));
    await waitFor(() => expect(mock.watches.create).toHaveBeenCalledTimes(1));
    expect(sentInput(mock.watches.create)).toMatchObject({ unitKinds: ['cabin'] });
    expect(sentInput(mock.watches.create)).not.toHaveProperty('unitIds');
  });

  it('groups the units by stay type, and Tab reaches the stay types before the units', async () => {
    const { user } = renderWithApp({ route: PREFILL, api: api() });
    const group = await stayTypes();
    await user.click(button('Choose sites'));
    expect(screen.getByRole('group', { name: 'Camping' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Cabins & villas' })).toBeInTheDocument();

    within(group).getByRole('button', { name: 'Cabins & villas' }).focus();
    await user.tab();
    expect(button('Choose sites')).toHaveFocus();
  });

  it('unticks a site when only cabins are chosen, saying so', async () => {
    const mock = api();
    const { user } = renderWithApp({ route: PREFILL, api: mock });
    const group = await stayTypes();
    await user.click(button('Choose sites'));
    await user.click(screen.getByRole('checkbox', { name: 'Site 1' }));
    expect(screen.getByText(/1 site chosen/)).toBeInTheDocument();

    await user.click(within(group).getByRole('button', { name: 'Cabins & villas' }));
    expect(screen.getByText('1 site unticked: not in the chosen stay types')).toHaveAttribute(
      'role',
      'status'
    );
    expect(screen.getByText(/Any site\./)).toBeInTheDocument();
    for (const name of ['Continue', 'Continue', 'Create watch']) {
      await user.click(button(name));
    }
    await waitFor(() => expect(mock.watches.create).toHaveBeenCalled());
    expect(sentInput(mock.watches.create)).not.toHaveProperty('unitIds');
  });

  it('will not hold automatically until a stay type or a site is chosen', async () => {
    const { user } = renderWithApp({ route: PREFILL, api: api() });
    await stayTypes();
    await user.click(button('Continue'));
    await step(/Alerts$/);
    const hold = screen.getByRole('checkbox', { name: 'Hold a site automatically when found' });
    await user.click(hold);
    await user.click(button('Continue'));

    const message =
      'Osprey Bay has more than one stay type. Choose a stay type or a site on the Stay step to hold one automatically.';
    await waitFor(() => expect(hold).toHaveFocus());
    expect(hold).toHaveAttribute('aria-invalid', 'true');
    expect(hold).toHaveAccessibleDescription(expect.stringContaining(message));
    expect(screen.getByRole('heading', { level: 2, name: /Alerts$/ })).toBeInTheDocument();

    // A stay type on the Stay step meets it, and the error goes.
    await user.click(button('Back'));
    await user.click(within(await stayTypes()).getByRole('button', { name: 'Camping' }));
    await user.click(button('Continue'));
    await step(/Alerts$/);
    expect(screen.queryByText(message)).toBeNull();
    await user.click(button('Continue'));
    expect(await step(/Review$/)).toBeInTheDocument();
  });

  it('holds automatically once a site is chosen instead', async () => {
    const { user } = renderWithApp({ route: PREFILL, api: api() });
    await stayTypes();
    await user.click(button('Choose sites'));
    await user.click(screen.getByRole('checkbox', { name: 'Cabin 2' }));
    await user.click(button('Continue'));
    await step(/Alerts$/);
    await user.click(
      screen.getByRole('checkbox', { name: 'Hold a site automatically when found' })
    );
    await user.click(button('Continue'));
    await step(/Review$/);
    expect(items(screen.getByRole('region', { name: 'Who' }))).toMatchObject({
      'Stay type': 'Any',
      'Preferred sites': '1 chosen',
    });
  });

  it('asks for nothing at a place with sites only, as before', async () => {
    const mock = api(makeMixedDetail({}, 'campsite'));
    const { user } = renderWithApp({ route: PREFILL, api: mock });
    await step(/Your stay$/);
    await screen.findByText('Preferred sites');
    expect(screen.queryByRole('group', { name: 'Stay type' })).toBeNull();
    await user.click(button('Continue'));
    await step(/Alerts$/);
    await user.click(
      screen.getByRole('checkbox', { name: 'Hold a site automatically when found' })
    );
    await user.click(button('Continue'));
    await step(/Review$/);
    expect(within(screen.getByRole('region', { name: 'Who' })).queryByText('Stay type')).toBeNull();
  });
});
