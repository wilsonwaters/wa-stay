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
 * - Stay rules (`meetsStayRules`): the provider's minimum nights, and the days it takes no
 *   arrivals or departures. A night it refuses under them (`reason: 'min-stay'`), like any
 *   night with a reason, is never free, whatever its state.
 * - Full match: a unit with every night available that passes the price rule and the stay
 *   rules, so a provider's `fullyAvailable` alone never alerts on a stay it would refuse. It
 *   keeps the unit's `freeCount` (the units it stands for, such as RAC's sites of a category),
 *   so an alert counts what is free as Explore does (`freeUnitsOf`).
 * - Partial matches: per unit, each run of consecutive available nights that passes the
 *   price rule, as its own stay (`departure` is the morning after the run's last night),
 *   trimmed to a day it takes arrivals and a day it takes departures, and dropped when shorter
 *   than its minimum.
 */

import type { NightStatus, UnitAvailability, UnitKind, WatchMatch } from '@shared/types';
import { addDays, nightsBetween } from '@shared/utils/calendar-date';
import { isUnitKind, unitKindOfUnit } from '@shared/utils/unit-kinds';

/** What matching needs from a watch (or a snipe). */
export interface MatchCriteria {
  unitIds: readonly string[];
  /** The stay types wanted; none or empty means any kind. */
  unitKinds?: readonly UnitKind[];
  maxPrice?: number;
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

/** A whole number of nights of 1 or more; anything else (0, negative, a fraction) is no rule. */
function nightsRule(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined;
}

/**
 * The fewest nights a stay arriving on `first` may have: the night's own `minNights`, else the
 * unit's, else 1. The arrival decides, so the first night's minimum holds for the whole stay.
 */
export function minimumNights(
  unit: Pick<UnitAvailability, 'minNights'>,
  first: NightStatus | undefined
): number {
  return nightsRule(first?.minNights) ?? nightsRule(unit.minNights) ?? 1;
}

/**
 * Whether the provider's stay rules allow a stay of `nights` (consecutive, from the arrival):
 * it is at least its minimum (`minimumNights`), its first night takes arrivals, and the night
 * starting on its departure date, when the provider reported it (`departureNight`), takes
 * departures.
 */
export function meetsStayRules(
  unit: Pick<UnitAvailability, 'minNights'>,
  nights: readonly NightStatus[],
  departureNight?: NightStatus
): boolean {
  if (nights.length < minimumNights(unit, nights[0])) return false;
  if (nights[0].noArrival === true) return false;
  return departureNight?.noDeparture !== true;
}

/**
 * A night matching counts as free: available, with no reason it is not (`split`, or `min-stay`:
 * refused under the stay rules). The reason wins over the state.
 */
export function isFreeNight(night: NightStatus): boolean {
  return night.state === 'available' && night.reason === undefined;
}

/** The unit's night starting on the morning after `last`, when the provider reported it. */
export function nightAfter(
  unit: Pick<UnitAvailability, 'nights'>,
  last: NightStatus
): NightStatus | undefined {
  const date = addDays(last.date, 1);
  return unit.nights.find((night) => night.date === date);
}

/**
 * A unit free for the whole stay it was checked for: the provider says so (`fullyAvailable`),
 * no night has a reason it is not (`split`, `min-stay`), and the stay meets the stay rules.
 */
export function freeForStay(unit: UnitAvailability): boolean {
  const { nights } = unit;
  if (!unit.fullyAvailable || nights.length === 0) return false;
  if (nights.some((night) => night.reason !== undefined)) return false;
  return meetsStayRules(unit, nights, nightAfter(unit, nights[nights.length - 1]));
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
    ...(isUnitKind(unit.unitKind) ? { unitKind: unit.unitKind } : {}),
    arrival: nights[0].date,
    departure: addDays(nights[nights.length - 1].date, 1),
    partial,
    // A whole-stay match counts the units its unit stands for (`freeUnitsOf`); a run, its dates
    ...(!partial && unit.freeCount !== undefined ? { freeCount: unit.freeCount } : {}),
    priceKnown: price.priceKnown,
    ...(price.total !== undefined ? { total: price.total } : {}),
  };
}

/** Units with every night of the stay available, within the price rule and the stay rules. */
export function fullMatches(
  criteria: Pick<MatchCriteria, 'maxPrice'>,
  units: readonly UnitAvailability[]
): WatchMatch[] {
  const matches: WatchMatch[] = [];
  for (const unit of units) {
    if (!freeForStay(unit)) continue;
    const price = priceCheck(unit.nights, criteria.maxPrice);
    if (price.passes) matches.push(toMatch(unit, unit.nights, false, price));
  }
  return matches;
}

/**
 * A run of consecutive nights as the stay rules allow it: its start moved past nights that take
 * no arrivals, then its end moved back until its departure date takes departures (the night
 * starting that day, inside the run or after it). Empty when nothing is left.
 */
function trimToStayRules(unit: UnitAvailability, run: readonly NightStatus[]): NightStatus[] {
  let start = 0;
  while (start < run.length && run[start].noArrival === true) start += 1;
  let end = run.length;
  while (end > start && nightAfter(unit, run[end - 1])?.noDeparture === true) end -= 1;
  return run.slice(start, end);
}

/**
 * Per unit, each run of consecutive available nights within the price rule and the stay
 * rules. When every night of a run has a price, nights above `maxPrice` split it; a run with
 * an unpriced night passes whole with `priceKnown: false`. Each piece is then trimmed to the
 * days the provider takes arrivals and departures, and dropped when shorter than its minimum.
 */
export function partialMatches(
  criteria: Pick<MatchCriteria, 'maxPrice'>,
  units: readonly UnitAvailability[]
): WatchMatch[] {
  const matches: WatchMatch[] = [];
  const pushRun = (unit: UnitAvailability, run: NightStatus[]): void => {
    const nights = trimToStayRules(unit, run);
    if (nights.length === 0) return;
    if (!meetsStayRules(unit, nights, nightAfter(unit, nights[nights.length - 1]))) return;
    matches.push(toMatch(unit, nights, true, priceCheck(nights)));
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
      if (!isFreeNight(night)) {
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
