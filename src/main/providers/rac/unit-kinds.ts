/**
 * What an RAC category is, as a unit kind (`UnitKind`). RAC's category names say it best
 * ("Dorm Room - Sleeps 26", "Modern Safari Tent", "Powered Big Rig Site"), so the name decides
 * first: the first rule whose words it has, in this order (a "Dorm Room" is a dorm, a "Studio
 * Room" a cabin):
 *
 * 1. dorm or bunk → `dorm`;
 * 2. safari tent, glamping or bell tent → `glamping`;
 * 3. site or camp (camping, campsite) → `campsite`;
 * 4. cabin, chalet, villa, cottage, bungalow, lodge, studio or apartment → `cabin`;
 * 5. room, suite or motel → `room`.
 *
 * Words are whole words, so "Two Bedroom Cabin" is not a room. A name with none of them falls
 * back to the park's category type (`RacPark.categoryTypes`); without that, the caller uses
 * `other` (and logs it).
 */

import type { UnitKind } from '@shared/types/provider.types';

const BY_NAME: ReadonlyArray<readonly [RegExp, UnitKind]> = [
  [/\b(?:dorms?|dormitory|dormitories|bunks?|bunkhouse)\b/i, 'dorm'],
  [/\b(?:safari[\s-]*tents?|glamping|bell[\s-]*tents?)\b/i, 'glamping'],
  [/\b(?:sites?|campsites?|camp|camps|camping|campground)\b/i, 'campsite'],
  [/\b(?:cabins?|chalets?|villas?|cottages?|bungalows?|lodges?|studios?|apartments?)\b/i, 'cabin'],
  [/\b(?:rooms?|suites?|motel)\b/i, 'room'],
];

/** The unit kind a category's name gives, or undefined when it names none. */
export function unitKindFromName(name: string): UnitKind | undefined {
  return BY_NAME.find(([words]) => words.test(name))?.[1];
}

/**
 * A category's unit kind: from its name, else from its type id in `categoryTypes`, else
 * undefined (the caller's `other`).
 */
export function unitKindOf(
  name: string,
  typeId: string | undefined,
  categoryTypes: Readonly<Record<string, UnitKind>>
): UnitKind | undefined {
  const byName = unitKindFromName(name);
  if (byName) return byName;
  if (typeId !== undefined && Object.prototype.hasOwnProperty.call(categoryTypes, typeId)) {
    return categoryTypes[typeId];
  }
  return undefined;
}
