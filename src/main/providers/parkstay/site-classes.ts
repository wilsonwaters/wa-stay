/**
 * Campgrounds ParkStay lists by site class rather than by site (`site_type` 1 or 2). Lucky
 * Bay (Cape Le Grand, 43) is one: its 56 sites form one class, "One site - select on
 * arrival". For these, `campsite_availablity_view` has one entry per class
 * (`api.py:1375-1527`; checked live on 9 Oct 2026):
 *
 * - `type` is the class id and `name` its name. `id` is one site of the class: the first by
 *   name, or, while some site is free for the whole stay, any one of those (`v.pop()`,
 *   `api.py:1521`), so it changes from poll to poll. `classes` is empty.
 * - `availability` has one tuple per night, `[bookable, label, price, _, counts, date]`.
 *   While some site is free for the whole stay, every night is bookable
 *   (`api.py:1503-1524`). Otherwise a night is bookable only when no site of the class is
 *   taken; its label is the price while some site is free, `Booked` when every site is booked
 *   and `Unavailable` when every site is closed or not released (`api.py:1438-1497`).
 *   `counts` is `[booked, closed, other]` sites.
 * - `breakdown`, only when no site is free for the whole stay, lists each site of the class
 *   by name with its nights, `[free, label, price, _]` (`api.py:1429-1431,1500-1501`).
 *
 * A class is booked as a class: `create_booking` refuses a site at such a campground
 * ("Campground doesn't support per-site bookings.", `api.py:3112-3123`) and, given
 * `campsite_class`, holds the first site of the class that is free for the whole stay, or
 * answers "Campsite class unavailable for specified time period." (`utils.py:186-202`).
 *
 * So the module shows each class as one unit, `class:<class id>`, whatever site `id` the view
 * gave, and a hold for it posts `campsite_class`: ParkStay picks the free site. Unit ids kept
 * from before #21 are site ids; they name a class through `classesOfSiteId`, from the view.
 */

import type { UnitSummary } from '@shared/types/catalog.types';
import type { RawCampsite, RawCampsiteAvailabilityView } from './types';

const CLASS_UNIT = /^class:(\d+)$/;

/** Whether the view lists campsite classes (`site_type` 1 or 2) rather than sites. */
export function isClassListing(view: Pick<RawCampsiteAvailabilityView, 'site_type'>): boolean {
  return typeof view.site_type === 'number' && view.site_type !== 0;
}

/** A class entry's unit id: `class:<class id>`, or undefined for an entry without a class. */
export function classUnitId(entry: Pick<RawCampsite, 'type'>): string | undefined {
  const classId = entry.type as unknown;
  return typeof classId === 'number' || (typeof classId === 'string' && /^\d+$/.test(classId))
    ? `class:${classId}`
    : undefined;
}

/** `class:117` → `117`; undefined for a site's unit id. */
export function classIdOfUnit(unitId: string | undefined): string | undefined {
  return unitId ? CLASS_UNIT.exec(unitId)?.[1] : undefined;
}

const isCount = (value: unknown, least: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= least;

/**
 * What a site (or a class) entry says about itself, as ParkStay's site cards show it: the
 * people it takes (`min_people` to `max_people`), the vehicles (`max_vehicles`), the gear and
 * its paragraph. The paragraph is `short_description`, plain text (ParkStay's own page inserts
 * it unescaped, so it is only ever shown as text); `description` is always the placeholder
 * `"x"` and is never read. A class entry carries the class's values.
 */
export function unitFacts(
  entry: RawCampsite
): Pick<UnitSummary, 'minPeople' | 'maxPeople' | 'maxVehicles' | 'equipment' | 'description'> {
  const equipment = Object.entries(entry.gearType ?? {})
    .filter(([, on]) => on === true)
    .map(([gear]) => gear);
  const maxPeople = isCount(entry.max_people, 1) ? entry.max_people : undefined;
  const minPeople =
    isCount(entry.min_people, 1) && (maxPeople === undefined || entry.min_people <= maxPeople)
      ? entry.min_people
      : undefined;
  const raw = entry.short_description as unknown;
  const description = typeof raw === 'string' ? raw.trim() : '';
  return {
    ...(minPeople !== undefined ? { minPeople } : {}),
    ...(maxPeople !== undefined ? { maxPeople } : {}),
    ...(isCount(entry.max_vehicles, 0) ? { maxVehicles: entry.max_vehicles } : {}),
    equipment,
    ...(description ? { description } : {}),
  };
}

/** A class entry as a `UnitSummary`: the class, never the one site the view named. */
export function toClassUnitSummary(entry: RawCampsite): UnitSummary {
  return {
    unitId: classUnitId(entry) ?? String(entry.id),
    unitName: entry.name,
    ...unitFacts(entry),
  };
}

/**
 * Which classes a site id stored before #21 names, from the view alone: the class whose
 * entry gave that id, else every class (the view does not say which class a site is in; Lucky
 * Bay has only one). Anything but a site id (a number) names none.
 */
export function classesOfSiteId(
  view: Pick<RawCampsiteAvailabilityView, 'sites'>,
  unitId: string
): RawCampsite[] {
  if (!/^\d+$/.test(unitId)) return [];
  const named = view.sites.filter((entry) => String(entry.id) === unitId);
  return named.length > 0 ? named : [...view.sites];
}

/**
 * Which nights a class can offer as stays: `free[site][night]` says whether a site of the
 * class is free that night. Each run of nights chosen lies on one site (ParkStay books a
 * class run on one site), and two runs are never next to each other, which would read as one
 * stay. The most nights win, then the longest runs (the sum of their squared lengths). A
 * site free every night gives every night; one free night on a different site each night
 * gives every other night.
 */
export function bookableClassNights(
  free: readonly (readonly boolean[])[],
  nights: number
): boolean[] {
  // runFrom[i]: the earliest night a run ending on night i can start on one site, or -1. Any
  // later start works too: the same site is free on the shorter run.
  const runFrom: number[] = [];
  const runStart = free.map(() => -1);
  for (let i = 0; i < nights; i++) {
    let earliest = -1;
    free.forEach((site, s) => {
      if (site[i] !== true) {
        runStart[s] = -1;
        return;
      }
      if (runStart[s] < 0) runStart[s] = i;
      if (earliest < 0 || runStart[s] < earliest) earliest = runStart[s];
    });
    runFrom.push(earliest);
  }

  // best[k]: the best choice among the first k nights; from[k]: where the run ending on night
  // k-1 starts when that night is chosen, else -1.
  interface Score {
    nights: number;
    runs: number;
  }
  const better = (a: Score, b: Score): boolean =>
    a.nights > b.nights || (a.nights === b.nights && a.runs > b.runs);
  const best: Score[] = [{ nights: 0, runs: 0 }];
  const from: number[] = [-1];
  for (let k = 1; k <= nights; k++) {
    let top = best[k - 1];
    let start = -1;
    for (let s = runFrom[k - 1]; s >= 0 && s < k; s++) {
      const before = s === 0 ? best[0] : best[s - 1];
      const length = k - s;
      const score = { nights: before.nights + length, runs: before.runs + length * length };
      if (better(score, top)) {
        top = score;
        start = s;
      }
    }
    best.push(top);
    from.push(start);
  }

  const chosen: boolean[] = Array(nights).fill(false);
  for (let k = nights; k > 0;) {
    const start = from[k];
    if (start < 0) {
      k--;
      continue;
    }
    for (let i = start; i < k; i++) chosen[i] = true;
    k = start - 1;
  }
  return chosen;
}
