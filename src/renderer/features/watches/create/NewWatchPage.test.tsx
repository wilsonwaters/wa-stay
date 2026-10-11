import { screen, waitFor, within } from '@testing-library/react';
import type { WatchInput } from '../../../../shared/types/watch.types';
import {
  BROWSE_ONLY_MANIFEST,
  FAKE_MANIFEST,
  PARKSTAY_MANIFEST,
  fail,
  ok,
} from '@tests/utils/renderer/createMockApi';
import { catalogGet, makeLocation, makeWatch } from '@tests/fixtures/renderer/watches';
import { currentRoute, renderWithApp } from '@tests/utils/renderer/renderWithApp';

const OSPREY = makeLocation();
const PREFILL =
  '/watches/new?provider=parkstay&location=20&arrival=2099-12-11&departure=2099-12-13&adults=2';

function api(
  overrides: Record<string, Record<string, jest.Mock>> = {},
  manifests = [PARKSTAY_MANIFEST, FAKE_MANIFEST]
) {
  const created = makeWatch({ id: 42 });
  return {
    providers: { list: jest.fn().mockResolvedValue(ok(manifests)) },
    catalog: {
      get: catalogGet(),
      search: jest.fn().mockResolvedValue(ok({ items: [OSPREY], total: 1 })),
      status: jest
        .fn()
        .mockResolvedValue(
          ok({ providers: [{ providerId: 'parkstay', count: 6, stale: false, syncing: false }] })
        ),
    },
    watches: {
      list: jest.fn().mockResolvedValue(ok([])),
      create: jest.fn().mockResolvedValue(ok(created)),
      get: jest.fn().mockResolvedValue(ok(created)),
    },
    ...overrides,
  };
}

const button = (name: string) => screen.getByRole('button', { name });
const sentInput = (mock: jest.Mock): WatchInput => mock.mock.calls[0][0];

describe('NewWatchPage', () => {
  it('a single watch provider is pre-selected and Continue is enabled', async () => {
    const { user } = renderWithApp({
      route: '/watches/new',
      api: api({}, [PARKSTAY_MANIFEST, BROWSE_ONLY_MANIFEST]),
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'New watch' })).toBeInTheDocument();
    const radio = await screen.findByRole('radio', { name: 'ParkStay WA' });
    await waitFor(() => expect(radio).toBeChecked());
    expect(screen.queryByRole('radio', { name: 'Browse Only' })).toBeNull();
    expect(button('Continue')).toBeEnabled();
    await user.click(button('Continue'));
    // The heading takes focus in an effect after the step renders.
    const location = await screen.findByRole('heading', { level: 2, name: /Location$/ });
    await waitFor(() => expect(location).toHaveFocus());
  });

  it('Create watch sends providerId, location, YYYY-MM-DD stay and no user id, then opens the watch', async () => {
    const mock = api();
    const { user } = renderWithApp({ route: PREFILL, api: mock });
    await screen.findByRole('heading', { level: 2, name: /Your stay$/ });
    await user.click(button('Continue'));
    await screen.findByRole('heading', { level: 2, name: /Alerts$/ });
    await user.click(button('Continue'));
    await screen.findByRole('heading', { level: 2, name: /Review$/ });
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(
      'Osprey Bay · Fri 11 – Sun 13 Dec 2099'
    );
    await user.click(button('Create watch'));

    await waitFor(() => expect(mock.watches.create).toHaveBeenCalledTimes(1));
    const input = sentInput(mock.watches.create);
    expect(input).toEqual({
      providerId: 'parkstay',
      name: 'Osprey Bay · Fri 11 – Sun 13 Dec 2099',
      location: { externalId: '20', name: 'Osprey Bay', areaName: 'Cape Range National Park' },
      stay: { arrival: '2099-12-11', departure: '2099-12-13', adults: 2 },
      stayParams: { gearType: 'all' },
      checkIntervalMinutes: 60,
      notifyOnly: true,
      allowPartialMatch: false,
    });
    await waitFor(() => expect(currentRoute()).toBe('/watches/42'));
    expect(
      within(screen.getByRole('region', { name: 'Notifications' })).getByText('Watch created')
    ).toBeInTheDocument();
  });

  it('creates a watch with no unit or unit type chosen', async () => {
    const mock = api();
    const { user } = renderWithApp({ route: PREFILL, api: mock });
    await screen.findByRole('heading', { level: 2, name: /Your stay$/ });
    for (let i = 0; i < 3; i += 1) await user.click(button(i === 2 ? 'Create watch' : 'Continue'));
    await waitFor(() => expect(mock.watches.create).toHaveBeenCalled());
    expect(sentInput(mock.watches.create)).not.toHaveProperty('unitIds');
  });

  it('creates a watch with an empty max price (no NaN)', async () => {
    const mock = api();
    const { user } = renderWithApp({ route: PREFILL, api: mock });
    const price = await screen.findByRole('textbox', { name: /Max price per night/ });
    await user.type(price, '45');
    await user.clear(price);
    for (let i = 0; i < 3; i += 1) await user.click(button(i === 2 ? 'Create watch' : 'Continue'));
    await waitFor(() => expect(mock.watches.create).toHaveBeenCalled());
    const input = sentInput(mock.watches.create);
    expect(input).not.toHaveProperty('maxPrice');
    expect(JSON.stringify(input)).not.toContain('NaN');
  });

  it('sends a typed max price as dollars and rejects one that is not a price', async () => {
    const mock = api();
    const { user } = renderWithApp({ route: PREFILL, api: mock });
    const price = await screen.findByRole('textbox', { name: /Max price per night/ });
    await user.type(price, 'cheap');
    await user.click(button('Continue'));
    await waitFor(() => expect(price).toHaveFocus());
    expect(price).toHaveAccessibleDescription(
      /Enter a price in dollars, like 40, or leave it empty/
    );
    await user.clear(price);
    await user.type(price, '45.50');
    for (let i = 0; i < 3; i += 1) await user.click(button(i === 2 ? 'Create watch' : 'Continue'));
    await waitFor(() => expect(mock.watches.create).toHaveBeenCalled());
    expect(sentInput(mock.watches.create).maxPrice).toBe(45.5);
  });

  it('Continue focuses the first invalid field, described by its error', async () => {
    const { user } = renderWithApp({
      route: '/watches/new?provider=parkstay&location=20',
      api: api(),
    });
    await screen.findByRole('heading', { level: 2, name: /Your stay$/ });
    await user.click(button('Continue'));
    const dates = screen.getByRole('button', { name: /^Dates/ });
    await waitFor(() => expect(dates).toHaveFocus());
    expect(dates).toHaveAttribute('aria-invalid', 'true');
    expect(dates).toHaveAccessibleDescription('Choose your check-in and check-out dates');
    expect(screen.getByRole('heading', { level: 2, name: /Your stay$/ })).toBeInTheDocument();
  });

  it('clears the dates error as soon as a valid range is chosen', async () => {
    const { user } = renderWithApp({
      route: '/watches/new?provider=parkstay&location=20',
      api: api(),
    });
    await screen.findByRole('heading', { level: 2, name: /Your stay$/ });
    await user.click(button('Continue'));
    const error = 'Choose your check-in and check-out dates';
    expect(await screen.findByText(error)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Dates/ }));
    await user.keyboard('{ArrowRight}{Enter}{ArrowRight}{ArrowRight}{Enter}');
    const picker = screen.getByRole('dialog', { name: 'Choose dates' });
    await user.click(within(picker).getByRole('button', { name: 'Done' }));

    const dates = screen.getByRole('button', { name: /^Dates .+ – .+/ });
    await waitFor(() => expect(screen.queryByText(error)).toBeNull());
    expect(dates).not.toHaveAttribute('aria-invalid');
    expect(dates).not.toHaveAccessibleDescription(error);
  });

  it('takes a VALIDATION answer from main back to the step that owns the field', async () => {
    const mock = api({
      watches: {
        list: jest.fn().mockResolvedValue(ok([])),
        create: jest.fn().mockResolvedValue({
          success: false,
          code: 'VALIDATION',
          error: 'Arrival must be in the future',
          issues: ['stay.arrival'],
        }),
      },
    });
    const { user } = renderWithApp({ route: PREFILL, api: mock });
    await screen.findByRole('heading', { level: 2, name: /Your stay$/ });
    for (let i = 0; i < 3; i += 1) await user.click(button(i === 2 ? 'Create watch' : 'Continue'));
    const dates = await screen.findByRole('button', { name: /^Dates/ });
    await waitFor(() => expect(dates).toHaveFocus());
    expect(dates).toHaveAccessibleDescription('Arrival must be in the future');
  });

  it('takes a VALIDATION on a number stay field back to it, focused and described', async () => {
    const mock = api({
      watches: {
        list: jest.fn().mockResolvedValue(ok([])),
        create: jest.fn().mockResolvedValue({
          success: false,
          code: 'VALIDATION',
          error: 'Vehicles must be at most 5',
          issues: ['stayParams.numVehicles'],
        }),
      },
    });
    const { user } = renderWithApp({ route: PREFILL, api: mock });
    await screen.findByRole('heading', { level: 2, name: /Your stay$/ });
    await user.click(button('Continue'));
    await user.click(
      await screen.findByRole('checkbox', { name: 'Hold a site automatically when found' })
    );
    await user.click(button('Continue'));
    await user.click(await screen.findByRole('button', { name: 'Create watch' }));

    const vehicles = await screen.findByRole('group', { name: 'Vehicles' });
    await waitFor(() => expect(vehicles).toHaveFocus());
    expect(vehicles).toHaveAttribute('aria-invalid', 'true');
    expect(vehicles).toHaveAccessibleDescription('Vehicles must be at most 5');
    expect(screen.getByRole('heading', { level: 2, name: /Alerts$/ })).toBeInTheDocument();
  });

  it('shows why creating failed and keeps the review', async () => {
    const mock = api({
      watches: {
        list: jest.fn().mockResolvedValue(ok([])),
        create: jest.fn().mockResolvedValue(fail('The database is busy')),
      },
    });
    const { user } = renderWithApp({ route: PREFILL, api: mock });
    await screen.findByRole('heading', { level: 2, name: /Your stay$/ });
    for (let i = 0; i < 3; i += 1) await user.click(button(i === 2 ? 'Create watch' : 'Continue'));
    expect(await screen.findByText("The watch couldn't be created")).toBeInTheDocument();
    expect(screen.getByText('The database is busy')).toBeInTheDocument();
    expect(button('Create watch')).toBeInTheDocument();
  });

  it('says so when no provider supports watches', async () => {
    renderWithApp({ route: '/watches/new', api: api({}, [BROWSE_ONLY_MANIFEST]) });
    expect(
      await screen.findByRole('heading', { name: 'No provider supports watches yet' })
    ).toBeInTheDocument();
  });
});
