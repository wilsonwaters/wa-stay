/**
 * Dated fixtures: a temp copy of `tests/e2e/fixtures/http/` whose RAC availability answers are
 * moved to a journey's own stay, so a journey that checks availability never goes stale as the
 * recorded dates pass.
 *
 * Every RAC route that answers an availability POST (`form.available_from`, RAC's `D MMM YYYY`)
 * is moved so its stay arrives `arrivalInDays` days after today in Perth: its answer's dates
 * (the night keys, the dates in `online_booking_url`, and the dates in RAC's messages, as
 * `YYYY-MM-DD` or `D MMM YYYY`) and the route's own `available_from` shift by the same number of
 * days. Every other file is copied as it is. The launch then passes the copy as
 * `env: { WA_STAY_E2E_FIXTURES_DIR: fixtures.dir }` (`support/wa-stay.ts`).
 *
 *   const fixtures = writeDatedFixtures(tempDir('dated'));
 *   const wa = await launchWaStay({ env: { WA_STAY_E2E_FIXTURES_DIR: fixtures.dir }, … });
 */

import fs from 'fs';
import path from 'path';
import { addDays, nightsBetween, todayIn } from '../../../src/shared/utils/calendar-date';
import { HTTP_FIXTURES_DIR, REPO_ROOT } from './paths';

/** The journeys' arrival: 7 days after today in Perth, so its nights are 7 and 8 days ahead. */
export const DATED_ARRIVAL_IN_DAYS = 7;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-11-06` → `6 Nov 2026`. */
function toRacDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** `6 Nov 2026` → `2026-11-06`, or undefined. */
function fromRacDate(text: string): string | undefined {
  const match = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(text.trim());
  const month = match ? MONTHS.indexOf(match[2]) + 1 : 0;
  if (!match || month === 0) return undefined;
  return `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

/** `text` with every date in it (`YYYY-MM-DD` or `D MMM YYYY`) moved by `days`. */
function shiftDates(text: string, days: number): string {
  return text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, (date) => addDays(date, days))
    .replace(/\b\d{1,2} [A-Z][a-z]{2} \d{4}\b/g, (date) => {
      const calendar = fromRacDate(date);
      return calendar ? toRacDate(addDays(calendar, days)) : date;
    });
}

export interface DatedFixtures {
  /** The copy, for `WA_STAY_E2E_FIXTURES_DIR`. */
  dir: string;
  /** The stay every RAC availability answer now arrives on (`YYYY-MM-DD`). */
  arrival: string;
}

interface Route {
  method: string;
  path: string;
  form?: Record<string, string>;
  file: string;
}

/**
 * Copies the e2e HTTP fixtures into `dir` (an empty temp folder) with RAC's availability
 * answers moved to arrive `arrivalInDays` days after `today` (Perth by default).
 */
export function writeDatedFixtures(
  dir: string,
  { arrivalInDays = DATED_ARRIVAL_IN_DAYS, today = todayIn('Australia/Perth') } = {}
): DatedFixtures {
  fs.cpSync(path.join(REPO_ROOT, HTTP_FIXTURES_DIR), dir, { recursive: true });
  const arrival = addDays(today, arrivalInDays);
  const racDir = path.join(dir, 'rac');
  const manifestFile = path.join(racDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as { routes: Route[] };
  const moved = new Set<string>();
  for (const route of manifest.routes) {
    const recorded = route.method === 'POST' && fromRacDate(route.form?.available_from ?? '');
    if (!recorded || !route.form) continue;
    const days = nightsBetween(recorded, arrival);
    route.form.available_from = toRacDate(arrival);
    if (moved.has(route.file)) continue;
    moved.add(route.file);
    const file = path.join(racDir, route.file);
    fs.writeFileSync(file, shiftDates(fs.readFileSync(file, 'utf8'), days));
  }
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, arrival };
}
