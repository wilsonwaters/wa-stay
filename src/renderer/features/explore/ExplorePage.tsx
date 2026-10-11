import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useLocation } from 'react-router';
import { Hourglass, List, Map as MapIcon } from 'lucide-react';
import type {
  BoundingBox,
  CatalogQuery,
  CatalogSearchResult,
  LocationSummary,
} from '../../../shared/types/catalog.types';
import {
  normaliseCatalogQuery,
  stayKey,
  toApiError,
  useBulkAvailability,
  useCatalogAll,
  useCatalogAreaSearch,
  useCatalogRefresh,
  useCatalogSearch,
  useCatalogStatus,
  useCatalogUpdates,
  useProviders,
  useProvidersWith,
} from '../../api';
import type { PlaceLinkState } from '../../app/routes';
import type { StayParams } from '../../app/stayParams';
import type { CardAvailability } from '../../components/LocationCard';
import { hasMapLocation, placesLabel } from '../../components/locationFormat';
import { stayRangeLabel } from '../../components/nightGridModel';
import { Button, Notice, Spinner, useAnnounce, type Guests } from '../../components/ui';
import { cx } from '../../components/ui/cx';
import { useMinWidth } from '../../components/ui/useMinWidth';
import {
  availabilityLabel,
  deriveAvailability,
  sortByAvailability,
  type PlaceAvailability,
} from './availability/deriveAvailability';
import { exploreStay } from './availability/stay';
import { useSlowLoads } from './availability/useSlowLoads';
import { buildFacets, type ExploreFilters } from './filters/facets';
import { FilterRow } from './filters/FilterRow';
import { boundsOf, centreOf, PLACE_ZOOM, WA_BOUNDS, withinBbox } from './map/geo';
import { detectMapSupport } from './map/mapSupport';
import type { FitRequest, FlyRequest } from './map/MapView';
import type { MapCamera, MapViewState, PinAvailability } from './map/types';
import { orderPlaces } from './results/order';
import { ResultsList, type ResultsState } from './results/ResultsList';
import { SearchPill } from './search/SearchPill';
import { buildSuggestionIndex, type Suggestion } from './search/suggestions';
import { hasActiveFilters, type ExploreParams, type KnownValues } from './state/exploreParams';
import { createHighlightStore, HighlightContext } from './state/highlight';
import { useDebouncedValue } from './state/useDebouncedValue';
import { useExploreScrollMemory } from './state/scrollMemory';
import { useExploreParams } from './state/useExploreParams';
import { useOnline } from './state/useOnline';

// Vite replaces `process.env.NODE_ENV` in renderer code; Jest runs on Node (as in ui/dev.ts).
declare const process: { env: { NODE_ENV?: string } };

const MapView = lazy(() => import('./map/MapView'));

const EMPTY: LocationSummary[] = [];
const WA_BBOX: BoundingBox = [WA_BOUNDS[0][0], WA_BOUNDS[0][1], WA_BOUNDS[1][0], WA_BOUNDS[1][1]];
/** Results are announced this long after a search or filter change settles. */
export const ANNOUNCE_DELAY_MS = 500;
/** How often an empty catalogue's sync state is asked for. */
const STATUS_POLL_MS = 3000;
/** Availability is asked for once the dates and guests have stayed the same this long. */
export const STAY_DEBOUNCE_MS = 400;
/** A provider still checking availability after this long gets a notice (EQ7). */
export const SLOW_AVAILABILITY_MS = 10_000;
/** The map's area is sent to main once the map has stayed still this long (search mode). */
export const AREA_SEARCH_DEBOUNCE_MS = 500;
const ALL_PLACES: PlaceAvailability = { state: 'no-dates' };
const HEADER_HEIGHT = 64;

const unique = (values: Iterable<string | undefined>) =>
  [...new Set(values)].filter((v): v is string => Boolean(v)).sort();

/** Results on screen: the search they answer, and which results they are (see `epoch`). */
interface ShownResult {
  data: CatalogSearchResult;
  key: string;
  /**
   * Counts the searches shown, from 0. The map area applies to one epoch: a new search starts
   * with the whole list, even when it returns to an earlier search.
   */
  epoch: number;
}

/**
 * The results to show: the latest that loaded for the current search, else the last good ones
 * (kept while a new search loads, or after one fails).
 */
function useShownResult(
  search: { data?: CatalogSearchResult; isError: boolean; isPlaceholderData: boolean },
  key: string
): ShownResult | undefined {
  const shown = useRef<ShownResult | undefined>(undefined);
  const { data, isError, isPlaceholderData } = search;
  if (data && !isError && !isPlaceholderData) {
    const last = shown.current;
    if (!last) shown.current = { data, key, epoch: 0 };
    else if (last.key !== key) shown.current = { data, key, epoch: last.epoch + 1 };
    else if (last.data !== data) shown.current = { ...last, data };
  }
  return shown.current;
}

/**
 * Explore, the home screen (`/`): an Airbnb-style search pill and filter chips over a list of
 * places beside a Mapbox map of Western Australia. The map and the list stay in step: hovering
 * either highlights the other, choosing a pin selects its card, and "Search as I move the map"
 * narrows the list to the visible area. Without a Mapbox token or WebGL it is a list.
 */
export default function ExplorePage() {
  useCatalogUpdates();
  const announce = useAnnounce();
  const online = useOnline();
  const wide = useMinWidth(1024);

  // ---- Catalogue and URL state -----------------------------------------------------------
  const providersQuery = useProvidersWith('catalog');
  const catalogProviders = providersQuery.data;
  const allQuery = useCatalogAll();
  const catalogue = allQuery.data?.items ?? EMPTY;

  const catalogueByKey = useMemo(
    () => new Map(catalogue.map((item) => [item.key, item])),
    [catalogue]
  );
  const known = useMemo<KnownValues>(() => {
    const loaded = catalogue.length > 0;
    return {
      providers: catalogProviders?.map((p) => p.id),
      regions: loaded ? unique(catalogue.map((i) => i.area?.region)) : undefined,
      amenities: loaded ? unique(catalogue.flatMap((i) => i.amenities)) : undefined,
      keys: loaded ? new Set(catalogueByKey.keys()) : undefined,
    };
  }, [catalogProviders, catalogue, catalogueByKey]);

  const { params, update, setCamera } = useExploreParams(known);

  // A place's detail page opens with Explore's stay, and Back on it returns here as it was.
  const { search: currentSearch } = useLocation();
  const detailStay = useMemo<Partial<StayParams>>(
    () => ({
      arrival: params.arrival,
      departure: params.departure,
      adults: params.adults,
      children: params.children,
      infants: params.infants,
    }),
    [params.arrival, params.departure, params.adults, params.children, params.infants]
  );
  const detailState = useMemo<PlaceLinkState>(
    () => ({ from: 'explore', search: currentSearch }),
    [currentSearch]
  );

  const filters: ExploreFilters = useMemo(
    () => ({
      providerIds: params.providers,
      kinds: params.kinds,
      regions: params.regions,
      amenities: params.amenities,
      bookingModes: params.online ? ['online'] : [],
    }),
    [params.providers, params.kinds, params.regions, params.amenities, params.online]
  );
  const query: CatalogQuery = useMemo(() => ({ text: params.q, ...filters }), [params.q, filters]);
  const queryKey = JSON.stringify(normaliseCatalogQuery(query));
  const searching = Boolean(params.q) || hasActiveFilters(params);

  const search = useCatalogSearch(query);
  const textSearch = useCatalogSearch({ text: params.q }, { enabled: Boolean(params.q) });
  const shown = useShownResult(search, queryKey);
  const result = shown?.data;
  const results = result?.items ?? EMPTY;
  const epoch = shown?.epoch ?? null;
  // An empty catalogue is either waiting for its first sync (5 s after launch), syncing, or
  // failed: ask main which, and keep asking while it is empty.
  const catalogueEmpty = Boolean(allQuery.data && allQuery.data.total === 0);
  const status = useCatalogStatus({
    enabled: catalogueEmpty,
    refetchInterval: catalogueEmpty ? STATUS_POLL_MS : false,
  });
  const refresh = useCatalogRefresh();

  const facets = useMemo(
    () =>
      buildFacets(
        catalogue,
        params.q ? (textSearch.data?.items ?? catalogue) : catalogue,
        filters,
        (catalogProviders ?? []).map((p) => ({ id: p.id, name: p.name }))
      ),
    [catalogue, params.q, textSearch.data, filters, catalogProviders]
  );
  const suggestionIndex = useMemo(() => buildSuggestionIndex(catalogue), [catalogue]);

  // ---- Map ---------------------------------------------------------------------------
  const [support] = useState(detectMapSupport);
  const [mapFailure, setMapFailure] = useState<Error | null>(null);
  const [mapAttempt, setMapAttempt] = useState(0);
  const mapMode = support.available && !mapFailure;

  // The list follows the map only once the person has moved it, over the results on screen
  // (`movedFor` is their epoch): a view the app made (the first one, a fit to new results)
  // never narrows the list or reaches the URL. Opening Explore at a camera in the URL counts
  // as moved: it was the person's.
  const [liveBbox, setLiveBbox] = useState<BoundingBox | null>(null);
  const [movedFor, setMovedFor] = useState<number | null>(() => (params.map ? 0 : null));
  const [applied, setApplied] = useState<{ epoch: number; bbox: BoundingBox } | null>(null);
  const area: BoundingBox | null =
    !mapMode || epoch === null
      ? null
      : params.follow
        ? movedFor === epoch
          ? liveBbox
          : null
        : applied?.epoch === epoch
          ? applied.bbox
          : null;
  const visible = useMemo(
    () => (area ? results.filter((item) => withinBbox(item, area)) : results),
    [results, area]
  );

  // A provider that cannot list all its places (`catalogMode: 'search'`) is asked for the area
  // the map shows (all of WA without a map), unless the provider filter leaves it out. Its
  // places join the results when main announces them (`catalog:updated`); with only `full`
  // catalogues (ParkStay) nothing is asked.
  const shownArea = useDebouncedValue(mapMode ? liveBbox : WA_BBOX, AREA_SEARCH_DEBOUNCE_MS);
  useCatalogAreaSearch(shownArea, filters.providerIds);

  // ---- Availability for the dates (E3) ----------------------------------------------------
  // One bulk call per provider for the whole catalogue, once the stay has settled; panning the
  // map or changing filters asks nothing.
  const manifestsQuery = useProviders();
  const manifests = useMemo(
    () => new Map((manifestsQuery.data ?? []).map((manifest) => [manifest.id, manifest])),
    [manifestsQuery.data]
  );
  const bulkProviders = useMemo(
    () =>
      [...manifests.values()].filter(
        (m) => m.capabilities.catalog && m.capabilities.bulkAvailability
      ),
    [manifests]
  );
  const stay = useMemo(
    () =>
      exploreStay({
        arrival: params.arrival,
        departure: params.departure,
        adults: params.adults,
        children: params.children,
        infants: params.infants,
      }),
    [params.arrival, params.departure, params.adults, params.children, params.infants]
  );
  const currentStayKey = stay ? stayKey(stay) : null;
  const settledStayKey = useDebouncedValue(currentStayKey, STAY_DEBOUNCE_MS);
  const bulk = useBulkAvailability(stay, { settled: settledStayKey === currentStayKey, online });
  const statuses = bulk.statusByProvider;
  const checking = stay !== null && Object.values(statuses).includes('loading');
  const answered = Object.values(statuses).includes('success');
  const range = stay ? stayRangeLabel(stay.arrival, stay.departure) : null;

  const availableOnlyUnavailable = !stay
    ? 'Add dates to filter by availability'
    : manifestsQuery.isSuccess && bulkProviders.length === 0
      ? "Availability filtering isn't supported by these providers"
      : undefined;
  const availableOnly = params.avail && !availableOnlyUnavailable;

  /** Each result's availability for the stay; null without one. */
  const placeAvailability = useMemo(() => {
    if (!stay) return null;
    const out = new Map<string, PlaceAvailability>();
    for (const item of results) {
      out.set(
        item.key,
        deriveAvailability(item, {
          staySet: true,
          capabilities: manifests.get(item.providerId)?.capabilities,
          status: statuses[item.providerId],
          errorCode: bulk.errors[item.providerId]?.code,
          entry: bulk.byKey.get(item.key),
        })
      );
    }
    return out;
  }, [stay, results, manifests, statuses, bulk.errors, bulk.byKey]);

  /** How each result's availability reads on its card and its map pill. */
  const { cardAvailability, pinAvailability } = useMemo(() => {
    if (!placeAvailability) return { cardAvailability: null, pinAvailability: null };
    const cards = new Map<string, CardAvailability>();
    const pins = new Map<string, PinAvailability>();
    for (const item of results) {
      const availability = placeAvailability.get(item.key) ?? ALL_PLACES;
      const shortName = manifests.get(item.providerId)?.shortName ?? item.providerId;
      const label = availabilityLabel(availability, item.kind, shortName);
      if (!label) continue;
      pins.set(item.key, { state: availability.state, pill: label.pill });
      if (label.card === null) continue;
      cards.set(
        item.key,
        label.tone
          ? { status: 'ready', text: label.card, tone: label.tone, statesTotal: label.statesTotal }
          : { status: 'loading' }
      );
    }
    return { cardAvailability: cards, pinAvailability: pins };
  }, [placeAvailability, results, manifests]);

  const isAvailable = useCallback(
    (item: LocationSummary) => placeAvailability?.get(item.key)?.state === 'available',
    [placeAvailability]
  );
  // "Available only" applies after the filters and the map area.
  const shownPlaces = useMemo(
    () => (availableOnly ? visible.filter(isAvailable) : visible),
    [availableOnly, visible, isAvailable]
  );
  const mapItems = useMemo(
    () => (availableOnly ? results.filter(isAvailable) : results),
    [availableOnly, results, isAvailable]
  );
  const availableCount = useMemo(
    () => (placeAvailability ? visible.filter(isAvailable).length : 0),
    [placeAvailability, visible, isAvailable]
  );
  const availabilityNote =
    !stay || bulkProviders.length === 0
      ? undefined
      : checking
        ? 'checking availability…'
        : answered
          ? `${availableCount} available for ${range}`
          : undefined;

  const epochRef = useRef(epoch);
  epochRef.current = epoch;
  const lastCamera = useRef<MapCamera | null>(params.map);
  /**
   * A place chosen in Where: the map's stop there is the person's view. (A fit the fly cut
   * short also ends a move; only the landing at the place counts.)
   */
  const flyingTo = useRef<{ lng: number; lat: number } | null>(null);

  // The list's order: a text search keeps its relevance order; otherwise nearest the middle of
  // the map area (or of the results the map shows), or by name without a map.
  const resultsBounds = useMemo(() => boundsOf(results), [results]);
  const [centreLng, centreLat] = mapMode ? centreOf(area ?? resultsBounds ?? WA_BBOX) : [];
  // With dates, once every provider has answered, available places come first (most free
  // units first) and each group keeps this order. While one is still checking the order
  // holds, so the list moves once rather than twice.
  const listed = useMemo(() => {
    const ordered = params.q
      ? shownPlaces
      : orderPlaces(
          shownPlaces,
          centreLng === undefined || centreLat === undefined ? null : [centreLng, centreLat]
        );
    return placeAvailability && !checking
      ? sortByAvailability(ordered, (item) => placeAvailability.get(item.key) ?? ALL_PLACES)
      : ordered;
  }, [shownPlaces, params.q, centreLng, centreLat, placeAvailability, checking]);

  const requestId = useRef(0);
  const [fitRequest, setFitRequest] = useState<FitRequest | null>(null);
  const [flyRequest, setFlyRequest] = useState<FlyRequest | null>(null);
  const fit = useCallback((bbox: BoundingBox, options: { animate?: boolean } = {}) => {
    requestId.current += 1;
    setFitRequest({ id: requestId.current, bbox, animate: options.animate });
  }, []);

  // A new search (text or filters, not the map area) fits the map to its results. Opened at a
  // search with no camera of the person's (a link, or Back), the first results are framed
  // at once; the app's own first view of all of WA is not a search.
  const settledQuery = useRef<string | null>(params.map || !searching ? queryKey : null);
  const noFitFor = useRef<string | null>(null);
  useEffect(() => {
    if (!search.isSuccess || search.isPlaceholderData || settledQuery.current === queryKey) return;
    const first = settledQuery.current === null;
    settledQuery.current = queryKey;
    if (noFitFor.current === queryKey) {
      noFitFor.current = null;
      return;
    }
    const bbox = boundsOf(search.data.items);
    if (bbox) fit(bbox, { animate: !first });
  }, [queryKey, search.isSuccess, search.isPlaceholderData, search.data, fit]);

  const onView = useCallback(
    (view: MapViewState) => {
      setLiveBbox(view.bbox);
      lastCamera.current = view.camera;
      if (view.userInitiated) setCamera(view.camera);
      const target = flyingTo.current;
      const landed =
        target !== null &&
        Math.abs(view.camera.lng - target.lng) < 1e-6 &&
        Math.abs(view.camera.lat - target.lat) < 1e-6;
      if (view.userInitiated || landed) {
        flyingTo.current = null;
        setMovedFor(epochRef.current);
      }
    },
    [setCamera]
  );

  /** A new search: the camera in the URL gives way to the fit to its results. */
  const updateSearch = useCallback(
    (patch: Partial<ExploreParams>) => update({ ...patch, map: null }),
    [update]
  );

  // ---- Highlight and selection -----------------------------------------------------------
  const [highlight] = useState(createHighlightStore);
  /** A place chosen on the map or in Where, whose card the list brings into view. */
  const [reveal, setReveal] = useState<string | null>(null);
  const onRevealed = useCallback(() => setReveal(null), []);

  const select = useCallback(
    (key: string | null) => {
      setReveal(key);
      update({ sel: key });
    },
    [update]
  );

  const onSuggestion = (suggestion: Suggestion) => {
    if (suggestion.kind === 'region') {
      const unchanged =
        !params.q && params.regions.length === 1 && params.regions[0] === suggestion.target;
      if (unchanged) {
        // The same region again: frame it again, as a new search would.
        setMovedFor(null);
        update({ map: null }, { replace: true });
        if (resultsBounds) fit(resultsBounds);
      } else updateSearch({ regions: [suggestion.target], q: '' });
    } else if (suggestion.kind === 'area') {
      updateSearch({ q: suggestion.target });
    } else {
      const place = catalogueByKey.get(suggestion.target);
      // The text typed to find the place is cleared; that is not a new search to fit to.
      if (params.q)
        noFitFor.current = JSON.stringify(normaliseCatalogQuery({ ...query, text: '' }));
      setReveal(suggestion.target);
      if (place && hasMapLocation(place)) {
        // The person chose where the map goes: the camera is theirs (in the URL, with the
        // selection, in one history entry), and the list follows it once the map lands.
        const camera = {
          lng: place.lng,
          lat: place.lat,
          zoom: Math.max(lastCamera.current?.zoom ?? 0, PLACE_ZOOM),
        };
        update({ sel: suggestion.target, q: '', map: mapMode ? camera : null });
        if (mapMode) {
          flyingTo.current = { lng: camera.lng, lat: camera.lat };
          requestId.current += 1;
          setFlyRequest({ id: requestId.current, ...camera });
        }
      } else update({ sel: suggestion.target, q: '' });
    }
  };

  // ---- Actions ---------------------------------------------------------------------------
  const NO_FILTERS = {
    providers: [],
    kinds: [],
    regions: [],
    amenities: [],
    online: false,
    avail: false,
  } satisfies Partial<ExploreParams>;
  const clearFilters = () => updateSearch(NO_FILTERS);
  const clearSearch = () => updateSearch({ q: '', ...NO_FILTERS });
  const showAll = () => {
    setMovedFor(null);
    setApplied(null);
    update({ map: null }, { replace: true });
    fit(WA_BBOX);
  };
  const setFollow = (follow: boolean) => {
    // Turning it off keeps the list as it is; turning it on follows the map from here.
    setApplied(!follow && area && epoch !== null ? { epoch, bbox: area } : null);
    update({ follow });
  };
  const searchArea = (bbox: BoundingBox) => {
    if (epoch !== null) setApplied({ epoch, bbox });
  };

  // Clearing the dates turns "Available only" off with them.
  const onDates = ({ arrival, departure }: { arrival?: string; departure?: string }) =>
    update({
      arrival: arrival ?? null,
      departure: departure ?? null,
      ...(arrival ? {} : { avail: false }),
    });
  const datesTriggerRef = useRef<HTMLButtonElement>(null);
  const onGuests = (guests: Guests) =>
    update({ adults: guests.adults, children: guests.children, infants: guests.infants });
  const guests: Guests | undefined =
    params.adults !== null
      ? { adults: params.adults, children: params.children ?? 0, infants: params.infants ?? 0 }
      : undefined;

  // ---- Which state the results are in ------------------------------------------------------
  const searchError = search.isError ? toApiError(search.error) : null;
  let state: ResultsState;
  if (catalogProviders && catalogProviders.length === 0) state = { kind: 'no-providers' };
  else if (!result) {
    if (searchError?.code === 'NOT_IMPLEMENTED') state = { kind: 'unavailable' };
    else if (searchError) state = { kind: 'failed', retrying: refresh.isPending };
    else state = { kind: 'loading' };
  } else if (result.items.length === 0 && !searching) {
    // Nothing in the catalogue at all: syncing (or about to), or the sync failed.
    const providers = status.data?.providers ?? [];
    const failed =
      status.isError || (!providers.some((p) => p.syncing) && providers.some((p) => p.lastError));
    if (status.isPending && !status.isError) state = { kind: 'loading' };
    else if (failed) state = { kind: 'failed', retrying: refresh.isPending };
    else state = { kind: 'syncing' };
  } else if (result.items.length === 0) state = { kind: 'no-matches' };
  else if (area && visible.length === 0) state = { kind: 'empty-area' };
  else if (availableOnly && shownPlaces.length === 0 && range) {
    state = checking ? { kind: 'checking' } : { kind: 'none-available', range, checked: answered };
  } else state = { kind: 'results' };

  const scrollMemory = useExploreScrollMemory(state.kind === 'results');

  // ---- Announce the count once a new search's results are on screen ---------------------------
  // (Not for the first results, and not for map moves.)
  const message =
    state.kind === 'results'
      ? `${placesLabel(visible.length)}${area ? ' in map area' : ''}`
      : state.kind === 'no-matches'
        ? 'No places match your search'
        : state.kind === 'empty-area'
          ? 'No places in this part of the map'
          : null;
  const announcedEpoch = useRef<number | null>(null);
  useEffect(() => {
    if (epoch === null) return undefined;
    if (announcedEpoch.current === null) {
      announcedEpoch.current = epoch;
      return undefined;
    }
    if (!message || announcedEpoch.current === epoch) return undefined;
    const timer = setTimeout(() => {
      announcedEpoch.current = epoch;
      announce(message);
    }, ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [message, epoch, announce]);

  // ---- Announce availability once it settles for a stay, and each provider that failed ----
  const settledMessage =
    stay && range && epoch !== null && bulkProviders.length > 0 && !checking && answered
      ? `${availableCount} of ${visible.length} places have sites available for ${range}`
      : null;
  const announcedStay = useRef<string | null>(null);
  useEffect(() => {
    if (!settledMessage || !currentStayKey || announcedStay.current === currentStayKey) return;
    announcedStay.current = currentStayKey;
    announce(settledMessage);
  }, [settledMessage, currentStayKey, announce]);

  // A provider that fails is announced once, by its notice (`role="alert"`, or `status` for a
  // waiting queue), not again through the live region.

  const slowLoads = useSlowLoads(
    stay
      ? bulkProviders
          .filter((m) => statuses[m.id] === 'loading')
          .map((m) => `${currentStayKey}|${m.id}`)
      : [],
    SLOW_AVAILABILITY_MS
  );

  // ---- Below 1024 px: one pane at a time --------------------------------------------------
  const listPaneRef = useRef<HTMLDivElement>(null);
  const mapHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusPane = useRef<'map' | 'list' | null>(null);
  const toggleView = () => {
    const next = params.view === 'map' ? 'list' : 'map';
    focusPane.current = next;
    update({ view: next });
  };
  useEffect(() => {
    if (focusPane.current !== params.view) return;
    focusPane.current = null;
    const heading =
      params.view === 'map' ? mapHeadingRef.current : listPaneRef.current?.querySelector('h2');
    if (!heading) return;
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    heading.focus();
  }, [params.view]);
  const mapShown = mapMode && (wide || params.view === 'map');

  // ---- The sticky search bar's height, for the sticky map and card scroll margins ----------
  const subheaderRef = useRef<HTMLDivElement>(null);
  const [subheaderHeight, setSubheaderHeight] = useState(140);
  useLayoutEffect(() => {
    const element = subheaderRef.current;
    if (!element) return undefined;
    const measure = () => {
      if (element.offsetHeight) setSubheaderHeight(element.offsetHeight);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const stickyStyle = {
    '--explore-sticky': `${HEADER_HEIGHT + subheaderHeight}px`,
  } as CSSProperties;

  // ---- Notices -----------------------------------------------------------------------------
  // One notice per provider that failed or is slow, never one per card.
  const availabilityNotices = stay
    ? bulkProviders.map((manifest) => {
        const { id, shortName } = manifest;
        if (statuses[id] === 'error') {
          const queue = bulk.errors[id]?.code === 'ACCESS_GATE' && manifest.capabilities.accessGate;
          return (
            <Notice
              key={id}
              tone={queue ? 'warning' : 'danger'}
              icon={queue ? Hourglass : undefined}
              actions={
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Retry ${shortName} availability`}
                  onClick={() => bulk.refetch(id)}
                >
                  Retry
                </Button>
              }
            >
              Couldn&apos;t check availability on {shortName}.
              {queue && ` ${shortName} has a waiting queue right now. Try again in a few minutes.`}
            </Notice>
          );
        }
        if (statuses[id] === 'loading' && slowLoads.has(`${currentStayKey}|${id}`)) {
          return (
            <Notice key={id} tone="info">
              Still checking {shortName}…
              {manifest.capabilities.accessGate && ' It may have a waiting queue right now.'}
            </Notice>
          );
        }
        return null;
      })
    : [];
  const hasAvailabilityNotices =
    Boolean(stay && !online && bulkProviders.length > 0) ||
    availabilityNotices.some((notice) => notice !== null);

  const notices = (
    <>
      {!online && (
        <Notice tone="warning">
          You&apos;re offline. Showing saved places; photos and map tiles may not load.
        </Notice>
      )}
      {searchError && result && (
        <Notice
          tone="danger"
          title="We couldn't update the results"
          actions={
            <Button variant="secondary" size="sm" onClick={() => void search.refetch()}>
              Retry
            </Button>
          }
        >
          {searchError.message}
        </Notice>
      )}
      {!support.available && (
        <Notice tone="info">
          {support.reason === 'no-token'
            ? "The map isn't available in this build, so places are shown as a list."
            : "This computer can't show the map, so places are shown as a list."}
          {support.reason === 'no-token' && process.env.NODE_ENV !== 'production' && (
            <> Set MAPBOX_ACCESS_TOKEN in .env to enable it.</>
          )}
        </Notice>
      )}
      {stay && !online && bulkProviders.length > 0 && (
        <Notice tone="info">Availability needs an internet connection.</Notice>
      )}
      {availabilityNotices}
      {support.available && mapFailure && (
        <Notice
          tone="warning"
          actions={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setMapFailure(null);
                setMapAttempt((n) => n + 1);
              }}
            >
              Try again
            </Button>
          }
        >
          The map couldn&apos;t load, so places are shown as a list.
        </Notice>
      )}
    </>
  );
  const hasNotices =
    !online ||
    Boolean(searchError && result) ||
    !support.available ||
    mapFailure ||
    hasAvailabilityNotices;

  return (
    <HighlightContext.Provider value={highlight}>
      <div className="flex flex-col" style={stickyStyle}>
        {/* Fixed, so the focus it takes on arrival never scrolls the list back to the top. */}
        <h1 className="sr-only fixed left-0 top-0">Explore places to stay</h1>

        <div
          ref={subheaderRef}
          className="sticky top-16 z-header border-b border-border bg-surface px-6 py-4 lg:px-8"
        >
          <SearchPill
            query={params.q}
            index={suggestionIndex}
            dates={{
              arrival: params.arrival ?? undefined,
              departure: params.departure ?? undefined,
            }}
            guests={guests}
            onQueryChange={(q) => updateSearch({ q })}
            onSuggestion={onSuggestion}
            onDatesChange={onDates}
            onGuestsChange={onGuests}
            datesTriggerRef={datesTriggerRef}
          />
          <div className="mx-auto mt-4 w-full max-w-[860px]">
            <FilterRow
              params={params}
              facets={facets}
              showKinds={facets.kinds.length > 1}
              onChange={updateSearch}
              onClearAll={clearFilters}
              availableOnlyUnavailable={availableOnlyUnavailable}
              onAvailableOnlyChange={(avail) => update({ avail })}
            />
          </div>
        </div>

        <div
          className={cx(
            mapMode && 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:items-start'
          )}
        >
          <div
            ref={listPaneRef}
            className={cx(
              'px-6 pb-24 pt-8 lg:px-8',
              mapMode ? params.view === 'map' && 'max-lg:hidden' : 'mx-auto w-full max-w-7xl'
            )}
          >
            <ResultsList
              state={state}
              items={listed}
              inMapArea={Boolean(area)}
              width={mapMode ? 'split' : 'full'}
              selectedKey={params.sel}
              revealKey={reveal}
              onRevealed={onRevealed}
              resetKey={queryKey}
              onHighlight={highlight.set}
              onRetry={() => refresh.mutate(undefined)}
              onClearFilters={clearSearch}
              onShowAll={showAll}
              notices={hasNotices ? notices : undefined}
              stay={detailStay}
              linkState={detailState}
              initialShown={scrollMemory.initialShown}
              onShownChange={scrollMemory.setShown}
              placeCount={visible.length}
              availabilityNote={availabilityNote}
              availability={cardAvailability}
              onShowAllPlaces={() => update({ avail: false })}
              onTryOtherDates={() => datesTriggerRef.current?.click()}
            />
          </div>

          {mapMode && support.available && (
            <section
              aria-labelledby="explore-map-heading"
              className={cx(
                'isolate bg-canvas',
                'max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:top-(--explore-sticky)',
                'lg:sticky lg:top-(--explore-sticky) lg:h-[calc(100vh-var(--explore-sticky))]',
                !wide && params.view !== 'map' && 'invisible'
              )}
            >
              <h2 id="explore-map-heading" ref={mapHeadingRef} tabIndex={-1} className="sr-only">
                Map of places
              </h2>
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center">
                    <Spinner label="Loading map" />
                  </div>
                }
              >
                <MapView
                  key={mapAttempt}
                  token={support.token}
                  items={mapItems}
                  lookup={(key) => catalogueByKey.get(key) ?? results.find((r) => r.key === key)}
                  initialCamera={params.map}
                  selectedKey={params.sel}
                  follow={params.follow}
                  shown={mapShown}
                  fitRequest={fitRequest}
                  flyRequest={flyRequest}
                  onView={onView}
                  onSelect={select}
                  onFollowChange={setFollow}
                  onSearchArea={searchArea}
                  onFailed={setMapFailure}
                  detailStay={detailStay}
                  detailState={detailState}
                  availability={pinAvailability}
                  pulsing={checking}
                />
              </Suspense>
            </section>
          )}
        </div>

        {mapMode && !wide && (
          <Button
            variant="inverse"
            shape="pill"
            size="lg"
            onClick={toggleView}
            leadingIcon={
              params.view === 'map' ? (
                <List size={18} aria-hidden="true" />
              ) : (
                <MapIcon size={18} aria-hidden="true" />
              )
            }
            className="fixed bottom-6 left-1/2 z-header -translate-x-1/2"
          >
            {params.view === 'map' ? 'Show list' : 'Show map'}
          </Button>
        )}
      </div>
    </HighlightContext.Provider>
  );
}
