/**
 * How a stay reads in the UI (D1 voice): "Fri 12 – Sun 14 Dec", "Fri 30 Oct – Mon 2 Nov",
 * "Wed 30 Dec 2026 – Fri 1 Jan 2027"; "2 nights"; "2 adults, 1 child". Calendar dates stay
 * `YYYY-MM-DD` strings until they are formatted, so no time zone can shift them. Pure.
 */
import { nightsBetween } from '../../../shared/utils/calendar-date';
import { guestsSummary } from '../ui';
import { nightsLabel, parseIsoDate, shortRange } from '../ui/calendar';

/**
 * "Fri 12 – Sun 14 Dec": a stay with its weekdays, as a watch or snipe shows it (the place page
 * and NightGrid use the shorter `stayRangeLabel`, "12–14 Dec"). The year shows when the stay is
 * not all in `today`'s year.
 */
export function stayDatesLabel(arrival: string, departure: string, today?: string): string {
  const a = parseIsoDate(arrival);
  const d = parseIsoDate(departure);
  if (Number.isNaN(a.getTime()) || Number.isNaN(d.getTime())) return `${arrival} – ${departure}`;
  const thisYear = today ? today.slice(0, 4) : String(new Date().getFullYear());
  const showYear =
    arrival.slice(0, 4) !== departure.slice(0, 4) || arrival.slice(0, 4) !== thisYear;
  return shortRange(arrival, departure, showYear);
}

/** "2 nights". */
export function stayNightsLabel(arrival: string, departure: string): string {
  return nightsLabel(Math.max(0, nightsBetween(arrival, departure)));
}

/** "2 adults, 1 child"; concessions count as people too. "No guests" when nobody is set. */
export function partyLabel(party: {
  adults: number;
  children?: number;
  infants?: number;
  concessions?: number;
}): string {
  const base = guestsSummary({
    adults: party.adults,
    children: party.children ?? 0,
    infants: party.infants ?? 0,
  });
  const concessions = party.concessions ?? 0;
  const extra =
    concessions > 0 ? `${concessions} ${concessions === 1 ? 'concession' : 'concessions'}` : '';
  return [base, extra].filter(Boolean).join(', ') || 'No guests';
}
