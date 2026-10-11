import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { BellRing, Plus } from 'lucide-react';
import { useProviders, useWatches, useWatchUpdates } from '../../api';
import { ROUTES } from '../../app/routes';
import { useNow } from '../../hooks/useNow';
import {
  Button,
  EmptyState,
  Notice,
  PageHeader,
  Skeleton,
  VisuallyHidden,
  useAnnounce,
} from '../../components/ui';
import { WatchCard } from './list/WatchCard';
import { WatchFilters } from './list/WatchFilters';
import {
  parseWatchFilters,
  passesFilters,
  providerFilterOptions,
  sortWatches,
  withWatchFilters,
  type WatchFilters as Filters,
} from './list/listFilters';
import { watchStateOf } from './shared/watchState';
import { providerToday } from '../../components/stay/providerToday';
import { useCatalogPlaces } from '../../api';

const watchesLabel = (n: number) => `${n} ${n === 1 ? 'watch' : 'watches'}`;

/** `/watches`: every watch, with provider and status filters kept in the URL. */
export function WatchesPage() {
  useWatchUpdates();
  const [search, setSearch] = useSearchParams();
  const watches = useWatches();
  const providers = useProviders();
  const now = useNow();
  const announce = useAnnounce();

  const manifests = useMemo(() => providers.data ?? [], [providers.data]);
  const canWatch = !providers.isSuccess || manifests.some((m) => m.capabilities.watches);
  // Only once the providers are known: before that every watch would read as an unknown one.
  const providerOptions = providers.isSuccess
    ? providerFilterOptions(manifests, watches.data ?? [])
    : undefined;
  const parsed = parseWatchFilters(search);
  const filters: Filters = {
    ...parsed,
    provider:
      !providers.isSuccess || providerOptions?.some((o) => o.value === parsed.provider)
        ? parsed.provider
        : undefined,
  };

  const rows = (watches.data ?? []).map((watch) => {
    const manifest = manifests.find((m) => m.id === watch.providerId);
    const today = providerToday(manifest, now);
    return { watch, manifest, today, state: watchStateOf(watch, today, now) };
  });
  const visible = sortWatches(rows.filter((r) => passesFilters(r.watch, r.state, filters)));
  // The photos: one search of main's local catalogue for every card, asked once there are cards.
  const places = useCatalogPlaces(rows.length > 0);

  // A filter change says how many watches it shows.
  const filterKey = `${filters.provider ?? ''}|${filters.status}`;
  const lastKey = useRef(filterKey);
  useEffect(() => {
    if (lastKey.current === filterKey || !watches.isSuccess) return;
    lastKey.current = filterKey;
    announce(watchesLabel(visible.length));
  }, [filterKey, visible.length, watches.isSuccess, announce]);

  const setFilters = (next: Filters) =>
    setSearch(withWatchFilters(search, next), { replace: true });

  const newWatch = canWatch ? (
    <Button
      as="a"
      href={`#${ROUTES.watchNew()}`}
      variant="primary"
      leadingIcon={<Plus size={18} />}
    >
      New watch
    </Button>
  ) : (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="primary"
        leadingIcon={<Plus size={18} />}
        disabled
        aria-describedby="no-watch-provider"
      >
        New watch
      </Button>
      <p id="no-watch-provider" className="text-sm text-fg-muted">
        No provider supports watches yet
      </p>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8 lg:px-8">
      <PageHeader
        title="Watches"
        description="Get an alert when places free up for your dates."
        actions={newWatch}
      />

      {providers.isError && (
        <Notice
          tone="warning"
          title="Provider details couldn't be loaded"
          actions={
            <Button variant="secondary" size="sm" onClick={() => void providers.refetch()}>
              Try again
            </Button>
          }
        >
          Your watches are below; their providers show as unknown until this works.
        </Notice>
      )}

      {watches.isPending && (
        <div aria-busy="true" className="flex flex-col gap-4">
          <p role="status">
            <VisuallyHidden>Loading watches</VisuallyHidden>
          </p>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
      )}

      {watches.isError && (
        <Notice
          tone="danger"
          title="Watches couldn't be loaded"
          actions={
            <Button variant="secondary" size="sm" onClick={() => void watches.refetch()}>
              Try again
            </Button>
          }
        >
          {watches.error.message}
        </Notice>
      )}

      {watches.isSuccess && rows.length === 0 && (
        <EmptyState
          size="md"
          icon={<BellRing size={24} />}
          accent="sun"
          title="No watches yet"
          description="A watch checks a place for your dates and tells you when something frees up."
          actions={
            canWatch ? (
              <Button as="a" href={`#${ROUTES.watchNew()}`} variant="secondary">
                Create your first watch
              </Button>
            ) : undefined
          }
        />
      )}

      {watches.isSuccess && rows.length > 0 && (
        <>
          <WatchFilters filters={filters} providerOptions={providerOptions} onChange={setFilters} />
          {visible.length === 0 ? (
            <EmptyState
              size="md"
              title="No watches match these filters"
              description="Try another provider or status."
              actions={
                <Button variant="secondary" onClick={() => setFilters({ status: 'all' })}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <ul aria-label="Watches" className="flex flex-col gap-3">
              {visible.map((row) => (
                <li key={row.watch.id}>
                  <WatchCard
                    watch={row.watch}
                    state={row.state}
                    manifest={row.manifest}
                    now={now}
                    today={row.today}
                    place={places.byKey.get(row.watch.locationKey)}
                    placeLoading={places.loading}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export default WatchesPage;
