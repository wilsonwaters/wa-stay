/**
 * Wall-clock times in a provider's time zone, for a scheduled release ("10:00 am on Tue 3 Nov,
 * Perth time"), and how they read beside the computer's own clock. Pure; dates are `YYYY-MM-DD`
 * and times `HH:MM`, so no time zone shifts them until they become an instant here.
 */
import { timeInZone } from '../../../components/timeFormat';

/** The zone's offset from UTC, in ms, at `at`. */
function offsetMs(timeZone: string, at: number): number {
  const parts: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(at))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  const wall = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return wall - Math.floor(at / 1000) * 1000;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * The instant it is `time` (`HH:MM`) on `date` (`YYYY-MM-DD`) in `timeZone`, or undefined when
 * either is not a real date or time.
 */
export function zonedInstant(date: string, time: string, timeZone: string): Date | undefined {
  const d = DATE.exec(date);
  const t = TIME.exec(time);
  if (!d || !t) return undefined;
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const wall = Date.UTC(year, month - 1, day, Number(t[1]), Number(t[2]));
  const check = new Date(wall);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return undefined;
  // Twice, so a guess on the far side of a daylight-saving change settles.
  let instant = wall - offsetMs(timeZone, wall);
  instant = wall - offsetMs(timeZone, instant);
  return new Date(instant);
}

/** The zone's short name at `at`, e.g. `AWST`. */
export function zoneName(timeZone: string, at: Date = new Date()): string {
  return (
    new Intl.DateTimeFormat('en-AU', { timeZone, timeZoneName: 'short' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value ?? timeZone
  );
}

/** The computer's own time zone. */
export function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * "10:00 am AWST", or "10:00 am AWST · 12:00 pm your time" when this computer's clock reads
 * differently. With the day ("Tue 3 Nov, 10:00 am AWST") unless it is `now`'s day there.
 */
export function inZoneAndLocal(
  at: Date,
  timeZone: string,
  now: Date = new Date(),
  local: string = localZone()
): string {
  const there = timeInZone(at, timeZone, now);
  if (offsetMs(timeZone, at.getTime()) === offsetMs(local, at.getTime())) return there;
  const here = timeInZone(at, local, now).replace(/\s\S+$/, '');
  return `${there} · ${here} your time`;
}
