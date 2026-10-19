/**
 * Stay Rottnest's catalogue: the island's nine precincts, each with its room types as units, from
 * the seed (`precincts.ts`). Nothing is sent: neither listing nor a precinct's page asks Stay
 * Rottnest anything (`ai-state/research/rottnest-terms.md` §9.7).
 *
 * - A precinct is `rottnest:<slug>`, booked online, in the area "Rottnest Island", with its kind,
 *   pin, unit kinds, one-sentence summary, the accommodation maps as `infoUrl` and Stay
 *   Rottnest's search as `bookingUrl`. No photos or amenities: those are RIA's.
 * - Its page lists its room types as units (`unitId` the code), each with its kind, its kind's
 *   group as its type, and its most people; `unitsAreTypes`, as each stands for several units.
 */

import type { LocationDetail, LocationSummary, UnitSummary } from '@shared/types/catalog.types';
import type { ProviderId } from '@shared/types/provider.types';
import { STAY_TYPES } from '@shared/utils/unit-kinds';
import { makeLocationKey } from '@shared/utils/location-key';
import type { ProviderContext } from '../sdk/context';
import { ProviderError, throwIfAborted } from '../sdk/errors';
import type { FullCatalogModule, ProviderLinks, ReleasePolicy } from '../sdk/provider';
import {
  ROTTNEST_PRECINCTS,
  rottnestPrecinct,
  unitKindsOf,
  type RottnestPrecinct,
  type RottnestRoomType,
} from './precincts';

/** Every precinct is on the island, in Explore's region for Perth (DBCA's Swan region). */
export const ROTTNEST_AREA = { name: 'Rottnest Island', region: 'Swan' } as const;

/** A precinct as a location: the seed's facts only. */
export function toLocationSummary(
  providerId: ProviderId,
  precinct: RottnestPrecinct,
  links: ProviderLinks
): LocationSummary {
  const summary: LocationSummary = {
    key: makeLocationKey(providerId, precinct.slug),
    providerId,
    externalId: precinct.slug,
    name: precinct.name,
    kind: precinct.kind,
    bookingMode: 'online',
    lat: precinct.lat,
    lng: precinct.lng,
    area: { ...ROTTNEST_AREA },
    summary: precinct.summary,
    imageUrls: [],
    amenities: [],
    unitKinds: unitKindsOf(precinct),
    unitCount: precinct.roomTypes.length,
  };
  const infoUrl = links.location(precinct.slug);
  const bookingUrl = links.booking(precinct.slug);
  if (infoUrl) summary.infoUrl = infoUrl;
  if (bookingUrl) summary.bookingUrl = bookingUrl;
  return summary;
}

/** A room type as a unit. */
export function toUnit(type: RottnestRoomType): UnitSummary {
  const group = STAY_TYPES.find((stayType) => stayType.kind === type.kind)?.label;
  return {
    unitId: type.code,
    unitName: type.name,
    unitKind: type.kind,
    ...(group ? { unitType: group } : {}),
    maxPeople: type.sleeps,
  };
}

export interface RottnestCatalogDeps {
  ctx: ProviderContext;
  links: ProviderLinks;
  /** When a precinct's dates open, for the place page. */
  release?: Pick<ReleasePolicy, 'describe'>;
}

export function createRottnestCatalog({
  ctx,
  links,
  release,
}: RottnestCatalogDeps): FullCatalogModule {
  return {
    async listLocations(signal) {
      throwIfAborted(signal);
      // Nothing is sent; still settle after the caller could abort.
      await Promise.resolve();
      throwIfAborted(signal);
      return ROTTNEST_PRECINCTS.map((precinct) => toLocationSummary(ctx.id, precinct, links));
    },

    async getLocation(externalId, signal): Promise<LocationDetail> {
      throwIfAborted(signal);
      const precinct = rottnestPrecinct(externalId);
      if (!precinct) {
        throw new ProviderError({
          providerId: ctx.id,
          message: `${ctx.manifest.name} has no precinct "${externalId}"`,
        });
      }
      const detail: LocationDetail = {
        ...toLocationSummary(ctx.id, precinct, links),
        units: precinct.roomTypes.map(toUnit),
        // Each unit is a room type, standing for several units: a type, never one place to stay
        unitsAreTypes: true,
        fetchedAt: ctx.clock().toISOString(),
      };
      const releaseInfo = await release?.describe(precinct.slug, signal);
      if (releaseInfo) detail.releaseInfo = releaseInfo;
      // Nothing is sent; still settle after the caller could abort.
      await Promise.resolve();
      throwIfAborted(signal);
      return detail;
    },
  };
}
