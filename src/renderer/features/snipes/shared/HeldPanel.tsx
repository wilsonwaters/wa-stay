import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import { HoldPanel } from '../../../components/stay/HoldPanel';
import type { SnipeActions } from './useSnipeActions';
import { unitLabel, unitNounFor } from './snipeState';

export interface HeldPanelProps {
  snipe: SiteSnipe;
  manifest: ProviderManifest | undefined;
  actions: Pick<SnipeActions, 'payNow' | 'paying'>;
  /** The place's own unit names, when known, for "Site 12 (powered)". */
  unitNames?: ReadonlyMap<string, string>;
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
  unitNames,
  variant = 'page',
  className,
}: HeldPanelProps) {
  return (
    <HoldPanel
      unit={unitLabel(snipe.holdUnitId, unitNounFor(manifest), unitNames)}
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
