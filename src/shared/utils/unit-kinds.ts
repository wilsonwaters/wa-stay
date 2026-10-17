/**
 * Unit kinds (`UnitKind`): what a person sleeps in, the same words for every provider. The
 * groups people choose from (`STAY_TYPES`), what a place offers when its provider does not say
 * (`deriveUnitKinds`, from its `LocationKind`), the cleaning every stored or returned list
 * goes through (`unitKindsOf`), so a location's `unitKinds` is never empty, and what one unit
 * is (`unitKindOfUnit`), the same in main's matching and the renderer's flows.
 *
 * No node or electron imports: the renderer compiles this file too.
 */

import { UNIT_KINDS, type LocationKind, type UnitKind } from '../types/provider.types';

/** A unit kind people can choose: every kind but `other`. */
export type StayTypeKind = Exclude<UnitKind, 'other'>;

/** One group of the stay-type filter. */
export interface StayType {
  kind: StayTypeKind;
  /** The group's name, e.g. "Cabins & villas". */
  label: string;
}

/** The stay types, in display order. `other` is never one. */
export const STAY_TYPES = [
  { kind: 'campsite', label: 'Camping' },
  { kind: 'cabin', label: 'Cabins & villas' },
  { kind: 'room', label: 'Rooms' },
  { kind: 'dorm', label: 'Dorms' },
  { kind: 'glamping', label: 'Glamping' },
] as const satisfies readonly StayType[];

/** What each kind of place offers, when its provider does not say. Never empty. */
const DERIVED: Readonly<Record<LocationKind, readonly UnitKind[]>> = {
  campground: ['campsite'],
  'caravan-park': ['campsite'],
  'holiday-park': ['campsite', 'cabin'],
  cabin: ['cabin'],
  hut: ['dorm'],
  glamping: ['glamping'],
  'farm-stay': ['other'],
  home: ['other'],
  other: ['other'],
};

const KNOWN: ReadonlySet<string> = new Set(UNIT_KINDS);

/** Whether `value` is one of the `UNIT_KINDS`. */
export function isUnitKind(value: unknown): value is UnitKind {
  return typeof value === 'string' && KNOWN.has(value);
}

/**
 * The unit kinds a place of `kind` offers: a holiday park has sites and cabins, a hut has
 * dorm beds. Never empty: a kind outside `LOCATION_KINDS` (a stored row may have one) gives
 * `['other']`. A new array each call.
 */
export function deriveUnitKinds(kind: LocationKind): UnitKind[] {
  const known = Object.prototype.hasOwnProperty.call(DERIVED, kind);
  return [...(known ? DERIVED[kind] : DERIVED.other)];
}

/** `value`'s unit kinds, in its order, without unknown values or duplicates. `[]` for a non-array. */
export function cleanUnitKinds(value: unknown): UnitKind[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isUnitKind))];
}

/**
 * A location's unit kinds: its own `unitKinds` cleaned (`cleanUnitKinds`), or, when that
 * leaves none, those its `kind` gives (`deriveUnitKinds`). Never empty.
 */
export function unitKindsOf(location: { kind: LocationKind; unitKinds?: unknown }): UnitKind[] {
  const own = cleanUnitKinds(location.unitKinds);
  return own.length > 0 ? own : deriveUnitKinds(location.kind);
}

/**
 * What `unit` is: its `unitKind`, or `other` when it has none (or one this app does not know).
 * Watch and snipe matching, and the flows' "mixed place" rule, count units by it.
 */
export function unitKindOfUnit(unit: { unitKind?: unknown }): UnitKind {
  return isUnitKind(unit.unitKind) ? unit.unitKind : 'other';
}
