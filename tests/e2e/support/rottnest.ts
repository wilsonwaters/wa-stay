/**
 * Stay Rottnest's Open Days for the e2e journeys, worked out as `open-days.ts` does: 8:30 am
 * Perth on the first Wednesday of a month (a week later when that is New Year's Day), opening
 * the month of stays eight months on.
 */

import { addDays, todayIn } from '../../../src/shared/utils/calendar-date';

const PERTH = 'Australia/Perth';

/** The first Wednesday of `YYYY-MM`, a week later when it is New Year's Day. */
function firstWednesday(month: string): string {
  const weekday = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  const day = addDays(`${month}-01`, (3 - weekday + 7) % 7);
  return day.endsWith('-01-01') ? addDays(day, 7) : day;
}

/**
 * The next Open Day (8:30 am Perth on the first Wednesday of a month, `open-days.ts`) and the
 * month of stays it opens, eight months on.
 */
export function nextOpenDay(now = new Date()): { date: string; stayMonth: string } {
  const today = todayIn(PERTH, now);
  let [year, month] = today.split('-').map(Number);
  for (;;) {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const date = firstWednesday(ym);
    const opensAt = new Date(`${date}T00:30:00.000Z`); // 8:30 am Perth
    if (opensAt > now) {
      const index = year * 12 + (month - 1) + 8;
      const stayMonth = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
      return { date, stayMonth };
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
}

/**
 * Whether now is an Open Day morning in Perth (05:30 to noon on the first Wednesday of the
 * month, a week later when that is New Year's Day): Stay Rottnest's checks pause then
 * (`open-days.ts`), so the counts would not come.
 */
export function openDayMorning(now = new Date()): boolean {
  const today = todayIn(PERTH, now);
  const [year, month] = today.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  let day = 1 + ((3 - first + 7) % 7);
  if (month === 1 && day === 1) day += 7;
  if (Number(today.slice(8)) !== day) return false;
  const hm = new Intl.DateTimeFormat('en-GB', {
    timeZone: PERTH,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  return hm >= '05:30' && hm < '12:00';
}
