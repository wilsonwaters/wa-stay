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
 *   book-now page for the stay, with `membership_type` for this person. Never a cart address.
 * - **Members** (terms rule 14). One `isMember()` per check (`release.forStay`, through
 *   `membership.ts`) decides both which tariffs count (a members' tariff only with a member
 *   number saved, `mapping.ts`) and when held-back nights open, so prices, free nights and the
 *   release always agree. The number itself is never read here, and never sent.
 * - **Releases** (`release-policy.ts`). A night that is not open yet is `not-released`: one RAC
 *   refuses as beyond its 364-day window (site code 9, or tariff code 5), or one RAC does not
 *   report free in a school-holiday period whose release is still to come for this person (the
 *   member pre-sale's instant for a category in it, with a member number; else the public
 *   one). A night RAC reports free stays free: its engine decides (terms rule 16). The result's
 *   `release` is `{ open: false, opensAt }` when a night is not open yet, with `opensAt` the
 *   policy's `daily_rollover` instant for the stay (left out when the policy would refuse it),
 *   else `{ open: true }`; none when no unit is in the answer. A stay that is not open and that
 *   the policy would refuse to time carries the refusal's words as `refused` (Cable Beach's dry
 *   season, holidays RAC has not announced), for Site Sniper's release preview.
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
import type { AvailabilityCheckOptions, AvailabilityModule } from '../sdk/provider';
import type { RacClient } from './client';
import { racBookingPage, type RacLinks } from './links';
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
  links: RacLinks;
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

/**
 * Why RAC's form cannot carry `stay` (nothing is sent then), or undefined when it can: the
 * dates must be two calendar dates in order, and the pets 0 to 2.
 */
export function stayRefusal(stay: StayQuery): string | undefined {
  const { arrival, departure } = stay;
  if (!isCalendarDate(arrival) || !isCalendarDate(departure) || departure <= arrival) {
    return 'a stay needs an arrival and a later departure (YYYY-MM-DD)';
  }
  if (petsOf(stay) === undefined) return 'a booking takes from 0 to 2 pets';
  return undefined;
}

/** A category's unit id, `cat:<category id>`. */
export function categoryUnitId(category: Pick<RawCategory, 'category_id'>): string {
  return `cat:${category.category_id}`;
}

export interface RacAvailability extends AvailabilityModule {
  /**
   * The categories RAC lists for the stay at the park, from one POST (a native park's units).
   * `onSend` is called once the POST is sent, not while it waits its turn.
   */
  categories(
    park: RacPark,
    stay: StayQuery,
    signal?: AbortSignal,
    onSend?: () => void
  ): Promise<RawCategory[]>;
  /**
   * The categories as `check` gives them, one unit each, in their order, with the nights a
   * school-holiday release still holds back for this person marked `not-released`: the same
   * function `check` uses, so Explore's counts (bulk) and the place page cannot disagree.
   */
  unitsOf(
    park: RacPark,
    stay: StayQuery,
    categories: readonly RawCategory[]
  ): Promise<UnitAvailability[]>;
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
    signal?: AbortSignal,
    onSend?: () => void
  ): Promise<RawCategory[]> {
    throwIfAborted(signal);
    const refusal = stayRefusal(stay);
    if (refusal) throw refuse(refusal);
    const pets = petsOf(stay) ?? 0;
    const response = await client.postAjax(
      RAC_AVAILABILITY_PATH,
      availabilityForm(park, stay, pets),
      { referer: `${ctx.manifest.website}/${park.slug}/book-now/`, signal, onSend }
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

  function toUnit(
    park: RacPark,
    stay: StayQuery,
    category: RawCategory,
    member: boolean
  ): UnitAvailability {
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
      ...categoryAvailability(category, eachNight(stay.arrival, stay.departure), { member }),
      ...(bookingUrl ? { bookingUrl } : {}),
    };
  }

  /**
   * The categories as units, nights held back marked (`withHeldBackNights`), and the stay's
   * release for this person (one `isMember()`, which also decides which tariffs count): what
   * `check` and bulk both read.
   */
  async function unitsAndRelease(
    park: RacPark,
    stay: StayQuery,
    answered: readonly RawCategory[],
    options: { unitIds?: readonly string[]; signal?: AbortSignal } = {}
  ): Promise<{ units: UnitAvailability[]; stayRelease: StayRelease }> {
    const { unitIds, signal } = options;
    const stayRelease = await release.forStay(park.slug, stay, {
      unitIds,
      now: ctx.clock(),
      signal,
    });
    const wanted = unitIds?.length ? new Set(unitIds) : undefined;
    const units = answered
      .filter((category) => !wanted || wanted.has(categoryUnitId(category)))
      .map((category) =>
        withHeldBackNights(toUnit(park, stay, category, stayRelease.member), stayRelease)
      );
    return { units, stayRelease };
  }

  return {
    categories,

    unitsOf: async (park, stay, answered) => (await unitsAndRelease(park, stay, answered)).units,

    async check(
      externalId: string,
      stay: StayQuery,
      options: AvailabilityCheckOptions = {}
    ): Promise<LocationAvailability> {
      const { signal, unitIds } = options;
      throwIfAborted(signal);
      const park = parkOf(externalId);
      const answered = await categories(park, stay, signal);
      const { units, stayRelease } = await unitsAndRelease(park, stay, answered, {
        unitIds,
        signal,
      });
      const open = !units.some((unit) => unit.nights.some((n) => n.state === 'not-released'));
      const { opensAt, refused } = stayRelease;
      const bookingUrl = links.bookNow(park.slug, stay, stayRelease.member);
      return {
        key: makeLocationKey(ctx.id, park.slug),
        checkedAt: ctx.clock().toISOString(),
        units,
        // With no unit, nothing says whether the stay is open
        ...(units.length === 0
          ? {}
          : {
              release: open
                ? { open: true }
                : {
                    open: false,
                    ...(opensAt ? { opensAt: opensAt.toISOString() } : {}),
                    ...(refused ? { refused } : {}),
                  },
            }),
        ...(bookingUrl ? { bookingUrl } : {}),
      };
    },
  };
}
