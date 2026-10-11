import type { UnitSummary } from '../../../../../shared/types/catalog.types';
import type { ProviderManifest } from '../../../../../shared/types/provider.types';
import type { UnitNoun } from '../../../../components/stay/UnitPicker';
import { WatchStayFields } from '../../form/WatchStayFields';

export interface StayStepProps {
  manifest: ProviderManifest;
  today: string;
  units?: readonly UnitSummary[];
  noun: UnitNoun;
}

/** Step 3: dates, guests, the provider's stay fields, preferred units and a price limit. */
export function StayStep(props: StayStepProps) {
  return <WatchStayFields {...props} />;
}

export default StayStep;
