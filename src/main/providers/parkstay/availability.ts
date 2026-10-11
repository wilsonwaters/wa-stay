/**
 * ParkStay availability:
 *
 * - `check`: one campground's sites night by night, with prices, from
 *   `GET /api/campsite_availablity_view/{id}/` (the misspelling is ParkStay's). Each night is
 *   a tuple `[bookable, label, price, _, _, date]` (`api.py:1550`).
 * - `search`: every campground's free-site counts for a stay in one call,
 *   `GET /api/campground_availabilty_view/` (map pins). It has no prices. ParkStay answers
 *   a request it rejects (a bad Referer, empty dates) with HTTP 200 and no campgrounds
 *   (`api.py:1062-1075`), so an empty answer is returned as it is, with a warning.
 *
 * For the public, ParkStay folds booked, closed and not-yet-released nights into one label,
 * `Unavailable` (`api.py:1578-1588`). Booked is by far the usual reason, so `Unavailable` is
 * `booked`, except on nights past the release horizon (`release-policy.ts` `isReleased`),
 * which are `not-released`. The label is kept for display.
 *
 * At a campground listed by site class (Lucky Bay), each class is one unit, `class:<id>`, and
 * its nights come from the class's own nights and its per-site breakdown (`site-classes.ts`).
 */

import type {
  BulkAvailabilityEntry,
  LocationAvailability,
  NightState,
  NightStatus,
  StayQuery,
  UnitAvailability,
} from '@shared/types/provider.types';
import { eachNight } from '@shared/utils/calendar-date';
import { makeLocationKey } from '@shared/utils/location-key';
import type { ProviderContext } from '../sdk/context';
import { ProviderError, ProviderParseError, throwIfAborted } from '../sdk/errors';
import type { QueryValue } from '../sdk/http';
import type { AvailabilityCheckOptions, AvailabilityModule } from '../sdk/provider';
import type { CampgroundFacts } from './catalog';
import { toParkStayDate, type ParkStayClient } from './client';
import { DEFAULT_MAX_ADVANCE_DAYS } from './constants';
import { parkstayLinks } from './links';
import { isReleased, type ParkStayReleasePolicy } from './release-policy';
import { bookableClassNights, classesOfSiteId, classUnitId, isClassListing } from './site-classes';
import type {
  RawBulkAvailability,
  RawCampsite,
  RawCampsiteAvailabilityView,
  RawNightTuple,
} from './types';

/** The gear types ParkStay accepts (`serialisers.py`: a `ChoiceField`; anything else is HTTP 500). */
const GEAR_TYPES = ['all', 'tent', 'campervan', 'caravan'];

/**
 * ParkStay's `gear_type`: the stay field, else the generic equipment, else `all`. A value
 * ParkStay does not accept, or several (the legacy watch form stored `tent,caravan`, `cabin`
 * or `hut`), asks for `all`.
 */
export function gearTypeOf(stay: StayQuery): string {
  const fromParams = stay.params?.gearType;
  const raw = (typeof fromParams === 'string' && fromParams) || stay.equipment || 'all';
  const wanted = raw
    .split(',')
    .map((gear) => gear.trim().toLowerCase())
    .filter((gear) => GEAR_TYPES.includes(gear));
  return wanted.length === 1 ? wanted[0] : 'all';
}

/** The query `campsite_availablity_view` takes for a stay. */
export function campsiteViewQuery(stay: StayQuery): Record<string, QueryValue> {
  return {
    arrival: toParkStayDate(stay.arrival),
    departure: toParkStayDate(stay.departure),
    num_adult: stay.adults,
    num_concession: stay.concessions ?? 0,
    num_child: stay.children ?? 0,
    num_infant: stay.infants ?? 0,
    gear_type: gearTypeOf(stay),
  };
}

/** `'30.00'`, `30` → 30; `null`, `''`, `'n/a'` → undefined. */
export function parsePrice(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return undefined;
  }
  const price = Number(value);
  return Number.isFinite(price) ? price : undefined;
}

function isNightTuple(value: unknown): value is RawNightTuple {
  return (
    Array.isArray(value) &&
    value.length >= 6 &&
    typeof value[0] === 'boolean' &&
    typeof value[1] === 'string' &&
    typeof value[5] === 'string'
  );
}

/** Whether the view looks like `campsite_availablity_view`: a `sites` array of night tuples. */
function isCampsiteView(body: unknown): body is RawCampsiteAvailabilityView {
  if (typeof body !== 'object' || body === null) return false;
  const sites = (body as RawCampsiteAvailabilityView).sites;
  return (
    Array.isArray(sites) &&
    sites.every(
      (site) =>
        typeof site === 'object' &&
        site !== null &&
        (typeof site.id === 'number' || typeof site.id === 'string') &&
        Array.isArray(site.availability) &&
        site.availability.every(isNightTuple)
    )
  );
}

/** One night tuple as a `NightStatus`; `released` says whether ParkStay has released the date. */
export function toNightStatus(tuple: RawNightTuple, released: boolean): NightStatus {
  const [bookable, label, rawPrice, , , date] = tuple;
  let state: NightState;
  if (bookable === true) state = 'available';
  else if (label === 'Booked') state = 'booked';
  else if (/^Closed/.test(label) || label === 'Closures/Bookings') state = 'closed';
  else if (label === 'Unavailable') state = released ? 'booked' : 'not-released';
  else state = 'unknown';
  const price = parsePrice(rawPrice);
  return { date, state, ...(price !== undefined ? { price } : {}), label };
}

/** The class's sites, each with whether it is free on each of `offsets` (its night indexes). */
function freeSitesByNight(entry: RawCampsite, offsets: readonly number[]): boolean[][] | undefined {
  const rows = entry.breakdown;
  const nights = entry.availability.length;
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  const aligned = rows.every(
    (row) => Array.isArray(row?.availability) && row.availability.length === nights
  );
  if (!aligned) return undefined;
  return rows.map((row) => offsets.map((offset) => row.availability[offset]?.[0] === true));
}

/**
 * A campsite class's nights in the stay (`site-classes.ts`). While some site of the class is
 * free for the whole stay, ParkStay marks every night bookable. Otherwise its breakdown says
 * which sites are free each night: the nights one site can offer as a stay
 * (`bookableClassNights`) are available; a night whose free sites cannot join the available
 * nights next to it is `unknown` with the reason `split` (shown available, the core would
 * read one stay that no site can take); and a night with no free site is booked, closed or
 * not released as for a site. Without a breakdown, the class's own labels are read as a
 * site's.
 */
export function classNights(
  entry: RawCampsite,
  inStay: (date: string) => boolean,
  released: (date: string) => boolean
): NightStatus[] {
  const offsets = entry.availability.flatMap((tuple, offset) => (inStay(tuple[5]) ? offset : []));
  const free = freeSitesByNight(entry, offsets);
  const chosen = free ? bookableClassNights(free, offsets.length) : undefined;
  return offsets.map((offset, i): NightStatus => {
    const tuple = entry.availability[offset];
    const night = toNightStatus(tuple, released(tuple[5]));
    if (!free || !chosen) return night;
    if (chosen[i]) return { ...night, state: 'available' };
    if (free.some((site) => site[i])) return { ...night, state: 'unknown', reason: 'split' };
    // No site is free; a price label then means taken and closed sites together.
    if (night.state === 'available' || night.state === 'unknown') {
      return { ...night, state: released(tuple[5]) ? 'booked' : 'not-released' };
    }
    return night;
  });
}

export interface ViewSourceDeps {
  ctx: Pick<ProviderContext, 'id' | 'clock'>;
  client: ParkStayClient;
  facts: CampgroundFacts;
  release: ParkStayReleasePolicy;
}

/**
 * Reads `campsite_availablity_view` and records what it says about the campground's
 * releases and classes. Catalogue detail, availability and the release policy share it.
 */
export class CampsiteViews {
  constructor(private readonly deps: ViewSourceDeps) {}

  async fetch(
    externalId: string,
    stay: StayQuery,
    signal?: AbortSignal
  ): Promise<RawCampsiteAvailabilityView> {
    const { ctx, client, facts, release } = this.deps;
    throwIfAborted(signal);
    if (!/^\d+$/.test(externalId)) {
      throw new ProviderError({
        providerId: ctx.id,
        message: `${ctx.id}: there is no campground ${externalId}`,
      });
    }
    const body = await client.getApi<unknown>(`/campsite_availablity_view/${externalId}/`, {
      query: campsiteViewQuery(stay),
      signal,
    });
    if (!isCampsiteView(body)) {
      throw new ProviderParseError({
        providerId: ctx.id,
        message: `${ctx.id}: campground ${externalId}'s availability has an unexpected shape`,
      });
    }
    facts.rememberView(externalId, body, ctx.clock());
    await release.rememberReleaseTime(externalId, body.release_time_friendly);
    throwIfAborted(signal);
    return body;
  }
}

export interface AvailabilityDeps {
  ctx: Pick<ProviderContext, 'id' | 'clock' | 'timezone' | 'logger'>;
  client: ParkStayClient;
  facts: CampgroundFacts;
  views: CampsiteViews;
  release: ParkStayReleasePolicy;
}

function isBulkAvailability(body: unknown): body is RawBulkAvailability {
  const available = (body as RawBulkAvailability | null)?.campground_available;
  return typeof available === 'object' && available !== null && !Array.isArray(available);
}

export function createAvailability({
  ctx,
  client,
  facts,
  views,
  release,
}: AvailabilityDeps): AvailabilityModule {
  async function check(
    externalId: string,
    stay: StayQuery,
    options: AvailabilityCheckOptions = {}
  ): Promise<LocationAvailability> {
    const { signal, unitIds, knownUnitIds } = options;
    const view = await views.fetch(externalId, stay, signal);
    const nights = eachNight(stay.arrival, stay.departure);
    const today = release.today();
    const maxAdvanceDays = facts.maxAdvanceBooking(externalId) ?? DEFAULT_MAX_ADVANCE_DAYS;
    const releaseDate = view.release_date ?? undefined;
    const released = (date: string): boolean =>
      isReleased({
        date,
        today,
        maxAdvanceDays,
        releaseDate,
        bookingTimeOpen: view.booking_time_open,
      });

    // Only the stay's own nights.
    const inStay = (date: string): boolean => date >= stay.arrival && date < stay.departure;
    const byClass = isClassListing(view);
    // At a class listing, a site id kept from before #21 names a class (`classesOfSiteId`).
    const asked = [...new Set([...(unitIds ?? []), ...(knownUnitIds ?? [])])];
    const aliasesOf = (site: RawCampsite): string[] =>
      byClass ? asked.filter((id) => classesOfSiteId(view, id).includes(site)) : [];
    const wanted = unitIds?.length ? new Set(unitIds) : undefined;

    const units: UnitAvailability[] = [];
    for (const site of view.sites) {
      const unitId = (byClass && classUnitId(site)) || String(site.id);
      const aliases = aliasesOf(site);
      if (wanted && !wanted.has(unitId) && !aliases.some((id) => wanted.has(id))) continue;
      const siteNights = byClass
        ? classNights(site, inStay, released)
        : site.availability
            .filter((tuple) => inStay(tuple[5]))
            .map((tuple) => toNightStatus(tuple, released(tuple[5])));
      const byDate = new Map(siteNights.map((night) => [night.date, night]));
      const unitNights = nights.flatMap((date) => byDate.get(date) ?? []);
      const fullyAvailable =
        nights.length > 0 && nights.every((date) => byDate.get(date)?.state === 'available');
      const prices = unitNights.map((night) => night.price);
      const total =
        fullyAvailable && prices.every((p) => p !== undefined)
          ? prices.reduce<number>((sum, p) => sum + (p ?? 0), 0)
          : undefined;
      const className = byClass ? undefined : view.classes?.[String(site.class ?? null)];
      units.push({
        unitId,
        unitName: site.name,
        ...(className ? { unitType: className } : {}),
        ...(aliases.length > 0 ? { aliases } : {}),
        nights: unitNights,
        fullyAvailable,
        ...(total !== undefined ? { total } : {}),
      });
    }

    const open = nights.every(released);
    let opensAt: string | undefined;
    if (!open && !releaseDate) {
      const at = await release.computeReleaseAt({
        mode: 'daily_rollover',
        externalId,
        stay,
        now: ctx.clock(),
        signal,
      });
      opensAt = at?.toISOString();
    }

    return {
      key: makeLocationKey(ctx.id, externalId),
      checkedAt: ctx.clock().toISOString(),
      units,
      release: { open, ...(opensAt ? { opensAt } : {}) },
      bookingUrl: parkstayLinks.booking(externalId, stay) ?? undefined,
    };
  }

  async function search(stay: StayQuery, signal?: AbortSignal): Promise<BulkAvailabilityEntry[]> {
    const body = await client.getApi<unknown>('/campground_availabilty_view/', {
      query: {
        format: 'json',
        arrival: toParkStayDate(stay.arrival),
        departure: toParkStayDate(stay.departure),
        gear_type: gearTypeOf(stay),
        features: '[]',
        featurescs: '[]',
      },
      signal,
    });
    if (!isBulkAvailability(body)) {
      throw new ProviderParseError({
        providerId: ctx.id,
        message: `${ctx.id}: bulk availability has an unexpected shape`,
      });
    }
    const campgrounds = Object.entries(body.campground_available);
    if (campgrounds.length === 0) {
      // Possibly a genuinely empty answer, so not an error.
      ctx.logger.warn(
        'ParkStay bulk availability listed 0 campgrounds; ParkStay answers a request it rejects the same way'
      );
    }
    const entries: BulkAvailabilityEntry[] = [];
    for (const [id, value] of campgrounds) {
      // Campgrounds that are not bookable online have no totals.
      if (!Number.isFinite(value?.total_available) || !Number.isFinite(value?.total_bookable)) {
        continue;
      }
      // ParkStay's names read the other way round (`api.py:1100-1169`): `total_available` is
      // how many sites the campground has, `total_bookable` how many are free on every night
      // (its `sites`). Both are 0 past the 180-day horizon and for stays over 28 nights.
      entries.push({
        key: makeLocationKey(ctx.id, id),
        availableUnits: value.total_bookable!,
        bookableUnits: value.total_available!,
      });
    }
    return entries;
  }

  return { check, search };
}
