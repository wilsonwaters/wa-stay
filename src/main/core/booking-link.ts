/**
 * Booking links (brief R6, R7; master plan "Also decided"): the provider's public booking page
 * for a stay an alert found. A desktop click on the alert opens it in the browser, the alert
 * email carries it as "Book on {shortName}", and the watch's page shows it.
 *
 * The core accepts a link only when it is https, carries no user name or password, and is on
 * the provider's own site: the host of `manifest.website`, that host without its leading
 * `www.`, or a subdomain of it (a website `https://www.example.com` allows
 * `https://book.example.com`). Whether a link adds to a cart cannot be told from the URL, so
 * refusing cart URLs is the provider's job (the SDK's rule on `UnitAvailability.bookingUrl`).
 *
 * Refused links are logged with `describeUrl` (the origin only), never their path or query.
 * Pure apart from that log line: the alert and the watch's page compute the same link from the
 * same stored units.
 */

import type { UnitAvailability, Watch, WatchBookingLink, WatchMatch } from '@shared/types';
import type { ProviderManifest } from '@shared/types/provider.types';
import { toStayQuery } from '@shared/types/stay.types';
import type { AccommodationProvider } from '../providers/sdk/provider';
import { describeUrl } from '../providers/sdk/url-patterns';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'booking-link' });

/** What a booking link is checked against: the provider's id (for logs) and website. */
export type BookingLinkManifest = Pick<ProviderManifest, 'id' | 'website'>;

/**
 * `quiet`: log nothing. For the watch reads (`get`, `list`, `watch:updated`), which derive the
 * link again on every refresh; only the alert path logs what it refused.
 */
export interface BookingLinkOptions {
  quiet?: boolean;
}

/** What `matchedStayLink` needs from a provider. */
export type BookingLinkProvider = { manifest: BookingLinkManifest } & Pick<
  AccommodationProvider,
  'links'
>;

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** The URL (normalised) when it is an absolute https URL with no user name or password. */
export function httpsLink(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const parsed = parse(url);
  if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    return undefined;
  }
  return parsed.href;
}

/**
 * True when `url` is https, has no credentials, and its host is the website's host, that host
 * without a leading `www.`, or a subdomain of it, on the same port.
 */
export function isProviderBookingLink(
  manifest: Pick<ProviderManifest, 'website'>,
  url: string
): boolean {
  const link = httpsLink(url);
  const site = parse(manifest.website);
  if (!link || !site || site.protocol !== 'https:') return false;
  const host = new URL(link).host;
  const siteHost = site.host;
  const base = siteHost.startsWith('www.') ? siteHost.slice('www.'.length) : siteHost;
  return host === siteHost || host === base || host.endsWith(`.${base}`);
}

/**
 * The first candidate that is a booking link of the provider (normalised), or undefined. Empty
 * candidates are passed over; refused ones are logged once per call, by origin only (unless
 * `quiet`).
 */
export function firstBookingLink(
  manifest: BookingLinkManifest,
  candidates: ReadonlyArray<string | null | undefined>,
  { quiet = false }: BookingLinkOptions = {}
): string | undefined {
  const refused: string[] = [];
  let found: string | undefined;
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (isProviderBookingLink(manifest, candidate)) {
      found = httpsLink(candidate);
      break;
    }
    refused.push(describeUrl(candidate));
  }
  if (refused.length > 0 && !quiet) {
    log.warn(`${manifest.id}: skipped booking links off its site: ${refused.join(', ')}`);
  }
  return found;
}

/**
 * The booking link for a stay a watch found, and the stay it is for. Candidates, in order:
 * for a full match, the matched unit's own `bookingUrl` (from `units`, the check's units);
 * then `links.booking` for the match's stay (a partial match's run, with its dates) and unit.
 * Undefined when neither is a booking link of the provider. `quiet` logs nothing (the reads).
 */
export function matchedStayLink(
  provider: BookingLinkProvider,
  watch: Pick<Watch, 'location' | 'stay' | 'stayParams'>,
  match: WatchMatch,
  units: readonly UnitAvailability[],
  options: BookingLinkOptions = {}
): WatchBookingLink | undefined {
  const { manifest } = provider;
  const unitUrl = match.partial
    ? undefined
    : units.find((unit) => unit.unitId === match.unitId)?.bookingUrl;
  const stay = toStayQuery(
    { ...watch.stay, arrival: match.arrival, departure: match.departure },
    watch.stayParams
  );
  let stayUrl: string | null = null;
  try {
    stayUrl = provider.links.booking(watch.location.externalId, stay, match.unitId);
  } catch (error) {
    if (!options.quiet) {
      log.warn(
        `${manifest.id}: links.booking failed: ${error instanceof Error ? error.name : 'error'}`
      );
    }
  }
  const url = firstBookingLink(manifest, [unitUrl, stayUrl], options);
  return url ? { url, arrival: match.arrival, departure: match.departure } : undefined;
}
