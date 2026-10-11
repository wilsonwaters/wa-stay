import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Download, Luggage, Plus } from 'lucide-react';
import { useBookings, useBookingUpdates, useProviders, useProvidersWith } from '../../api';
import type { Booking } from '../../../shared/types/booking.types';
import { ComingSoonBanner } from '../../components/ComingSoonBanner';
import {
  Button,
  EmptyState,
  Notice,
  PageHeader,
  Skeleton,
  VisuallyHidden,
  useAnnounce,
} from '../../components/ui';
import { useNow } from '../../hooks/useNow';
import { AddBookingDialog } from './add/AddBookingDialog';
import { ImportBookingDialog } from './add/ImportBookingDialog';
import { BookingFilters } from './list/BookingFilters';
import { TripList } from './list/TripList';
import { TripTabs } from './list/TripTabs';
import {
  matchesSearch,
  parseListParams,
  providerFilterOptions,
  withListParams,
  type BookingListParams,
} from './list/listParams';
import { rowsForTab, tabCounts, tripRows } from './list/tripBuckets';
import { RemoveBookingDialog } from './shared/RemoveBookingDialog';
import { useCatalogPlaces } from '../../api';

const PAGE = 'mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8 lg:px-8';
const tripsLabel = (n: number) => `${n} ${n === 1 ? 'trip' : 'trips'}`;

/** `/bookings`: every trip across providers, in Upcoming / Past / Cancelled tabs. */
export function BookingsPage() {
  useBookingUpdates();
  const [search, setSearch] = useSearchParams();
  const bookings = useBookings();
  const providers = useProviders();
  const importers = useProvidersWith('bookingImport');
  const now = useNow();
  const announce = useAnnounce();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [removing, setRemoving] = useState<Booking | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const manifests = useMemo(() => providers.data ?? [], [providers.data]);
  const all = useMemo(() => bookings.data ?? [], [bookings.data]);
  const canImport = (importers.data?.length ?? 0) > 0;
  const providerOptions = providers.isSuccess ? providerFilterOptions(manifests, all) : undefined;
  const parsed = parseListParams(search);
  const params: BookingListParams = {
    ...parsed,
    provider:
      !providers.isSuccess || providerOptions?.some((o) => o.value === parsed.provider)
        ? parsed.provider
        : undefined,
  };

  const rows = tripRows(all, manifests, now);
  const filtered = rows.filter(
    (row) =>
      (!params.provider || row.booking.providerId === params.provider) &&
      matchesSearch(row.booking, params.q)
  );
  const counts = tabCounts(filtered);
  const visible = rowsForTab(filtered, params.tab);
  // The photos: one search of main's local catalogue for every card, asked once there are cards.
  const places = useCatalogPlaces(rows.length > 0);

  // A filter or search change says how many trips the tab now shows.
  const filterKey = `${params.provider ?? ''}|${params.q.trim()}`;
  const lastKey = useRef(filterKey);
  useEffect(() => {
    if (lastKey.current === filterKey || !bookings.isSuccess) return;
    lastKey.current = filterKey;
    announce(tripsLabel(visible.length));
  }, [filterKey, visible.length, bookings.isSuccess, announce]);

  const setParams = (next: BookingListParams) =>
    setSearch(withListParams(search, next), { replace: true });

  /** A new booking: show the tab it lands in, without a filter that would hide it. */
  const showBooking = (booking: Booking) => {
    setParams({
      tab: tripRows([booking], manifests, now)[0].tab,
      provider: params.provider === booking.providerId ? params.provider : undefined,
      q: '',
    });
    // From the empty state, its button goes once the list shows: focus the header's instead.
    const fromEmptyState = all.length === 0;
    requestAnimationFrame(() => {
      const lost = !document.activeElement || document.activeElement === document.body;
      if (fromEmptyState || lost) addButton.current?.focus();
    });
  };

  const importButton = canImport && (
    <Button
      variant="secondary"
      leadingIcon={<Download size={18} />}
      onClick={() => setImporting(true)}
    >
      Import booking
    </Button>
  );

  return (
    <div className={PAGE}>
      <PageHeader
        title="Bookings"
        description="Your trips across every provider."
        actions={
          <>
            {importButton}
            <Button
              ref={addButton}
              variant="primary"
              leadingIcon={<Plus size={18} />}
              onClick={() => setAdding(true)}
            >
              Add booking
            </Button>
          </>
        }
      />
      <ComingSoonBanner featureName="Bookings" />

      {providers.isError && (
        <Notice tone="warning" title="Provider details couldn't be loaded">
          Your bookings are below; their providers show as unknown until this works.
        </Notice>
      )}

      {bookings.isPending && (
        <div aria-busy="true" className="flex flex-col gap-4">
          <p role="status">
            <VisuallyHidden>Loading bookings</VisuallyHidden>
          </p>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
      )}

      {bookings.isError && (
        <Notice
          tone="danger"
          title="Bookings couldn't be loaded"
          actions={
            <Button variant="secondary" size="sm" onClick={() => void bookings.refetch()}>
              Try again
            </Button>
          }
        >
          {bookings.error.message}
        </Notice>
      )}

      {bookings.isSuccess && all.length === 0 && (
        <EmptyState
          size="md"
          icon={<Luggage size={24} />}
          accent="sun"
          title="No trips yet"
          description="Add a booking you made on a provider's site to keep all your trips in one place."
          actions={
            <>
              <Button variant="secondary" onClick={() => setAdding(true)}>
                Add your first booking
              </Button>
              {canImport && (
                <Button variant="ghost" onClick={() => setImporting(true)}>
                  Import a booking
                </Button>
              )}
            </>
          }
        />
      )}

      {bookings.isSuccess && all.length > 0 && (
        <div ref={listRef} className="flex flex-col gap-6">
          <BookingFilters params={params} providerOptions={providerOptions} onChange={setParams} />
          <TripTabs
            value={params.tab}
            onChange={(tab) => setParams({ ...params, tab })}
            counts={counts}
          >
            <TripList
              tab={params.tab}
              rows={visible}
              query={params.q.trim()}
              places={places}
              onClearSearch={() => setParams({ ...params, q: '' })}
              onRemove={setRemoving}
            />
          </TripTabs>
        </div>
      )}

      <AddBookingDialog
        open={adding}
        onClose={() => setAdding(false)}
        bookings={all}
        onAdded={showBooking}
      />
      {canImport && (
        <ImportBookingDialog
          open={importing}
          onClose={() => setImporting(false)}
          bookings={all}
          onImported={showBooking}
        />
      )}
      {removing && (
        <RemoveBookingDialog
          booking={removing}
          manifest={manifests.find((m) => m.id === removing.providerId)}
          open
          onClose={() => setRemoving(null)}
          onRemoved={() =>
            requestAnimationFrame(() =>
              listRef.current
                ?.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')
                ?.focus()
            )
          }
        />
      )}
    </div>
  );
}

export default BookingsPage;
