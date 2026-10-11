/**
 * Links to ParkStay pages: a campground on ParkStay's search page, with a stay's dates when
 * there is one, and the bookings page where a person manages what they booked.
 *
 * The links open in the system browser, which sends no `Referer`. ParkStay's campground page
 * (`/search-availability/campground/?site_id=…`) refuses any request without its own
 * `Referer` and redirects to an error (`views.py:1322-1338`), so the links never go there.
 * They open the search page instead (`/search-availability/information/`, no `Referer` check,
 * `views.py:1209-1258`; checked live on 11 Oct 2026): it preselects the campground and the
 * dates (tomorrow when there are none), and its "See availability" opens the campground page
 * with ParkStay as the `Referer`. It ignores guest counts, so none are sent.
 */

import type { StayQuery } from '@shared/types/provider.types';
import type { ProviderLinks } from '../sdk/provider';
import { PARKSTAY_BASE_URL } from './constants';
import { toParkStayDate } from './client';

const SEARCH_PAGE = `${PARKSTAY_BASE_URL}/search-availability/information/`;

/** The search page with the campground preselected: `?campground_id=20`. */
function campgroundPage(externalId: string): string {
  return `${SEARCH_PAGE}?campground_id=${encodeURIComponent(externalId)}`;
}

/** With a stay, its dates too: `?campground_id=20&arrival=2026/11/10&departure=2026/11/12`. */
function stayPage(externalId: string, stay?: StayQuery): string {
  if (!stay) return campgroundPage(externalId);
  return (
    `${campgroundPage(externalId)}&arrival=${toParkStayDate(stay.arrival)}` +
    `&departure=${toParkStayDate(stay.departure)}`
  );
}

export const parkstayLinks: ProviderLinks = {
  location: campgroundPage,
  booking: stayPage,
  manageBooking: () => `${PARKSTAY_BASE_URL}/mybookings/`,
};
