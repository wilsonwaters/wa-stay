import { screen, waitFor, within } from '@testing-library/react';
import { makeHeldSnipe, makeSnipe, snipeFlowApi } from '@tests/fixtures/renderer/snipes';
import { catalogGet, makeLocationDetail, makeMixedDetail } from '@tests/fixtures/renderer/watches';
import { createMockApi, ok, PARKSTAY_MANIFEST } from '@tests/utils/renderer/createMockApi';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { SnipeCard } from './list/SnipeCard';
import { SnipesPage } from './SnipesPage';

/**
 * Site Sniper's pages name units by their kinds (R9): a held cabin is a "Cabin held", a snipe of
 * cabins prefers cabins, one at a place of sites and cabins prefers "spots", and the Release step
 * asks when the cabins are released.
 */
const MIXED = makeMixedDetail();
const heldCabin = makeHeldSnipe(20, { holdUnitId: 'c1' });

describe('Site Sniper: unit nouns', () => {
  it('a held cabin: "Cabin held", named as the place names it, and "held a cabin"', async () => {
    renderWithApp({
      route: '/site-sniper/7',
      api: {
        snipes: { get: jest.fn().mockResolvedValue(ok(heldCabin)) },
        catalog: { get: catalogGet(MIXED) },
      },
    });
    const hold = await screen.findByRole('region', { name: 'Hold at Osprey Bay' });
    expect(await within(hold).findByText('Cabin 1 is held for you')).toBeInTheDocument();
    expect(
      await screen.findByText(/A snipe that has held a cabin can't be armed again/)
    ).toBeInTheDocument();
  });

  it('a snipe’s preferences: "spots" at a mixed place, "cabins" with Cabins & villas chosen', async () => {
    const { unmount } = renderWithApp({
      route: '/site-sniper/7',
      api: {
        snipes: { get: jest.fn().mockResolvedValue(ok(makeSnipe({ id: 7 }))) },
        catalog: { get: catalogGet(MIXED) },
      },
    });
    const stay = await screen.findByRole('region', { name: 'Stay' });
    expect(await within(stay).findByText('Preferred spots')).toBeInTheDocument();
    expect(within(stay).getByText('Any spot')).toBeInTheDocument();
    unmount();

    renderWithApp({
      route: '/site-sniper/7',
      api: {
        snipes: {
          get: jest.fn().mockResolvedValue(ok(makeSnipe({ id: 7, unitKinds: ['cabin'] }))),
        },
        catalog: { get: catalogGet(MIXED) },
      },
    });
    const cabins = await screen.findByRole('region', { name: 'Stay' });
    expect(await within(cabins).findByText('Preferred cabins')).toBeInTheDocument();
    expect(within(cabins).getByText('Any cabin')).toBeInTheDocument();
  });

  it('a held cabin’s card says "Cabin held" once the place’s units load', async () => {
    renderWithProviders(
      <SnipeCard snipe={heldCabin} manifest={PARKSTAY_MANIFEST} today="2099-06-01" />,
      { api: { catalog: { get: catalogGet(MIXED) } } }
    );
    const card = screen.getByRole('article', { name: heldCabin.name });
    expect(await within(card).findByText('Cabin held')).toBeInTheDocument();
    expect(within(card).getByText('Cabin 1 is held for you')).toBeInTheDocument();
  });

  it('announces a hold on a cabin as "Cabin held", as its pill and hold panel say', async () => {
    const snipe = makeSnipe();
    const list = jest.fn().mockResolvedValue(ok([snipe]));
    const mock = createMockApi({ snipes: { list }, catalog: { get: catalogGet(MIXED) } });
    renderWithProviders(<SnipesPage />, { api: mock });
    await screen.findByRole('article', { name: snipe.name });

    const held = { ...heldCabin, name: snipe.name };
    list.mockResolvedValue(ok([held]));
    mock.emit('snipe:updated', held);
    // Said at once, then named as the card names it once the place's units load
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Cabin held at Osprey Bay. Pay within 20 minutes.'
      )
    );
    const card = screen.getByRole('article', { name: snipe.name });
    expect(await within(card).findByText('Cabin held')).toBeInTheDocument();
  });

  it('asks when the cabins are released at a place of cabins', async () => {
    const cabins = makeLocationDetail({
      kind: 'cabin',
      releaseInfo: 'Bookings open 180 days ahead at 12:00 am AWST',
      units: [1, 2].map((n) => ({ unitId: `c${n}`, unitName: `Cabin ${n}`, unitKind: 'cabin' })),
    });
    const { user } = renderWithApp({
      route:
        '/site-sniper/new?provider=parkstay&location=20&arrival=2099-12-11&departure=2099-12-13&adults=2',
      api: snipeFlowApi({}, undefined, cabins),
    });
    await screen.findByRole('heading', { level: 2, name: /Your stay$/ });
    expect(await screen.findByText('Preferred cabins')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      await screen.findByRole('radiogroup', { name: 'When are the cabins released?' })
    ).toBeInTheDocument();
  });
});
