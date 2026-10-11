/**
 * How a booking's facts read: dates, cost, units and the provider's own stay fields. Built on
 * U1's `stayFormat`; calendar dates stay `YYYY-MM-DD` strings until formatted, and nights are
 * counted between calendar dates, never from milliseconds. Pure.
 */
import { format } from 'date-fns';
import type { Booking } from '../../../../shared/types/booking.types';
import type { UnitSummary } from '../../../../shared/types/catalog.types';
import type { ProviderManifest, StayParams } from '../../../../shared/types/provider.types';
import { unitNoun } from '../../../components/locationFormat';
import { stayDatesLabel, stayNightsLabel } from '../../../components/stay/stayFormat';
import { parseIsoDate } from '../../../components/ui/calendar';

/**
 * "Fri 12 – Sun 14 Dec", with the year when the trip is not all in `today`'s year. A stored
 * date that is not a calendar date (a v1 row copied unchanged) shows as it is.
 */
export function tripDatesLabel(stay: Booking['stay'], today: string): string {
  try {
    return stayDatesLabel(stay.arrival, stay.departure, today);
  } catch {
    return `${stay.arrival} – ${stay.departure}`;
  }
}

/** "2 nights", or undefined when a date is not a calendar date. */
export function tripNightsLabel(stay: Booking['stay']): string | undefined {
  try {
    return stayNightsLabel(stay.arrival, stay.departure);
  } catch {
    return undefined;
  }
}

/** "Fri 12 Dec 2026": one day in full, as the detail page lists check-in and check-out. */
export function fullDayLabel(date: string): string {
  try {
    return format(parseIsoDate(date), 'EEE d MMM yyyy');
  } catch {
    return date;
  }
}

/** "$105.00" in Australian dollars; another currency keeps its code ("USD 105.00"). */
export function formatCost(amount: number, currency: string | undefined): string {
  try {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: currency || 'AUD',
    }).format(amount);
  } catch {
    // An unknown currency code: the amount, and the code as stored.
    return `${currency ?? ''} ${amount.toFixed(2)}`.trim();
  }
}

/**
 * ParkStay's class unit id (`class:117`), which bookings recorded from a paid hold kept before
 * they stored the unit's name. It means nothing to a person.
 */
const CLASS_UNIT_ID = /^class:\d+$/;

/**
 * The booked units as a person reads them. A booking keeps what its confirmation calls the
 * unit: "Site 12" for a bare number, the text as stored otherwise ("CAMPSITE 07", "Site: 12").
 * An older paid hold's class id is named from the place's units when the detail page has
 * them, and left out when it cannot be. Undefined when nothing is left to show.
 */
export function unitLabel(
  booking: Pick<Booking, 'unitIds'>,
  manifest: ProviderManifest | undefined,
  units?: readonly UnitSummary[]
): string | undefined {
  const noun = unitNoun(manifest?.locationKinds[0]).one;
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);
  const names = booking.unitIds.flatMap((id) => {
    if (CLASS_UNIT_ID.test(id)) {
      const known = units?.find((unit) => unit.unitId === id)?.unitName;
      return known ? [known] : [];
    }
    return [/^\d+$/.test(id) ? `${Noun} ${id}` : id];
  });
  return names.length ? names.join(', ') : undefined;
}

export interface StayParamRow {
  label: string;
  value: string;
}

/** "siteType" → "Site type". */
function humanise(key: string): string {
  const words = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The provider's own stay fields worth showing: declared ones by their label (and option
 * label), then any other text or number a v1 booking kept (its site type). Keys ending in
 * `id` are the provider's own references and are left out.
 */
export function stayParamRows(
  params: StayParams,
  manifest: ProviderManifest | undefined
): StayParamRow[] {
  const declared = manifest?.stayFields ?? [];
  const rows: StayParamRow[] = [];
  for (const field of declared) {
    const value = params[field.key];
    if (value === undefined || value === '') continue;
    const option = field.options?.find((o) => o.value === String(value))?.label;
    const text = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : (option ?? String(value));
    rows.push({ label: field.label, value: text });
  }
  for (const [key, value] of Object.entries(params)) {
    if (declared.some((field) => field.key === key) || /id$/i.test(key)) continue;
    if (typeof value === 'boolean' || value === '') continue;
    rows.push({ label: humanise(key), value: String(value) });
  }
  return rows;
}
