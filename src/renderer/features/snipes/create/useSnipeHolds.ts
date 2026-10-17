import { useEffect } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { useProviderExperiments } from '../../../api';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { holdsTurningOff } from './snipeAction';
import type { SnipeFormValues } from './snipeForm';

/**
 * Whether the flow offers "Hold it for me": the provider places holds, and they are not turning
 * off (an experiment switched off, until WA Stay restarts), as main decides it (`holdsOf`).
 * While they are, a snipe set to hold is switched to alert, which main would default to.
 */
export function useSnipeHolds(
  manifest: ProviderManifest | undefined,
  form: Pick<UseFormReturn<SnipeFormValues>, 'getValues' | 'setValue'>
): boolean {
  const asks = (manifest?.experiments ?? []).some((e) => e.turnsOn.includes('holds'));
  const states = useProviderExperiments(manifest?.id ?? '', asks);
  const off = asks && holdsTurningOff(manifest, states.data);
  const { getValues, setValue } = form;
  useEffect(() => {
    if (off && getValues('action') === 'hold') setValue('action', 'alert');
  }, [off, getValues, setValue]);
  return manifest?.capabilities.holds === true && !off;
}
