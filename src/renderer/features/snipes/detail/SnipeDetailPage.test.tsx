import { screen, waitFor, within } from '@testing-library/react';
import { SnipeStatus } from '../../../../shared/types/common.types';
import { makeHeldSnipe, makeSnipe } from '@tests/fixtures/renderer/snipes';
import { catalogGet, makeLocationDetail } from '@tests/fixtures/renderer/watches';
import { createMockApi, fail, ok } from '@tests/utils/renderer/createMockApi';
import { currentRoute, renderWithApp } from '@tests/utils/renderer/renderWithApp';

const detail = makeLocationDetail({
  units: [{ unitId: '12', unitName: 'Site 12 (powered)', unitType: 'Powered' }],
});

function api(snipe: ReturnType<typeof makeSnipe> | null, extra = {}) {
  return {
    snipes: { get: jest.fn().mockResolvedValue(ok(snipe)) },
    catalog: { get: catalogGet(detail) },
    ...extra,
  };
}

describe('SnipeDetailPage', () => {
  it('/site-sniper/7 shows that snipe, its provider, place and timeline', async () => {
    const get = jest.fn().mockResolvedValue(ok(makeSnipe({ status: SnipeStatus.WAITING_RELEASE })));
    renderWithApp({ route: '/site-sniper/7', api: { ...api(null), snipes: { get } } });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Osprey Bay · Fri 11 – Sun 13 Dec' })
    ).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(7);
    expect(screen.getByRole('link', { name: 'Osprey Bay' })).toHaveAttribute(
      'href',
      '#/places/parkstay/20'
    );
    const main = screen.getByRole('main');
    expect(within(main).getAllByRole('img', { name: 'ParkStay WA' }).length).toBeGreaterThan(0);
    const progress = screen.getByRole('list', { name: 'Progress' });
    expect(within(progress).getByText('Waiting for release').closest('li')).toHaveAttribute(
      'aria-current',
      'step'
    );
    expect(screen.getByRole('timer', { name: /^Opens in/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disarm' })).toBeInTheDocument();
  });

  it('says "Snipe not found" for an unknown id, without leaving the address', async () => {
    renderWithApp({
      route: '/site-sniper/999',
      api: {
        snipes: { get: jest.fn().mockResolvedValue(fail('Site snipe not found', 'NOT_FOUND')) },
      },
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Snipe not found' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Site Sniper' })).toHaveAttribute(
      'href',
      '#/site-sniper'
    );
    expect(currentRoute()).toBe('/site-sniper/999');
  });

  it('leads a held snipe with Pay now and its countdown, and says it cannot be armed again', async () => {
    const openPayment = jest.fn().mockResolvedValue(ok(undefined));
    const { user } = renderWithApp({
      route: '/site-sniper/7',
      api: api(makeHeldSnipe(23), {
        snipes: { get: jest.fn().mockResolvedValue(ok(makeHeldSnipe(23))), openPayment },
      }),
    });
    const hold = await screen.findByRole('region', { name: 'Hold at Osprey Bay' });
    expect(await within(hold).findByText('Site 12 (powered) is held for you')).toBeInTheDocument();
    expect(within(hold).getByRole('timer', { name: /minutes left to pay$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Arm/ })).toBeNull();
    expect(
      screen.getByText(/A snipe that has held a site can't be armed again/)
    ).toBeInTheDocument();
    await user.click(within(hold).getByRole('button', { name: 'Pay now' }));
    expect(openPayment).toHaveBeenCalledWith(7);
  });

  it('names the held and preferred sites once the first catalogue sync finishes', async () => {
    const snipe = makeHeldSnipe(23, { unitIds: ['12'] });
    // A brand-new profile: until the first sync main knows no places
    const get = jest.fn().mockResolvedValue(fail('There is no location parkstay:20', 'NOT_FOUND'));
    const { mock } = renderWithApp({
      route: '/site-sniper/7',
      api: api(snipe, {
        snipes: { get: jest.fn().mockResolvedValue(ok(snipe)) },
        catalog: { get },
      }),
    });
    const hold = await screen.findByRole('region', { name: 'Hold at Osprey Bay' });
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(within(hold).getByText('Site 12 is held for you')).toBeInTheDocument();
    const stay = screen.getByRole('region', { name: 'Stay' });
    expect(within(stay).getByText('Site 12')).toBeInTheDocument();

    get.mockResolvedValue(ok(detail));
    mock!.emit('catalog:updated', {
      providerId: 'parkstay',
      count: 169,
      syncedAt: '2026-10-10T02:00:00Z',
    });
    expect(await within(hold).findByText('Site 12 (powered) is held for you')).toBeInTheDocument();
    expect(within(stay).getByText('Site 12 (powered)')).toBeInTheDocument();
  });

  it('links a booked snipe to its booking', async () => {
    const booked = makeHeldSnipe(5, { status: SnipeStatus.BOOKED, bookedReference: 'PB123' });
    renderWithApp({ route: '/site-sniper/7', api: api(booked) });
    expect(await screen.findByText('Booked on ParkStay')).toBeInTheDocument();
    expect(screen.getByText(/Reference PB123/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See it in Bookings' })).toHaveAttribute(
      'href',
      '#/bookings?q=PB123'
    );
  });

  it('shows why a snipe failed, and offers Arm again', async () => {
    renderWithApp({
      route: '/site-sniper/7',
      api: api(
        makeSnipe({
          status: SnipeStatus.FAILED,
          isActive: false,
          lastError: 'Another snipe holds these nights',
        })
      ),
    });
    expect(await screen.findByText('Another snipe holds these nights')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Arm again' })).toBeInTheDocument();
  });

  it('suggests connecting ParkStay before the release, without blocking', async () => {
    const signIn = jest
      .fn()
      .mockResolvedValue(
        ok({ providerId: 'parkstay', requirement: 'optional', status: 'signed-out' })
      );
    const mock = createMockApi(
      api(makeSnipe(), {
        accounts: {
          list: jest
            .fn()
            .mockResolvedValue(
              ok([{ providerId: 'parkstay', requirement: 'optional', status: 'signed-out' }])
            ),
          signIn,
        },
      })
    );
    const { user } = renderWithApp({ route: '/site-sniper/7', api: mock });
    expect(
      await screen.findByText('Connect ParkStay before the release so checkout is quicker.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disarm' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Connect ParkStay' }));
    expect(signIn).toHaveBeenCalledWith('parkstay');
  });

  it('goes back to the list after a delete', async () => {
    const remove = jest.fn().mockResolvedValue(ok(true));
    const { user } = renderWithApp({
      route: '/site-sniper/7',
      api: api(makeSnipe(), {
        snipes: {
          get: jest.fn().mockResolvedValue(ok(makeSnipe())),
          delete: remove,
          list: jest.fn().mockResolvedValue(ok([])),
        },
      }),
    });
    await user.click(await screen.findByRole('button', { name: /^More actions for/ }));
    expect(screen.queryByRole('menuitem', { name: 'View details' })).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete snipe' })
    );
    await waitFor(() => expect(currentRoute()).toBe('/site-sniper'));
    expect(remove).toHaveBeenCalledWith(7);
  });
});
