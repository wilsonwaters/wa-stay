/**
 * What a unit is called in copy, from unit kinds (`UnitKind`), the same in main (notifications)
 * and the renderer: "site" when every unit is a campsite, "cabin" when every one is a cabin, and
 * "spot" for units of more than one kind, of `other`, or of none known. "Place" is never a unit
 * noun: it is Explore's word for a location.
 *
 * Copy takes its kinds from the first of these that has any (`unitNounFrom`):
 * 1. the units the copy is about (matched, held or chosen), by their `unitKind` (`kindsOfUnits`);
 * 2. the watch's or snipe's stay types (`unitKinds`);
 * 3. the place's (`unitKindsOf`, or its units' kinds where the units are loaded);
 * 4. the provider's default, from its first location kind (`providerUnitKinds`).
 *
 * No node or electron imports: the renderer compiles this file too.
 */

import type { LocationKind, UnitKind } from '../types/provider.types';
import { cleanUnitKinds, deriveUnitKinds, unitKindOfUnit } from './unit-kinds';

/** What one unit is called, and several: `{ one: 'site', many: 'sites' }`. */
export interface UnitNoun {
  one: string;
  many: string;
}

/** Units of more than one kind, of `other`, or of no known kind. */
export const MIXED_UNIT_NOUN: Readonly<UnitNoun> = Object.freeze({ one: 'spot', many: 'spots' });

/** Each stay type's noun. A dorm is a bunk, as ParkStay's huts have always read. */
const NOUNS: Readonly<Record<Exclude<UnitKind, 'other'>, Readonly<UnitNoun>>> = {
  campsite: { one: 'site', many: 'sites' },
  cabin: { one: 'cabin', many: 'cabins' },
  room: { one: 'room', many: 'rooms' },
  dorm: { one: 'bunk', many: 'bunks' },
  glamping: { one: 'tent', many: 'tents' },
};

/**
 * The noun for units of `kinds`: one stay type's own noun; "spot" for `other`, more than one
 * kind, or none. Unknown values are left out. A new object each call.
 */
export function nounForKinds(kinds: readonly unknown[] | undefined): UnitNoun {
  const known = cleanUnitKinds(kinds);
  const only = known.length === 1 ? known[0] : undefined;
  const noun = only && only !== 'other' ? NOUNS[only] : MIXED_UNIT_NOUN;
  return { ...noun };
}

/**
 * The kinds of `units`, in their order, without repeats. A unit with no kind counts as `other`,
 * as matching counts it, except when no unit says its kind (a provider that gives none, or a
 * check stored before kinds): then there are none, and copy falls back to the next source.
 */
export function kindsOfUnits(
  units: readonly { unitKind?: unknown }[] | null | undefined
): UnitKind[] {
  if (!Array.isArray(units) || units.length === 0) return [];
  if (cleanUnitKinds(units.map((unit) => unit.unitKind)).length === 0) return [];
  return [...new Set(units.map(unitKindOfUnit))];
}

/**
 * A provider's default kinds, those of its first location kind (ParkStay's campgrounds:
 * `['campsite']`); none without a manifest (an unknown provider).
 */
export function providerUnitKinds(
  manifest: { locationKinds: readonly LocationKind[] } | null | undefined
): UnitKind[] {
  const first = manifest?.locationKinds[0];
  return first ? deriveUnitKinds(first) : [];
}

/** The noun from the first source that has a known kind; "spot" when none has. */
export function unitNounFrom(
  ...sources: ReadonlyArray<readonly unknown[] | null | undefined>
): UnitNoun {
  for (const source of sources) {
    const kinds = cleanUnitKinds(source);
    if (kinds.length > 0) return nounForKinds(kinds);
  }
  return nounForKinds([]);
}

/**
 * What `units` are called by their kinds (`kindsOfUnits`), or `fallback` when none says its
 * kind: the units a sentence is about first, then whatever the caller's noun falls back on.
 */
export function nounOfUnits(
  units: readonly { unitKind?: unknown }[] | null | undefined,
  fallback: UnitNoun
): UnitNoun {
  const kinds = kindsOfUnits(units);
  return kinds.length > 0 ? nounForKinds(kinds) : fallback;
}

/** "1 cabin", "24 sites". */
export function unitCountLabel(count: number, noun: UnitNoun): string {
  return `${count} ${count === 1 ? noun.one : noun.many}`;
}

/** The word with a capital, for the start of a sentence: "Cabin held at …". */
export function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
