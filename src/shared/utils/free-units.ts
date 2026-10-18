/**
 * Free units for a stay, counted one way wherever the app counts them: Explore's free counts
 * (a provider's bulk availability), the place page's and a watch's summary line, a watch's
 * card, its alert and its email, and the Check now toast. A unit free for the whole stay counts
 * as the units it stands for (`UnitAvailability.freeCount`: RAC's sites of a category free for
 * the whole stay), else as one. A provider that gives such counts has no total of its units, so
 * a count of them says no "of M" (`countsFreeUnits`), as Explore does without `bookableUnits`.
 *
 * No node or electron imports: the renderer compiles this file too.
 */

/** Something that may carry a free count: a unit, a watch's match, or a unit read from a row. */
interface Counted {
  freeCount?: unknown;
}

/**
 * How many units a unit free for the whole stay stands for: its `freeCount` when that is a
 * whole number of 1 or more, else 1 (a unit with none, a check stored before counts, or a value
 * that is not a count).
 */
export function freeUnitsOf(unit: Counted): number {
  const count = unit.freeCount;
  return typeof count === 'number' && Number.isInteger(count) && count >= 1 ? count : 1;
}

/** The units free for the whole stay that `units` stand for (each already known to be free). */
export function sumFreeUnits(units: readonly Counted[]): number {
  return units.reduce((sum, unit) => sum + freeUnitsOf(unit), 0);
}

/**
 * Whether the provider counted the units it listed (`freeCount` on any of them, free or not): it
 * then gives no total of its units, so a count says what is free, never "of M".
 */
export function countsFreeUnits(units: readonly Counted[]): boolean {
  return units.some((unit) => unit.freeCount !== undefined);
}

/**
 * The word after a count of the units free for the whole stay: "free" when the provider counts
 * its units (`countsFreeUnits`), as Explore says it ("51 spots free"), else "available" (ParkStay's
 * "3 sites available").
 */
export function freeUnitsWord(units: readonly Counted[]): 'free' | 'available' {
  return countsFreeUnits(units) ? 'free' : 'available';
}
