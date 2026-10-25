import { useFormContext } from 'react-hook-form';
import { ProviderPicker } from '../../../../components/providers/ProviderPicker';
import type { WatchFormValues } from '../../form/watchFormSchema';

export interface ProviderStepProps {
  /** Switches the form to another provider (clearing what belonged to the old one). */
  onProviderChange: (providerId: string) => void;
}

/** Step 1: whose places to watch. Only providers that offer watches are listed (§8, §12.9). */
export function ProviderStep({ onProviderChange }: ProviderStepProps) {
  const { watch } = useFormContext<WatchFormValues>();
  const providerId = watch('providerId');
  return (
    <ProviderPicker
      capability="watches"
      label="Booking site"
      hint="Watches check this booking site's places for your dates."
      value={providerId || undefined}
      onChange={(id) => {
        if (id !== providerId) onProviderChange(id);
      }}
      emptyMessage="No booking site supports watches yet"
    />
  );
}

export default ProviderStep;
