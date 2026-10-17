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

/** What a unit of each kind is called as a group, for its `unitType`; none for `other`. */
const TYPE_LABELS: Readonly<Record<UnitKind, string | undefined>> = {
  campsite: 'Sites',
  cabin: 'Cabins',
  room: 'Rooms',
  dorm: 'Dorms',
  glamping: 'Glamping',
  other: undefined,
};

/**
 * Every RAC unit's `unitType`: the group its kind is in, "Sites" or "Cabins". RAC's availability
 * answer and a NewBook-native park give no label for a category's type, so the book-now page's
 * labels ("Dorm", or a safari tent among "Cabins") are not used either: a unit's type is the
 * same on the place page, in a check and in a watch.
 */
export function unitTypeOfKind(kind: UnitKind): string | undefined {
  return TYPE_LABELS[kind];
}

/**
 * The kind of a park's category, by `unitKindOf`, else `other`, logging such a category once
 * (by park and category id) through `warn`.
 */
export function createKindResolver(
  warn: (message: string) => void
): (
  park: { slug: string; categoryTypes: Readonly<Record<string, UnitKind>> },
  category: { catId: string; name: string; typeId?: string }
) => UnitKind {
  const logged = new Set<string>();
  return (park, { catId, name, typeId }) => {
    const kind = unitKindOf(name, typeId, park.categoryTypes);
    if (kind) return kind;
    const key = `${park.slug}:${catId}`;
    if (!logged.has(key)) {
      logged.add(key);
      warn(
        `${park.slug}: category ${catId} (type ${typeId ?? 'none'}) has no unit kind in its ` +
          `name or its type; it is "other"`
      );
    }
    return 'other';
  };
}
