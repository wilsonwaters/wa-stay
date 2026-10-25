/**
 * Stay Rottnest's published booking rules for a stay (`stayRules.check`), worked out without
 * asking it: RIA's terms (RIA4555 §8, §12) and each month's booking guide, read by hand
 * (`booking-guides.ts`, `public-holidays.ts`). The core refuses a watch for a stay these rules
 * refuse, and the place page says why before anything is checked; availability never asks
 * Stay Rottnest about such a stay (`availability.ts`).
 *
 * In the order they are checked, each refusal naming the part of the stay to change:
 * - **Arrival**: not a date already past, nor today (online bookings can't be for the same
 *   day).
 * - **Length**: at most 14 nights.
 * - **Closures** a guide publishes (Bathurst, from 27 Apr 2027).
 * - **Fixed peak stays**: in the periods a guide sets them, each block group (Geordie Bay;
 *   Longreach and Fay's; Bathurst with the Caroline Thomson Cabins…) arrives and leaves only
 *   on its own dates; the stay's nights in the period must be whole blocks. The refusal
 *   suggests the blocks nearest the stay.
 * - **Minimum stays** a guide sets for the peak (the Campground, the dorms, the hostel's family
 *   rooms and Governor Circle: 3 nights).
 * - **Event Saturdays** (the Channel Swim, Port to Pub): not a stay of that Saturday night
 *   alone.
 * - **The party**: everyone (adults, children and infants) within what a room type sleeps.
 *
 * Arriving or leaving on a WA public holiday is a note, not a refusal: the guides from July
 * 2026 dropped the rule that forbade it, and RIA's terms now say only that restrictions "may
 * apply". Nor is a two-night minimum for every Saturday checked: no guide from September 2026
 * says it.
 *
 * A rule that covers only some of the room types the stay could take (Kingstown's heritage
 * cottages, beside its dorms) is a note instead, unless the person chose types it covers. The
 * release, on sale or when it opens, comes with every verdict (`release.ts`).
 */

import type {
  StayQuery,
  StayRelease,
  StayRuleField,
  StayRulesVerdict,
  StaySuggestion,
} from '@shared/types/provider.types';
import {
  addDays,
  compareDates,
  eachNight,
  todayIn,
  type CalendarDate,
} from '@shared/utils/calendar-date';
import type { StayRulesInput, StayRulesModule } from '../sdk/provider';
import {
  BOOKING_GUIDES,
  type BookingGuide,
  type DateRange,
  type NightRange,
} from './booking-guides';
import { ROTTNEST_TIME_ZONE } from './open-days';
import { rottnestPrecinct, type RottnestPrecinct, type RottnestRoomType } from './precincts';
import { WA_PUBLIC_HOLIDAYS } from './public-holidays';
import { releaseStatus, releaseText, type CarryOver } from './release';

/** Everyone a stay sleeps: Stay Rottnest's adults and children (0–17, so infants too). */
export function partyOf(stay: Pick<StayQuery, 'adults' | 'children' | 'infants'>): number {
  return stay.adults + (stay.children ?? 0) + (stay.infants ?? 0);
}

/** The longest stay Stay Rottnest takes (RIA4555 §8; every guide). */
export const ROTTNEST_MAX_NIGHTS = 14;
/** How many suggestions a refusal offers at most. */
const MAX_SUGGESTIONS = 4;

export interface RottnestRulesData {
  guides: readonly BookingGuide[];
  /** WA public holidays, by date. */
  publicHolidays: ReadonlyMap<CalendarDate, string>;
}

const DEFAULT_DATA: RottnestRulesData = {
  guides: BOOKING_GUIDES,
  publicHolidays: new Map(WA_PUBLIC_HOLIDAYS.map((holiday) => [holiday.date, holiday.name])),
};

/** "1 Dec 2026". */
export function shortDate(date: CalendarDate): string {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

/** "8–15 Dec", or "29 Nov – 3 Dec" across months (a block's arrival and departure). */
function blockLabel([arrival, departure]: DateRange): string {
  const format = (date: CalendarDate, withMonth: boolean) =>
    new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      ...(withMonth ? { month: 'short' } : {}),
      timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00Z`));
  return arrival.slice(0, 7) === departure.slice(0, 7)
    ? `${format(arrival, false)}–${format(departure, true)}`
    : `${format(arrival, true)} – ${format(departure, true)}`;
}

/** Whether a rule for these precincts or room types covers a room type at the precinct. */
function covers(
  rule: { precincts?: readonly string[]; roomTypes?: readonly string[] },
  precinct: RottnestPrecinct,
  type: RottnestRoomType
): boolean {
  if (rule.roomTypes?.length) return rule.roomTypes.includes(type.code);
  return rule.precincts?.includes(precinct.slug) ?? false;
}

/** Whether a night range (`from` to `to`, nights inclusive) has a night of the stay. */
function touches(range: { from: CalendarDate; to: CalendarDate }, nights: CalendarDate[]): boolean {
  return nights.some(
    (night) => compareDates(night, range.from) >= 0 && compareDates(night, range.to) <= 0
  );
}

/** The blocks nearest the stay: those it overlaps first, then the nearest arrivals. */
function nearestBlocks(blocks: readonly DateRange[], arrival: CalendarDate): DateRange[] {
  const distance = ([start]: DateRange) =>
    Math.abs(Date.parse(`${start}T00:00:00Z`) - Date.parse(`${arrival}T00:00:00Z`));
  return [...blocks].sort((a, b) => distance(a) - distance(b)).slice(0, MAX_SUGGESTIONS);
}

/**
 * The guides' closures, with those of the same scope that run on from each other joined
 * (Bathurst's April, May and June closures read as one, from 27 Apr to 30 Jun 2027).
 */
function joinedClosures(guides: readonly BookingGuide[]): NightRange[] {
  const scopeOf = (range: NightRange) =>
    JSON.stringify([[...(range.precincts ?? [])].sort(), [...(range.roomTypes ?? [])].sort()]);
  const sorted = guides
    .flatMap((guide) => guide.closures)
    .slice()
    .sort((a, b) => compareDates(a.from, b.from));
  const joined: NightRange[] = [];
  for (const closure of sorted) {
    const last = [...joined].reverse().find((range) => scopeOf(range) === scopeOf(closure));
    if (last && compareDates(closure.from, addDays(last.to, 1)) <= 0) {
      if (compareDates(closure.to, last.to) > 0) last.to = closure.to;
    } else {
      joined.push({ ...closure });
    }
  }
  return joined;
}

export function createRottnestRules(data: RottnestRulesData = DEFAULT_DATA): StayRulesModule {
  const guides = new Map(data.guides.map((guide) => [guide.month, guide]));
  const closures = joinedClosures(data.guides);
  const carryOverInto = (month: string): CarryOver => guides.get(month)?.carryOver ?? 'unknown';

  return {
    check({ externalId, stay, unitIds, unitKinds, now }: StayRulesInput): StayRulesVerdict {
      const precinct = rottnestPrecinct(externalId);
      if (!precinct || compareDates(stay.departure, stay.arrival) <= 0) {
        return { ok: true, notes: [] };
      }
      const nights = eachNight(stay.arrival, stay.departure);
      const status = releaseStatus(stay, now, carryOverInto);
      const release: StayRelease = {
        open: status.open,
        text: releaseText(status),
        ...(status.open ? {} : { opensAt: status.opensAt.toISOString() }),
        ...(status.expected && !status.open ? { expected: true } : {}),
      };
      const notes: string[] = [];
      const refuse = (
        field: StayRuleField,
        reason: string,
        suggestions: StaySuggestion[] = []
      ): StayRulesVerdict => ({
        ok: false,
        reason,
        field,
        notes,
        release,
        ...(suggestions.length ? { suggestions } : {}),
      });

      // The room types the stay could take: the ones chosen, else of the stay types chosen
      let types = precinct.roomTypes;
      const chosen = Boolean(unitIds?.length);
      if (unitIds?.length) {
        types = types.filter((type) => unitIds.includes(type.code));
        if (!types.length)
          return refuse('units', `None of these room types is at ${precinct.name}.`);
      } else if (unitKinds?.length) {
        types = types.filter((type) => unitKinds.includes(type.kind));
        if (!types.length) {
          return refuse('units', `${precinct.name} has none of the stay types chosen.`);
        }
      }
      const subject = types.length === 1 ? types[0].name : precinct.name;
      /** A rule over the stay's room types: all of them, some (a note), or none. */
      const reach = (rule: { precincts?: readonly string[]; roomTypes?: readonly string[] }) => {
        const covered = types.filter((type) => covers(rule, precinct, type)).length;
        return covered === 0 ? 'none' : covered === types.length || chosen ? 'all' : 'some';
      };

      // Arrival: not past, not today
      const today = todayIn(ROTTNEST_TIME_ZONE, now);
      if (compareDates(stay.arrival, today) < 0) return refuse('arrival', 'That date has passed.');
      if (stay.arrival === today) {
        return refuse('arrival', "Stay Rottnest doesn't take online bookings for the same day.");
      }

      // Length
      if (nights.length > ROTTNEST_MAX_NIGHTS) {
        return refuse(
          'departure',
          `Stay Rottnest takes stays of ${ROTTNEST_MAX_NIGHTS} nights at most.`,
          [{ arrival: stay.arrival, departure: addDays(stay.arrival, ROTTNEST_MAX_NIGHTS) }]
        );
      }

      // Public holidays: a note (the terms say restrictions may apply)
      for (const [verb, date] of [
        ['arrive', stay.arrival],
        ['leave', stay.departure],
      ] as const) {
        const holiday = data.publicHolidays.get(date);
        if (!holiday) continue;
        notes.push(
          `You'd ${verb} on a public holiday (${holiday}, ${shortDate(date)}): Stay Rottnest's terms say arrivals and departures then may be restricted.`
        );
      }

      // Every guide's rules whose dates the stay touches (a guide's blocks run into the next
      // month, and the next month's into this one)
      const { guides: all } = data;

      // Closures
      for (const closure of closures) {
        if (!touches(closure, nights)) continue;
        const scope = reach(closure);
        const words = `from ${shortDate(closure.from)} to ${shortDate(closure.to)}`;
        if (scope === 'all') return refuse('arrival', `${subject} is closed ${words}.`);
        if (scope === 'some')
          notes.push(`Some room types at ${precinct.name} are closed ${words}.`);
      }

      // Fixed peak stays
      for (const group of all.flatMap((guide) => guide.fixedBlocks)) {
        const [start, end] = group.period;
        const inPeriod = nights.filter(
          (night) => compareDates(night, start) >= 0 && compareDates(night, end) < 0
        );
        if (!inPeriod.length) continue;
        const scope = reach(group);
        const span = `From ${shortDate(start)} to ${shortDate(end)}`;
        if (scope === 'some') {
          notes.push(`${span}, some room types here take fixed stays only (${group.group}).`);
          continue;
        }
        if (scope === 'none') continue;
        const segStart = inPeriod[0];
        const segEnd = addDays(inPeriod[inPeriod.length - 1], 1);
        const startsBlock = group.blocks.some(([arrival]) => arrival === segStart);
        const endsBlock = group.blocks.some(([, departure]) => departure === segEnd);
        if (startsBlock && endsBlock) continue;
        const near = nearestBlocks(group.blocks, stay.arrival);
        return refuse(
          startsBlock ? 'departure' : 'arrival',
          `${span}, stays at ${group.group} arrive and leave on fixed dates only, such as ${near
            .slice(0, 3)
            .map(blockLabel)
            .join(', ')}.`,
          near.map(([arrival, departure]) => ({ arrival, departure }))
        );
      }

      // Minimum stays in the peak
      for (const minimum of all.flatMap((guide) => guide.minimumStays)) {
        if (nights.length >= minimum.nights || !touches(minimum, nights)) continue;
        const scope = reach(minimum);
        const words = `needs a stay of at least ${minimum.nights} nights from ${shortDate(minimum.from)} to ${shortDate(minimum.to)}`;
        if (scope === 'all') {
          return refuse('departure', `${subject} ${words}.`, [
            { arrival: stay.arrival, departure: addDays(stay.arrival, minimum.nights) },
          ]);
        }
        if (scope === 'some') notes.push(`Some room types here: ${words}.`);
      }

      // Event Saturdays: not that Saturday night alone
      const event = all
        .flatMap((guide) => guide.eventSaturdays)
        .find((saturday) => nights.length === 1 && nights[0] === saturday.date);
      if (event) {
        return refuse(
          'departure',
          `On the ${event.event} weekend, a stay on Saturday ${shortDate(event.date)} must include the Friday or the Sunday night too.`,
          [
            { arrival: addDays(event.date, -1), departure: addDays(event.date, 1) },
            { arrival: event.date, departure: addDays(event.date, 2) },
          ]
        );
      }

      // The party
      const party = partyOf(stay);
      const sleeps = Math.max(...types.map((type) => type.sleeps));
      if (party > sleeps) {
        return refuse(
          'guests',
          types.length === 1
            ? `${types[0].name} sleeps ${sleeps} at most.`
            : `Nothing at ${precinct.name} sleeps ${party}: ${sleeps} at most.`
        );
      }

      return { ok: true, notes, release };
    },
  };
}
