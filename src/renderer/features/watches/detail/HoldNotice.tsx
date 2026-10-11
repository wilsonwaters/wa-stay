import { Link } from 'react-router';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { Watch } from '../../../../shared/types/watch.types';
import { ROUTES } from '../../../app/routes';
import { HoldPanel } from '../../../components/stay/HoldPanel';
import { timeInZone } from '../../../components/timeFormat';
import { Notice } from '../../../components/ui';
import type { WatchActions } from '../shared/useWatchActions';
import { holdRegionLabel, unitNameOf, unitNounFor, type WatchState } from '../shared/watchState';

export interface HoldNoticeProps {
  watch: Watch;
  state: WatchState;
  manifest: ProviderManifest | undefined;
  actions: WatchActions;
}

/**
 * The watch's automatic hold: the shared `HoldPanel` while it is held (the same panel as a
 * snipe's, with the page's one coral button), then that it ran out, or that it was booked.
 */
export function HoldNotice({ watch, state, manifest, actions }: HoldNoticeProps) {
  const provider = manifest?.shortName ?? 'the provider';
  const unit = unitNameOf(watch, watch.hold?.unitId, unitNounFor(manifest));
  const at = watch.hold
    ? timeInZone(new Date(watch.hold.expiresAt), manifest?.timezone ?? 'Australia/Perth')
    : undefined;
  if (state === 'held') {
    return (
      <HoldPanel
        unit={unit}
        expiresAt={watch.hold ? new Date(watch.hold.expiresAt) : undefined}
        manifest={manifest}
        label={holdRegionLabel(watch)}
        onPay={actions.payNow}
        paying={actions.paying}
      />
    );
  }
  if (state === 'hold-expired') {
    return (
      <Notice tone="info" title={at ? `The hold expired at ${at}` : 'The hold has expired'}>
        {unit} was released. Create a new watch to look again.
      </Notice>
    );
  }
  if (state === 'booked') {
    return (
      <Notice tone="success" title={`Booked on ${provider}`}>
        <Link to={ROUTES.bookings()} className="font-semibold underline">
          See it in Bookings
        </Link>
      </Notice>
    );
  }
  return null;
}

export default HoldNotice;
