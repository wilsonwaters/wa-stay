import type { Booking } from '../../../../shared/types/booking.types';
import { Button, EmptyState } from '../../../components/ui';
import { BookingCard } from './BookingCard';
import type { TripRow, TripTab } from './tripBuckets';
import type { PhotoPlace } from '../../../components/PlacePhoto';

export interface TripListProps {
  tab: TripTab;
  /** The tab's rows, filtered and in order. */
  rows: TripRow[];
  /** The trimmed search text ('' for none). */
  query: string;
  /** The local catalogue's places by location key, for the photos. */
  places: { byKey: Map<string, PhotoPlace>; loading: boolean };
  onClearSearch: () => void;
  onRemove: (booking: Booking) => void;
}

const LIST_LABEL: Record<TripTab, string> = {
  upcoming: 'Upcoming trips',
  past: 'Past trips',
  cancelled: 'Cancelled trips',
};

const EMPTY: Record<TripTab, { title: string; description: string }> = {
  upcoming: {
    title: 'No upcoming trips',
    description: 'Bookings you add for future dates show here until you check out.',
  },
  past: { title: 'No past trips', description: 'Trips move here the day after you check out.' },
  cancelled: {
    title: 'No cancelled trips',
    description: 'Cancelled bookings show here.',
  },
};

/** One tab's trips, or why there are none (with "Clear search" when a search hides them). */
export function TripList({ tab, rows, query, places, onClearSearch, onRemove }: TripListProps) {
  if (rows.length === 0) {
    return query ? (
      <EmptyState
        size="md"
        title={`No trips match "${query}"`}
        description="Search looks at the place, its area and the booking reference."
        actions={
          <Button variant="secondary" onClick={onClearSearch}>
            Clear search
          </Button>
        }
      />
    ) : (
      <EmptyState size="md" title={EMPTY[tab].title} description={EMPTY[tab].description} />
    );
  }
  return (
    <ul aria-label={LIST_LABEL[tab]} className="flex flex-col gap-3">
      {rows.map(({ booking, manifest, today }) => (
        <li key={booking.id}>
          <BookingCard
            booking={booking}
            manifest={manifest}
            today={today}
            place={booking.locationKey ? places.byKey.get(booking.locationKey) : undefined}
            placeLoading={Boolean(booking.locationKey) && places.loading}
            onRemove={onRemove}
          />
        </li>
      ))}
    </ul>
  );
}

export default TripList;
