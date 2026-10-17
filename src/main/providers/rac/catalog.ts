/**
 * RAC's catalogue: the eight open parks, and each park's categories as its units.
 *
 * - **`listLocations`** maps the seed (`parks.ts`) and sends nothing (terms rule 2): a park is
 *   `rac:<slug>`, a holiday park booked online, with its area, coordinates, unit kinds, its
 *   home page as `infoUrl` and its book-now page as `bookingUrl`. No summary, photos or
 *   amenities: those are RAC's copy (rule 6).
 * - **`getLocation`**, for a park on RAC's widget, reads its book-now page (one GET,
 *   `book-now.ts`): each category is the unit `cat:<category id>`, with its kind
 *   (`unit-kinds.ts`), type, guests, equipment, features and short description, and the
 *   gallery's photos are the place's. They are fetched live and shown only in the app (rule 6).
 *   The page's notices that have not ended become `info` notices. A page with no category is a
 *   `ProviderParseError` (the core then serves the stored summary, marked stale).
 * - A **NewBook-native** park's page lists no categories until it is searched, so its detail is
 *   the seed's facts with no units, and nothing is sent.
 * - A park the seed does not have (Ningaloo) rejects with a `ProviderError`, unsent.
 */

import type {
  LocationDetail,
  LocationNotice,
  LocationSummary,
  UnitSummary,
} from '@shared/types/catalog.types';
import type { ProviderId, UnitKind } from '@shared/types/provider.types';
import { todayIn } from '@shared/utils/calendar-date';
import { makeLocationKey } from '@shared/utils/location-key';
import type { ProviderContext } from '../sdk/context';
import { ProviderError, ProviderParseError, throwIfAborted } from '../sdk/errors';
import type { FullCatalogModule, ProviderLinks } from '../sdk/provider';
import { readBookNowPage, type BookNowCategory, type BookNowPage } from './book-now';
import type { RacClient } from './client';
import { RAC_PARKS, racPark, type RacPark } from './parks';
import { unitKindOf } from './unit-kinds';

/** When a park's dates open, for the place page's booking rules. */
export const RAC_RELEASE_INFO =
  'Bookings open 364 days ahead, at midnight Perth time. School-holiday dates open on set days.';

/** Cable Beach is not in the school-holiday releases; its peak season opens month by month. */
export const RAC_ROLLING_RELEASE_INFO =
  'Bookings open 364 days ahead, at midnight Perth time. Peak-season dates open on set days.';

/** A park as a location: the seed's facts only. */
export function toLocationSummary(
  providerId: ProviderId,
  park: RacPark,
  links: ProviderLinks
): LocationSummary {
  const summary: LocationSummary = {
    key: makeLocationKey(providerId, park.slug),
    providerId,
    externalId: park.slug,
    name: park.name,
    kind: 'holiday-park',
    bookingMode: 'online',
    lat: park.lat,
    lng: park.lng,
    area: { ...park.area },
    imageUrls: [],
    amenities: [],
    unitKinds: [...park.unitKinds],
  };
  const infoUrl = links.location(park.slug);
  const bookingUrl = links.booking(park.slug);
  if (infoUrl) summary.infoUrl = infoUrl;
  if (bookingUrl) summary.bookingUrl = bookingUrl;
  return summary;
}

/** A unit's amenities: its features, plus pets and wheelchair access when they apply. */
function amenitiesOf(category: BookNowCategory): string[] {
  const amenities = [...category.features];
  if (category.maxPets > 0) amenities.push(`Pets allowed (up to ${category.maxPets})`);
  const listed = amenities.some((amenity) => /^wheelchair[\s-]accessible$/i.test(amenity));
  if (category.accessible && !listed) amenities.push('Wheelchair accessible');
  return amenities;
}

export interface RacCatalogDeps {
  ctx: ProviderContext;
  client: RacClient;
  links: ProviderLinks;
}

export function createRacCatalog({ ctx, client, links }: RacCatalogDeps): FullCatalogModule {
  /** Categories whose kind was not found, already logged once. */
  const unknownKinds = new Set<string>();

  function kindOf(park: RacPark, category: BookNowCategory): UnitKind {
    const kind = unitKindOf(category.title, category.typeId, park.categoryTypes);
    if (kind) return kind;
    const key = `${park.slug}:${category.catId}`;
    if (!unknownKinds.has(key)) {
      unknownKinds.add(key);
      ctx.logger.warn(
        `${park.slug}: category ${category.catId} (type ${category.typeId ?? 'none'}) has no ` +
          `unit kind in its name or its type; it is "other"`
      );
    }
    return 'other';
  }

  function toUnit(park: RacPark, page: BookNowPage, category: BookNowCategory): UnitSummary {
    const unit: UnitSummary = {
      unitId: `cat:${category.catId}`,
      unitName: category.title,
      unitKind: kindOf(park, category),
    };
    const type = category.typeId === undefined ? undefined : page.types.get(category.typeId);
    if (type) unit.unitType = type;
    if (category.maxGuests !== undefined) unit.maxPeople = category.maxGuests;
    const equipment = category.equipmentIds
      .map((id) => page.equipment.get(id))
      .filter((name): name is string => name !== undefined);
    if (equipment.length > 0) unit.equipment = equipment;
    const amenities = amenitiesOf(category);
    if (amenities.length > 0) unit.amenities = amenities;
    if (category.description) unit.description = category.description;
    return unit;
  }

  /** The notices that have not ended by today (Perth), in the page's order. */
  function noticesOf(page: BookNowPage): LocationNotice[] {
    const today = todayIn(ctx.timezone, ctx.clock());
    return page.notices
      .filter((notice) => notice.to >= today)
      .map((notice) => ({
        level: 'info',
        text: notice.title ? `${notice.title}: ${notice.text}` : notice.text,
      }));
  }

  return {
    async listLocations(signal) {
      throwIfAborted(signal);
      // Nothing is sent; still settle after the caller could abort.
      await Promise.resolve();
      throwIfAborted(signal);
      return RAC_PARKS.map((park) => toLocationSummary(ctx.id, park, links));
    },

    async getLocation(externalId, signal): Promise<LocationDetail> {
      throwIfAborted(signal);
      const park = racPark(externalId);
      if (!park) {
        throw new ProviderError({
          providerId: ctx.id,
          message: `${ctx.manifest.name} has no park "${externalId}"`,
        });
      }
      const detail: LocationDetail = {
        ...toLocationSummary(ctx.id, park, links),
        units: [],
        releaseInfo: park.schoolHolidays ? RAC_RELEASE_INFO : RAC_ROLLING_RELEASE_INFO,
        fetchedAt: ctx.clock().toISOString(),
      };
      if (park.bookNow === 'native') {
        await Promise.resolve();
        throwIfAborted(signal);
        return detail;
      }

      const response = await client.getPage(`/${park.slug}/book-now/`, { signal });
      const page = readBookNowPage(response.body);
      if (!page) {
        throw new ProviderParseError({
          providerId: ctx.id,
          url: response.url,
          message: `${ctx.manifest.name}: the book-now page of ${park.name} lists no accommodation`,
        });
      }
      detail.units = page.categories.map((category) => toUnit(park, page, category));
      detail.imageUrls = [...new Set(page.categories.flatMap((category) => category.imageUrls))];
      const notices = noticesOf(page);
      if (notices.length > 0) detail.notices = notices;
      return detail;
    },
  };
}
