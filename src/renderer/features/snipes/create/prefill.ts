/**
 * The new-snipe prefill query (architecture-notes §12.10), as a place's "Snipe a site" links
 * here. The query is read by the shared `parseCreatePrefill` (the stay kept to the provider's
 * day by `clampStayParams`); this adds what a snipe needs: the provider must offer Site Sniper,
 * the dates must not have passed where the provider is, and every part of the link that cannot
 * be used is dropped with a notice. Pure.
 */
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { providerToday } from '../../../components/stay/providerToday';
import { parseCreatePrefill } from '../../../app/routes';
import { clampStayParams, EMPTY_STAY_PARAMS } from '../../../app/stayParams';

export interface SnipePrefill {
  providerId?: string;
  /** The provider's id for the location (not the composite key). */
  locationId?: string;
  arrival?: string;
  departure?: string;
  adults?: number;
  children?: number;
  /** Why parts of the link were not used. */
  notices: string[];
}

export function parseSnipePrefill(
  search: string,
  manifests: readonly ProviderManifest[],
  now: Date = new Date()
): SnipePrefill {
  const raw = new URLSearchParams(search);
  const parsed = parseCreatePrefill(search);
  const prefill: SnipePrefill = { notices: [] };
  const snipeProviders = manifests.filter((m) => m.capabilities.snipes);

  const manifest = parsed.provider ? manifests.find((m) => m.id === parsed.provider) : undefined;
  if (raw.has('provider')) {
    if (manifest?.capabilities.snipes) prefill.providerId = manifest.id;
    else if (manifest) {
      prefill.notices.push(
        `${manifest.shortName} doesn't offer Site Sniper, so choose a provider.`
      );
    } else prefill.notices.push("The link's provider isn't available, so choose a provider.");
  }

  if (raw.has('location')) {
    if (prefill.providerId && parsed.location?.trim()) prefill.locationId = parsed.location.trim();
    else prefill.notices.push("The link's place couldn't be used, so choose a location.");
  }

  if (raw.has('arrival') || raw.has('departure')) {
    const today = providerToday(prefill.providerId ? manifest : snipeProviders[0], now);
    const stay = clampStayParams(
      {
        ...EMPTY_STAY_PARAMS,
        arrival: parsed.arrival ?? null,
        departure: parsed.departure ?? null,
      },
      { minDate: today }
    );
    if (stay.arrival && stay.departure) {
      prefill.arrival = stay.arrival;
      prefill.departure = stay.departure;
    } else {
      prefill.notices.push(
        "The link's dates couldn't be used (they have passed or are out of order), so choose your dates."
      );
    }
  }

  if (parsed.adults !== undefined) prefill.adults = parsed.adults;
  if (parsed.children !== undefined) prefill.children = parsed.children;
  const lostGuests =
    (raw.has('adults') && parsed.adults === undefined) ||
    (raw.has('children') && parsed.children === undefined);
  if (lostGuests)
    prefill.notices.push("The link's guests couldn't be used, so check who's coming.");
  return prefill;
}
