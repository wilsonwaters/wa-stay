import { useMemo } from 'react';
import { useLocationDetail, useLocationDetailUpdates } from '../../../api';
import type { UnitSummary } from '../../../../shared/types/catalog.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';

/** A snipe's place's units, as its catalogue detail lists them. */
export interface PlaceUnits {
  /** The place's own unit names by id. */
  names: ReadonlyMap<string, string>;
  /** The units, once the detail has loaded: their kinds say what they are called (R9). */
  units?: readonly UnitSummary[];
}

/**
 * The place's units and their own names by id, from its catalogue detail (main's 6-hour cache,
 * shared with the place and detail pages), so a held unit reads the same everywhere. Asks only
 * while `enabled`: a list asks only for held snipes. The detail reloads when its provider's
 * catalogue syncs (`catalog:updated`), as on the place page: on a new profile the first sync
 * brings the names.
 */
export function usePlaceUnits(snipe: Pick<SiteSnipe, 'locationKey'>, enabled = true): PlaceUnits {
  const key = enabled ? snipe.locationKey : null;
  const detail = useLocationDetail(key);
  useLocationDetailUpdates(key);
  const units = detail.data?.units;
  return useMemo(
    () => ({ names: new Map((units ?? []).map((u) => [u.unitId, u.unitName])), units }),
    [units]
  );
}
