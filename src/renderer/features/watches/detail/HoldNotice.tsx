import { Link } from 'react-router';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { Watch } from '../../../../shared/types/watch.types';
import { ROUTES } from '../../../app/routes';
import { HoldPanel } from '../../../components/stay/HoldPanel';
import { timeInZone } from '../../../components/timeFormat';
import { Notice } from '../../../components/ui';
import type { WatchActions } from '../shared/useWatchActions';
import { heldNoun, holdRegionLabel, unitNameOf, type WatchState } from '../shared/watchState';

export interface HoldNoticeProps {
  watch: Watch;
  state: WatchState;
  manifest: ProviderManifest | undefined;
  actions: WatchActions;
}

/**
 * The watch's automatic hold: the shared `HoldPanel` while it is held (the same panel as a
 * snipe's, with the page's one coral button, and "Let it go" for a provider that can let a hold
 * go), then that it ran out, or that it was booked. A hold that was let go stays in the panel,
 * which says why it ended (`lastError`: main writes one on a held watch only then).
 */
export function HoldNotice({ watch, state, manifest, actions }: HoldNoticeProps) {
  const provider = manifest?.shortName ?? 'the provider';
  const unit = unitNameOf(watch, watch.hold?.unitId, heldNoun(watch, manifest));
  const at = watch.hold
    ? timeInZone(new Date(watch.hold.expiresAt), manifest?.timezone ?? 'Australia/Perth')
    : undefined;
  const letGo = state === 'hold-expired' && watch.lastError !== undefined;
  if (state === 'held' || letGo) {
    return (
      <HoldPanel
        unit={unit}
        expiresAt={watch.hold ? new Date(watch.hold.expiresAt) : undefined}
        expiresEstimated={watch.hold?.expiresEstimated}
        manifest={manifest}
        label={holdRegionLabel(watch)}
        place={watch.location.name || watch.name}
        onPay={actions.payNow}
        paying={actions.paying}
        onRelease={actions.releaseHold}
        endedMessage={letGo ? watch.lastError : undefined}
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
