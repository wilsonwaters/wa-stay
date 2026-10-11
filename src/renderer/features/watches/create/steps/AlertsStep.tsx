import type { ProviderManifest } from '../../../../../shared/types/provider.types';
import type { UnitNoun } from '../../../../components/stay/UnitPicker';
import { WatchAlertFields } from '../../form/WatchAlertFields';

/** Step 4: how often to check, and what to do when something is found. */
export function AlertsStep({ manifest, noun }: { manifest: ProviderManifest; noun: UnitNoun }) {
  return <WatchAlertFields manifest={manifest} noun={noun} />;
}

export default AlertsStep;
