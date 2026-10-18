/**
 * Stay Rottnest's own pages, for the person to open in their browser. Every link is a public
 * page that needs no sign-in and never starts a booking: the search (`/rates-room1`, or the bare
 * `/search-rates`), the accommodation maps and the sign-in page. Never the booking step
 * (`/details/…`), which a room's "Book" button posts to.
 */

import type { StayQuery } from '@shared/types/provider.types';
import type { ProviderLinks } from '../sdk/provider';
import { rottnestPrecinct } from './precincts';

/** Stay Rottnest's site, the manifest's `website`. */
export const ROTTNEST_SITE_URL = 'https://www.stayrottnest.com';

/** Stay Rottnest's booking engine (P3 Hotel Software), where every search is. */
export const ROTTNEST_BOOKINGS_URL = 'https://bookings.stayrottnest.com';

/** The island in Stay Rottnest's booking engine (`hotel`): one for every room type. */
export const ROTTNEST_HOTEL_ID = '62607';

/** The results page of a search: one stay, every room type on the island. */
export const ROTTNEST_RESULTS_PATH = '/rates-room1';

/**
 * The query of a search for `stay`, as Stay Rottnest's own search form writes it: one room, its
 * adults, and its children (Stay Rottnest's children are 0–17, so infants count as children).
 */
export function searchQuery(stay: StayQuery): Record<string, string> {
  const children = (stay.children ?? 0) + (stay.infants ?? 0);
  return {
    hotel: ROTTNEST_HOTEL_ID,
    arrival: stay.arrival,
    departure: stay.departure,
    rooms: '1',
    'adults[1]': String(stay.adults),
    'children[1]': String(children),
  };
}

/** Stay Rottnest's search for `stay`, showing the precinct with `group` (all, without it). */
export function searchUrl(stay: StayQuery, group?: number): string {
  const url = new URL(ROTTNEST_RESULTS_PATH, ROTTNEST_BOOKINGS_URL);
  for (const [name, value] of Object.entries(searchQuery(stay))) url.searchParams.set(name, value);
  if (group !== undefined) url.searchParams.append('roomCategories[]', String(group));
  return url.href;
}

export const rottnestLinks: ProviderLinks = {
  // No precinct has a page of its own: the accommodation maps show them all
  location: () => `${ROTTNEST_SITE_URL}/accommodation-maps`,
  booking(externalId, stay) {
    if (!stay) return `${ROTTNEST_BOOKINGS_URL}/search-rates`;
    return searchUrl(stay, rottnestPrecinct(externalId)?.group);
  },
  // "My Booking": the person's own Stay Rottnest sign-in, in their browser
  manageBooking: () => `${ROTTNEST_BOOKINGS_URL}/login`,
};
