/**
 * The eight open RAC Parks & Resorts parks: facts only, so listing them needs no request per
 * park (terms rule 2; a sync reads one page, RAC's parks page, for their card photos:
 * `park-pages.ts`). No photo, description or other copy of RAC's is kept here (rule 6).
 *
 * Sources (research of 16 Oct 2026, `ai-state/research/rac-booking-flow.md` §1, §2 and §5):
 * each park's book-now page (`blog_id`, which widget it uses, its category types), its
 * contact page (address, and the lat/lng of its "View on Google Maps" link) and the school
 * holiday page (release hours, the member pre-sale). Ningaloo Reef Resort (closed for
 * redevelopment) and Rose Gardens Holiday Park (another site) are left out.
 *
 * - **slug** is the park's path on RAC's site (`/<slug>/`) and its id in WA Stay. It is stored
 *   in watches and snipes, so it never changes.
 * - **blogId** is the park's WordPress site id, which RAC's availability endpoint takes.
 * - **bookNow** says which page `/<slug>/book-now/` is: RAC's own widget, which lists the
 *   categories (`book-now.ts`), or NewBook's native engine, which lists none until searched.
 * - **area** uses the region names Explore already has (DBCA's), so the Region filter works
 *   across providers; RAC's own labels ("Coral Coast") are not used.
 * - **categoryTypes** maps the park's NewBook category type ids to unit kinds. The ids differ
 *   by park (type 2 is cabins at Cable Beach but sites at Busselton). A category's name decides
 *   first (`unit-kinds.ts`); the type is the fallback.
 * - **schoolHolidays** is the park's part in RAC's school-holiday releases: the hour (Perth)
 *   they open; whether the park is in the 48-hour member pre-sale before each one, which opens
 *   at the same hour, 48 hours earlier (decided on 16 Oct 2026; terms rule 14); and what is left
 *   out of the pre-sale, as unit kinds and as the same categories' NewBook ids (a snipe may name
 *   categories rather than kinds, and the release policy sends no request to look one up).
 *   `null` for Cable Beach, which is in neither (decided on 16 Oct 2026). The release days
 *   themselves are in `release-calendar.ts`.
 * - **seasonalRelease** is the part of the year whose nights the park releases on its own
 *   monthly seasonal release days, not as they come into the 364-day window: Cable Beach's dry
 *   season, 15 May to 15 October (`ai-state/research/rac-terms.md` §4). WA Stay does not know
 *   those days, so a stay with a night in it is timed by the person. `null` elsewhere.
 *
 * The NewBook-native parks' categories, from the research's availability captures of
 * 16–17 Oct 2026 (type id: names), kept for their units later:
 * - Exmouth: 1: Blue Reef Motel, Blue Reef Queen, Blue Reef Studio, cabins (one and two
 *   bedroom, family, budget, pool view); 2: ensuite, powered (pets or not), slab, natural
 *   ground and unpowered sites.
 * - Karri Valley: 2: Lakeside Room (and Queen), two- and three-bedroom chalets (forest and
 *   lake views, family, accessible); 7: ensuite, powered, powered slab and unpowered camper sites.
 * - Monkey Mia: 1: rooms (garden, pool, beach and superior beach view, family garden, budget
 *   with shared bathroom), Family Studio, two- and three-bedroom beachfront villas; 2: powered
 *   (ensuite, beach) sites and unpowered camping; 7: exclusive-use 4- and 8-bed dorms.
 */

import type { UnitKind } from '@shared/types/provider.types';

export type BookNowPage = 'widget' | 'native';

/** A park's part in RAC's school-holiday releases. */
export interface SchoolHolidayRelease {
  /**
   * The hour, Perth time, the park's releases open: 7, 8 or 9 am. Its member pre-sale opens at
   * the same hour, 48 hours earlier.
   */
  hour: 7 | 8 | 9;
  /** Whether the park is in the 48-hour member pre-sale before each release. */
  memberPreSale: boolean;
  /** Unit kinds that are not in the member pre-sale (Margaret River's dorms). */
  presaleExcludes: readonly UnitKind[];
  /**
   * NewBook category ids (`data-cat-id`, a unit `cat:<id>`) that are not in the member
   * pre-sale: the same categories as `presaleExcludes`, for a snipe that names categories.
   */
  presaleExcludedCategoryIds: readonly string[];
}

/** Nights a park releases on its own seasonal days: month and day, `MM-DD`, both included. */
export interface SeasonalRelease {
  /** The season, for messages ("dry-season"). */
  name: string;
  first: string;
  last: string;
}

export interface RacPark {
  slug: string;
  blogId: number;
  name: string;
  bookNow: BookNowPage;
  /** `name` is the town; `region` one of Explore's region names. */
  area: { name: string; region: string };
  address: string;
  lat: number;
  lng: number;
  /** What a person can sleep in at the park, in `UNIT_KINDS` order. */
  unitKinds: readonly UnitKind[];
  /** NewBook category type id → unit kind. */
  categoryTypes: Readonly<Record<string, UnitKind>>;
  schoolHolidays: SchoolHolidayRelease | null;
  seasonalRelease: SeasonalRelease | null;
}

/** A park in the school-holiday releases and the member pre-sale, with nothing left out. */
const inPreSale = (hour: 7 | 8 | 9): SchoolHolidayRelease => ({
  hour,
  memberPreSale: true,
  presaleExcludes: [],
  presaleExcludedCategoryIds: [],
});

export const RAC_PARKS: readonly RacPark[] = [
  {
    slug: 'busselton',
    blogId: 6,
    name: 'RAC Busselton Holiday Park',
    bookNow: 'widget',
    area: { name: 'Busselton', region: 'South West' },
    address: '97 Caves Road, Abbey, WA 6280',
    lat: -33.6611769,
    lng: 115.2487607,
    unitKinds: ['campsite', 'cabin'],
    categoryTypes: { '2': 'campsite', '5': 'cabin' },
    schoolHolidays: inPreSale(8),
    seasonalRelease: null,
  },
  {
    slug: 'cable-beach',
    blogId: 9,
    name: 'RAC Cable Beach Holiday Park',
    bookNow: 'widget',
    area: { name: 'Broome', region: 'Kimberley' },
    address: '1 Murray Road, Cable Beach, WA 6726',
    lat: -17.9356448,
    lng: 122.2141982,
    unitKinds: ['campsite', 'cabin'],
    categoryTypes: { '2': 'cabin', '4': 'campsite' },
    schoolHolidays: null,
    // Seasonal guests rebook on arrival; everyone else waits for RAC's monthly release days
    seasonalRelease: { name: 'dry-season', first: '05-15', last: '10-15' },
  },
  {
    slug: 'cervantes',
    blogId: 5,
    name: 'RAC Cervantes Holiday Park',
    bookNow: 'widget',
    area: { name: 'Cervantes', region: 'Midwest' },
    address: '35 Aragon Street, Cervantes, WA 6511',
    lat: -30.4979022,
    lng: 115.0669404,
    unitKinds: ['campsite', 'cabin'],
    categoryTypes: { '1': 'cabin', '2': 'campsite' },
    schoolHolidays: inPreSale(9),
    seasonalRelease: null,
  },
  {
    slug: 'esperance',
    blogId: 10,
    name: 'RAC Esperance Holiday Park',
    bookNow: 'widget',
    area: { name: 'Esperance', region: 'South Coast' },
    address: 'Goldfields Road, Esperance, WA 6450',
    lat: -33.8448715,
    lng: 121.9017562,
    unitKinds: ['campsite', 'cabin'],
    categoryTypes: { '2': 'campsite', '5': 'cabin' },
    schoolHolidays: inPreSale(7),
    seasonalRelease: null,
  },
  {
    slug: 'margaret-river',
    blogId: 8,
    name: 'RAC Margaret River Nature Park',
    bookNow: 'widget',
    area: { name: 'Margaret River', region: 'South West' },
    address: 'Lot 352 McQueen Road, Margaret River, WA 6285',
    lat: -33.9346726,
    lng: 115.077829,
    unitKinds: ['campsite', 'cabin', 'dorm', 'glamping'],
    categoryTypes: { '2': 'cabin', '4': 'dorm', '5': 'campsite' },
    // Its dorms (category type 4: "Dorm Room - Sleeps 26", "- Sleeps 14" and "- Sleeps 5") are
    // not in the member pre-sale (research §5, book-now page of 16 Oct 2026).
    schoolHolidays: {
      hour: 7,
      memberPreSale: true,
      presaleExcludes: ['dorm'],
      presaleExcludedCategoryIds: ['2', '3', '4'],
    },
    seasonalRelease: null,
  },
  {
    slug: 'exmouth',
    blogId: 3,
    name: 'RAC Exmouth Cape Holiday Park',
    bookNow: 'native',
    area: { name: 'Exmouth', region: 'Pilbara' },
    address: '3 Truscott Cres, Exmouth, WA 6707',
    lat: -21.9385751,
    lng: 114.1323242,
    unitKinds: ['campsite', 'cabin', 'room'],
    // Type 1 holds the cabins and the Blue Reef motel rooms; a cabin says so in its name.
    categoryTypes: { '1': 'room', '2': 'campsite' },
    schoolHolidays: inPreSale(9),
    seasonalRelease: null,
  },
  {
    slug: 'karri-valley',
    blogId: 7,
    name: 'RAC Karri Valley Resort',
    bookNow: 'native',
    area: { name: 'Pemberton', region: 'Warren' },
    address: '11342 Vasse Highway, Beedelup, WA 6260',
    lat: -34.4205734,
    lng: 115.850881,
    unitKinds: ['campsite', 'cabin', 'room'],
    categoryTypes: { '2': 'cabin', '7': 'campsite' },
    schoolHolidays: inPreSale(8),
    seasonalRelease: null,
  },
  {
    slug: 'monkey-mia',
    blogId: 2,
    name: 'RAC Monkey Mia Dolphin Resort',
    bookNow: 'native',
    area: { name: 'Shark Bay', region: 'Midwest' },
    address: '1 Monkey Mia Road, Monkey Mia, WA 6537',
    lat: -25.7936732,
    lng: 113.7183656,
    unitKinds: ['campsite', 'cabin', 'room', 'dorm'],
    categoryTypes: { '1': 'room', '2': 'campsite', '7': 'dorm' },
    schoolHolidays: inPreSale(8),
    seasonalRelease: null,
  },
];

const BY_SLUG: ReadonlyMap<string, RacPark> = new Map(RAC_PARKS.map((park) => [park.slug, park]));

/** The park with this slug, or undefined (Ningaloo, or anything else). */
export function racPark(slug: string): RacPark | undefined {
  return BY_SLUG.get(slug);
}
