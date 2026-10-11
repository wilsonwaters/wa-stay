import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Ellipsis, LoaderCircle, Trash2 } from 'lucide-react';
import {
  toApiError,
  useBooking,
  useBookingUpdates,
  useLocationDetail,
  useProviders,
} from '../../../api';
import type { Booking } from '../../../../shared/types/booking.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { ROUTES } from '../../../app/routes';
import { ExternalLink } from '../../../components/ExternalLink';
import { photoUrl } from '../../../components/LocationCard';
import {
  Badge,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Notice,
  PageHeader,
  ProviderBadge,
  Skeleton,
  StatusPill,
  VisuallyHidden,
  statusPresets,
} from '../../../components/ui';
import { useNow } from '../../../hooks/useNow';
import { isHappeningNow, tripRows } from '../list/tripBuckets';
import { manageLinkFor } from '../shared/manageLink';
import { RemoveBookingDialog } from '../shared/RemoveBookingDialog';
import { BookingFacts } from './BookingFacts';
import { PlacePhoto } from '../../../components/PlacePhoto';

const PAGE = 'mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8 lg:px-8';
const BACK = { label: 'Bookings', href: `#${ROUTES.bookings()}` };

interface ViewProps {
  booking: Booking;
  manifest: ProviderManifest | undefined;
  /** A background refetch is running: the page stays, with a quiet indicator. */
  updating: boolean;
}

function BookingDetailView({ booking, manifest, updating }: ViewProps) {
  const navigate = useNavigate();
  const now = useNow();
  const [removing, setRemoving] = useState(false);
  const { location } = booking;
  const today = tripRows([booking], manifest ? [manifest] : [], now)[0].today;
  const manage = manageLinkFor(booking, manifest);
  // The place from the catalogue (main's 6-hour detail cache): its photo, and the names of
  // its class units. A booking with no location key (a v1 row) has no photo to show.
  const place = useLocationDetail(booking.locationKey ?? null);

  return (
    <div className={PAGE}>
      <PageHeader
        title={location.name}
        back={BACK}
        hero={
          // While the catalogue answers, and when it has a photo: never an empty banner.
          booking.locationKey &&
          (place.isLoading || photoUrl(place.data?.imageUrls ?? [])) && (
            <PlacePhoto
              name={location.name}
              place={place.data}
              loading={place.isLoading}
              className="aspect-video w-full rounded-xl sm:aspect-5/2"
            />
          )
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <ProviderBadge providerId={booking.providerId} size="sm" />
            {location.areaName && <span>· {location.areaName}</span>}
            <StatusPill {...statusPresets.booking[booking.status]} />
            {isHappeningNow(booking, today) && <Badge tone="sun">Happening now</Badge>}
            {location.externalId && (
              <Link
                to={ROUTES.placeDetail(booking.providerId, location.externalId)}
                className="basis-full font-semibold text-brand-strong hover:underline"
              >
                About {location.name}
              </Link>
            )}
          </span>
        }
        actions={
          <>
            {updating && (
              <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
                <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
                Updating…
              </span>
            )}
            {manage && (
              <ExternalLink href={manage.href} variant="primary">
                {manage.label}
              </ExternalLink>
            )}
            <Menu
              align="end"
              trigger={
                <IconButton
                  label={`More actions for ${location.name}`}
                  icon={<Ellipsis />}
                  variant="secondary"
                />
              }
            >
              <MenuItem
                icon={<Trash2 size={16} />}
                tone="danger"
                onSelect={() => setRemoving(true)}
              >
                Remove from WA Stay
              </MenuItem>
            </Menu>
          </>
        }
      />
      <BookingFacts booking={booking} manifest={manifest} units={place.data?.units} />
      <RemoveBookingDialog
        booking={booking}
        manifest={manifest}
        open={removing}
        onClose={() => setRemoving(false)}
        onRemoved={() => navigate(ROUTES.bookings())}
      />
    </div>
  );
}

/** `/bookings/:id`. Refetches keep the page on screen: no full-page spinner after the first load. */
export function BookingDetailPage() {
  useBookingUpdates();
  const { id } = useParams();
  const query = useBooking(Number(id));
  const providers = useProviders();
  const manifest = providers.data?.find((m) => m.id === query.data?.providerId);

  if (query.isPending) {
    return (
      <div className={PAGE} aria-busy="true">
        <p role="status">
          <VisuallyHidden>Loading booking</VisuallyHidden>
        </p>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }
  const missing = query.isSuccess
    ? query.data === null
    : toApiError(query.error).code === 'NOT_FOUND';
  if (missing) {
    return (
      <div className={PAGE}>
        <PageHeader
          title="Booking not found"
          description="It may have been removed from WA Stay."
          back={BACK}
          actions={
            <Button as="a" href={BACK.href} variant="secondary">
              Back to bookings
            </Button>
          }
        />
      </div>
    );
  }
  if (!query.data) {
    return (
      <div className={PAGE}>
        <PageHeader title="Booking" back={BACK} />
        <Notice
          tone="danger"
          title="This booking couldn't be loaded"
          actions={
            <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
              Try again
            </Button>
          }
        >
          {query.error?.message}
        </Notice>
      </div>
    );
  }
  return <BookingDetailView booking={query.data} manifest={manifest} updating={query.isFetching} />;
}

export default BookingDetailPage;
