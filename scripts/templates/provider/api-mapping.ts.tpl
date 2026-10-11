/**
 * {{NAME}}'s API: the shapes of its answers, and how they map to the SDK's normalised types.
 * Plain functions, easy to test.
 *
 * TODO: replace the shapes and the words below with the real API's.
 */

import { z } from 'zod';
// @if search
import type { BoundingBox, LocationSummary, UnitSummary } from '@shared/types/catalog.types';
// @else
import type { LocationSummary, UnitSummary } from '@shared/types/catalog.types';
// @endif
import type {
  LocationKind,
  NightState,
  NightStatus,
  StayQuery,
  UnitAvailability,
} from '@shared/types/provider.types';
import { eachNight } from '@shared/utils/calendar-date';
import { makeLocationKey } from '@shared/utils/location-key';
import { ProviderParseError, type ProviderLinks } from '../sdk';

/** A place, as the API lists it. Validated: a provider's JSON is not a contract. */
export const RawLocation = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  town: z.string().optional(),
  region: z.string().optional(),
  photos: z.array(z.string()).optional(),
  facilities: z.array(z.string()).optional(),
});
// @if search
/** One page of a search by map area; `nextPage` is there when there is another. */
export const RawSearchPage = z.object({
  locations: z.array(RawLocation),
  nextPage: z.number().int().positive().optional(),
});
// @else
export const RawLocationList = z.object({ locations: z.array(RawLocation) });
// @endif
const RawUnit = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().optional(),
  sleeps: z.number().int().positive().optional(),
});
export const RawLocationDetail = RawLocation.extend({
  description: z.string().optional(),
  units: z.array(RawUnit),
});
const RawNight = z.object({ date: z.string(), status: z.string(), price: z.number().optional() });
const RawUnitNights = z.object({ id: z.string(), name: z.string(), nights: z.array(RawNight) });
export const RawAvailability = z.object({ units: z.array(RawUnitNights) });

export type RawLocation = z.infer<typeof RawLocation>;
type RawNight = z.infer<typeof RawNight>;

/** The API's words for a kind of place. A word that is not here is `other`. */
const KINDS: Record<string, LocationKind> = { campground: 'campground', cabin: 'cabin' };

/** The API's words for a night. A word that is not here is `unknown`, never `available`. */
const NIGHT_STATES: Record<string, NightState> = {
  open: 'available',
  booked: 'booked',
  closed: 'closed',
  'not-yet-open': 'not-released',
};

/** `body` as `schema` describes it, or a ProviderParseError naming the request. */
export function parseRaw<T>(
  providerId: string,
  path: string,
  schema: z.ZodType<T>,
  body: unknown
): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const where = parsed.error.issues[0]?.path.join('.') || 'the body';
    throw new ProviderParseError({
      providerId,
      message: `${providerId}: unexpected answer from ${path} (${where})`,
    });
  }
  return parsed.data;
}

export function toLocationSummary(
  providerId: string,
  raw: RawLocation,
  links: ProviderLinks
): LocationSummary {
  return {
    key: makeLocationKey(providerId, raw.id),
    providerId,
    externalId: raw.id,
    name: raw.name,
    kind: KINDS[raw.type] ?? 'other',
    bookingMode: 'online',
    lat: raw.latitude,
    lng: raw.longitude,
    ...(raw.town ? { area: { name: raw.town, ...(raw.region ? { region: raw.region } : {}) } } : {}),
    // Only https images: the app loads nothing else.
    imageUrls: (raw.photos ?? []).filter((url) => url.startsWith('https://')),
    amenities: raw.facilities ?? [],
    infoUrl: links.location(raw.id) ?? undefined,
    bookingUrl: links.booking(raw.id) ?? undefined,
  };
}

export function toUnitSummary(raw: z.infer<typeof RawUnit>): UnitSummary {
  return {
    unitId: raw.id,
    unitName: raw.name,
    ...(raw.type ? { unitType: raw.type } : {}),
    ...(raw.sleeps ? { maxPeople: raw.sleeps } : {}),
  };
}

/** One NightStatus per night of the stay, `YYYY-MM-DD`. A night the API left out is `unknown`. */
export function toNights(stay: StayQuery, raw: RawNight[]): NightStatus[] {
  const byDate = new Map(raw.map((night) => [night.date, night]));
  return eachNight(stay.arrival, stay.departure).map((date): NightStatus => {
    const night = byDate.get(date);
    const state = (night && NIGHT_STATES[night.status]) ?? 'unknown';
    return state === 'available' && night?.price !== undefined
      ? { date, state, price: night.price }
      : { date, state };
  });
}

/** A unit's nights for the stay. `fullyAvailable` only when every night is `available`. */
export function toUnitAvailability(
  stay: StayQuery,
  raw: z.infer<typeof RawUnitNights>
): UnitAvailability {
  const nights = toNights(stay, raw.nights);
  const fullyAvailable = nights.every((night) => night.state === 'available');
  const prices = nights.map((night) => night.price);
  const total =
    fullyAvailable && prices.every((price) => price !== undefined)
      ? prices.reduce((sum: number, price) => sum + (price ?? 0), 0)
      : undefined;
  return {
    unitId: raw.id,
    unitName: raw.name,
    nights,
    fullyAvailable,
    ...(total !== undefined ? { total } : {}),
  };
}
// @if search

/** Whether a place is inside a map area, `[west, south, east, north]` in degrees. */
export function isInside([west, south, east, north]: BoundingBox, raw: RawLocation): boolean {
  return (
    raw.longitude >= west &&
    raw.longitude <= east &&
    raw.latitude >= south &&
    raw.latitude <= north
  );
}
// @endif
