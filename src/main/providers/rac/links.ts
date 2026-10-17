/**
 * Links to RAC Parks & Resorts' own pages, opened in the system browser:
 *
 * - a park: its home page, `/<slug>/`;
 * - booking, with no category: its book-now page, `/<slug>/book-now/`. With a stay, the page's
 *   own search parameters (checked live for Busselton on 16 Oct 2026: the page shows the dates
 *   and searches them): `available_from` and `available_to` (`YYYY-MM-DD`), `adults`,
 *   `children`, `infants`, `pets` (the stay's, 0 to 2) and `membership_type=non-member`;
 * - booking a category (a unit `cat:<id>`) for a stay: the park's booking page,
 *   `/<slug>/booking/?available_from=…&available_to=…&force_category_id=<id>&adults=…&children=…
 *   &infants=…&animals=…`, the form of the `online_booking_url` RAC's availability answers
 *   carry. Checked live, anonymously, for Busselton's powered site on 17 Oct 2026: the page
 *   shows the dates, the nights, the guests and the category, then loads its availability; its
 *   cart stays empty (nothing is added until a person presses its book button).
 *
 * Every link is on RAC's own site (the manifest's `website`), over https. Never RAC's cart, or a
 * tariff's cart address from an availability answer: opening one adds the stay to a cart.
 * `racBookingPage` says whether an address RAC sent is a booking page of this kind, so the
 * availability module uses RAC's own only then. There is no link to manage a booking: that
 * needs the park's own NewBook sign-in. A park the seed does not have (Ningaloo) has no links.
 */

import type { StayQuery } from '@shared/types/provider.types';
import type { ProviderLinks } from '../sdk/provider';
import { RAC_SITE_URL } from './client';
import { petsOf } from './mapping';
import { racPark } from './parks';

const RAC_HOST = new URL(RAC_SITE_URL).host;

function parkPage(externalId: string, page = ''): string | null {
  const park = racPark(externalId);
  return park ? `${RAC_SITE_URL}/${park.slug}/${page}` : null;
}

/** The stay's pets, 0 to 2; 0 when it has none (or a value no stay can have). */
const petsParam = (stay: StayQuery): string => String(petsOf(stay) ?? 0);

/** The category id of a unit `cat:<id>`, or undefined. */
export function categoryIdOf(unitId: string | undefined): string | undefined {
  return unitId === undefined ? undefined : /^cat:(\d+)$/.exec(unitId)?.[1];
}

/**
 * The park's booking page for the stay, with the unit's category when it names one (`cat:<id>`),
 * else its book-now page, prefilled with the stay when there is one.
 */
function booking(externalId: string, stay?: StayQuery, unitId?: string): string | null {
  const category = stay ? categoryIdOf(unitId) : undefined;
  if (stay && category) {
    const page = parkPage(externalId, 'booking/');
    if (!page) return null;
    const search = new URLSearchParams({
      available_from: stay.arrival,
      available_to: stay.departure,
      force_category_id: category,
      adults: String(stay.adults),
      children: String(stay.children ?? 0),
      infants: String(stay.infants ?? 0),
      animals: petsParam(stay),
    });
    return `${page}?${search}`;
  }
  const page = parkPage(externalId, 'book-now/');
  if (!page || !stay) return page;
  const search = new URLSearchParams({
    available_from: stay.arrival,
    available_to: stay.departure,
    adults: String(stay.adults),
    children: String(stay.children ?? 0),
    infants: String(stay.infants ?? 0),
    pets: petsParam(stay),
    membership_type: 'non-member',
  });
  return `${page}?${search}`;
}

/**
 * `url` as a link, when it is a booking page of the park on RAC's site: https on RAC's host
 * (default port, no user name or password), under `/<slug>/booking/`, with no `cart` key and no
 * `rest_api_data_id` in its query. Undefined for anything else: a cart address is never a link.
 */
export function racBookingPage(url: string | undefined, slug: string): string | undefined {
  if (!url) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const onRac =
    parsed.protocol === 'https:' &&
    parsed.host === RAC_HOST &&
    !parsed.username &&
    !parsed.password &&
    parsed.pathname.startsWith(`/${slug}/booking/`);
  const query = parsed.searchParams;
  if (!onRac || query.has('cart') || query.has('rest_api_data_id')) return undefined;
  return parsed.href;
}

export const racLinks: ProviderLinks = {
  location: (externalId) => parkPage(externalId),
  booking,
};
