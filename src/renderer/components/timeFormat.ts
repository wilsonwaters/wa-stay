/**
 * How instants read in the UI (D1 voice): "12 min ago", "3:15 pm AWST", "Fri 3 Oct, 3:15 pm
 * AWST". Times are shown in the provider's time zone, because that is where the place is. Pure.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

type Parts = Partial<Record<Intl.DateTimeFormatPartTypes, string>>;

function partsOf(date: Date, timeZone: string | undefined, options: Intl.DateTimeFormatOptions) {
  const parts: Parts = {};
  for (const part of new Intl.DateTimeFormat('en-AU', { ...options, timeZone }).formatToParts(
    date
  )) {
    parts[part.type] = part.value;
  }
  return parts;
}

/** "Fri 3 Oct" in the zone (the host's when none is given). */
export function dayInZone(date: Date, timeZone?: string): string {
  const p = partsOf(date, timeZone, { weekday: 'short', day: 'numeric', month: 'short' });
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** The calendar day an instant falls on in a zone, `YYYY-MM-DD`. */
function dateKey(date: Date, timeZone?: string): string {
  const p = partsOf(date, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * "3:15 pm AWST" in the provider's zone; on another day than `now` there, "Fri 3 Oct, 3:15 pm
 * AWST".
 */
export function timeInZone(date: Date, timeZone: string, now: Date = new Date()): string {
  const p = partsOf(date, timeZone, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
  const time = `${p.hour}:${p.minute} ${(p.dayPeriod ?? '').toLowerCase()} ${p.timeZoneName}`
    .replace(/\s+/g, ' ')
    .trim();
  return dateKey(date, timeZone) === dateKey(now, timeZone)
    ? time
    : `${dayInZone(date, timeZone)}, ${time}`;
}

/** "just now", "12 min ago", "3 h ago", "yesterday", then the day ("Fri 3 Oct"). */
export function relativeTime(date: Date, now: Date = new Date()): string {
  const ago = now.getTime() - date.getTime();
  if (ago < MINUTE) return 'just now';
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)} min ago`;
  if (ago < 24 * HOUR) return `${Math.floor(ago / HOUR)} h ago`;
  if (ago < 48 * HOUR) return 'yesterday';
  return dayInZone(date);
}
