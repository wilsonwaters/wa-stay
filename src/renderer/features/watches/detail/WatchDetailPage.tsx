import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { LoaderCircle } from 'lucide-react';
import {
  toApiError,
  useLocationDetail,
  useProviders,
  useWatch,
  useWatchUpdates,
} from '../../../api';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { Watch } from '../../../../shared/types/watch.types';
import { ROUTES } from '../../../app/routes';
import {
  Button,
  Notice,
  PageHeader,
  ProviderBadge,
  Skeleton,
  VisuallyHidden,
} from '../../../components/ui';
import { useNow } from '../../../hooks/useNow';
import { DeleteWatchDialog } from '../shared/DeleteWatchDialog';
import { useWatchActions } from '../shared/useWatchActions';
import { WatchActionsBar } from '../shared/WatchActionsBar';
import { watchStateOf } from '../shared/watchState';
import { HoldNotice } from './HoldNotice';
import { WatchAvailability } from './WatchAvailability';
import { WatchSummary } from './WatchSummary';
import { PlacePhoto } from '../../../components/PlacePhoto';
import { providerToday } from '../../../components/stay/providerToday';

const PAGE = 'mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8 lg:px-8';
const BACK = { label: 'Watches', href: `#${ROUTES.watches()}` };

interface ViewProps {
  watch: Watch;
  manifest: ProviderManifest | undefined;
  /** A background refetch is running: the page stays, with a quiet indicator. */
  updating: boolean;
}

function WatchDetailView({ watch, manifest, updating }: ViewProps) {
  const navigate = useNavigate();
  const now = useNow();
  const today = providerToday(manifest, now);
  const state = watchStateOf(watch, today, now);
  const actions = useWatchActions(watch, manifest);
  const [confirming, setConfirming] = useState(false);
  const { location } = watch;
  // The place from the catalogue (main's 6-hour detail cache; the list's search at once): its
  // photo for the header, and its unit names for the preferences.
  const place = useLocationDetail(watch.locationKey);

  return (
    <div className={PAGE}>
      <PageHeader
        title={watch.name}
        back={BACK}
        media={
          <PlacePhoto
            name={location.name}
            place={place.data}
            loading={place.isLoading}
            className="aspect-video w-full rounded-lg sm:aspect-4/3 sm:w-44"
          />
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ProviderBadge providerId={watch.providerId} size="sm" />
            <Link
              to={ROUTES.placeDetail(watch.providerId, location.externalId)}
              className="font-semibold text-brand-strong hover:underline"
            >
              {location.name}
            </Link>
            {location.areaName && <span>· {location.areaName}</span>}
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
            <WatchActionsBar
              watch={watch}
              state={state}
              manifest={manifest}
              actions={actions}
              onDelete={() => setConfirming(true)}
            />
          </>
        }
      />
      <HoldNotice watch={watch} state={state} manifest={manifest} actions={actions} />
      {watch.lastError && (
        <Notice tone="danger" title="Last check failed">
          {watch.lastError}
        </Notice>
      )}
      <WatchSummary
        watch={watch}
        state={state}
        manifest={manifest}
        today={today}
        now={now}
        units={place.data?.units}
      />
      <WatchAvailability watch={watch} manifest={manifest} now={now} />
      {watch.notes && (
        <section aria-labelledby="notes-heading" className="flex flex-col gap-2">
          <h2 id="notes-heading" className="text-xl font-semibold text-fg">
            Notes
          </h2>
          <p className="max-w-2xl whitespace-pre-line text-base text-fg-secondary">{watch.notes}</p>
        </section>
      )}
      <DeleteWatchDialog
        watch={watch}
        open={confirming}
        onConfirm={async () => {
          await actions.deleteWatch();
          navigate(ROUTES.watches());
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

/** `/watches/:id`. Refetches keep the page on screen: no full-page spinner after the first load. */
export function WatchDetailPage() {
  useWatchUpdates();
  const { id } = useParams();
  const query = useWatch(Number(id));
  const providers = useProviders();
  const manifest = providers.data?.find((m) => m.id === query.data?.providerId);

  if (query.isPending) {
    return (
      <div className={PAGE} aria-busy="true">
        <p role="status">
          <VisuallyHidden>Loading watch</VisuallyHidden>
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
          title="Watch not found"
          description="It may have been deleted."
          back={BACK}
          actions={
            <Button as="a" href={BACK.href} variant="secondary">
              Back to watches
            </Button>
          }
        />
      </div>
    );
  }
  if (!query.data) {
    return (
      <div className={PAGE}>
        <PageHeader title="Watch" back={BACK} />
        <Notice
          tone="danger"
          title="This watch couldn't be loaded"
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
  return <WatchDetailView watch={query.data} manifest={manifest} updating={query.isFetching} />;
}

export default WatchDetailPage;
