import { useFormContext } from 'react-hook-form';
import { ProviderPicker } from '../../../../components/providers/ProviderPicker';
import type { SnipeFormValues } from '../snipeForm';

export interface ProviderStepProps {
  /** Switches the form to another provider (clearing what belonged to the old one). */
  onProviderChange: (providerId: string) => void;
}

/**
 * Step 1: which provider. Only providers that offer Site Sniper are listed (§8, §12.9); one that
 * places no holds says "Alerts only" under its name.
 */
export function ProviderStep({ onProviderChange }: ProviderStepProps) {
  const { watch } = useFormContext<SnipeFormValues>();
  const providerId = watch('providerId');
  return (
    <ProviderPicker
      capability="snipes"
      label="Which provider"
      hint="The moment what you choose is released, Site Sniper alerts you or, where the provider allows it, holds it for you."
      note={(provider) => (provider.capabilities.holds ? undefined : 'Alerts only')}
      value={providerId || undefined}
      onChange={(id) => {
        if (id !== providerId) onProviderChange(id);
      }}
      emptyMessage="No provider supports Site Sniper yet"
    />
  );
}

export default ProviderStep;
