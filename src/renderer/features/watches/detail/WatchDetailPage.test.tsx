import { screen, waitFor, within } from '@testing-library/react';
import { WatchResult } from '../../../../shared/types/common.types';
import type { Watch } from '../../../../shared/types/watch.types';
import { PARKSTAY_MANIFEST, fail, ok } from '@tests/utils/renderer/createMockApi';
import {
  catalogGet,
  makeLocationDetail,
  makeUnit,
  makeWatch,
} from '@tests/fixtures/renderer/watches';
import { currentRoute, renderWithApp } from '@tests/utils/renderer/renderWithApp';

const NIGHTS = ['2099-12-11', '2099-12-12'];
const WATCH = makeWatch({
  id: 7,
  name: 'Osprey summer',
  lastResult: WatchResult.FOUND,
  lastCheckedAt: new Date(Date.now() - 5 * 60_000),
  nextCheckAt: new Date(Date.now() + 55 * 60_000),
  foundCount: 2,
  lastAvailability: [makeUnit('1', NIGHTS), makeUnit('2', NIGHTS)],
  stayParams: { gearType: 'tent' },
  notes: 'Near the water',
});

function api(watch: Watch | null = WATCH, extra: Record<string, jest.Mock> = {}) {
  return {
    providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST])) },
    watches: {
      get: jest.fn().mockResolvedValue(ok(watch)),
      list: jest.fn().mockResolvedValue(ok([])),
      ...extra,
    },
    accounts: { list: jest.fn().mockResolvedValue(ok([])) },
  };
}

const heading = () => screen.getByRole('heading', { level: 1, name: 'Osprey summer' });

describe('WatchDetailPage', () => {
  it('shows the watch: provider, linked location, stay, preferences and status', async () => {
    renderWithApp({ route: '/watches/7', api: api() });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Osprey summer' })
    ).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'ParkStay WA' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Osprey Bay' })).toHaveAttribute(
      'href',
      '#/places/parkstay/20'
    );
    const stay = screen.getByRole('region', { name: 'Stay' });
    expect(within(stay).getByText(/Fri 11 – Sun 13 Dec 2099 · 2 nights/)).toBeInTheDocument();
    expect(within(stay).getByText('Tent')).toBeInTheDocument();
    const status = screen.getByRole('region', { name: 'Status' });
    expect(within(status).getByText('Watching')).toBeInTheDocument();
    expect(within(status).getByText('5 min ago')).toBeInTheDocument();
    expect(within(status).getByText('2 times')).toBeInTheDocument();
    expect(screen.getByText('2 sites available')).toBeInTheDocument();
    expect(screen.getByText('Near the water')).toBeInTheDocument();
  });

  it('shows a 1.x site type that is not one of the options as it was saved ("Unpowered")', async () => {
    renderWithApp({
      route: '/watches/7',
      api: api({ ...WATCH, stayParams: { parkId: '17', gearType: 'Unpowered' } }),
    });
    const stay = await screen.findByRole('region', { name: 'Stay' });
    expect(within(stay).getByText('Camping with')).toBeInTheDocument();
    expect(within(stay).getByText('Unpowered')).toBeInTheDocument();
    expect(within(stay).queryByText('Any')).toBeNull();
  });

  it('keeps heading and summaries while watch:updated and Check now refetch', async () => {
    let answer: (value: unknown) => void = () => undefined;
    const mock = api(WATCH, {
      runNow: jest
        .fn()
        .mockResolvedValue(
          ok({ watchId: 7, success: true, found: false, matches: [], checkedAt: new Date() })
        ),
    });
    const { user, mock: app } = renderWithApp({ route: '/watches/7', api: mock });
    await screen.findByRole('heading', { level: 1, name: 'Osprey summer' });

    mock.watches.get.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    app?.emit('watch:updated', WATCH);
    expect(await screen.findByText('Updating…', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(heading()).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Stay' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading watch' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Check now' }));
    expect(heading()).toBeInTheDocument();
    await waitFor(() => expect(mock.watches.runNow).toHaveBeenCalledWith(7));
    expect(
      await within(screen.getByRole('region', { name: 'Notifications' })).findByText(
        'Nothing available yet'
      )
    ).toBeInTheDocument();
    answer(ok({ ...WATCH, foundCount: 3 }));
    await waitFor(() => expect(screen.queryByText('Updating…')).toBeNull());
    expect(
      within(screen.getByRole('region', { name: 'Status' })).getByText('3 times')
    ).toBeInTheDocument();
  });

  it('shows why the last check failed', async () => {
    renderWithApp({
      route: '/watches/7',
      api: api({
        ...WATCH,
        lastResult: WatchResult.ERROR,
        lastError: 'ParkStay did not answer in time',
      }),
    });
    // The danger tone: a failed check is an error, not a caution.
    const notice = (await screen.findByText('ParkStay did not answer in time')).closest(
      '[role="alert"]'
    ) as HTMLElement;
    expect(within(notice).getByText('Last check failed')).toBeInTheDocument();
  });

  it('leads with the place’s photo, names chosen units, prices in the currency, and hides Found 0', async () => {
    const detail = makeLocationDetail({ imageUrls: ['https://example.org/osprey.jpg'] });
    renderWithApp({
      route: '/watches/7',
      api: {
        ...api({ ...WATCH, foundCount: 0, unitIds: ['3', '5'], maxPrice: 42.5 }),
        catalog: { get: catalogGet(detail) },
      },
    });
    const header = (await screen.findByRole('heading', { level: 1 })).closest('header');
    const photo = await within(header as HTMLElement).findByRole('img', { name: 'Osprey Bay' });
    expect(photo).toHaveAttribute('src', 'https://example.org/osprey.jpg');
    const preferences = screen.getByRole('region', { name: 'Preferences' });
    expect(await within(preferences).findByText('Site 3, Site 5')).toBeInTheDocument();
    expect(within(preferences).getByText('$42.50')).toBeInTheDocument();
    const status = screen.getByRole('region', { name: 'Status' });
    expect(within(status).queryByText('Found')).not.toBeInTheDocument();
    expect(within(status).queryByText(/0 times/)).not.toBeInTheDocument();
  });

  it('falls back to the placeholder when the catalogue has no such place', async () => {
    renderWithApp({
      route: '/watches/7',
      api: {
        ...api(),
        catalog: { get: catalogGet(makeLocationDetail({ key: 'parkstay:other' })) },
      },
    });
    expect(
      await screen.findByRole('img', { name: 'No photo available for Osprey Bay' })
    ).toBeInTheDocument();
  });

  it('offers Pay now as the page’s main action while a hold is live', async () => {
    const openPayment = jest.fn().mockResolvedValue(ok(undefined));
    const held = {
      ...WATCH,
      lastResult: WatchResult.HELD,
      hold: { reference: 'PB1', unitId: '1', expiresAt: new Date(Date.now() + 20 * 60_000) },
    };
    const { user } = renderWithApp({ route: '/watches/7', api: api(held, { openPayment }) });
    // The hold panel a held snipe shows: the unit, its expiry, the time left, Pay now.
    const hold = await screen.findByRole('region', { name: 'Hold at Osprey Bay' });
    expect(within(hold).getByText('Site 1 is held for you')).toBeInTheDocument();
    expect(
      within(hold).getByText(/^Held until (?:\w{3} \d{1,2} \w{3}, )?\d{1,2}:\d{2} [ap]m AWST/)
    ).toBeInTheDocument();
    expect(within(hold).getByRole('timer', { name: /left to pay$/ })).toBeInTheDocument();
    expect(
      within(hold).getByText(/^Pay on ParkStay before the hold runs out\./)
    ).toBeInTheDocument();
    // The stored flag is off in this row, but a hold was placed: the summary says so.
    const preferences = screen.getByRole('region', { name: 'Preferences' });
    expect(within(preferences).getByText(/^On: Site 1 held until /)).toBeInTheDocument();
    expect(within(preferences).queryByText('Off')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Pay now' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
    await user.click(within(hold).getByRole('button', { name: 'Pay now' }));
    expect(openPayment).toHaveBeenCalledWith(7);
  });

  it('says why when the hold is gone by the time Pay now is pressed (HOLD_EXPIRED)', async () => {
    const openPayment = jest.fn().mockResolvedValue(fail('gone', 'HOLD_EXPIRED'));
    const held = {
      ...WATCH,
      lastResult: WatchResult.HELD,
      hold: { reference: 'PB1', unitId: '1', expiresAt: new Date(Date.now() + 20 * 60_000) },
    };
    const { user } = renderWithApp({ route: '/watches/7', api: api(held, { openPayment }) });
    const hold = await screen.findByRole('region', { name: 'Hold at Osprey Bay' });
    await user.click(within(hold).getByRole('button', { name: 'Pay now' }));
    expect(
      await within(screen.getByRole('region', { name: 'Notifications' })).findByText(
        'This hold has expired, so it can no longer be paid for.'
      )
    ).toBeInTheDocument();
  });

  it('Delete confirms and returns to /watches', async () => {
    const remove = jest.fn().mockResolvedValue(ok(true));
    const { user } = renderWithApp({ route: '/watches/7', api: api(WATCH, { delete: remove }) });
    await screen.findByRole('heading', { level: 1, name: 'Osprey summer' });
    await user.click(screen.getByRole('button', { name: 'More actions for Osprey summer' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete Osprey summer?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete watch' }));
    await waitFor(() => expect(currentRoute()).toBe('/watches'));
    expect(remove).toHaveBeenCalledWith(7);
  });

  it('says when the watch does not exist', async () => {
    renderWithApp({ route: '/watches/7', api: api(null) });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Watch not found' })
    ).toBeInTheDocument();
  });

  it('offers a retry when the watch cannot be loaded', async () => {
    const mock = api();
    mock.watches.get.mockResolvedValue(fail('Database is locked'));
    renderWithApp({ route: '/watches/7', api: mock });
    expect(
      await screen.findByText("This watch couldn't be loaded", {}, { timeout: 4000 })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
