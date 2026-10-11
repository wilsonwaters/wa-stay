import { useId, useState } from 'react';
import { Link } from 'react-router';
import { SnipeStatus } from '../../../../shared/types/common.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import { ROUTES } from '../../../app/routes';
import { ConnectAccountPrompt } from '../../../components/accounts/ConnectAccountPrompt';
import { PlacePhoto, type PhotoPlace } from '../../../components/PlacePhoto';
import { partyLabel, stayDatesLabel, stayNightsLabel } from '../../../components/stay/stayFormat';
import { Card, ProviderBadge, StatusPill } from '../../../components/ui';
import { ConnectToArmDialog } from '../shared/ConnectToArmDialog';
import { DeleteSnipeDialog } from '../shared/DeleteSnipeDialog';
import { HeldPanel } from '../shared/HeldPanel';
import { ReleaseLine } from '../shared/ReleaseLine';
import { SnipeActionsBar } from '../shared/SnipeActionsBar';
import { compactProgress } from '../shared/SnipeTimeline';
import { isFinished, statusPillFor, timelineSteps } from '../shared/snipeState';
import { useSnipeActions } from '../shared/useSnipeActions';
import { useUnitNames } from '../shared/useUnitNames';

export interface SnipeCardProps {
  snipe: SiteSnipe;
  manifest: ProviderManifest | undefined;
  /** Today where the provider is, for the stay's dates. */
  today: string;
  /** The catalogue's record of the place, for its photo; undefined when it has none. */
  place?: PhotoPlace;
  placeLoading?: boolean;
}

const attempts = (n: number) => `${n} ${n === 1 ? 'attempt' : 'attempts'}`;

/**
 * One snipe in the list, photo first: whose and where, the stay, its status and current step,
 * when the sites open (the only part that ticks), the hold to pay for (its unit named as the
 * place names it), and one action with a menu for the rest.
 */
export function SnipeCard({ snipe, manifest, today, place, placeLoading }: SnipeCardProps) {
  const headingId = useId();
  // The place's unit names (its cached catalogue detail), asked only for a held snipe.
  const unitNames = useUnitNames(snipe, snipe.status === SnipeStatus.HELD);
  const actions = useSnipeActions(snipe, manifest, unitNames);
  const [confirming, setConfirming] = useState(false);
  const { location, stay } = snipe;
  const provider = manifest?.shortName ?? 'the provider';

  return (
    <Card
      as="article"
      aria-labelledby={headingId}
      padding="none"
      className="flex flex-col gap-3 p-3 sm:flex-row sm:gap-4"
    >
      <PlacePhoto
        name={location.name || snipe.name}
        place={place}
        loading={placeLoading}
        className="aspect-video w-full rounded-md sm:aspect-4/3 sm:w-36 sm:self-start"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-3">
          <h2 id={headingId} className="min-w-0 text-base font-semibold text-fg">
            <Link
              to={ROUTES.snipeDetail(snipe.id)}
              className="block truncate rounded-sm hover:underline"
            >
              {snipe.name}
            </Link>
          </h2>
          <StatusPill {...statusPillFor(snipe.status)} className="shrink-0" />
        </div>
        <p className="flex min-w-0 items-center gap-2 text-sm text-fg-secondary">
          <ProviderBadge providerId={snipe.providerId} size="sm" className="shrink-0" />
          <span className="truncate">
            {[location.name, location.areaName].filter(Boolean).join(' · ')}
          </span>
        </p>
        <p className="text-sm text-fg-secondary">
          {stayDatesLabel(stay.arrival, stay.departure, today)} ·{' '}
          {stayNightsLabel(stay.arrival, stay.departure)} · {partyLabel(stay)}
        </p>
        <ReleaseLine snipe={snipe} manifest={manifest} />
        {snipe.status === SnipeStatus.HELD && (
          <HeldPanel
            snipe={snipe}
            manifest={manifest}
            actions={actions}
            unitNames={unitNames}
            variant="card"
          />
        )}
        {snipe.status === SnipeStatus.BOOKED && (
          <p className="text-sm text-available-fg">
            Booked on {provider}
            {snipe.bookedReference ? ` · ${snipe.bookedReference}` : ''}
          </p>
        )}
        {snipe.lastError && snipe.status !== SnipeStatus.HELD && (
          <p className="text-sm text-danger">{snipe.lastError}</p>
        )}
        {manifest && !isFinished(snipe) && (
          <ConnectAccountPrompt
            manifest={manifest}
            when="required"
            compact
            message={`${provider} needs you signed in before Site Sniper can hold a site.`}
          />
        )}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-1">
          <p className="text-sm text-fg-muted">
            {compactProgress(timelineSteps(snipe))} ·{' '}
            {snipe.attemptsCount > 0 ? attempts(snipe.attemptsCount) : 'No attempts yet'}
          </p>
          <div className="ml-auto">
            <SnipeActionsBar
              snipe={snipe}
              manifest={manifest}
              actions={actions}
              onDelete={() => setConfirming(true)}
            />
          </div>
        </div>
      </div>
      <DeleteSnipeDialog
        snipe={snipe}
        provider={provider}
        open={confirming}
        onConfirm={actions.deleteSnipe}
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
    </Card>
  );
}

export default SnipeCard;
