import { useState } from 'react';
import { SnipeReleaseMode } from '../../../../shared/types/common.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { releaseModeLabel } from '../shared/snipeFormat';
import { whenInZone } from './releasePreview';
import type { SnipeFormValues } from './snipeForm';
import { isComputedMode } from './useReleasePreview';
import { zonedInstant } from './zonedTime';

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

/**
 * The Review's release line: "At a scheduled time: Tue 3 Nov, 10:00 am AWST", or a mode that
 * works out its own release with what is known of it (`known`: the refusal, else the preview),
 * or the mode's name alone (a cancellation).
 */
export function releaseSummaryFor(
  manifest: ProviderManifest | undefined,
  values: Pick<SnipeFormValues, 'releaseMode' | 'releaseDate' | 'releaseTime'>,
  known: string
): string {
  const label = releaseModeLabel(manifest, values.releaseMode);
  const scheduledAt =
    values.releaseMode === SnipeReleaseMode.SCHEDULED && manifest
      ? zonedInstant(values.releaseDate, values.releaseTime, manifest.timezone)
      : undefined;
  if (scheduledAt && manifest) return `${label}: ${whenInZone(scheduledAt, manifest.timezone)}`;
  return isComputedMode(values.releaseMode) ? `${label}. ${known}` : label;
}
