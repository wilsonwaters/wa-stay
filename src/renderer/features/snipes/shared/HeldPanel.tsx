import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import { HoldPanel } from '../../../components/stay/HoldPanel';
import type { PlaceUnits } from './usePlaceUnits';
import type { SnipeActions } from './useSnipeActions';
import { heldUnitNoun } from './snipeNouns';
import { unitLabel } from './snipeState';

export interface HeldPanelProps {
  snipe: SiteSnipe;
  manifest: ProviderManifest | undefined;
  actions: Pick<SnipeActions, 'payNow' | 'paying'>;
  /** The place's units, when known: their own names ("Site 12 (powered)") and kinds. */
  place?: PlaceUnits;
  /** `page`: the page's one coral button; `card`: a quieter one in a list. */
  variant?: 'page' | 'card';
  className?: string;
}

/**
 * A snipe's held site in the shared `HoldPanel` (the same panel as a watch's automatic hold):
 * the site by the place's own name, the time left to pay, and "Pay now" (V6).
 */
export function HeldPanel({
  snipe,
  manifest,
  actions,
  place,
  variant = 'page',
  className,
}: HeldPanelProps) {
  return (
    <HoldPanel
      unit={unitLabel(snipe.holdUnitId, heldUnitNoun(snipe, manifest, place?.units), place?.names)}
      expiresAt={snipe.holdExpiresAt ? new Date(snipe.holdExpiresAt) : undefined}
      manifest={manifest}
      label={`Hold at ${snipe.location.name || snipe.name}`}
      onPay={actions.payNow}
      paying={actions.paying}
      variant={variant}
      className={className}
    />
  );
}

export default HeldPanel;
