/**
 * What a snipe's units are called (R9), for its pages: the units the words are about, its stay
 * types, the place's units, then its provider's (`unitNounFrom`). Pure.
 */
import type { UnitSummary } from '../../../../shared/types/catalog.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import {
  kindsOfUnits,
  providerUnitKinds,
  unitNounFrom,
  type UnitNoun,
} from '../../../../shared/utils/unit-noun';

/**
 * What a snipe's units are called (R9): by the kinds of the units the words are about (`about`;
 * by default the units it names, found among the place's `units`), else its stay types, else
 * the place's units' kinds, else its provider's: ParkStay's are sites.
 */
export function snipeNoun(
  snipe: Pick<SiteSnipe, 'unitIds' | 'unitKinds'>,
  manifest: ProviderManifest | undefined,
  units?: readonly UnitSummary[],
  about?: readonly UnitSummary[]
): UnitNoun {
  const named =
    about ??
    units?.filter((u) => snipe.unitIds.includes(u.unitId) || snipe.unitIds.includes(u.unitName));
  return unitNounFrom(
    kindsOfUnits(named),
    snipe.unitKinds,
    kindsOfUnits(units),
    providerUnitKinds(manifest)
  );
}

/**
 * What one unit (`unitId`, by default the held one) is called: by its kind among the place's
 * `units`; when it is not there, as `snipeNoun` falls back without the named units.
 */
export function heldUnitNoun(
  snipe: Pick<SiteSnipe, 'unitIds' | 'unitKinds' | 'holdUnitId'>,
  manifest: ProviderManifest | undefined,
  units?: readonly UnitSummary[],
  unitId = snipe.holdUnitId
): UnitNoun {
  const unit = unitId ? (units ?? []).filter((u) => u.unitId === unitId) : [];
  return snipeNoun(snipe, manifest, units, unit);
}
