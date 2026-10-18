/**
 * Stay Rottnest's booking guides, a month of stays each: what the Rottnest Island Authority
 * publishes about a month's bookings before its Open Day, as facts read by hand from its
 * "Open Day booking guide" PDFs for October 2026 to June 2027 (checked against each other and
 * against the PDFs' own tables, 18 Oct 2026; nothing in WA Stay fetches them).
 *
 * - **`carryOver`**: whether the month's Open Day lets a stay carry 5/3 into the next month
 *   (`release.ts`); "There will be no bookings into …" is `suspended`.
 * - **`fixedBlocks`**: in peak periods each block group arrives and leaves only on its own
 *   dates ("you must arrive and depart on the fixed dates shown below"); `period` is the
 *   first arrival and the last departure, and `blocks` each `[arrival, departure]`. A group
 *   with `roomTypes` covers only those types (Thomson Bay South with Kingstown's heritage and
 *   superior view cottages).
 * - **`minimumStays`**: the Campground, Kingstown's dorms, the hostel's family rooms and
 *   Governor Circle take 3 nights at least in the peak; `from` and `to` are nights,
 *   inclusive. A guide that gives no end ("from Sunday 22 November") ends with its month, and
 *   "over Easter" or "over the school holidays" are the nights the guide's own blocks and
 *   school-holiday dates cover.
 * - **`closures`**: Bathurst, from the night of 27 Apr 2027 (its last April block still
 *   leaves that morning) through June 2027.
 * - **`eventSaturdays`**: a booking with that Saturday night must include the Friday or the
 *   Sunday night too (the Channel Swim, Port to Pub).
 *
 * Not here, because the guides from September 2026 no longer say them: a two-night minimum
 * for every Saturday, and no arrivals or departures on public holidays (the terms now say only
 * that restrictions "may apply"; `rules.ts` notes it).
 *
 * **Upkeep.** Each month RIA publishes the guide for the month its next Open Day opens
 * (linked from Stay Rottnest's Open Days page). Read it in a browser and add its month here:
 * the carry-over sentence, any fixed-dates table (every group, every block), minimum stays,
 * closures and event weekends. Then extend `tests/unit/providers/rottnest/booking-guides.test.ts`.
 */

import type { CalendarDate } from '@shared/utils/calendar-date';

/** An `[arrival, departure]`, or a period's first arrival and last departure. */
export type DateRange = readonly [CalendarDate, CalendarDate];

/** What a rule covers: whole precincts, or only `roomTypes` (codes) when given. */
export interface RuleScope {
  precincts?: readonly string[];
  roomTypes?: readonly string[];
}

export interface FixedBlocks extends RuleScope {
  /** The group as the guide names it: "Geordie Bay", "Longreach Bay and Fay's Bay". */
  group: string;
  period: DateRange;
  blocks: readonly DateRange[];
}

/** Nights `from` to `to`, inclusive. */
export interface NightRange extends RuleScope {
  from: CalendarDate;
  to: CalendarDate;
}

export interface MinimumStay extends NightRange {
  nights: number;
}

export interface BookingGuide {
  /** The month of stays it covers, `YYYY-MM`. */
  month: string;
  /** The Open Day that opened it. */
  openDay: CalendarDate;
  carryOver: 'allowed' | 'suspended';
  fixedBlocks: readonly FixedBlocks[];
  minimumStays: readonly MinimumStay[];
  closures: readonly NightRange[];
  eventSaturdays: readonly { date: CalendarDate; event: string }[];
}

/** The booking guides RIA has published, in month order. */
export const BOOKING_GUIDES: readonly BookingGuide[] = [
  {
    month: '2026-10',
    openDay: '2026-02-04',
    carryOver: 'allowed',
    fixedBlocks: [],
    minimumStays: [],
    closures: [],
    eventSaturdays: [],
  },
  {
    month: '2026-11',
    openDay: '2026-03-04',
    carryOver: 'suspended',
    fixedBlocks: [
      {
        group: 'Thomson Bay North',
        precincts: ['thomson-bay-north'],
        period: ['2026-11-22', '2026-11-29'],
        blocks: [
          ['2026-11-22', '2026-11-26'],
          ['2026-11-26', '2026-11-29'],
        ],
      },
      {
        group: 'Bathurst and Caroline Thomson Cabins',
        precincts: ['bathurst', 'caroline-thomson-cabins'],
        period: ['2026-11-23', '2026-11-29'],
        blocks: [
          ['2026-11-23', '2026-11-26'],
          ['2026-11-26', '2026-11-29'],
        ],
      },
      {
        group: "Longreach Bay and Fay's Bay",
        precincts: ['longreach-bay', 'fays-bay'],
        period: ['2026-11-24', '2026-11-30'],
        blocks: [
          ['2026-11-24', '2026-11-27'],
          ['2026-11-27', '2026-11-30'],
        ],
      },
      {
        group: 'Geordie Bay',
        precincts: ['geordie-bay'],
        period: ['2026-11-24', '2026-12-01'],
        blocks: [
          ['2026-11-24', '2026-11-27'],
          ['2026-11-27', '2026-12-01'],
        ],
      },
      {
        group: 'Thomson Bay South and Kingstown Heritage/Superior View',
        precincts: ['thomson-bay-south', 'kingstown'],
        roomTypes: ['SSD04', 'SPR04', 'SPR06', 'SOV04', 'SOV06', 'KHV06', 'KHSV06'],
        period: ['2026-11-25', '2026-11-28'],
        blocks: [['2026-11-25', '2026-11-28']],
      },
    ],
    minimumStays: [
      {
        nights: 3,
        from: '2026-11-22',
        to: '2026-11-30',
        precincts: ['campground', 'kingstown'],
        roomTypes: [
          'CG06',
          'KDM02',
          'KDM04',
          'KDM04B',
          'KDM08',
          'KDM12',
          'KDM12B',
          'KDM14',
          'KDM18',
          'KYF03',
          'KGC09',
          'KGC13',
          'KGC18',
        ],
      },
    ],
    closures: [],
    eventSaturdays: [],
  },
  {
    month: '2026-12',
    openDay: '2026-04-01',
    carryOver: 'suspended',
    fixedBlocks: [
      {
        group: 'Thomson Bay North',
        precincts: ['thomson-bay-north'],
        period: ['2026-11-29', '2026-12-27'],
        blocks: [
          ['2026-11-29', '2026-12-03'],
          ['2026-12-03', '2026-12-09'],
          ['2026-12-09', '2026-12-14'],
          ['2026-12-14', '2026-12-21'],
          ['2026-12-21', '2026-12-27'],
        ],
      },
      {
        group: 'Bathurst and Caroline Thomson Cabins',
        precincts: ['bathurst', 'caroline-thomson-cabins'],
        period: ['2026-11-29', '2026-12-30'],
        blocks: [
          ['2026-11-29', '2026-12-03'],
          ['2026-12-03', '2026-12-07'],
          ['2026-12-07', '2026-12-11'],
          ['2026-12-11', '2026-12-18'],
          ['2026-12-18', '2026-12-23'],
          ['2026-12-23', '2026-12-30'],
        ],
      },
      {
        group: "Longreach Bay and Fay's Bay",
        precincts: ['longreach-bay', 'fays-bay'],
        period: ['2026-11-30', '2026-12-29'],
        blocks: [
          ['2026-11-30', '2026-12-04'],
          ['2026-12-04', '2026-12-10'],
          ['2026-12-10', '2026-12-16'],
          ['2026-12-16', '2026-12-22'],
          ['2026-12-22', '2026-12-29'],
        ],
      },
      {
        group: 'Geordie Bay',
        precincts: ['geordie-bay'],
        period: ['2026-12-01', '2026-12-29'],
        blocks: [
          ['2026-12-01', '2026-12-08'],
          ['2026-12-08', '2026-12-15'],
          ['2026-12-15', '2026-12-22'],
          ['2026-12-22', '2026-12-29'],
        ],
      },
      {
        group: 'Thomson Bay South and Kingstown Heritage/Superior View',
        precincts: ['thomson-bay-south', 'kingstown'],
        roomTypes: ['SSD04', 'SPR04', 'SPR06', 'SOV04', 'SOV06', 'KHV06', 'KHSV06'],
        period: ['2026-11-28', '2026-12-31'],
        blocks: [
          ['2026-11-28', '2026-12-02'],
          ['2026-12-02', '2026-12-06'],
          ['2026-12-06', '2026-12-13'],
          ['2026-12-13', '2026-12-19'],
          ['2026-12-19', '2026-12-24'],
          ['2026-12-24', '2026-12-31'],
        ],
      },
    ],
    minimumStays: [
      {
        nights: 3,
        from: '2026-12-01',
        to: '2026-12-31',
        precincts: ['campground', 'kingstown'],
        roomTypes: [
          'CG06',
          'KDM02',
          'KDM04',
          'KDM04B',
          'KDM08',
          'KDM12',
          'KDM12B',
          'KDM14',
          'KDM18',
          'KYF03',
          'KGC09',
          'KGC13',
          'KGC18',
        ],
      },
    ],
    closures: [],
    eventSaturdays: [],
  },
  {
    month: '2027-01',
    openDay: '2026-05-06',
    carryOver: 'suspended',
    fixedBlocks: [
      {
        group: 'Thomson Bay North',
        precincts: ['thomson-bay-north'],
        period: ['2026-12-27', '2027-02-01'],
        blocks: [
          ['2026-12-27', '2027-01-03'],
          ['2027-01-03', '2027-01-09'],
          ['2027-01-09', '2027-01-15'],
          ['2027-01-15', '2027-01-20'],
          ['2027-01-20', '2027-01-27'],
          ['2027-01-27', '2027-02-01'],
        ],
      },
      {
        group: 'Bathurst and Caroline Thomson Cabins',
        precincts: ['bathurst', 'caroline-thomson-cabins'],
        period: ['2026-12-30', '2027-02-03'],
        blocks: [
          ['2026-12-30', '2027-01-06'],
          ['2027-01-06', '2027-01-11'],
          ['2027-01-11', '2027-01-16'],
          ['2027-01-16', '2027-01-22'],
          ['2027-01-22', '2027-01-29'],
          ['2027-01-29', '2027-02-03'],
        ],
      },
      {
        group: "Longreach Bay and Fay's Bay",
        precincts: ['longreach-bay', 'fays-bay'],
        period: ['2026-12-29', '2027-01-30'],
        blocks: [
          ['2026-12-29', '2027-01-05'],
          ['2027-01-05', '2027-01-12'],
          ['2027-01-12', '2027-01-18'],
          ['2027-01-18', '2027-01-24'],
          ['2027-01-24', '2027-01-30'],
        ],
      },
      {
        group: 'Geordie Bay',
        precincts: ['geordie-bay'],
        period: ['2026-12-29', '2027-02-02'],
        blocks: [
          ['2026-12-29', '2027-01-02'],
          ['2027-01-02', '2027-01-08'],
          ['2027-01-08', '2027-01-14'],
          ['2027-01-14', '2027-01-21'],
          ['2027-01-21', '2027-01-28'],
          ['2027-01-28', '2027-02-02'],
        ],
      },
      {
        group: 'Thomson Bay South and Kingstown Heritage/Superior View',
        precincts: ['thomson-bay-south', 'kingstown'],
        roomTypes: ['SSD04', 'SPR04', 'SPR06', 'SOV04', 'SOV06', 'KHV06', 'KHSV06'],
        period: ['2026-12-31', '2027-01-31'],
        blocks: [
          ['2026-12-31', '2027-01-07'],
          ['2027-01-07', '2027-01-13'],
          ['2027-01-13', '2027-01-19'],
          ['2027-01-19', '2027-01-25'],
          ['2027-01-25', '2027-01-31'],
        ],
      },
    ],
    minimumStays: [
      {
        nights: 3,
        from: '2027-01-01',
        to: '2027-01-31',
        precincts: ['campground', 'kingstown'],
        roomTypes: [
          'CG06',
          'KDM02',
          'KDM04',
          'KDM04B',
          'KDM08',
          'KDM12',
          'KDM12B',
          'KDM14',
          'KDM18',
          'KYF03',
          'KGC09',
          'KGC13',
          'KGC18',
        ],
      },
    ],
    closures: [],
    eventSaturdays: [],
  },
  {
    month: '2027-02',
    openDay: '2026-06-03',
    carryOver: 'allowed',
    fixedBlocks: [],
    minimumStays: [],
    closures: [],
    eventSaturdays: [{ date: '2027-02-20', event: 'Rottnest Channel Swim' }],
  },
  {
    month: '2027-03',
    openDay: '2026-07-01',
    carryOver: 'allowed',
    fixedBlocks: [
      {
        group: 'Bathurst and Caroline Thomson Cabins',
        precincts: ['bathurst', 'caroline-thomson-cabins'],
        period: ['2027-03-23', '2027-04-01'],
        blocks: [
          ['2027-03-23', '2027-03-27'],
          ['2027-03-27', '2027-04-01'],
        ],
      },
      {
        group: "Longreach Bay and Fay's Bay",
        precincts: ['longreach-bay', 'fays-bay'],
        period: ['2027-03-24', '2027-03-30'],
        blocks: [['2027-03-24', '2027-03-30']],
      },
      {
        group: 'Geordie Bay',
        precincts: ['geordie-bay'],
        period: ['2027-03-24', '2027-03-30'],
        blocks: [['2027-03-24', '2027-03-30']],
      },
      {
        group: 'Thomson Bay North',
        precincts: ['thomson-bay-north'],
        period: ['2027-03-25', '2027-03-31'],
        blocks: [['2027-03-25', '2027-03-31']],
      },
      {
        group: 'Thomson Bay South and Kingstown Heritage/Superior View',
        precincts: ['thomson-bay-south', 'kingstown'],
        roomTypes: ['SSD04', 'SPR04', 'SPR06', 'SOV04', 'SOV06', 'KHV06', 'KHSV06'],
        period: ['2027-03-25', '2027-03-31'],
        blocks: [['2027-03-25', '2027-03-31']],
      },
    ],
    minimumStays: [
      {
        nights: 3,
        from: '2027-03-23',
        to: '2027-03-31',
        precincts: ['campground', 'kingstown'],
        roomTypes: [
          'CG06',
          'KDM02',
          'KDM04',
          'KDM04B',
          'KDM08',
          'KDM12',
          'KDM12B',
          'KDM14',
          'KDM18',
          'KYF03',
          'KGC09',
          'KGC13',
          'KGC18',
        ],
      },
    ],
    closures: [],
    eventSaturdays: [{ date: '2027-03-20', event: 'Port to Pub Swim' }],
  },
  {
    month: '2027-04',
    openDay: '2026-08-05',
    carryOver: 'suspended',
    fixedBlocks: [
      {
        group: 'Bathurst and Caroline Thomson Cabins',
        precincts: ['bathurst', 'caroline-thomson-cabins'],
        period: ['2027-04-08', '2027-04-27'],
        blocks: [
          ['2027-04-08', '2027-04-12'],
          ['2027-04-12', '2027-04-18'],
          ['2027-04-18', '2027-04-23'],
          ['2027-04-23', '2027-04-27'],
        ],
      },
      {
        group: "Longreach Bay and Fay's Bay",
        precincts: ['longreach-bay', 'fays-bay'],
        period: ['2027-04-09', '2027-04-27'],
        blocks: [
          ['2027-04-09', '2027-04-15'],
          ['2027-04-15', '2027-04-20'],
          ['2027-04-20', '2027-04-27'],
        ],
      },
      {
        group: 'Geordie Bay',
        precincts: ['geordie-bay'],
        period: ['2027-04-09', '2027-04-28'],
        blocks: [
          ['2027-04-09', '2027-04-14'],
          ['2027-04-14', '2027-04-19'],
          ['2027-04-19', '2027-04-24'],
          ['2027-04-24', '2027-04-28'],
        ],
      },
      {
        group: 'Thomson Bay North',
        precincts: ['thomson-bay-north'],
        period: ['2027-04-10', '2027-04-25'],
        blocks: [
          ['2027-04-10', '2027-04-16'],
          ['2027-04-16', '2027-04-21'],
          ['2027-04-21', '2027-04-25'],
        ],
      },
      {
        group: 'Thomson Bay South and Kingstown Heritage/Superior View',
        precincts: ['thomson-bay-south', 'kingstown'],
        roomTypes: ['SSD04', 'SPR04', 'SPR06', 'SOV04', 'SOV06', 'KHV06', 'KHSV06'],
        period: ['2027-04-11', '2027-04-27'],
        blocks: [
          ['2027-04-11', '2027-04-17'],
          ['2027-04-17', '2027-04-22'],
          ['2027-04-22', '2027-04-27'],
        ],
      },
    ],
    minimumStays: [
      {
        nights: 3,
        from: '2027-04-10',
        to: '2027-04-25',
        precincts: ['campground', 'kingstown'],
        roomTypes: [
          'CG06',
          'KDM02',
          'KDM04',
          'KDM04B',
          'KDM08',
          'KDM12',
          'KDM12B',
          'KDM14',
          'KDM18',
          'KYF03',
          'KGC09',
          'KGC13',
          'KGC18',
        ],
      },
    ],
    closures: [{ from: '2027-04-27', to: '2027-04-30', precincts: ['bathurst'] }],
    eventSaturdays: [],
  },
  {
    month: '2027-05',
    openDay: '2026-09-02',
    carryOver: 'allowed',
    fixedBlocks: [],
    minimumStays: [],
    closures: [{ from: '2027-04-27', to: '2027-05-31', precincts: ['bathurst'] }],
    eventSaturdays: [],
  },
  {
    month: '2027-06',
    openDay: '2026-10-07',
    carryOver: 'suspended',
    fixedBlocks: [],
    minimumStays: [],
    closures: [{ from: '2027-06-01', to: '2027-06-30', precincts: ['bathurst'] }],
    eventSaturdays: [],
  },
];
