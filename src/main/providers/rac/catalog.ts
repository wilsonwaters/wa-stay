/**
 * RAC's catalogue: the eight open parks, and each park's categories as its units.
 *
 * - **`listLocations`** maps the seed (`parks.ts`): a park is `rac:<slug>`, a holiday park
 *   booked online, with its area, coordinates, unit kinds, its home page as `infoUrl` and its
 *   book-now page as `bookingUrl`. Each park's card photo comes from RAC's parks page
 *   (`/bookings/`, `park-pages.ts`), read once per sync: the catalogue's one background request
 *   (terms rule 2). The photos read are kept in the provider's state
 *   (`RAC_PARK_PHOTOS_STATE_KEY`), so a sync whose read fails (a block, an error, a page with no
 *   park in it) lists the parks with the photos read before, or with none, and never fails for
 *   it; an abort rejects. No summary or amenities: the core derives a summary from a park's
 *   description once its page is opened.
 * - **`getLocation`**, for a park on RAC's widget, reads its book-now page (one GET,
 *   `book-now.ts`): each category is the unit `cat:<category id>`, with its kind
 *   (`unit-kinds.ts`), its kind's group as its type ("Sites", "Cabins", "Glamping": the type
 *   availability gives it too, which has no type labels), guests, equipment, features and short
 *   description, and the gallery's photos are the place's. The page's notices that have not
 *   ended become `info` notices. A page with no category is a `ProviderParseError` (the core
 *   then serves the stored summary, marked stale).
 * - A **NewBook-native** park's page lists no categories until it is searched, so its units
 *   come from one availability POST for a near stay (one night, 14 days after today in Perth,
 *   two adults; `availability.ts`): every category RAC lists, whatever its availability, as
 *   `cat:<category id>` with its kind and its kind's group as its type. Nothing of that stay's
 *   availability or prices is kept. An answer with no category is a `ProviderParseError`.
 * - With it, at every park, one GET of its **home page** (`/<slug>/`, `park-pages.ts`), queued
 *   at once behind the categories' request: its intro, RAC's own paragraphs, is the detail's
 *   `descriptionHtml` (the place page's About), and its own photos come first in `imageUrls`,
 *   before the widget gallery's photos or, at a native park, its accommodation grid's. A home
 *   page that fails, or shows no intro or no photo, never fails the detail: the intro of the
 *   detail the core stored before is kept, and the card's photo stands in for the park's (a
 *   warning says why).
 * - RAC's photos and words are fetched live and shown only in the app, as RAC publishes them,
 *   with the link to its page (rule 6); the card's photo address is kept in the person's own
 *   catalogue.
 * - Every park's **release info** is the release policy's `describe()`: new dates daily at
 *   midnight, and its school-holiday hour with the members' pre-sale, or its own season.
 * - A park the seed does not have (Ningaloo) rejects with a `ProviderError`, unsent.
 */

import type {
  LocationDetail,
  LocationNotice,
  LocationSummary,
  UnitSummary,
} from '@shared/types/catalog.types';
import type { ProviderId, StayQuery } from '@shared/types/provider.types';
import { addDays, todayIn } from '@shared/utils/calendar-date';
import { makeLocationKey } from '@shared/utils/location-key';
import type { ProviderContext } from '../sdk/context';
import { isAbortError, ProviderError, ProviderParseError, throwIfAborted } from '../sdk/errors';
import type {
  FullCatalogModule,
  GetLocationOptions,
  ProviderLinks,
  ReleasePolicy,
} from '../sdk/provider';
import { categoryUnitId, type CategoryKindOf, type RacAvailability } from './availability';
import { readBookNowPage, type BookNowCategory, type BookNowPage } from './book-now';
import type { RacClient } from './client';
import {
  RAC_PARKS_PAGE_PATH,
  racPhotoUrl,
  readParkHomePage,
  readParksPage,
  type ParkHomePage,
} from './park-pages';
import { RAC_PARKS, racPark, type RacPark } from './parks';
import { unitTypeOfKind } from './unit-kinds';

/** How far ahead a native park's near stay is, to list its categories: 14 days. */
export const RAC_NATIVE_LOOKAHEAD_DAYS = 14;

/**
 * Where the parks' card photos last read from RAC's parks page are kept (slug → photo), for a
 * sync whose read fails.
 */
export const RAC_PARK_PHOTOS_STATE_KEY = 'catalog.parkPhotos';

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

/** An error's message for the log, without its last full stop: never a query (`client.ts`). */
const reasonOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/\.$/, '');

export interface RacCatalogDeps {
  ctx: ProviderContext;
  client: RacClient;
  links: ProviderLinks;
  /** For a native park's categories. */
  availability: RacAvailability;
  kindOf: CategoryKindOf;
  /** When a park's dates open, for the place page and Site Sniper's release step. */
  release: Pick<ReleasePolicy, 'describe'>;
}

export function createRacCatalog({
  ctx,
  client,
  links,
  availability,
  kindOf,
  release,
}: RacCatalogDeps): FullCatalogModule {
  function toUnit(park: RacPark, page: BookNowPage, category: BookNowCategory): UnitSummary {
    const unit: UnitSummary = {
      unitId: `cat:${category.catId}`,
      unitName: category.title,
      unitKind: kindOf(park, {
        catId: category.catId,
        name: category.title,
        typeId: category.typeId,
      }),
    };
    // The kind's group, as availability gives it, so a unit's type is the same on both
    const type = unitTypeOfKind(unit.unitKind ?? 'other');
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

  /** A native park's categories, from one availability POST for a near stay. */
  async function nativeUnits(park: RacPark, signal?: AbortSignal): Promise<UnitSummary[]> {
    const arrival = addDays(todayIn(ctx.timezone, ctx.clock()), RAC_NATIVE_LOOKAHEAD_DAYS);
    const stay: StayQuery = { arrival, departure: addDays(arrival, 1), adults: 2 };
    const categories = await availability.categories(park, stay, signal);
    if (categories.length === 0) {
      throw new ProviderParseError({
        providerId: ctx.id,
        message: `${ctx.manifest.name}: RAC listed no accommodation at ${park.name}`,
      });
    }
    return categories.map((category): UnitSummary => {
      const unitKind = kindOf(park, {
        catId: String(category.category_id),
        name: category.category_name,
        typeId: category.category_type_id,
      });
      const unitType = unitTypeOfKind(unitKind);
      return {
        unitId: categoryUnitId(category),
        unitName: category.category_name,
        ...(unitType ? { unitType } : {}),
        unitKind,
      };
    });
  }

  /** A park's categories, with their notices and photos: what its booking page shows. */
  interface ParkBook {
    units: UnitSummary[];
    notices: LocationNotice[];
    /** The categories' photos (a widget park's gallery); none at a native park. */
    photos: string[];
  }

  /** A widget park's book-now page: its categories, their photos and its current notices. */
  async function widgetBook(park: RacPark, signal?: AbortSignal): Promise<ParkBook> {
    const response = await client.getPage(`/${park.slug}/book-now/`, { signal });
    const page = readBookNowPage(response.body);
    if (!page) {
      throw new ProviderParseError({
        providerId: ctx.id,
        url: response.url,
        message: `${ctx.manifest.name}: the book-now page of ${park.name} lists no accommodation`,
      });
    }
    return {
      units: page.categories.map((category) => toUnit(park, page, category)),
      notices: noticesOf(page),
      photos: page.categories.flatMap((category) => category.imageUrls),
    };
  }

  /** A native park's categories, from one availability POST: no notices or photos. */
  async function nativeBook(park: RacPark, signal?: AbortSignal): Promise<ParkBook> {
    return { units: await nativeUnits(park, signal), notices: [], photos: [] };
  }

  /** The card photos last read (slug → photo), checked again: none when nothing usable is kept. */
  async function storedParkPhotos(): Promise<Map<string, string>> {
    const photos = new Map<string, string>();
    let stored: unknown;
    try {
      stored = await ctx.state.get<unknown>(RAC_PARK_PHOTOS_STATE_KEY);
    } catch {
      stored = undefined;
    }
    if (typeof stored !== 'object' || stored === null) return photos;
    for (const park of RAC_PARKS) {
      const value = (stored as Record<string, unknown>)[park.slug];
      const photo = typeof value === 'string' ? racPhotoUrl(value) : undefined;
      if (photo) photos.set(park.slug, photo);
    }
    return photos;
  }

  /**
   * Each park's card photo (slug → photo): RAC's parks page, read now and kept; else, when it
   * cannot be read or shows none of the parks, the photos read before. An abort rejects.
   */
  async function parkPhotos(signal?: AbortSignal): Promise<Map<string, string>> {
    let reason: string;
    try {
      const page = await client.getPage(RAC_PARKS_PAGE_PATH, { signal });
      const read = readParksPage(page.body);
      const photos = new Map<string, string>();
      for (const park of RAC_PARKS) {
        const photo = read.get(park.slug);
        if (photo) photos.set(park.slug, photo);
      }
      if (photos.size > 0) {
        await ctx.state.set(RAC_PARK_PHOTOS_STATE_KEY, Object.fromEntries(photos));
        return photos;
      }
      reason = 'it shows none of the parks with a photo (a new layout?)';
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw error;
      reason = reasonOf(error);
    }
    const kept = await storedParkPhotos();
    ctx.logger.warn(
      `No park photos from ${RAC_PARKS_PAGE_PATH}: ${reason}; ` +
        (kept.size > 0 ? 'the photos read before are kept' : 'the parks are listed without')
    );
    return kept;
  }

  /**
   * The park's home page as read, or undefined when it could not be (a warning says why). A
   * page read with no intro is logged too. An abort rejects.
   */
  async function homePage(park: RacPark, signal?: AbortSignal): Promise<ParkHomePage | undefined> {
    const path = `/${park.slug}/`;
    try {
      const response = await client.getPage(`/${park.slug}/`, { signal });
      const page = readParkHomePage(response.body, response.url);
      if (!page.descriptionHtml || page.photos.length === 0) {
        const missing = [page.descriptionHtml ? '' : 'intro', page.photos.length ? '' : 'photo']
          .filter(Boolean)
          .join(' or ');
        ctx.logger.warn(`${park.name}: ${path} shows no ${missing} (a new layout?)`);
      }
      return page;
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw error;
      ctx.logger.warn(`${park.name}: no intro or photos from ${path}: ${reasonOf(error)}`);
      return undefined;
    }
  }

  /** The card photo the stored summary of this park carries, as a stand-in for its own. */
  function cardPhotos(park: RacPark, options?: GetLocationOptions): string[] {
    const summary = options?.summary;
    if (summary?.providerId !== ctx.id || summary.externalId !== park.slug) return [];
    const urls = Array.isArray(summary.imageUrls) ? summary.imageUrls : [];
    return urls
      .map((url) => (typeof url === 'string' ? racPhotoUrl(url) : undefined))
      .filter((url): url is string => url !== undefined);
  }

  /** The intro of the detail the core stored before for this park, if any. */
  function keptIntro(park: RacPark, options?: GetLocationOptions): string | undefined {
    const previous = options?.previous;
    const same = previous?.providerId === ctx.id && previous.externalId === park.slug;
    const html = same ? previous.descriptionHtml : undefined;
    return typeof html === 'string' && html.trim() !== '' ? html : undefined;
  }

  return {
    async listLocations(signal) {
      throwIfAborted(signal);
      const photos = await parkPhotos(signal);
      throwIfAborted(signal);
      return RAC_PARKS.map((park) => {
        const summary = toLocationSummary(ctx.id, park, links);
        const photo = photos.get(park.slug);
        if (photo) summary.imageUrls = [photo];
        return summary;
      });
    },

    async getLocation(externalId, signal, options): Promise<LocationDetail> {
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
        // Each unit is a category of sites or cabins: a type, never one place to stay
        unitsAreTypes: true,
        fetchedAt: ctx.clock().toISOString(),
      };
      // Its categories, and its own words and photos from its home page: both requests are
      // queued at once, in that order, so a place page opened while Explore's search runs
      // waits for one of the search's requests, not one between its own two
      const [book, home] = await Promise.all([
        park.bookNow === 'native' ? nativeBook(park, signal) : widgetBook(park, signal),
        homePage(park, signal),
      ]);
      detail.units = book.units;
      if (book.notices.length > 0) detail.notices = book.notices;
      // Photos of the accommodation: the widget's gallery, or a native park's home page grid's
      const accommodationPhotos =
        park.bookNow === 'native' ? (home?.accommodationPhotos ?? []) : book.photos;
      const ownPhotos = home?.photos.length ? home.photos : cardPhotos(park, options);
      detail.imageUrls = [...new Set([...ownPhotos, ...accommodationPhotos])];
      const description = home?.descriptionHtml ?? keptIntro(park, options);
      if (description) detail.descriptionHtml = description;

      // When its dates open: the park's own hour and the members' pre-sale, or its season. Read
      // after the requests, so they take their place in the queue at once.
      const releaseInfo = await release.describe(park.slug, signal);
      if (releaseInfo) detail.releaseInfo = releaseInfo;
      return detail;
    },
  };
}
