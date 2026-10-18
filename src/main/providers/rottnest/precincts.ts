/**
 * Rottnest Island's accommodation as Stay Rottnest sells it: nine precincts, each with its room
 * types. Facts only, written by hand, with no request: the catalogue never asks Stay Rottnest
 * anything (`ai-state/research/rottnest-terms.md` §9.7).
 *
 * **Sources**, read 18 Oct 2026:
 * - the stakeholder's own capture of one Stay Rottnest search (a HAR exported from their browser;
 *   `ai-state/research/rottnest-booking-flow.md` §11): every room type's code
 *   (`room-calendar-root`), precinct group (`data-group`), location type
 *   (`data-location-type`), sleeps (`data-sleeps`), bedrooms (`data-bedrooms`) and RIA's name
 *   for it (as RIA writes it, with two slips mended: BPV04's "4 Bed" and LPV08's double space);
 * - RIA's accommodation maps (the precincts and their unit-number blocks), and OpenStreetMap's
 *   place names (© OpenStreetMap contributors, ODbL) for each precinct's position: the Visitor
 *   Centre for Thomson Bay, Bathurst Lighthouse, Kingstown Barracks, the Caroline Thomson
 *   Cabins, and Geordie, Fay's and Longreach Bays. A precinct's pin is approximate (within a
 *   few hundred metres): Stay Rottnest assigns the unit about three weeks before arrival.
 *
 * No photos, descriptions or maps of RIA's: a precinct's summary is one sentence in WA Stay's
 * own words.
 *
 * **Upkeep.** When Stay Rottnest adds, renames or retires a room type, the results page shows
 * it (a code the seed lacks is logged and left out of a check, never guessed at): add it here
 * with its group, type, sleeps and bedrooms, and extend `tests/unit/providers/rottnest/precincts.test.ts`.
 */

import type { LocationKind, UnitKind } from '@shared/types/provider.types';

/** What Stay Rottnest's results page calls a room type's kind (`data-location-type`). */
export type RottnestLocationType = 'self-contained' | 'hostel-dorms' | 'campground';

export interface RottnestRoomType {
  /** Stay Rottnest's room code (`room-calendar-root`), e.g. `GPV04`: the unit id. */
  code: string;
  /** RIA's name for it, as the results page shows it. */
  name: string;
  locationType: RottnestLocationType;
  /** WA Stay's kind of it. */
  kind: UnitKind;
  /** The most people it sleeps (`data-sleeps`). */
  sleeps: number;
  /** Its bedrooms (`data-bedrooms`; 0 for a campsite, a cabin's one room or a bed). */
  bedrooms: number;
}

export interface RottnestPrecinct {
  /** The location's external id, e.g. `geordie-bay`. Stored in watches, so it never changes. */
  slug: string;
  name: string;
  /** Stay Rottnest's precinct group (`data-group`, and `roomCategories[]` in its search). */
  group: number;
  kind: LocationKind;
  lat: number;
  lng: number;
  /** One sentence, WA Stay's own. */
  summary: string;
  roomTypes: readonly RottnestRoomType[];
}

const selfContained = (code: string, name: string, sleeps: number, bedrooms: number) =>
  ({ code, name, locationType: 'self-contained', kind: 'cabin', sleeps, bedrooms }) as const;

const dorm = (code: string, name: string, sleeps: number, bedrooms: number) =>
  ({ code, name, locationType: 'hostel-dorms', kind: 'dorm', sleeps, bedrooms }) as const;

/** Every precinct, in the order Explore lists them: Thomson Bay first, then around the island. */
export const ROTTNEST_PRECINCTS: readonly RottnestPrecinct[] = [
  {
    slug: 'thomson-bay-north',
    name: 'Thomson Bay North',
    group: 41,
    kind: 'cabin',
    lat: -31.994,
    lng: 115.5422,
    summary: 'Units, heritage cottages and bungalows in the settlement, north of the main jetty.',
    roomTypes: [
      selfContained('NBU04', 'North Thomson Heritage Bungalow - 4 Beds', 6, 2),
      selfContained('NBU06', 'North Thomson Heritage Bungalow - 6 Beds', 9, 3),
      selfContained('NBV04', 'North Thomson Heritage View Bungalow - 4 Beds', 6, 2),
      selfContained('NCH04', 'North Thomson Chalet - 4 Beds', 6, 2),
      selfContained('NSD06', 'North Thomson Standard - 6 Beds', 9, 3),
      selfContained('NPR04', 'North Thomson Premium - 4 Beds', 6, 2),
      selfContained('NPR06', 'North Thomson Premium - 6 Beds', 9, 3),
      selfContained('NPV04', 'North Thomson Premium View - 4 Beds', 6, 2),
      selfContained('NPV06', 'North Thomson Premium View - 6 Beds', 9, 3),
      selfContained('NOV04', 'North Thomson Ocean View - 4 Beds', 6, 2),
      selfContained('NOV06', 'North Thomson Ocean View - 6 Beds', 9, 3),
      selfContained('NOV08', 'North Thomson Ocean View - 8 Beds', 12, 4),
      selfContained('NHV04', 'North Thomson Heritage View - 4 Beds', 6, 2),
      selfContained('NHV06', 'North Thomson Heritage View - 6 Beds', 9, 3),
      selfContained('NHV08', 'North Thomson Heritage View - 8 Beds', 12, 4),
      selfContained('NHC04', 'North Thomson Heritage Cottage - 4 Beds', 4, 2),
      selfContained('NHC06', 'North Thomson Heritage Cottage - 6 Beds', 9, 3),
      selfContained('NHC08', 'North Thomson Heritage Cottage - 8 Beds', 12, 4),
      selfContained('NHP08', 'North Thomson Heritage Premium - 8 Beds', 12, 4),
      selfContained('NHSV08', 'North Thomson Heritage Superior View - 8 Beds', 12, 4),
    ],
  },
  {
    slug: 'thomson-bay-south',
    name: 'Thomson Bay South',
    group: 42,
    kind: 'cabin',
    lat: -31.999,
    lng: 115.5452,
    summary: 'Units in the settlement, south of the main jetty towards Kingstown.',
    roomTypes: [
      selfContained('SSD04', 'South Thomson Standard - 4 Beds', 6, 2),
      selfContained('SPR04', 'South Thomson Premium - 4 Beds', 6, 2),
      selfContained('SPR06', 'South Thomson Premium - 6 Beds', 9, 3),
      selfContained('SOV04', 'South Thomson Ocean View - 4 Beds', 6, 2),
      selfContained('SOV06', 'South Thomson Ocean View - 6 Beds', 9, 3),
    ],
  },
  {
    slug: 'kingstown',
    name: 'Kingstown',
    group: 37,
    kind: 'other',
    lat: -32.004,
    lng: 115.552,
    summary: 'The old barracks: the hostel, dormitories, Governor Circle and heritage cottages.',
    roomTypes: [
      dorm('KYB01', 'Kingstown Hostel Bed', 1, 0),
      {
        code: 'KYF03',
        name: 'Kingstown Hostel Family Room',
        locationType: 'hostel-dorms',
        kind: 'room',
        sleeps: 4,
        bedrooms: 1,
      },
      dorm('KDM02', 'Kingstown Dormitory - 2 Beds', 2, 1),
      dorm('KDM04', 'Kingstown Dormitory - 4 Beds', 4, 1),
      dorm('KDM04B', 'Kingstown Dormitory - 4 Beds + Bathroom', 4, 1),
      dorm('KDM08', 'Kingstown Dormitory - 8 Beds', 8, 1),
      dorm('KDM12', 'Kingstown Dormitory - 12 Beds', 12, 1),
      dorm('KDM12B', 'Kingstown Dormitory - 12 Beds + Bathroom', 12, 5),
      dorm('KDM14', 'Kingstown Dormitory - 14 Beds', 14, 1),
      dorm('KDM18', 'Kingstown Dormitory - 18 Beds', 18, 1),
      selfContained('KGC09', 'Kingstown Governor Circle - 9 Beds', 9, 2),
      selfContained('KGC13', 'Kingstown Governor Circle - 13 Beds', 13, 3),
      selfContained('KGC18', 'Kingstown Governor Circle - 18 Beds', 18, 6),
      selfContained('KHV06', 'Kingstown Heritage View - 6 Beds', 9, 3),
      selfContained('KHSV06', 'Kingstown Heritage Superior View - 6 Beds', 9, 3),
      selfContained('KHOV06', 'Kingstown Heritage Ocean View - 6 Beds', 8, 3),
    ],
  },
  {
    slug: 'campground',
    name: 'Campground',
    group: 44,
    kind: 'campground',
    lat: -31.9925,
    lng: 115.5385,
    summary: 'Tent sites behind the settlement, with a shared camp kitchen and bathrooms.',
    roomTypes: [
      {
        code: 'CG06',
        name: 'Campground',
        locationType: 'campground',
        kind: 'campsite',
        sleeps: 6,
        bedrooms: 0,
      },
    ],
  },
  {
    slug: 'caroline-thomson-cabins',
    name: 'Caroline Thomson Cabins',
    group: 36,
    kind: 'cabin',
    lat: -31.9914,
    lng: 115.5398,
    summary: 'Cabins near the campground, each sleeping six.',
    roomTypes: [selfContained('CTC06', 'Caroline Thomson Cabins', 6, 0)],
  },
  {
    slug: 'bathurst',
    name: 'Bathurst',
    group: 43,
    kind: 'cabin',
    lat: -31.9897,
    lng: 115.541,
    summary: 'Units near Bathurst Lighthouse and Pinky Beach.',
    roomTypes: [
      selfContained('BSD04', 'Bathurst Standard - 4 Beds', 6, 2),
      selfContained('BPR04', 'Bathurst Premium - 4 Beds', 6, 2),
      selfContained('BPR06', 'Bathurst Premium - 6 Beds', 9, 3),
      selfContained('BPV04', 'Bathurst Premium View - 4 Beds', 6, 2),
      selfContained('BPV06', 'Bathurst Premium View - 6 Beds', 9, 3),
      selfContained('BOV06', 'Bathurst Ocean View - 6 Beds', 9, 3),
      selfContained('BOV08', 'Bathurst Ocean View - 8 Beds', 12, 4),
      selfContained('BHV04', 'Bathurst Heritage View - 4 Beds', 6, 2),
      selfContained('BHV06', 'Bathurst Heritage View - 6 Beds', 9, 3),
    ],
  },
  {
    slug: 'longreach-bay',
    name: 'Longreach Bay',
    group: 40,
    kind: 'cabin',
    lat: -31.9894,
    lng: 115.5298,
    summary: 'Units above Longreach Bay on the north coast.',
    roomTypes: [
      selfContained('LOV04', 'Longreach Ocean View - 4 Beds', 6, 2),
      selfContained('LOV06', 'Longreach Ocean View - 6 Beds', 9, 3),
      selfContained('LOV08', 'Longreach Ocean View - 8 Beds', 12, 4),
      selfContained('LPV04', 'Longreach Premium View - 4 Beds', 6, 2),
      selfContained('LPV06', 'Longreach Premium View - 6 Beds', 9, 3),
      selfContained('LPV08', 'Longreach Premium View - 8 Beds', 12, 4),
    ],
  },
  {
    slug: 'fays-bay',
    name: "Fay's Bay",
    group: 38,
    kind: 'cabin',
    lat: -31.9882,
    lng: 115.5249,
    summary: "Units around Fay's Bay, between Geordie and Longreach.",
    roomTypes: [
      selfContained('FPR04', "Fay's Bay Premium - 4 Beds", 6, 2),
      selfContained('FPR06', "Fay's Bay Premium - 6 Beds", 9, 3),
      selfContained('FPV04', "Fay's Bay Premium View - 4 Beds", 6, 2),
      selfContained('FPV06', "Fay's Bay Premium View - 6 Beds", 9, 3),
    ],
  },
  {
    slug: 'geordie-bay',
    name: 'Geordie Bay',
    group: 39,
    kind: 'cabin',
    lat: -31.9909,
    lng: 115.5227,
    summary: 'Units around the sheltered bay on the north coast, with its own store and café.',
    roomTypes: [
      selfContained('GPR06', 'Geordie Bay Premium - 6 Beds', 9, 3),
      selfContained('GPV04', 'Geordie Bay Premium View - 4 Beds', 6, 2),
      selfContained('GPV06', 'Geordie Bay Premium View - 6 Beds', 9, 3),
      selfContained('GPV08', 'Geordie Bay Premium View - 8 Beds', 12, 4),
      selfContained('GOV04', 'Geordie Bay Ocean View - 4 Beds', 6, 2),
      selfContained('GOV06', 'Geordie Bay Ocean View - 6 Beds', 9, 3),
    ],
  },
];

const BY_SLUG = new Map(ROTTNEST_PRECINCTS.map((precinct) => [precinct.slug, precinct]));
const BY_GROUP = new Map(ROTTNEST_PRECINCTS.map((precinct) => [precinct.group, precinct]));
const BY_CODE = new Map(
  ROTTNEST_PRECINCTS.flatMap((precinct) =>
    precinct.roomTypes.map((type) => [type.code, { precinct, type }] as const)
  )
);

/** The precinct with this external id, or undefined. */
export function rottnestPrecinct(slug: string): RottnestPrecinct | undefined {
  return BY_SLUG.get(slug);
}

/** The precinct in this Stay Rottnest group, or undefined. */
export function precinctOfGroup(group: number): RottnestPrecinct | undefined {
  return BY_GROUP.get(group);
}

/** The room type with this code, and its precinct, or undefined. */
export function roomTypeOf(
  code: string
): { precinct: RottnestPrecinct; type: RottnestRoomType } | undefined {
  return BY_CODE.get(code);
}

/** What a precinct offers, without repeats, in its room types' order. */
export function unitKindsOf(precinct: RottnestPrecinct): UnitKind[] {
  return [...new Set(precinct.roomTypes.map((type) => type.kind))];
}
