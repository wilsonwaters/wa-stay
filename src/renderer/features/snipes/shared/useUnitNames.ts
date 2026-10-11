import { useMemo } from 'react';
import { useLocationDetail, useLocationDetailUpdates } from '../../../api';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';

/**
 * The place's own unit names by id, from its catalogue detail (main's 6-hour cache, shared with
 * the place and detail pages), so a held unit reads the same everywhere. Asks only while
 * `enabled`: a list asks only for held snipes. The detail reloads when its provider's catalogue
 * syncs (`catalog:updated`), as on the place page: on a new profile the first sync brings the
 * names.
 */
export function useUnitNames(
  snipe: Pick<SiteSnipe, 'locationKey'>,
  enabled = true
): ReadonlyMap<string, string> {
  const key = enabled ? snipe.locationKey : null;
  const detail = useLocationDetail(key);
  useLocationDetailUpdates(key);
  const units = detail.data?.units;
  return useMemo(() => new Map((units ?? []).map((u) => [u.unitId, u.unitName])), [units]);
}
