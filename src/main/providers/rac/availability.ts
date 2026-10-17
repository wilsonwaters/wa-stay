/**
 * RAC availability: `check` asks RAC's availability endpoint once per park and stay, as the
 * park's own book-now page does (`ai-state/research/rac-booking-flow.md` §3), and maps every
 * category in the answer to a unit (`mapping.ts`).
 *
 * - **The request.** One POST to `RAC_AVAILABILITY_PATH` through the RAC client (`client.ts`):
 *   RAC's host only, `X-Requested-With`, `Origin` and the park's book-now page as `Referer`,
 *   and the block cool-down. The core paces it and sets its priority; nothing here does.
 * - **The form.** The park's `blog_id` (the seed), the dates as `D MMM YYYY`, the party, the
 *   stay's pets as `animals` (0 when it has none), and every equipment type: what RAC's page
 *   sends before a person picks equipment.
 * - **The units.** One per category, `cat:<category id>`, named as RAC names it, with its kind by
 *   `unit-kinds.ts` (for categories the book-now page leaves out too) and its kind's group as
 *   its type. `unitIds` keeps only those categories.
 * - **Booking links.** A unit's `bookingUrl` is the `online_booking_url` RAC sent when it is a
 *   booking page of the park (`racBookingPage`: https on RAC's site, under `/<slug>/booking/`,
 *   no cart key), else `links.booking` for the stay and the unit. The location's is the
 *   book-now page for the stay. Never a cart address.
 * - **Releases** (`release-policy.ts`). A night that is not open yet is `not-released`: one RAC
 *   refuses as beyond its 364-day window (site code 9, or tariff code 5), or one RAC does not
 *   report free in a school-holiday period whose release is still to come for this person (the
 *   member pre-sale's instant for a category in it, with a member number; else the public
 *   one). A night RAC reports free stays free: its engine decides (terms rule 16). The result's
 *   `release` is `{ open: false, opensAt }` when a night is not open yet, with `opensAt` the
 *   policy's `daily_rollover` instant for the stay (left out when the policy would refuse it),
 *   else `{ open: true }`.
 * - **Refusals.** A park the seed does not have, a stay that is not two calendar dates in order,
 *   or pets outside 0–2 reject with a `ProviderError` and nothing is sent. An answer that is no
 *   answer (`readAvailability`) is a `ProviderParseError`. A block, a 5xx or a network failure
 *   is the client's typed error. An aborted `signal` rejects with an AbortError and nothing more
 *   is sent.
 */

import type {
  LocationAvailability,
  NightStatus,
  StayQuery,
  UnitAvailability,
  UnitKind,
} from '@shared/types/provider.types';
import { eachNight, isCalendarDate } from '@shared/utils/calendar-date';
import { makeLocationKey } from '@shared/utils/location-key';
import type { ProviderContext } from '../sdk/context';
import { ProviderError, ProviderParseError, throwIfAborted } from '../sdk/errors';
import type { AvailabilityCheckOptions, AvailabilityModule, ProviderLinks } from '../sdk/provider';
import type { RacClient } from './client';
import { racBookingPage } from './links';
import {
  categoryAvailability,
  petsOf,
  readAvailability,
  toRacDate,
  type RawCategory,
} from './mapping';
import { racPark, type RacPark } from './parks';
import type { RacReleasePolicy, StayRelease } from './release-policy';
import { unitTypeOfKind } from './unit-kinds';

/** RAC's availability endpoint, at the site's root (the park is the form's `blog_id`). */
export const RAC_AVAILABILITY_PATH =
  '/wp-content/themes/parks-and-resorts/template-parts/components/booking-engine/availability-ajax.php';

/** A category's kind (`createKindResolver`). */
export type CategoryKindOf = (
  park: RacPark,
  category: { catId: string; name: string; typeId?: string }
) => UnitKind;

export interface RacAvailabilityDeps {
  ctx: Pick<ProviderContext, 'id' | 'manifest' | 'clock'>;
  client: RacClient;
  links: ProviderLinks;
  kindOf: CategoryKindOf;
  /** When the stay opens, and which nights a school-holiday release still holds back. */
  release: Pick<RacReleasePolicy, 'forStay'>;
}

/**
 * The unit with each night that is not free and is held back for a release still to come
 * marked `not-released` (its closed days kept).
 */
function withHeldBackNights(unit: UnitAvailability, release: StayRelease): UnitAvailability {
  if (!unit.nights.some((night) => night.state !== 'available')) return unit;
  const nights = unit.nights.map((night): NightStatus => {
    if (night.state === 'available' || night.state === 'not-released') return night;
    if (!release.heldBack(night.date, unit)) return night;
    return {
      date: night.date,
      state: 'not-released',
      ...(night.noArrival ? { noArrival: true } : {}),
      ...(night.noDeparture ? { noDeparture: true } : {}),
    };
  });
  return { ...unit, nights };
}

/** The form RAC's page posts for `stay` at `park`, with `pets` as `animals`. */
export function availabilityForm(
  park: RacPark,
  stay: StayQuery,
  pets: number
): Record<string, string | number> {
  return {
    blog_id: park.blogId,
    available_from: toRacDate(stay.arrival),
    available_to: toRacDate(stay.departure),
    adults: stay.adults,
    children: stay.children ?? 0,
    infants: stay.infants ?? 0,
    animals: pets,
    equipment_type_ids: 'all',
    equipment_measurement_unit: 'm',
    equipment_length: '',
    equipment_width: '',
  };
}

/** A category's unit id, `cat:<category id>`. */
export function categoryUnitId(category: Pick<RawCategory, 'category_id'>): string {
  return `cat:${category.category_id}`;
}

export interface RacAvailability extends AvailabilityModule {
  /** The categories RAC lists for the stay at the park, from one POST (a native park's units). */
  categories(park: RacPark, stay: StayQuery, signal?: AbortSignal): Promise<RawCategory[]>;
}

export function createRacAvailability({
  ctx,
  client,
  links,
  kindOf,
  release,
}: RacAvailabilityDeps): RacAvailability {
  const refuse = (message: string): ProviderError =>
    new ProviderError({ providerId: ctx.id, message: `${ctx.manifest.name}: ${message}` });

  function parkOf(externalId: string): RacPark {
    const park = racPark(externalId);
    if (!park) throw refuse(`there is no park "${externalId}"`);
    return park;
  }

  async function categories(
    park: RacPark,
    stay: StayQuery,
    signal?: AbortSignal
  ): Promise<RawCategory[]> {
    throwIfAborted(signal);
    const { arrival, departure } = stay;
    if (!isCalendarDate(arrival) || !isCalendarDate(departure) || departure <= arrival) {
      throw refuse('a stay needs an arrival and a later departure (YYYY-MM-DD)');
    }
    const pets = petsOf(stay);
    if (pets === undefined) throw refuse('a booking takes from 0 to 2 pets');
    const response = await client.postAjax(
      RAC_AVAILABILITY_PATH,
      availabilityForm(park, stay, pets),
      { referer: `${ctx.manifest.website}/${park.slug}/book-now/`, signal }
    );
    throwIfAborted(signal);
    const reading = readAvailability(response.body);
    if (!reading.ok) {
      throw new ProviderParseError({
        providerId: ctx.id,
        url: response.url,
        message: `${ctx.manifest.name}: no availability for ${park.name}: ${reading.why}`,
      });
    }
    return reading.categories;
  }

  function toUnit(park: RacPark, stay: StayQuery, category: RawCategory): UnitAvailability {
    const unitId = categoryUnitId(category);
    const unitKind = kindOf(park, {
      catId: String(category.category_id),
      name: category.category_name,
      typeId: category.category_type_id,
    });
    const unitType = unitTypeOfKind(unitKind);
    const bookingUrl =
      racBookingPage(category.online_booking_url, park.slug) ??
      links.booking(park.slug, stay, unitId) ??
      undefined;
    return {
      unitId,
      unitName: category.category_name,
      ...(unitType ? { unitType } : {}),
      unitKind,
      ...categoryAvailability(category, eachNight(stay.arrival, stay.departure)),
      ...(bookingUrl ? { bookingUrl } : {}),
    };
  }

  return {
    categories,

    async check(
      externalId: string,
      stay: StayQuery,
      options: AvailabilityCheckOptions = {}
    ): Promise<LocationAvailability> {
      const { signal, unitIds } = options;
      throwIfAborted(signal);
      const park = parkOf(externalId);
      const answered = await categories(park, stay, signal);
      const wanted = unitIds?.length ? new Set(unitIds) : undefined;
      const stayRelease = await release.forStay(park.slug, stay, {
        unitIds,
        now: ctx.clock(),
        signal,
      });
      const units = answered
        .filter((category) => !wanted || wanted.has(categoryUnitId(category)))
        .map((category) => withHeldBackNights(toUnit(park, stay, category), stayRelease));
      const open = !units.some((unit) => unit.nights.some((n) => n.state === 'not-released'));
      const { opensAt } = stayRelease;
      const bookingUrl = links.booking(park.slug, stay);
      return {
        key: makeLocationKey(ctx.id, park.slug),
        checkedAt: ctx.clock().toISOString(),
        units,
        release: open
          ? { open: true }
          : { open: false, ...(opensAt ? { opensAt: opensAt.toISOString() } : {}) },
        ...(bookingUrl ? { bookingUrl } : {}),
      };
    },
  };
}
