import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { LoaderCircle } from 'lucide-react';
import {
  toApiError,
  useLocationDetail,
  useProviders,
  useSnipe,
  useSnipeUpdates,
} from '../../../api';
import { SnipeStatus } from '../../../../shared/types/common.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import { ROUTES } from '../../../app/routes';
import { ConnectAccountPrompt } from '../../../components/accounts/ConnectAccountPrompt';
import { PlacePhoto } from '../../../components/PlacePhoto';
import { providerToday } from '../../../components/stay/providerToday';
import {
  Button,
  EmptyState,
  Notice,
  PageHeader,
  ProviderBadge,
  Skeleton,
  VisuallyHidden,
} from '../../../components/ui';
import { useNow } from '../../../hooks/useNow';
import { ConnectToArmDialog } from '../shared/ConnectToArmDialog';
import { DeleteSnipeDialog } from '../shared/DeleteSnipeDialog';
import { HeldPanel } from '../shared/HeldPanel';
import { ReleaseLine } from '../shared/ReleaseLine';
import { SnipeActionsBar } from '../shared/SnipeActionsBar';
import { SnipeTimeline } from '../shared/SnipeTimeline';
import { isFinished, timelineSteps } from '../shared/snipeState';
import { useSnipeActions } from '../shared/useSnipeActions';
import { useUnitNames } from '../shared/useUnitNames';
import { bookingHref } from '../shared/snipeFormat';
import { HoldAlert, useStatusAnnouncements } from '../shared/useStatusAnnouncements';
import { SnipeRecord, SnipeSummary } from './SnipeSummary';
import { useLingering } from './useLingering';

const PAGE = 'mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-8 lg:px-8';
const BACK = { label: 'Site Sniper', href: `#${ROUTES.snipes()}` };

interface ViewProps {
  snipe: SiteSnipe;
  manifest: ProviderManifest | undefined;
  /** A background refetch is running: the page stays, with a quiet indicator. */
  updating: boolean;
}

function SnipeDetailView({ snipe, manifest, updating: fetching }: ViewProps) {
  const updating = useLingering(fetching);
  const navigate = useNavigate();
  const now = useNow();
  const [confirming, setConfirming] = useState(false);
  const place = useLocationDetail(snipe.locationKey);
  const names = useUnitNames(snipe);
  const actions = useSnipeActions(snipe, manifest, names);
  const snipes = useMemo(() => [snipe], [snipe]);
  const manifestOf = useCallback(() => manifest, [manifest]);
  const alert = useStatusAnnouncements(snipes, manifestOf);
  const { location } = snipe;
  const provider = manifest?.shortName ?? 'the provider';
  const today = providerToday(manifest, now);
  const terminal = timelineSteps(snipe).find((step) => step.terminal);

  return (
    <div className={PAGE}>
      <PageHeader
        title={snipe.name}
        back={BACK}
        media={
          <PlacePhoto
            name={location.name || snipe.name}
            place={place.data}
            loading={place.isLoading}
            className="aspect-video w-full rounded-lg sm:aspect-4/3 sm:w-44"
          />
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ProviderBadge providerId={snipe.providerId} size="sm" />
            <Link
              to={ROUTES.placeDetail(snipe.providerId, location.externalId)}
              className="font-semibold text-brand-strong hover:underline"
            >
              {location.name || 'The place'}
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
            <SnipeActionsBar
              snipe={snipe}
              manifest={manifest}
              actions={actions}
              onDelete={() => setConfirming(true)}
              onPage
            />
          </>
        }
      />
      <HoldAlert message={alert} />
      {snipe.status === SnipeStatus.HELD && (
        <HeldPanel snipe={snipe} manifest={manifest} actions={actions} unitNames={names} />
      )}
      {snipe.status === SnipeStatus.BOOKED && (
        <Notice tone="success" title={`Booked on ${provider}`}>
          {snipe.bookedReference && <>Reference {snipe.bookedReference}. </>}
          <Link to={bookingHref(snipe.bookedReference)} className="font-semibold underline">
            See it in Bookings
          </Link>
        </Notice>
      )}
      {terminal && (
        <Notice
          tone={snipe.status === SnipeStatus.FAILED ? 'danger' : 'info'}
          title={terminal.label}
        >
          {snipe.lastError ?? 'The snipe has stopped. Arm it again to keep trying.'}
        </Notice>
      )}
      {manifest && !isFinished(snipe) && (
        <ConnectAccountPrompt
          manifest={manifest}
          message={
            manifest.capabilities.account === 'optional'
              ? `Connect ${provider} before the release so checkout is quicker.`
              : `${provider} needs you signed in before Site Sniper can hold a site.`
          }
        />
      )}
      <div className="grid gap-8 md:grid-cols-[minmax(0,15rem)_1fr]">
        <section aria-labelledby="progress-heading" className="flex flex-col gap-4">
          <h2 id="progress-heading" className="text-lg font-semibold text-fg">
            Progress
          </h2>
          <ReleaseLine snipe={snipe} manifest={manifest} />
          <SnipeTimeline snipe={snipe} />
          <SnipeRecord snipe={snipe} manifest={manifest} now={now} />
        </section>
        <SnipeSummary
          snipe={snipe}
          manifest={manifest}
          today={today}
          now={now}
          units={place.data?.units}
        />
      </div>
      {snipe.notes && (
        <section aria-labelledby="notes-heading" className="flex flex-col gap-2">
          <h2 id="notes-heading" className="text-xl font-semibold text-fg">
            Notes
          </h2>
          <p className="max-w-2xl whitespace-pre-line text-base text-fg-secondary">{snipe.notes}</p>
        </section>
      )}
      <DeleteSnipeDialog
        snipe={snipe}
        provider={provider}
        open={confirming}
        onConfirm={async () => {
          await actions.deleteSnipe();
          navigate(ROUTES.snipes());
        }}
        onCancel={() => setConfirming(false)}
      />
      {manifest && (
        <ConnectToArmDialog
          manifest={manifest}
          snipeName={snipe.name}
          open={actions.connectOpen}
          onClose={actions.closeConnect}
          onArm={actions.armAfterConnect}
        />
      )}
    </div>
  );
}

/** `/site-sniper/:id`. Refetches keep the page on screen: no full-page spinner after the first load. */
export function SnipeDetailPage() {
  useSnipeUpdates();
  const { id } = useParams();
  const query = useSnipe(Number(id));
  const providers = useProviders();
  const manifest = providers.data?.find((m) => m.id === query.data?.providerId);

  if (query.isPending && Number(id) > 0) {
    return (
      <div className={PAGE} aria-busy="true">
        <p role="status">
          <VisuallyHidden>Loading snipe</VisuallyHidden>
        </p>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }
  const missing = query.isSuccess
    ? query.data === null
    : query.isPending || toApiError(query.error).code === 'NOT_FOUND';
  if (missing) {
    return (
      <div className={PAGE}>
        <EmptyState
          headingLevel={1}
          size="md"
          title="Snipe not found"
          description="It may have been deleted, or the link is out of date."
          actions={
            <Button as="a" href={BACK.href} variant="secondary">
              Back to Site Sniper
            </Button>
          }
        />
      </div>
    );
  }
  if (!query.data) {
    return (
      <div className={PAGE}>
        <PageHeader title="Snipe" back={BACK} />
        <Notice
          tone="danger"
          title="This snipe couldn't be loaded"
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
  return <SnipeDetailView snipe={query.data} manifest={manifest} updating={query.isFetching} />;
}

export default SnipeDetailPage;
