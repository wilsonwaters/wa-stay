import { useId } from 'react';
import { BellRing } from 'lucide-react';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import { ExternalLink } from '../../../components/ExternalLink';
import { partyLabel, stayDatesLabel, stayNightsLabel } from '../../../components/stay/stayFormat';
import { Button } from '../../../components/ui';
import { cx } from '../../../components/ui/cx';
import { useNow } from '../../../hooks/useNow';
import { inZoneAndLocal } from '../create/zonedTime';
import { alertBookingUrl, alertedUnitLabel } from './snipeAlert';
import type { PlaceUnits } from './usePlaceUnits';
import type { SnipeActions } from './useSnipeActions';

const PERTH = 'Australia/Perth';

/** When the alert came, where the provider is and, when it differs, here. */
function alertTime(snipe: SiteSnipe, manifest: ProviderManifest | undefined, now: Date) {
  return snipe.alert
    ? inZoneAndLocal(new Date(snipe.alert.at), manifest?.timezone ?? PERTH, now)
    : undefined;
}

export interface AlertedPanelProps {
  snipe: SiteSnipe;
  manifest: ProviderManifest | undefined;
  actions: Pick<SnipeActions, 'arm' | 'arming'>;
  /** The place's units, when known: their own names, for an alert that names none. */
  place?: PlaceUnits;
  /** Today where the provider is, for the stay's dates. */
  today: string;
  now: Date;
  className?: string;
}

/**
 * An alerted snipe on its page (the counterpart of `HeldPanel`): "{Unit} was free", when the
 * alert came, the stay and the alert's note, then "Book on {shortName}", the provider's own
 * booking page in the browser (the page's one coral action), and "Arm again". Nothing was held,
 * and it says so. An alert that could not be read reads "Dates were free", with no unit or link.
 */
export function AlertedPanel({
  snipe,
  manifest,
  actions,
  place,
  today,
  now,
  className,
}: AlertedPanelProps) {
  const headingId = useId();
  const provider = manifest?.shortName ?? 'the provider';
  const unit = alertedUnitLabel(snipe, manifest, place);
  const url = alertBookingUrl(snipe);
  const at = alertTime(snipe, manifest, now);
  const { stay } = snipe;

  return (
    <section
      aria-labelledby={headingId}
      className={cx(
        'flex flex-col gap-3 rounded-lg border border-available/30 bg-available-subtle p-4 text-available-fg',
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id={headingId} className="flex items-center gap-2 text-base font-semibold">
          <BellRing size={18} aria-hidden="true" className="shrink-0" />
          {unit ? `${unit} was free` : 'Dates were free'}
        </h2>
        {at && <p className="text-sm">Alert sent {at}</p>}
        <p className="text-sm">
          For {stayDatesLabel(stay.arrival, stay.departure, today)} ·{' '}
          {stayNightsLabel(stay.arrival, stay.departure)} · {partyLabel(stay)}
        </p>
        {snipe.alert?.note && <p className="text-sm">{snipe.alert.note}</p>}
        <p className="text-sm">
          Nothing is held, so book it on {provider} before someone else does.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {url && (
          <ExternalLink href={url} variant="primary">
            Book on {provider}
          </ExternalLink>
        )}
        <Button
          variant="secondary"
          onClick={actions.arm}
          loading={actions.arming}
          disabled={!manifest}
        >
          Arm again
        </Button>
      </div>
    </section>
  );
}

export interface AlertedSummaryProps {
  snipe: SiteSnipe;
  manifest: ProviderManifest | undefined;
  className?: string;
}

/**
 * An alerted snipe on its card: when the alert came and what was free ("Alert sent 10:02 am
 * AWST · CAMPSITE 03 was free"), and "Book on {shortName}" when the alert has a link. Its pill
 * says "Alert sent"; "Arm again" is in the card's actions.
 */
export function AlertedSummary({ snipe, manifest, className }: AlertedSummaryProps) {
  const now = useNow();
  const provider = manifest?.shortName ?? 'the provider';
  const unit = alertedUnitLabel(snipe, manifest);
  const url = alertBookingUrl(snipe);
  const at = alertTime(snipe, manifest, now);
  const line = [at && `Alert sent ${at}`, unit && `${unit} was free`].filter(Boolean).join(' · ');
  if (!line && !url) return null;
  return (
    <div className={cx('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      {line && <p className="text-sm text-available-fg">{line}</p>}
      {url && (
        <ExternalLink href={url} className="text-sm">
          Book on {provider}
        </ExternalLink>
      )}
    </div>
  );
}

export default AlertedPanel;
