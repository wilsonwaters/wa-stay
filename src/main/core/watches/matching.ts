/**
 * What a watch finds in one availability check. Pure: everything comes from the one
 * `LocationAvailability` the provider returned, so partial matches cost no extra request.
 *
 * - Wanted units: those the watch names by id, by name (legacy watches stored site names) or
 *   by an id the provider used for the unit before (`aliases`); else those of the stay types
 *   it wants (`unitKinds`, a unit with no kind counting as `other`); else every unit.
 * - Mixed stay types (`kindsAmbiguous`): no units named, and the wanted units are of more
 *   than one kind, free or not. Nothing is held automatically for such a watch or snipe.
 * - Price rule: `maxPrice` applies per night, and only when every night of the stay (or of
 *   the run) has a price. Otherwise the unit passes with `priceKnown: false`.
 * - Full match: a unit with every night available that passes the price rule.
 * - Partial matches: per unit, each run of consecutive available nights that passes the
 *   price rule, as its own stay (`departure` is the morning after the run's last night).
 */

import type { NightStatus, UnitAvailability, UnitKind, WatchMatch } from '@shared/types';
import { addDays, nightsBetween } from '@shared/utils/calendar-date';
import { isUnitKind } from '@shared/utils/unit-kinds';

/** What matching needs from a watch (or a snipe). */
export interface MatchCriteria {
  unitIds: readonly string[];
  /** The stay types wanted; none or empty means any kind. */
  unitKinds?: readonly UnitKind[];
  maxPrice?: number;
}

/** What `unit` is: its `unitKind`, or `other` when it has none (or one this app does not know). */
function unitKindOfUnit(unit: Pick<UnitAvailability, 'unitKind'>): UnitKind {
  return isUnitKind(unit.unitKind) ? unit.unitKind : 'other';
}

/**
 * The units wanted: with `unitIds`, those named by id, name or an earlier id only (the person
 * chose them, so kinds do not apply); else, with `unitKinds`, the units of those kinds; else
 * every unit.
 */
export function wantedUnits(
  criteria: Pick<MatchCriteria, 'unitIds' | 'unitKinds'>,
  units: readonly UnitAvailability[]
): UnitAvailability[] {
  if (criteria.unitIds.length > 0) {
    return units.filter(
      (unit) =>
        criteria.unitIds.includes(unit.unitId) ||
        criteria.unitIds.includes(unit.unitName) ||
        (unit.aliases ?? []).some((alias) => criteria.unitIds.includes(alias))
    );
  }
  const kinds = criteria.unitKinds ?? [];
  if (kinds.length === 0) return [...units];
  return units.filter((unit) => kinds.includes(unitKindOfUnit(unit)));
}

/**
 * Whether "any unit" would be ambiguous: no units named, and the wanted units (every one, free
 * or not, so the answer is the same at every check) are of more than one kind. An automatic
 * hold must not pick between a campsite and a cabin for the person.
 */
export function kindsAmbiguous(
  criteria: Pick<MatchCriteria, 'unitIds'>,
  wanted: readonly UnitAvailability[]
): boolean {
  if (criteria.unitIds.length > 0) return false;
  return new Set(wanted.map(unitKindOfUnit)).size > 1;
}

/** The price rule for a run of nights: whether it passes, and whether every price is known. */
export function priceCheck(
  nights: readonly NightStatus[],
  maxPrice?: number
): { passes: boolean; priceKnown: boolean; total?: number } {
  const priceKnown = nights.length > 0 && nights.every((night) => night.price !== undefined);
  const total = priceKnown ? nights.reduce((sum, night) => sum + (night.price ?? 0), 0) : undefined;
  if (!maxPrice || !priceKnown) return { passes: true, priceKnown, total };
  return {
    passes: nights.every((night) => (night.price ?? 0) <= maxPrice),
    priceKnown,
    total,
  };
}

function toMatch(
  unit: UnitAvailability,
  nights: readonly NightStatus[],
  partial: boolean,
  price: { priceKnown: boolean; total?: number }
): WatchMatch {
  return {
    unitId: unit.unitId,
    unitName: unit.unitName,
    ...(unit.unitType ? { unitType: unit.unitType } : {}),
    arrival: nights[0].date,
    departure: addDays(nights[nights.length - 1].date, 1),
    partial,
    priceKnown: price.priceKnown,
    ...(price.total !== undefined ? { total: price.total } : {}),
  };
}

/** Units with every night of the stay available, within the price rule. */
export function fullMatches(
  criteria: Pick<MatchCriteria, 'maxPrice'>,
  units: readonly UnitAvailability[]
): WatchMatch[] {
  const matches: WatchMatch[] = [];
  for (const unit of units) {
    if (!unit.fullyAvailable || unit.nights.length === 0) continue;
    const price = priceCheck(unit.nights, criteria.maxPrice);
    if (price.passes) matches.push(toMatch(unit, unit.nights, false, price));
  }
  return matches;
}

/**
 * Per unit, each run of consecutive available nights within the price rule. When every
 * night of a run has a price, nights above `maxPrice` split it; a run with an unpriced night
 * passes whole with `priceKnown: false`.
 */
export function partialMatches(
  criteria: Pick<MatchCriteria, 'maxPrice'>,
  units: readonly UnitAvailability[]
): WatchMatch[] {
  const matches: WatchMatch[] = [];
  const pushRun = (unit: UnitAvailability, nights: NightStatus[]): void => {
    if (nights.length > 0) matches.push(toMatch(unit, nights, true, priceCheck(nights)));
  };
  for (const unit of units) {
    let run: NightStatus[] = [];
    const endRun = (): void => {
      const { priceKnown } = priceCheck(run);
      if (!criteria.maxPrice || !priceKnown) {
        pushRun(unit, run);
      } else {
        let within: NightStatus[] = [];
        for (const night of run) {
          if ((night.price ?? 0) <= criteria.maxPrice) {
            within.push(night);
          } else {
            pushRun(unit, within);
            within = [];
          }
        }
        pushRun(unit, within);
      }
      run = [];
    };
    for (const night of unit.nights) {
      const last = run[run.length - 1];
      if (night.state !== 'available') {
        endRun();
        continue;
      }
      if (last && night.date !== addDays(last.date, 1)) endRun();
      run.push(night);
    }
    endRun();
  }
  return matches;
}

/**
 * The longest of `runs` (partial matches), by nights, the first one on a tie; undefined for
 * none. A partial alert's message and its booking link both name this run.
 */
export function longestRun(runs: readonly WatchMatch[]): WatchMatch | undefined {
  let longest: WatchMatch | undefined;
  for (const run of runs) {
    if (
      !longest ||
      nightsBetween(run.arrival, run.departure) > nightsBetween(longest.arrival, longest.departure)
    ) {
      longest = run;
    }
  }
  return longest;
}
