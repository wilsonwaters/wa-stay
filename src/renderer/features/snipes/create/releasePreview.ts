/**
 * The plain-language release preview on the Release step: when the stay's first night opens,
 * from the provider's own check (`catalog.checkLocation(key, stay).release`). Pure.
 */
import { format } from 'date-fns';
import type { LocationAvailability } from '../../../../shared/types/provider.types';
import { nightsBetween, todayIn } from '../../../../shared/utils/calendar-date';
import type { UnitNoun } from '../../../components/stay/UnitPicker';
import { timeInZone } from '../../../components/timeFormat';
import { parseIsoDate } from '../../../components/ui/calendar';

export const RELEASE_UNKNOWN = 'Release time unknown. Site Sniper will keep checking.';

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "Sat 11 Apr", with the year when it is not this year where the provider is. */
export function nightLabel(date: string, today: string): string {
  const day = parseIsoDate(date);
  return format(day, date.slice(0, 4) === today.slice(0, 4) ? 'EEE d MMM' : 'EEE d MMM yyyy');
}

/**
 * "Mon 13 Oct, 12:00 am AWST": an instant with its day, in the provider's zone; the year too
 * when it is not `now`'s year there.
 */
export function whenInZone(at: Date, timeZone: string, now: Date = new Date()): string {
  return `${nightLabel(todayIn(timeZone, at), todayIn(timeZone, now))}, ${timeInZone(at, timeZone, at)}`;
}

/** "today", "tomorrow", "in 11 days": calendar days from today to `at`, in the zone. */
export function daysAway(at: Date, timeZone: string, now: Date): string {
  const days = nightsBetween(todayIn(timeZone, now), todayIn(timeZone, at));
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

export interface ReleasePreviewInput {
  arrival: string;
  release: LocationAvailability['release'] | undefined;
  timeZone: string;
  now: Date;
  noun: UnitNoun;
}

/**
 * - "Sites for Sat 11 Apr open Mon 13 Oct, 12:00 am AWST (in 11 days)."
 * - "Sites for Sat 11 Apr are already open for booking." (the provider says they are released)
 * - "Release time unknown. Site Sniper will keep checking." (no `opensAt`, or no answer)
 */
export function releasePreview({ arrival, release, timeZone, now, noun }: ReleasePreviewInput) {
  const today = todayIn(timeZone, now);
  const units = `${capitalise(noun.many)} for ${nightLabel(arrival, today)}`;
  if (release?.open) return `${units} are already open for booking.`;
  const opensAt = release?.opensAt ? new Date(release.opensAt) : undefined;
  if (!opensAt || Number.isNaN(opensAt.getTime())) return RELEASE_UNKNOWN;
  if (opensAt.getTime() <= now.getTime()) return `${units} should be open for booking now.`;
  return `${units} open ${whenInZone(opensAt, timeZone, now)} (${daysAway(opensAt, timeZone, now)}).`;
}
