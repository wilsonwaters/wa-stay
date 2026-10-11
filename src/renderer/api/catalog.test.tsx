import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { createMockApi, fail, ok, PARKSTAY_MANIFEST } from '@tests/utils/renderer/createMockApi';
import { catalogApi, placeApi, syncingStatus } from '@tests/utils/renderer/catalog';
import { createQueryClient } from '../app/queryClient';
import { stayKeyFor } from '../../shared/utils/stay-key';
import { queryKeys } from './queryKeys';
import {
  BULK_AVAILABILITY_GC_TIME_MS,
  BULK_AVAILABILITY_STALE_TIME_MS,
  CATALOG_STALE_TIME_MS,
  normaliseCatalogQuery,
  useBulkAvailability,
  useCatalogAll,
  useCatalogRefresh,
  useCatalogSearch,
  useCatalogStatus,
  useCatalogUpdates,
  LOCATION_SEARCH_PENDING_MAX_MS,
  LOCATION_SEARCH_PENDING_POLL_MS,
  useLocationCheck,
  useLocationDetail,
  useLocationSearch,
} from './catalog';

/** Lets `ms` pass, with what it causes applied (inside act). */
const pause = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

function wrapper(client = createQueryClient()) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('normaliseCatalogQuery', () => {
  it('asks for everything (limit 5000), leaving out blank text and empty filters', () => {
    expect(normaliseCatalogQuery({})).toEqual({ limit: 5000 });
    expect(
      normaliseCatalogQuery({ text: '  ', regions: [], kinds: [], amenities: [], providerIds: [] })
    ).toEqual({ limit: 5000 });
  });

  it('trims the text and sorts filter values, so equal searches share a cache entry', () => {
    expect(
      normaliseCatalogQuery({ text: ' Cape ', regions: ['Pilbara', 'Kimberley'], limit: 10 })
    ).toEqual({ text: 'Cape', regions: ['Kimberley', 'Pilbara'], limit: 5000 });
  });

  it('never sends the map area: Explore filters by area itself', () => {
    expect(normaliseCatalogQuery({ bbox: [112, -35, 129, -13] })).toEqual({ limit: 5000 });
  });
});

describe('catalog hooks', () => {
  it('useCatalogSearch calls catalog.search with the filters and limit 5000', async () => {
    const mock = createMockApi(catalogApi());
    window.api = mock.api;
    const { result } = renderHook(
      () => useCatalogSearch({ text: 'Cape', bookingModes: ['online'] }),
      { wrapper: wrapper() }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mock.api.catalog.search).toHaveBeenCalledWith({
      text: 'Cape',
      bookingModes: ['online'],
      limit: 5000,
    });
    expect(result.current.data?.items.every((p) => p.bookingMode === 'online')).toBe(true);
    expect(CATALOG_STALE_TIME_MS).toBe(300_000);
  });

  it('keeps the previous results on screen while the next search loads', async () => {
    let release: () => void = () => undefined;
    const mock = createMockApi(catalogApi());
    const search = jest.mocked(mock.api.catalog.search);
    const real = search.getMockImplementation()!;
    window.api = mock.api;
    const { result, rerender } = renderHook(({ text }) => useCatalogSearch({ text }), {
      wrapper: wrapper(),
      initialProps: { text: '' },
    });
    await waitFor(() => expect(result.current.data?.total).toBe(169));

    search.mockImplementationOnce(
      (query) => new Promise((resolve) => (release = () => resolve(real(query))))
    );
    rerender({ text: 'Cape' });
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data?.total).toBe(169);
    act(() => release());
    await waitFor(() => expect(result.current.data?.total).toBe(21));
    expect(result.current.isPlaceholderData).toBe(false);
  });

  it('useCatalogAll is the unfiltered search, sharing its cache entry', async () => {
    const mock = createMockApi(catalogApi());
    window.api = mock.api;
    const { result } = renderHook(() => ({ all: useCatalogAll(), search: useCatalogSearch({}) }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.all.isSuccess).toBe(true));
    expect(result.current.search.data).toBe(result.current.all.data);
    expect(mock.api.catalog.search).toHaveBeenCalledTimes(1);
  });

  it('useCatalogStatus reads each provider’s sync state', async () => {
    window.api = createMockApi(catalogApi({ status: syncingStatus() })).api;
    const { result } = renderHook(() => useCatalogStatus(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.providers[0].syncing).toBe(true);
  });

  it('useCatalogStatus keeps asking while waiting, when given an interval', async () => {
    const mock = createMockApi(catalogApi({ status: syncingStatus() }));
    window.api = mock.api;
    const { unmount } = renderHook(() => useCatalogStatus({ refetchInterval: 20 }), {
      wrapper: wrapper(),
    });
    // At least 3: the 20 ms interval may run again between two checks on a busy runner.
    await waitFor(() =>
      expect(jest.mocked(mock.api.catalog.status).mock.calls.length).toBeGreaterThanOrEqual(3)
    );
    unmount();
  });

  it('useCatalogRefresh re-syncs and then reloads the catalogue queries', async () => {
    const mock = createMockApi(catalogApi());
    window.api = mock.api;
    const { result } = renderHook(
      () => ({ search: useCatalogSearch({}), refresh: useCatalogRefresh() }),
      { wrapper: wrapper() }
    );
    await waitFor(() => expect(result.current.search.isSuccess).toBe(true));
    await act(() => result.current.refresh.mutateAsync('parkstay'));
    expect(mock.api.catalog.refresh).toHaveBeenCalledWith('parkstay');
    await waitFor(() => expect(mock.api.catalog.search).toHaveBeenCalledTimes(2));
  });

  it('useCatalogUpdates reloads the catalogue when a provider finishes a sync', async () => {
    const mock = createMockApi(
      catalogApi({ catalog: { search: jest.fn().mockResolvedValue(ok({ items: [], total: 0 })) } })
    );
    window.api = mock.api;
    renderHook(
      () => {
        useCatalogUpdates();
        return useCatalogSearch({});
      },
      { wrapper: wrapper() }
    );
    await waitFor(() => expect(mock.api.catalog.search).toHaveBeenCalledTimes(1));
    mock.emit('catalog:updated', {
      providerId: 'parkstay',
      count: 169,
      syncedAt: '2026-10-04T00:00:00Z',
    });
    await waitFor(() => expect(mock.api.catalog.search).toHaveBeenCalledTimes(2));
  });
});

describe('useLocationSearch while a search-mode provider is pending', () => {
  const pendingAnswer = ok({ items: [], total: 0, pending: ['search'] });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Lets `ms` of fake time pass, with what it causes applied. */
  const advance = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));

  function renderSearch(search: jest.Mock, text = 'loft') {
    jest.useFakeTimers();
    window.api = createMockApi({ catalog: { search } }).api;
    return renderHook(
      (props: { text: string }) => useLocationSearch({ providerId: 'search', ...props }),
      {
        wrapper: wrapper(),
        initialProps: { text },
      }
    );
  }

  it('asks again every second, and stops 60 s after the text was first asked', async () => {
    const search = jest.fn().mockResolvedValue(pendingAnswer);
    const { result } = renderSearch(search);

    await advance(0);
    expect(result.current.waiting).toBe(true);
    await advance(10 * LOCATION_SEARCH_PENDING_POLL_MS);
    expect(search.mock.calls.length).toBeGreaterThanOrEqual(10);

    await advance(LOCATION_SEARCH_PENDING_MAX_MS);
    const atCap = search.mock.calls.length;
    expect(atCap).toBeLessThanOrEqual(
      LOCATION_SEARCH_PENDING_MAX_MS / LOCATION_SEARCH_PENDING_POLL_MS + 2
    );
    expect(result.current.waiting).toBe(false);
    await advance(30 * LOCATION_SEARCH_PENDING_POLL_MS);
    expect(search).toHaveBeenCalledTimes(atCap);
  });

  it('starts the 60 s again for a new text', async () => {
    const search = jest.fn().mockResolvedValue(pendingAnswer);
    const { result, rerender } = renderSearch(search);
    await advance(LOCATION_SEARCH_PENDING_MAX_MS + LOCATION_SEARCH_PENDING_POLL_MS);
    expect(result.current.waiting).toBe(false);
    const before = search.mock.calls.length;

    rerender({ text: 'cabin' });
    await advance(5 * LOCATION_SEARCH_PENDING_POLL_MS);

    expect(result.current.waiting).toBe(true);
    expect(search.mock.calls.length - before).toBeGreaterThanOrEqual(5);
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'cabin' }));
  });

  it('stops asking while the search fails, though the last answer listed the provider', async () => {
    const search = jest
      .fn()
      .mockResolvedValueOnce(pendingAnswer)
      .mockResolvedValue(fail('The catalogue is unavailable'));
    const { result } = renderSearch(search);
    await advance(0);
    expect(result.current.waiting).toBe(true);

    // A poll fails, and its one retry too
    await advance(5 * LOCATION_SEARCH_PENDING_POLL_MS);
    expect(result.current.isError).toBe(true);
    expect(result.current.data?.pending).toEqual(['search']);
    expect(result.current.waiting).toBe(false);
    const failed = search.mock.calls.length;
    await advance(30 * LOCATION_SEARCH_PENDING_POLL_MS);

    expect(search).toHaveBeenCalledTimes(failed);
  });
});

describe('place hooks', () => {
  const STAY = { arrival: '2026-11-06', departure: '2026-11-08', adults: 2 };

  it('useLocationDetail asks catalog.get, and nothing without a key', async () => {
    const mock = createMockApi(placeApi());
    window.api = mock.api;
    const { result, rerender } = renderHook(({ key }) => useLocationDetail(key), {
      wrapper: wrapper(),
      initialProps: { key: null as string | null },
    });
    expect(mock.api.catalog.get).not.toHaveBeenCalled();
    rerender({ key: 'parkstay:20' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mock.api.catalog.get).toHaveBeenCalledWith('parkstay:20');
    expect(result.current.data?.units).toHaveLength(24);
  });

  it("shows the place's summary from a cached search while its detail loads", async () => {
    const mock = createMockApi(placeApi());
    window.api = mock.api;
    let release: () => void = () => undefined;
    const real = jest.mocked(mock.api.catalog.get).getMockImplementation()!;
    jest
      .mocked(mock.api.catalog.get)
      .mockImplementationOnce(
        (key) => new Promise((resolve) => (release = () => resolve(real(key))))
      );
    const client = createQueryClient();
    const { result: search } = renderHook(() => useCatalogAll(), { wrapper: wrapper(client) });
    await waitFor(() => expect(search.current.isSuccess).toBe(true));

    const { result } = renderHook(() => useLocationDetail('parkstay:20'), {
      wrapper: wrapper(client),
    });
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data).toMatchObject({ name: 'Bungarra', units: [] });
    act(() => release());
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false));
    expect(result.current.data?.units).toHaveLength(24);
  });

  it('useLocationCheck asks only once a stay is given, once per stay, and never retries itself', async () => {
    const checkLocation = jest.fn().mockResolvedValue(fail('parkstay: HTTP 500', 'PROVIDER_ERROR'));
    const mock = createMockApi(placeApi({ catalog: { checkLocation } }));
    window.api = mock.api;
    const { result, rerender } = renderHook(({ stay }) => useLocationCheck('parkstay:20', stay), {
      wrapper: wrapper(),
      initialProps: { stay: null as typeof STAY | null },
    });
    expect(checkLocation).not.toHaveBeenCalled();
    rerender({ stay: STAY });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(checkLocation).toHaveBeenCalledTimes(1);
    expect(checkLocation).toHaveBeenCalledWith('parkstay:20', STAY);
  });

  it('useLocationCheck does not ask again when the computer comes back online', async () => {
    const mock = createMockApi(placeApi());
    window.api = mock.api;
    const client = createQueryClient();
    const { result } = renderHook(() => useLocationCheck('parkstay:20', STAY), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const query = client
      .getQueryCache()
      .find({ queryKey: queryKeys.catalog.check('parkstay:20', STAY) });
    expect(query?.options).toMatchObject({ refetchOnReconnect: false, retry: false });
    // Even once stale, a reconnect asks nothing.
    act(() => {
      query?.invalidate();
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    await pause(20);
    expect(mock.api.catalog.checkLocation).toHaveBeenCalledTimes(1);
  });
});

describe('useBulkAvailability', () => {
  const STAY_A = { arrival: '2099-11-06', departure: '2099-11-08', adults: 2 };
  const STAY_B = { arrival: '2099-11-13', departure: '2099-11-15', adults: 2 };
  /** A second catalogue provider with bulk availability, and one that checks one place only. */
  const FAKE = {
    ...PARKSTAY_MANIFEST,
    id: 'fake',
    name: 'Fake Stays',
    shortName: 'Fake',
    capabilities: { ...PARKSTAY_MANIFEST.capabilities, accessGate: false },
  };
  const SINGLE = {
    ...PARKSTAY_MANIFEST,
    id: 'single',
    name: 'Single Stays',
    shortName: 'Single',
    capabilities: { ...PARKSTAY_MANIFEST.capabilities, bulkAvailability: false },
  };
  const PARKSTAY_ENTRY = { key: 'parkstay:20', availableUnits: 3, bookableUnits: 5 };
  /** ParkStay's cache key for a stay: its bulk answer reads only the dates and the gear. */
  const parkstayKey = (stay: typeof STAY_A) =>
    stayKeyFor(stay, PARKSTAY_MANIFEST.bulkAvailabilityStayFields);
  const FAKE_ENTRY = { key: 'fake:1', availableUnits: 0, bookableUnits: 4 };

  /** `catalog.availability` as main answers, failing `failing` providers in `errors`. */
  function availability(failing: Record<string, string> = {}) {
    return jest.fn(async (_stay: unknown, options: { providerIds?: string[] } = {}) => {
      const [id] = options.providerIds ?? [];
      if (failing[id]) {
        return ok({
          entries: [],
          errors: [{ providerId: id, code: failing[id], message: `${id}: failed` }],
        });
      }
      const entries = [PARKSTAY_ENTRY, FAKE_ENTRY].filter((e) => e.key.startsWith(`${id}:`));
      return ok({ entries, errors: [] });
    });
  }

  function setup(stub = availability(), manifests = [PARKSTAY_MANIFEST, FAKE, SINGLE]) {
    const mock = createMockApi(
      catalogApi({
        catalog: { availability: stub },
        stubs: { providers: { list: jest.fn().mockResolvedValue(ok(manifests)) } },
      })
    );
    window.api = mock.api;
    return { mock, stub, client: createQueryClient() };
  }

  it('asks each catalogue provider with bulk availability on its own, and merges what they say', async () => {
    const { stub, client } = setup();
    const { result } = renderHook(() => useBulkAvailability(STAY_A), { wrapper: wrapper(client) });
    await waitFor(() =>
      expect(result.current.statusByProvider).toEqual({ parkstay: 'success', fake: 'success' })
    );
    expect(stub).toHaveBeenCalledTimes(2);
    expect(stub).toHaveBeenCalledWith(STAY_A, { providerIds: ['parkstay'] });
    expect(stub).toHaveBeenCalledWith(STAY_A, { providerIds: ['fake'] });
    expect([...result.current.byKey.values()]).toEqual(
      expect.arrayContaining([PARKSTAY_ENTRY, FAKE_ENTRY])
    );
    const query = client
      .getQueryCache()
      .find({ queryKey: queryKeys.catalog.availability(parkstayKey(STAY_A), 'parkstay') });
    expect(query?.options).toMatchObject({
      staleTime: BULK_AVAILABILITY_STALE_TIME_MS,
      gcTime: BULK_AVAILABILITY_GC_TIME_MS,
      retry: false,
      refetchOnReconnect: false,
    });
    expect([BULK_AVAILABILITY_STALE_TIME_MS, BULK_AVAILABILITY_GC_TIME_MS]).toEqual([
      120_000, 900_000,
    ]);
  });

  it('keeps a failing provider apart, and Retry asks only it again', async () => {
    const { stub, client } = setup(availability({ parkstay: 'access-gate' }));
    const { result } = renderHook(() => useBulkAvailability(STAY_A), { wrapper: wrapper(client) });
    await waitFor(() =>
      expect(result.current.statusByProvider).toEqual({ parkstay: 'error', fake: 'success' })
    );
    expect(result.current.errors.parkstay).toMatchObject({ code: 'ACCESS_GATE' });
    expect(result.current.byKey.get('fake:1')).toEqual(FAKE_ENTRY);
    expect(stub).toHaveBeenCalledTimes(2);

    stub.mockClear();
    act(() => result.current.refetch('parkstay'));
    await waitFor(() => expect(stub).toHaveBeenCalledTimes(1));
    expect(stub).toHaveBeenCalledWith(STAY_A, { providerIds: ['parkstay'] });
  });

  it('reads a provider main says has no bulk availability (CAPABILITY) as unsupported, not failed', async () => {
    const stub = jest.fn(async (_stay: unknown, options: { providerIds?: string[] } = {}) =>
      options.providerIds?.[0] === 'fake'
        ? fail('fake has no bulk availability', 'CAPABILITY')
        : ok({ entries: [PARKSTAY_ENTRY], errors: [] })
    );
    const { client } = setup(stub);
    const { result } = renderHook(() => useBulkAvailability(STAY_A), { wrapper: wrapper(client) });
    await waitFor(() =>
      expect(result.current.statusByProvider).toEqual({ parkstay: 'success', fake: 'unsupported' })
    );
    expect(result.current.errors).toEqual({});
  });

  it('asks nothing until the stay settles; a stay already cached shows at once', async () => {
    const { stub, client } = setup();
    const { result, rerender } = renderHook(
      ({ stay, settled }) => useBulkAvailability(stay, { settled }),
      { wrapper: wrapper(client), initialProps: { stay: STAY_A, settled: true } }
    );
    await waitFor(() => expect(result.current.statusByProvider.parkstay).toBe('success'));
    stub.mockClear();

    rerender({ stay: STAY_B, settled: false });
    expect(result.current.statusByProvider).toEqual({ parkstay: 'loading', fake: 'loading' });
    expect(result.current.byKey.size).toBe(0);
    await pause(20);
    expect(stub).not.toHaveBeenCalled();

    // Back to A before B settled: A's answer, from the cache, without asking.
    rerender({ stay: STAY_A, settled: false });
    expect(result.current.statusByProvider).toEqual({ parkstay: 'success', fake: 'success' });
    expect(result.current.byKey.get('parkstay:20')).toEqual(PARKSTAY_ENTRY);
    rerender({ stay: STAY_A, settled: true });
    await pause(20);
    expect(stub).not.toHaveBeenCalled();
  });

  it('never shows an answer for another stay: a late answer for A is kept for A only', async () => {
    let answerA: () => void = () => undefined;
    const real = availability();
    const stub = jest.fn((stay: typeof STAY_A, options: { providerIds?: string[] }) =>
      stay.arrival === STAY_A.arrival
        ? new Promise((resolve) => (answerA = () => resolve(real(stay, options))))
        : real(stay, options)
    );
    const { client } = setup(stub, [PARKSTAY_MANIFEST]);
    const { result, rerender } = renderHook(({ stay }) => useBulkAvailability(stay), {
      wrapper: wrapper(client),
      initialProps: { stay: STAY_A },
    });
    await waitFor(() => expect(result.current.statusByProvider).toEqual({ parkstay: 'loading' }));
    await waitFor(() => expect(stub).toHaveBeenCalledTimes(1));

    rerender({ stay: { ...STAY_B } });
    await waitFor(() => expect(result.current.statusByProvider).toEqual({ parkstay: 'success' }));
    const shownForB = result.current.byKey;
    await act(async () => answerA());
    expect(result.current.byKey).toBe(shownForB);
    expect(
      client.getQueryData(queryKeys.catalog.availability(parkstayKey(STAY_A), 'parkstay'))
    ).toMatchObject({ entries: [PARKSTAY_ENTRY] });
  });

  it('shows the answer it has when only the guests change, for a provider that ignores them', async () => {
    const PARTY = { ...PARKSTAY_MANIFEST, id: 'party', name: 'Party Stays', shortName: 'Party' };
    delete (PARTY as Partial<typeof PARTY>).bulkAvailabilityStayFields; // reads every field
    const { stub, client } = setup(availability(), [PARKSTAY_MANIFEST, PARTY]);
    const { result, rerender } = renderHook(
      ({ stay, settled }) => useBulkAvailability(stay, { settled }),
      { wrapper: wrapper(client), initialProps: { stay: STAY_A, settled: true } }
    );
    await waitFor(() =>
      expect(result.current.statusByProvider).toEqual({ parkstay: 'success', party: 'success' })
    );
    expect(stub).toHaveBeenCalledTimes(2);
    stub.mockClear();

    // 4 adults instead of 2, while the change settles: ParkStay's answer shows at once.
    const moreGuests = { ...STAY_A, adults: 4 };
    rerender({ stay: moreGuests, settled: false });
    expect(result.current.statusByProvider).toEqual({ parkstay: 'success', party: 'loading' });
    expect(result.current.byKey.get('parkstay:20')).toEqual(PARKSTAY_ENTRY);
    rerender({ stay: moreGuests, settled: true });
    await waitFor(() => expect(result.current.statusByProvider.party).toBe('success'));
    // Only the provider that reads the party is asked again.
    expect(stub).toHaveBeenCalledTimes(1);
    expect(stub).toHaveBeenCalledWith(moreGuests, { providerIds: ['party'] });
  });

  it('asks nothing offline: providers with nothing cached are idle', async () => {
    const { stub, client } = setup();
    const { result } = renderHook(() => useBulkAvailability(STAY_A, { online: false }), {
      wrapper: wrapper(client),
    });
    await waitFor(() =>
      expect(result.current.statusByProvider).toEqual({ parkstay: 'idle', fake: 'idle' })
    );
    await pause(20);
    expect(stub).not.toHaveBeenCalled();
  });

  it('asks nothing without a stay', async () => {
    const { stub, client } = setup();
    const { result } = renderHook(() => useBulkAvailability(null), { wrapper: wrapper(client) });
    await pause(20);
    expect(result.current.statusByProvider).toEqual({});
    expect(stub).not.toHaveBeenCalled();
  });

  it('is not asked again when a catalogue syncs (catalog:updated) or is refreshed', async () => {
    const { mock, stub, client } = setup();
    const { result } = renderHook(
      () => ({
        search: useCatalogSearch({}),
        availability: useBulkAvailability(STAY_A),
        refresh: useCatalogRefresh(),
        updates: useCatalogUpdates(),
      }),
      { wrapper: wrapper(client) }
    );
    await waitFor(() =>
      expect(result.current.availability.statusByProvider.parkstay).toBe('success')
    );
    expect(stub).toHaveBeenCalledTimes(2);
    mock.emit('catalog:updated', { providerId: 'parkstay', count: 169, syncedAt: '2026-10-04' });
    await waitFor(() => expect(mock.api.catalog.search).toHaveBeenCalledTimes(2));
    await act(() => result.current.refresh.mutateAsync('parkstay'));
    await waitFor(() => expect(mock.api.catalog.search).toHaveBeenCalledTimes(3));
    expect(stub).toHaveBeenCalledTimes(2);
  });
});
