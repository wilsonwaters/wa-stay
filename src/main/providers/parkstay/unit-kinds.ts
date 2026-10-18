/**
 * What ParkStay's sites and places are, as unit kinds (`UnitKind`):
 *
 * - **A site** (or a campsite class) is a `campsite` when its gear allows a tent, a campervan
 *   or a caravan: the gear wins, so "Hut 3" that takes a tent is a campsite. Otherwise its
 *   name, or its class's, decides: a hut or bunk is a `dorm`; a cabin, cottage or chalet a
 *   `cabin`; an eco tent, safari tent or eco retreat `glamping`; anything else a `campsite`.
 * - **A place** that is a `campground` (`campground_type` 0, 1 or 4, all booked through
 *   ParkStay) is camping, `['campsite']`, even one with a hut among its sites. Another
 *   operator's place (type 2) gives none, so the catalogue derives them from its kind, which
 *   comes from its name (`kindFromName`).
 */

import type { LocationKind, UnitKind } from '@shared/types/provider.types';

/** The gear that makes a site a campsite. */
const CAMPING_GEAR = ['tent', 'campervan', 'caravan'];

/** Words in a site's or class's name, in the order they are tried. */
const BY_NAME: ReadonlyArray<[RegExp, UnitKind]> = [
  [/\b(?:huts?|bunk(?:s|house|room)?)\b/i, 'dorm'],
  [/\b(?:cabins?|cottages?|chalets?)\b/i, 'cabin'],
  [/\b(?:eco[\s-]*tents?|safari[\s-]*tents?|eco[\s-]*retreats?)\b/i, 'glamping'],
];

/**
 * A site's or campsite class's unit kind, from its `gearType` flags and its names (the site's,
 * then its class's; for a class listing, the class's own).
 */
export function unitKindOf(
  gearType: Record<string, boolean> | null | undefined,
  ...names: Array<string | null | undefined>
): UnitKind {
  if (CAMPING_GEAR.some((gear) => gearType?.[gear] === true)) return 'campsite';
  for (const name of names) {
    if (typeof name !== 'string') continue;
    const match = BY_NAME.find(([words]) => words.test(name));
    if (match) return match[1];
  }
  return 'campsite';
}

/**
 * A place's unit kinds: `['campsite']` for a campground; none for another operator's place,
 * whose kinds the catalogue derives from its kind.
 */
export function placeUnitKinds(kind: LocationKind): UnitKind[] | undefined {
  return kind === 'campground' ? ['campsite'] : undefined;
}
