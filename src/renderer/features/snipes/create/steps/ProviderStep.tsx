import { useFormContext } from 'react-hook-form';
import { ProviderPicker } from '../../../../components/providers/ProviderPicker';
import type { SnipeFormValues } from '../snipeForm';

export interface ProviderStepProps {
  /** Switches the form to another provider (clearing what belonged to the old one). */
  onProviderChange: (providerId: string) => void;
}

/** Step 1: whose sites to snipe. Only providers that offer Site Sniper are listed (§8, §12.9). */
export function ProviderStep({ onProviderChange }: ProviderStepProps) {
  const { watch } = useFormContext<SnipeFormValues>();
  const providerId = watch('providerId');
  return (
    <ProviderPicker
      capability="snipes"
      label="Whose sites to snipe"
      hint="Site Sniper holds a site on this provider the moment it is released."
      value={providerId || undefined}
      onChange={(id) => {
        if (id !== providerId) onProviderChange(id);
      }}
      emptyMessage="No provider supports Site Sniper yet"
    />
  );
}

export default ProviderStep;
