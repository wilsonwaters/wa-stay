import { useState } from 'react';
import type { SnipeFormValues } from './snipeForm';
import { isComputedMode } from './useReleasePreview';

/** What a refusal is about: the stay and the mode the provider could not time. */
const releaseKey = (v: SnipeFormValues) =>
  JSON.stringify([
    v.providerId,
    v.location?.externalId,
    v.arrival,
    v.departure,
    v.releaseMode,
    v.unitIds,
    v.unitKinds,
  ]);

/**
 * Why the provider could not time the stay in a mode that works out its own release (a refused
 * create's `VALIDATION` on `releaseAt`, such as RAC's "These dates are already open on RAC…"),
 * kept for that stay and mode only: the Release step and Review show it in place of the
 * preview's guess ("Release time unknown…") until the stay or the mode changes. A scheduled
 * release's refusal is its date field's error instead.
 */
export function useReleaseRefusal(values: SnipeFormValues) {
  const [refusal, setRefusal] = useState<{ key: string; message: string }>();
  return {
    refused: refusal?.key === releaseKey(values) ? refusal.message : undefined,
    remember: (refused: SnipeFormValues, message: string) => {
      if (isComputedMode(refused.releaseMode)) setRefusal({ key: releaseKey(refused), message });
    },
  };
}
