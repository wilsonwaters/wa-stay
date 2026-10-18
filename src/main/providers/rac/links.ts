/**
 * Links to RAC Parks & Resorts' own pages, opened in the system browser:
 *
 * - a park: its home page, `/<slug>/`;
 * - booking, with no category: its book-now page, `/<slug>/book-now/`. With a stay, the page's
 *   own search parameters (checked live for Busselton on 16 Oct 2026: the page shows the dates
 *   and searches them): `available_from` and `available_to` (`YYYY-MM-DD`), `adults`,
 *   `children`, `infants`, `pets` (the stay's, 0 to 2) and `membership_type`: `member` while
 *   the person has a member number saved (`membership.ts`), else `non-member`. The number
 *   itself is never in a link: the person types it at RAC's checkout;
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

/** RAC's book-now `membership_type` for a person with a member number saved, or without. */
export const membershipType = (member: boolean): 'member' | 'non-member' =>
  member ? 'member' : 'non-member';

/**
 * The park's booking page for the stay, with the unit's category when it names one (`cat:<id>`),
 * else its book-now page, prefilled with the stay (and `membership_type`) when there is one.
 */
function booking(
  member: boolean,
  externalId: string,
  stay?: StayQuery,
  unitId?: string
): string | null {
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
    membership_type: membershipType(member),
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

/** RAC's links, with a book-now page for a member (`member` true) or not. */
export interface RacLinks extends ProviderLinks {
  bookNow(externalId: string, stay: StayQuery, member: boolean): string | null;
}

/**
 * RAC's links. `isMember` is what `links.booking` (synchronous) knows of the member number: the
 * last answer the modules read (`RacMembership.last`); an availability check, which has just
 * asked, uses `bookNow` with its own answer instead.
 */
export function createRacLinks(isMember: () => boolean = () => false): RacLinks {
  return {
    location: (externalId) => parkPage(externalId),
    booking: (externalId, stay, unitId) => booking(isMember(), externalId, stay, unitId),
    bookNow: (externalId, stay, member) => booking(member, externalId, stay),
  };
}

/** RAC's links for a person with no member number saved. */
export const racLinks: RacLinks = createRacLinks();
