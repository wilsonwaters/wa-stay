import { useMemo } from 'react';
import { useLocationCheck } from '../../../api';
import { SnipeReleaseMode } from '../../../../shared/types/common.types';
import type { ProviderManifest, StayQuery } from '../../../../shared/types/provider.types';
import type { UnitNoun } from '../../../components/stay/UnitPicker';
import { toStayParams } from '../../../components/stay/stayFields';
import { RELEASE_UNKNOWN, releasePreview } from './releasePreview';
import { snipeStayFields, type SnipeFormValues } from './snipeForm';

/** Modes whose release time the provider works out itself (not set by hand, not continuous). */
export const isComputedMode = (mode: string) =>
  mode !== SnipeReleaseMode.SCHEDULED && mode !== SnipeReleaseMode.CANCELLATION;

/**
 * The release preview for the form's stay ("Sites for Sat 11 Apr open Mon 13 Oct, 12:00 am
 * AWST (in 11 days)."), from the provider's own check of the place (`catalog.checkLocation`,
 * cached a minute, so the Release and Review steps share one request). Asks only while
 * `enabled` and when the provider has a mode that works out its own release time.
 */
export function useReleasePreview(
  manifest: ProviderManifest,
  values: Pick<SnipeFormValues, 'location' | 'arrival' | 'departure' | 'adults' | 'stayParams'>,
  noun: UnitNoun,
  now: Date,
  enabled = true
): string {
  const { location, arrival, departure, adults, stayParams } = values;
  const wanted = enabled && (manifest.releaseModes ?? []).some((mode) => isComputedMode(mode.id));
  const params = useMemo(
    () => toStayParams(snipeStayFields(manifest), stayParams),
    [manifest, stayParams]
  );
  const stay = useMemo<StayQuery | null>(
    () => (arrival && departure ? { arrival, departure, adults, params } : null),
    [arrival, departure, adults, params]
  );
  const key = wanted && location ? `${manifest.id}:${location.externalId}` : null;
  const check = useLocationCheck(key, stay);
  if (!arrival || check.isError) return RELEASE_UNKNOWN;
  if (!check.data) return 'Checking when these dates open…';
  return releasePreview({
    arrival,
    release: check.data.release,
    timeZone: manifest.timezone,
    now,
    noun,
  });
}
