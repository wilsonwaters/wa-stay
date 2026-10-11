/**
 * The place page's facts, worked out from a location's detail and its provider's manifest:
 * the location key, the links out to the provider, the sites summary, the hand-off to the
 * create flows, the release time and what a failed check means. Pure.
 */

import type { LocationDetail, UnitSummary } from '../../../shared/types/catalog.types';
import type { ProviderManifest, StayQuery } from '../../../shared/types/provider.types';
import { makeLocationKey } from '../../../shared/utils/location-key';
import type { CreatePrefill } from '../../app/routes';
import type { StayParams } from '../../app/stayParams';

/** The location key for a route's params, or null when they cannot make one. */
export function placeKey(providerId: string, externalId: string): string | null {
  try {
    return makeLocationKey(providerId, externalId);
  } catch {
    return null;
  }
}

/** An http(s) URL's host ("exploreparks.dbca.wa.gov.au"), or null for anything else. */
export function linkHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.hostname : null;
  } catch {
    return null;
  }
}

export interface PlaceLinks {
  /** "Book on {shortName}": only for places booked online. */
  book?: string;
  /** "View on {shortName}": the provider's own page for this place. */
  view?: string;
  /** "More information": the place's information page, and its host to show. */
  info?: { url: string; host: string };
  /** "Visit {shortName}": the provider's website, when the place has neither link above. */
  visit?: string;
}

/**
 * Where the links out to the provider go. "Book" prefers the stay-specific link from a
 * successful check (`bookingUrl`, §12.17) over the place's date-less one. Only http(s) links
 * are kept.
 */
export function resolvePlaceLinks(
  detail: Pick<LocationDetail, 'bookingMode' | 'bookingUrl' | 'infoUrl'>,
  website: string | undefined,
  checkedBookingUrl?: string
): PlaceLinks {
  const links: PlaceLinks = {};
  const view = linkHost(detail.bookingUrl) ? detail.bookingUrl : undefined;
  if (detail.bookingMode === 'online') {
    const book = linkHost(checkedBookingUrl) ? checkedBookingUrl : view;
    if (book) links.book = book;
  }
  if (view) links.view = view;
  const host = linkHost(detail.infoUrl);
  if (detail.infoUrl && host) links.info = { url: detail.infoUrl, host };
  if (!links.view && !links.info && website && linkHost(website)) links.visit = website;
  return links;
}

export interface UnitTypeCount {
  /** The unit type, or null for units without one. */
  type: string | null;
  count: number;
}

/** Units grouped by type, most first (then by name); units without a type last. */
export function unitTypeBreakdown(units: readonly UnitSummary[]): UnitTypeCount[] {
  const counts = new Map<string | null, number>();
  for (const unit of units) {
    const type = unit.unitType?.trim() || null;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => {
      if ((a.type === null) !== (b.type === null)) return a.type === null ? 1 : -1;
      return b.count - a.count || (a.type ?? '').localeCompare(b.type ?? '');
    });
}

/**
 * The most guests a unit takes: "Up to 6 guests per site", or "Up to 2–6 guests per site"
 * when units differ. Undefined when no unit says.
 */
export function guestRangeLabel(
  units: readonly UnitSummary[],
  noun: { one: string }
): string | undefined {
  const most = units
    .map((unit) => unit.maxPeople)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0);
  if (most.length === 0) return undefined;
  const low = Math.min(...most);
  const high = Math.max(...most);
  const range = low === high ? `${high}` : `${low}–${high}`;
  return `Up to ${range} ${high === 1 ? 'guest' : 'guests'} per ${noun.one}`;
}

/**
 * The create-flow prefill for this place and stay (architecture-notes §12.10): the external
 * id (not the key), the dates, adults and children. Infants are not part of the contract.
 */
export function handoffPrefill(
  providerId: string,
  externalId: string,
  stay: Partial<StayParams>
): CreatePrefill {
  const prefill: CreatePrefill = { provider: providerId, location: externalId };
  if (stay.arrival) prefill.arrival = stay.arrival;
  if (stay.arrival && stay.departure) prefill.departure = stay.departure;
  if (stay.adults) prefill.adults = stay.adults;
  if (stay.children) prefill.children = stay.children;
  return prefill;
}

/** The stay to check: both dates, and the party (1 adult when none is chosen yet). */
export function stayQueryOf(stay: StayParams): StayQuery | null {
  if (!stay.arrival || !stay.departure) return null;
  return {
    arrival: stay.arrival,
    departure: stay.departure,
    adults: stay.adults ?? 1,
    children: stay.children ?? 0,
    infants: stay.infants ?? 0,
  };
}

/** True when two stays ask the same question. */
export function sameStay(a: StayQuery | null, b: StayQuery | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.arrival === b.arrival &&
    a.departure === b.departure &&
    a.adults === b.adults &&
    (a.children ?? 0) === (b.children ?? 0) &&
    (a.infants ?? 0) === (b.infants ?? 0)
  );
}

/**
 * When bookings open, in the provider's time zone: "Thu 1 Apr 2027, 12:00 am AWST". Null for
 * a timestamp that is not one.
 */
export function formatOpensAt(iso: string, timeZone: string): string | null {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-AU', {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    }).formatToParts(when);
  } catch {
    return null;
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const period = part('dayPeriod').toLowerCase();
  return `${part('weekday')} ${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part(
    'minute'
  )} ${period} ${part('timeZoneName')}`.trim();
}

export type CheckFailure = 'access-gate' | 'rate-limit' | 'other';

/**
 * What a failed check means. The access gate only counts for a provider that has one
 * (`capabilities.accessGate`, §12.2); `RATE_LIMITED` is the provider's HTTP 429.
 */
export function checkFailure(
  error: { code?: string } | null | undefined,
  manifest: Pick<ProviderManifest, 'capabilities'> | undefined
): CheckFailure {
  if (error?.code === 'ACCESS_GATE' && manifest?.capabilities.accessGate) return 'access-gate';
  if (error?.code === 'RATE_LIMITED') return 'rate-limit';
  return 'other';
}
