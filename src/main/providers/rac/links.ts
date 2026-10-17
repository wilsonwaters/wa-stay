/**
 * Links to RAC Parks & Resorts' own pages, opened in the system browser:
 *
 * - a park: its home page, `/<slug>/`;
 * - booking: its book-now page, `/<slug>/book-now/`. With a stay, the page's own search
 *   parameters (checked live for Busselton on 16 Oct 2026: the page shows the dates and
 *   searches them): `available_from` and `available_to` (`YYYY-MM-DD`), `adults`, `children`,
 *   `infants`, `pets=0` and `membership_type=non-member`.
 *
 * Every link is on RAC's own site (the manifest's `website`), over https. Never RAC's cart, or a
 * tariff's cart address from an availability answer: opening one adds the stay to a cart. There
 * is no link to manage a booking: that needs the park's own NewBook sign-in. A park the seed
 * does not have (Ningaloo) has no links.
 */

import type { StayQuery } from '@shared/types/provider.types';
import type { ProviderLinks } from '../sdk/provider';
import { RAC_SITE_URL } from './client';
import { racPark } from './parks';

function parkPage(externalId: string, page = ''): string | null {
  const park = racPark(externalId);
  return park ? `${RAC_SITE_URL}/${park.slug}/${page}` : null;
}

/**
 * The park's book-now page, prefilled with the stay when there is one. A unit (a category) is
 * accepted and left out: the page lists every category for the stay.
 */
function bookNow(externalId: string, stay?: StayQuery, _unitId?: string): string | null {
  const page = parkPage(externalId, 'book-now/');
  if (!page || !stay) return page;
  const search = new URLSearchParams({
    available_from: stay.arrival,
    available_to: stay.departure,
    adults: String(stay.adults),
    children: String(stay.children ?? 0),
    infants: String(stay.infants ?? 0),
    pets: '0',
    membership_type: 'non-member',
  });
  return `${page}?${search}`;
}

export const racLinks: ProviderLinks = {
  location: (externalId) => parkPage(externalId),
  booking: bookNow,
};
