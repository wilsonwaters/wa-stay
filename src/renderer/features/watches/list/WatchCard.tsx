import { useId, useState } from 'react';
import { Link } from 'react-router';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { Watch } from '../../../../shared/types/watch.types';
import { ROUTES } from '../../../app/routes';
import { HoldPanel } from '../../../components/stay/HoldPanel';
import { partyLabel, stayNightsLabel, stayDatesLabel } from '../../../components/stay/stayFormat';
import { relativeTime, timeInZone } from '../../../components/timeFormat';
import { Card, ProviderBadge, StatusPill } from '../../../components/ui';
import { DeleteWatchDialog } from '../shared/DeleteWatchDialog';
import { resultSummary } from '../shared/resultSummary';
import { useWatchActions, type WatchActions } from '../shared/useWatchActions';
import { WatchActionsBar } from '../shared/WatchActionsBar';
import {
  holdRegionLabel,
  statusPillFor,
  unitNameOf,
  unitNounFor,
  type WatchState,
} from '../shared/watchState';
import { PlacePhoto, type PhotoPlace } from '../../../components/PlacePhoto';

export interface WatchCardProps {
  watch: Watch;
  state: WatchState;
  manifest: ProviderManifest | undefined;
  now: Date;
  today: string;
  /** The catalogue's record of the place, for its photo; undefined when it has none. */
  place?: PhotoPlace;
  /** The catalogue is still answering. */
  placeLoading?: boolean;
}

/**
 * The hold, expired hold or booking under a card, in the provider's time zone. A live hold is
 * the shared `HoldPanel`, as on a snipe's card, with "Pay now" in it.
 */
export function HoldLine({
  watch,
  state,
  manifest,
  actions,
}: Pick<WatchCardProps, 'watch' | 'state' | 'manifest'> & {
  actions: Pick<WatchActions, 'payNow' | 'paying'>;
}) {
  const zone = manifest?.timezone ?? 'Australia/Perth';
  const provider = manifest?.shortName ?? 'the provider';
  const unit = unitNameOf(watch, watch.hold?.unitId, unitNounFor(manifest));
  const at = watch.hold ? timeInZone(new Date(watch.hold.expiresAt), zone) : undefined;
  if (state === 'held') {
    return (
      <HoldPanel
        unit={unit}
        expiresAt={watch.hold ? new Date(watch.hold.expiresAt) : undefined}
        manifest={manifest}
        label={holdRegionLabel(watch)}
        onPay={actions.payNow}
        paying={actions.paying}
        variant="card"
      />
    );
  }
  if (state === 'hold-expired') {
    return (
      <p className="text-sm text-fg-secondary">
        {at ? `The hold expired at ${at}.` : 'The hold has expired.'} Create a new watch to look
        again.
      </p>
    );
  }
  if (state === 'booked') {
    return (
      <p className="text-sm text-fg-secondary">
        Booked on {provider}.{' '}
        <Link to={ROUTES.bookings()} className="font-semibold text-brand-strong hover:underline">
          See it in Bookings
        </Link>
      </p>
    );
  }
  return null;
}

/**
 * One watch in the list, photo first: the place's photo (left, 4:3; on top when narrow), then
 * whose and where, the stay, what it found and its actions, in about 130 px.
 */
export function WatchCard({
  watch,
  state,
  manifest,
  now,
  today,
  place,
  placeLoading,
}: WatchCardProps) {
  const headingId = useId();
  const actions = useWatchActions(watch, manifest);
  const [confirming, setConfirming] = useState(false);
  const { location, stay } = watch;
  const facts = [
    watch.lastCheckedAt ? `Checked ${relativeTime(new Date(watch.lastCheckedAt), now)}` : undefined,
    watch.isActive && watch.nextCheckAt && (state === 'active' || state === 'held')
      ? `Next check ${timeInZone(new Date(watch.nextCheckAt), manifest?.timezone ?? 'Australia/Perth', now)}`
      : undefined,
    watch.foundCount > 0
      ? `Found ${watch.foundCount} ${watch.foundCount === 1 ? 'time' : 'times'}`
      : undefined,
  ].filter(Boolean);

  return (
    <Card
      as="article"
      aria-labelledby={headingId}
      padding="none"
      className="flex flex-col gap-3 p-3 sm:flex-row sm:gap-4"
    >
      <PlacePhoto
        name={location.name}
        place={place}
        loading={placeLoading}
        className="aspect-video w-full rounded-md sm:aspect-4/3 sm:w-36 sm:self-start"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <h2 id={headingId} className="min-w-0 text-base font-semibold text-fg">
            <Link
              to={ROUTES.watchDetail(watch.id)}
              className="block truncate rounded-sm hover:underline"
            >
              {watch.name}
            </Link>
          </h2>
          <StatusPill {...statusPillFor(state)} className="shrink-0" />
        </div>
        <p className="flex min-w-0 items-center gap-2 text-sm text-fg-secondary">
          <ProviderBadge providerId={watch.providerId} size="sm" className="shrink-0" />
          <span className="truncate">
            {[location.name, location.areaName].filter(Boolean).join(' · ')}
          </span>
        </p>
        <p className="text-sm text-fg-secondary">
          {stayDatesLabel(stay.arrival, stay.departure, today)} ·{' '}
          {stayNightsLabel(stay.arrival, stay.departure)} · {partyLabel(stay)}
        </p>
        <HoldLine watch={watch} state={state} manifest={manifest} actions={actions} />
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-1">
          <p className="min-w-0 text-sm text-fg-secondary">
            <span className="font-semibold text-fg">
              {resultSummary(watch, unitNounFor(manifest))}
            </span>
            {facts.map((fact) => (
              <span key={fact}> · {fact}</span>
            ))}
          </p>
          {/* Right-aligned, also when it wraps under a long summary. */}
          <div className="ml-auto">
            <WatchActionsBar
              watch={watch}
              state={state}
              manifest={manifest}
              actions={actions}
              onDelete={() => setConfirming(true)}
            />
          </div>
        </div>
      </div>
      <DeleteWatchDialog
        watch={watch}
        open={confirming}
        onConfirm={actions.deleteWatch}
        onCancel={() => setConfirming(false)}
      />
    </Card>
  );
}

export default WatchCard;
