/**
 * Western Australia's public holidays, 2026 to 2028, for what Stay Rottnest's terms say about
 * arrivals and departures on them (`rules.ts`). 2026 and 2027 are WA.gov.au's published list
 * (the King's Birthday by proclamation: 28 Sep 2026, 27 Sep 2027); 2028 is `expected`, from
 * the Public and Bank Holidays Act 1972's own rules, until the State publishes it.
 *
 * **Upkeep.** When WA.gov.au publishes the next year's public holidays (and the King's
 * Birthday proclamation), add them and drop `expected` from the ones confirmed.
 */

import type { CalendarDate } from '@shared/utils/calendar-date';

export interface PublicHoliday {
  date: CalendarDate;
  name: string;
  /** From the Act's rules, not yet published by the State. */
  expected?: boolean;
}

export const WA_PUBLIC_HOLIDAYS: readonly PublicHoliday[] = [
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-01-26', name: 'Australia Day' },
  { date: '2026-03-02', name: 'Labour Day' },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-04-05', name: 'Easter Sunday' },
  { date: '2026-04-06', name: 'Easter Monday' },
  { date: '2026-04-25', name: 'Anzac Day' },
  { date: '2026-04-27', name: 'Anzac Day (additional day)' },
  { date: '2026-06-01', name: 'Western Australia Day' },
  { date: '2026-09-28', name: "King's Birthday" },
  { date: '2026-12-25', name: 'Christmas Day' },
  { date: '2026-12-26', name: 'Boxing Day' },
  { date: '2026-12-28', name: 'Boxing Day (additional day)' },
  { date: '2027-01-01', name: "New Year's Day" },
  { date: '2027-01-26', name: 'Australia Day' },
  { date: '2027-03-01', name: 'Labour Day' },
  { date: '2027-03-26', name: 'Good Friday' },
  { date: '2027-03-28', name: 'Easter Sunday' },
  { date: '2027-03-29', name: 'Easter Monday' },
  { date: '2027-04-25', name: 'Anzac Day' },
  { date: '2027-04-26', name: 'Anzac Day (additional day)' },
  { date: '2027-06-07', name: 'Western Australia Day' },
  { date: '2027-09-27', name: "King's Birthday" },
  { date: '2027-12-25', name: 'Christmas Day' },
  { date: '2027-12-26', name: 'Boxing Day' },
  { date: '2027-12-27', name: 'Christmas Day (additional day)' },
  { date: '2027-12-28', name: 'Boxing Day (additional day)' },
  { date: '2028-01-01', name: "New Year's Day", expected: true },
  { date: '2028-01-03', name: "New Year's Day (additional day)", expected: true },
  { date: '2028-01-26', name: 'Australia Day', expected: true },
  { date: '2028-03-06', name: 'Labour Day', expected: true },
  { date: '2028-04-14', name: 'Good Friday', expected: true },
  { date: '2028-04-16', name: 'Easter Sunday', expected: true },
  { date: '2028-04-17', name: 'Easter Monday', expected: true },
  { date: '2028-04-25', name: 'Anzac Day', expected: true },
  { date: '2028-06-05', name: 'Western Australia Day', expected: true },
  { date: '2028-09-25', name: "King's Birthday", expected: true },
  { date: '2028-12-25', name: 'Christmas Day', expected: true },
  { date: '2028-12-26', name: 'Boxing Day', expected: true },
];
