/**
 * Stay types in the watch and snipe flows (R6): what a place's units are, whether the place is
 * mixed, which stay types to offer, how a choice reads, and the rule that an automatic hold
 * never takes "any unit" across stay types. A unit with no kind (or one this app does not know)
 * counts as `other`, as in main's matching (`unitKindOfUnit`), so the flows and the watch and
 * snipe services agree on which places are mixed. Pure.
 */
import { UNIT_KINDS, type UnitKind } from '../../../shared/types/provider.types';
import { STAY_TYPES, unitKindOfUnit } from '../../../shared/utils/unit-kinds';

/** `kinds` without repeats, in `UNIT_KINDS` order (the stay types' order, then `other`). */
export function orderedKinds(kinds: Iterable<UnitKind>): UnitKind[] {
  const set = new Set(kinds);
  return UNIT_KINDS.filter((kind) => set.has(kind));
}

/** The distinct kinds of a place's units, in order; a unit with no kind is `other`. */
export function placeUnitKinds(units: readonly { unitKind?: unknown }[]): UnitKind[] {
  return orderedKinds(units.map(unitKindOfUnit));
}

/** A place is mixed when its units are of two or more kinds (`other` counts as one). */
export function isMixedPlace(placeKinds: readonly UnitKind[] | undefined): boolean {
  return (placeKinds?.length ?? 0) >= 2;
}

/**
 * The stay types to offer as chips: at a mixed place its units' kinds without `other`, plus any
 * kind already chosen (an edited watch's stored kind the place no longer has stays on offer, so
 * it can be turned off). None for a place that is not mixed and has nothing chosen.
 */
export function stayTypeOptions(
  placeKinds: readonly UnitKind[],
  chosen: readonly UnitKind[]
): UnitKind[] {
  const offered = isMixedPlace(placeKinds) ? placeKinds.filter((kind) => kind !== 'other') : [];
  return orderedKinds([...offered, ...chosen]);
}

/** "Cabins & villas"; "Other" for `other`, which is never one of the `STAY_TYPES`. */
export function stayTypeLabel(kind: UnitKind): string {
  return STAY_TYPES.find((type) => type.kind === kind)?.label ?? 'Other';
}

/** "Cabins & villas, Rooms", or "Any" for none. */
export function stayTypesText(kinds: readonly UnitKind[]): string {
  return kinds.length > 0 ? orderedKinds(kinds).map(stayTypeLabel).join(', ') : 'Any';
}

/**
 * Whether an automatic hold would have to choose between stay types, as main decides it
 * (`kindsAmbiguous`): no units chosen, and the units wanted (those of the chosen stay types, or
 * every unit) are of more than one kind. Main then places no hold, so the flows ask for a stay
 * type or a unit first.
 */
export function holdNeedsChoice(
  placeKinds: readonly UnitKind[],
  unitKinds: readonly UnitKind[],
  unitIds: readonly string[]
): boolean {
  if (unitIds.length > 0) return false;
  const wanted =
    unitKinds.length > 0 ? placeKinds.filter((kind) => unitKinds.includes(kind)) : placeKinds;
  return wanted.length > 1;
}

/** "Cabins & villas", "Cabins & villas or Rooms", "Camping, Rooms or Dorms". */
function orList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/**
 * A prefill link's stay types against the place's units, once they are known: those the place
 * offers are kept; at a mixed place with none of them, they are cleared with a notice; a place
 * that is not mixed clears them without one, since there is nothing to filter.
 */
export function reconcileStayTypes(
  chosen: readonly UnitKind[],
  placeKinds: readonly UnitKind[],
  placeName: string
): { unitKinds: UnitKind[]; notice?: string } {
  if (chosen.length === 0) return { unitKinds: [] };
  const offered = stayTypeOptions(placeKinds, []);
  const kept = chosen.filter((kind) => offered.includes(kind));
  if (kept.length > 0 || offered.length === 0) return { unitKinds: kept };
  return {
    unitKinds: [],
    notice: `${placeName} has no ${orList(orderedKinds(chosen).map(stayTypeLabel))}, so choose a stay type.`,
  };
}
