import type { UnitSummary } from '../../../shared/types/catalog.types';
import type { UnitKind } from '../../../shared/types/provider.types';
import { isCalendarDate, nightsBetween } from '../../../shared/utils/calendar-date';
import { unitKindOfUnit } from '../../../shared/utils/unit-kinds';
import type { UnitNoun } from '../nightGridModel';
import { Notice } from '../ui';
import { choosesUnit } from './UnitPicker';

export interface MinStayInput {
  /** The place's units; none until they load. */
  units?: readonly UnitSummary[];
  /** The chosen units; none means every unit (of the chosen stay types). */
  unitIds: readonly string[];
  /** The chosen stay types, where they are offered; none means any. */
  unitKinds?: readonly UnitKind[];
  /** Calendar dates `YYYY-MM-DD`, or '' until chosen. */
  arrival: string;
  departure: string;
  /** The place's name: "Osprey Bay". */
  place?: string;
  noun: UnitNoun;
  /** The provider's short name. */
  shortName: string;
  /** What WA Stay does with a stay the provider accepts: a watch alerts on it, a snipe holds it. */
  action: 'alerts on' | 'holds';
}

/** A unit's usual minimum stay, when it is a rule: a whole number of nights above 1. */
function usualMinimum(unit: UnitSummary): number | undefined {
  const { minNights } = unit;
  return typeof minNights === 'number' && Number.isInteger(minNights) && minNights > 1
    ? minNights
    : undefined;
}

/**
 * Why the stay is shorter than the provider takes, from the units' usual minimums
 * (`UnitSummary.minNights`), for the stay steps: of the units it is about (the chosen ones, else
 * those of the chosen stay types, else every unit), when every one needs more nights than the
 * stay has, "Osprey Bay's cabins need at least 3 nights. WA Stay only alerts on stays RAC
 * accepts."; when some do, "Some cabins need at least 3 nights." The smallest such minimum is
 * named. Undefined when the dates or the units are not known yet, or no unit needs more.
 */
export function minStayWarning(input: MinStayInput): string | undefined {
  const { units, unitIds, unitKinds = [], arrival, departure, place, noun } = input;
  if (!units || units.length === 0) return undefined;
  if (!isCalendarDate(arrival) || !isCalendarDate(departure)) return undefined;
  const nights = nightsBetween(arrival, departure);
  if (nights < 1) return undefined;

  const chosen = units.filter((unit) => choosesUnit(unitIds, unit));
  const about =
    chosen.length > 0
      ? chosen
      : unitKinds.length > 0
        ? units.filter((unit) => unitKinds.includes(unitKindOfUnit(unit)))
        : units;
  const short = about.flatMap((unit) => {
    const minimum = usualMinimum(unit);
    return minimum !== undefined && minimum > nights ? [minimum] : [];
  });
  if (short.length === 0) return undefined;

  const minimum = Math.min(...short);
  if (short.length < about.length) return `Some ${noun.many} need at least ${minimum} nights.`;
  const whose = place ? `${place}'s ${noun.many}` : `These ${noun.many}`;
  return (
    `${whose} need at least ${minimum} nights. ` +
    `WA Stay only ${input.action} stays ${input.shortName} accepts.`
  );
}

/**
 * The stay steps' warning that the stay is shorter than the units take (`minStayWarning`): a
 * warning `Notice` (`role="status"`, so it is announced when it appears), or nothing.
 */
export function MinStayNotice(props: MinStayInput) {
  const warning = minStayWarning(props);
  return warning ? <Notice tone="warning">{warning}</Notice> : null;
}

export default MinStayNotice;
