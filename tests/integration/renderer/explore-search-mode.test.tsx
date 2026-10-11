/**
 * DX2 in the whole renderer: a provider searched by map area (`catalogMode: 'search'`) beside
 * ParkStay. Explore tells main the area it shows (all of WA as a list), and the places main
 * finds appear once it announces them (`catalog:updated`); with ParkStay alone nothing about
 * the area is sent. A found place opens on its page and hands off to a filled-in new watch.
 */
import { act, configure, screen, waitFor, within } from '@testing-library/react';
import { AREA_SEARCH_DEBOUNCE_MS } from '../../../src/renderer/features/explore/ExplorePage';
import { WA_BOUNDS } from '../../../src/renderer/features/explore/map/geo';
import type { CatalogQuery, LocationSummary } from '../../../src/shared/types/catalog.types';
import type { ProviderManifest } from '../../../src/shared/types/provider.types';
import { PARKSTAY_LOCATIONS, searchLocations } from '../../fixtures/catalog/parkstay-locations';
import { makeLocation, makeLocationDetail } from '../../fixtures/renderer/watches';
import { catalogApi, placeApi, syncedStatus } from '../../utils/renderer/catalog';
import {
  FAKE_MANIFEST,
  IDLE_ACCESS,
  ok,
  PARKSTAY_MANIFEST,
} from '../../utils/renderer/createMockApi';
import { currentRoute, renderWithApp } from '../../utils/renderer/renderWithApp';

configure({ asyncUtilTimeout: 4000 });

const SEARCH_MANIFEST: ProviderManifest = {
  ...FAKE_MANIFEST,
  id: 'search',
  name: 'Search Stays',
  shortName: 'SearchStays',
  locationKinds: ['cabin'],
  capabilities: { ...FAKE_MANIFEST.capabilities, catalogMode: 'search' },
};

/** A second search-mode provider, for the provider filter. */
const OTHER_SEARCH_MANIFEST: ProviderManifest = {
  ...SEARCH_MANIFEST,
  id: 'search2',
  name: 'More Search Stays',
  shortName: 'MoreStays',
};

const QUENDA: LocationSummary = makeLocation({
  providerId: 'search',
  externalId: 'quenda',
  name: 'Quenda Cottage',
  kind: 'cabin',
  lat: -31.95,
  lng: 115.86,
  area: { name: 'Perth Hills', region: 'Perth' },
  unitCount: 1,
});

const WA_BBOX = [WA_BOUNDS[0][0], WA_BOUNDS[0][1], WA_BOUNDS[1][0], WA_BOUNDS[1][1]];

const providers = (...manifests: ProviderManifest[]) => ({
  providers: {
    list: jest.fn().mockResolvedValue(ok(manifests)),
    accessStatus: jest.fn().mockResolvedValue(ok(IDLE_ACCESS)),
  },
});

/** A `catalog.search` over what main has stored, which a test can add to. */
function storedSearch(stored: LocationSummary[]): jest.Mock {
  return jest.fn(async (query: CatalogQuery) => ok(searchLocations(query, stored)));
}

const areaRequests = (search: jest.Mock): CatalogQuery[] =>
  search.mock.calls.map(([query]) => query as CatalogQuery).filter((query) => query.bbox);

describe('Explore with a search-mode provider', () => {
  it('asks main for the area it shows, and lists the places found once catalog:updated arrives', async () => {
    const stored = [...PARKSTAY_LOCATIONS];
    const search = storedSearch(stored);
    const { mock } = renderWithApp({
      route: '/?providers=search',
      api: catalogApi({
        catalog: { search },
        stubs: providers(PARKSTAY_MANIFEST, SEARCH_MANIFEST),
      }),
    });
    const results = await screen.findByRole('region', { name: 'Results' });
    expect(
      await within(results).findByRole('heading', { name: 'No places match your search' })
    ).toBeInTheDocument();

    // Without a map, the area is all of WA; only the search-mode provider is asked about it
    await waitFor(() =>
      expect(areaRequests(search)).toEqual([{ bbox: WA_BBOX, providerIds: ['search'], limit: 1 }])
    );

    // Main stores what the provider found, and says so
    stored.push(QUENDA);
    mock!.emit('catalog:updated', {
      providerId: 'search',
      count: 1,
      syncedAt: '2026-10-10T00:00:00.000Z',
    });

    expect(await within(results).findByRole('heading', { name: '1 place' })).toBeInTheDocument();
    const card = within(results).getByRole('link', { name: 'Quenda Cottage' });
    expect(card).toHaveAttribute('href', '#/places/search/quenda');
  });

  it("asks only the search-mode providers Explore's provider filter keeps", async () => {
    const search = storedSearch([...PARKSTAY_LOCATIONS]);
    renderWithApp({
      route: '/?providers=parkstay,search',
      api: catalogApi({
        catalog: { search },
        stubs: providers(PARKSTAY_MANIFEST, SEARCH_MANIFEST, OTHER_SEARCH_MANIFEST),
      }),
    });

    await waitFor(() =>
      expect(areaRequests(search)).toEqual([{ bbox: WA_BBOX, providerIds: ['search'], limit: 1 }])
    );
  });

  it('sends no map area when the provider filter leaves out every search-mode provider', async () => {
    const search = storedSearch([...PARKSTAY_LOCATIONS]);
    renderWithApp({
      route: '/?providers=parkstay',
      api: catalogApi({
        catalog: { search },
        stubs: providers(PARKSTAY_MANIFEST, SEARCH_MANIFEST, OTHER_SEARCH_MANIFEST),
      }),
    });
    const results = await screen.findByRole('region', { name: 'Results' });
    await within(results).findByRole('heading', { name: '169 places' });
    await act(() => new Promise((resolve) => setTimeout(resolve, AREA_SEARCH_DEBOUNCE_MS + 100)));

    expect(areaRequests(search)).toEqual([]);
  });

  it('with ParkStay alone (a full catalogue), sends no map area at all', async () => {
    const search = storedSearch([...PARKSTAY_LOCATIONS]);
    renderWithApp({ route: '/', api: catalogApi({ catalog: { search } }) });
    const results = await screen.findByRole('region', { name: 'Results' });
    await within(results).findByRole('heading', { name: '169 places' });
    // Longer than Explore waits for the map to settle before it sends an area
    await act(() => new Promise((resolve) => setTimeout(resolve, AREA_SEARCH_DEBOUNCE_MS + 100)));

    expect(areaRequests(search)).toEqual([]);
    expect(search.mock.calls.map(([query]) => query)).toEqual([{ limit: 5000 }]);
  });

  it("opens a found place's page and hands it off to a new watch, whose location step finds only places seen", async () => {
    const detail = makeLocationDetail({
      ...QUENDA,
      units: [{ unitId: 'u1', unitName: 'Cottage' }],
    });
    const { user } = renderWithApp({
      route: '/places/search/quenda?arrival=2099-01-10&departure=2099-01-12&adults=2',
      api: placeApi({
        items: [...PARKSTAY_LOCATIONS, QUENDA],
        detail,
        status: {
          providers: [
            ...syncedStatus().providers,
            {
              providerId: 'search',
              count: 1,
              stale: false,
              syncing: false,
              search: { textSearch: false, searchedAt: '2026-10-10T00:00:00.000Z' },
            },
          ],
        },
        stubs: providers(PARKSTAY_MANIFEST, SEARCH_MANIFEST),
      }),
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Quenda Cottage' })
    ).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'Check your dates' });
    await user.click(within(card).getByRole('link', { name: 'Watch for availability' }));

    expect(currentRoute()).toBe(
      '/watches/new?provider=search&location=quenda&arrival=2099-01-10&departure=2099-01-12&adults=2'
    );
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Step 3 of 5: Your stay' })
    ).toBeInTheDocument();
    const steps = screen.getByRole('navigation', { name: 'New watch steps' });
    await user.click(within(steps).getByRole('button', { name: 'Location, done' }));
    const location = await screen.findByRole('combobox', { name: 'Location' });
    expect(location).toHaveValue('Quenda Cottage');

    // SearchStays cannot be searched by name: a name it has not shown on the map finds nothing
    await user.clear(location);
    await user.type(location, 'Loft');
    expect(
      await screen.findByRole('option', {
        name: 'Browse SearchStays places on the Explore map to find more',
      })
    ).toBeInTheDocument();
  });
});
