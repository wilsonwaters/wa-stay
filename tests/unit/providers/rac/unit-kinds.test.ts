/**
 * What an RAC category is (`src/main/providers/rac/unit-kinds.ts`): its name first, in the
 * rule's order (a "Dorm Room" is a dorm, a "Studio Room" a cabin), then the park's category
 * type, then nothing (the catalogue's `other`). Every seeded park's kinds are what its
 * categories give.
 */

import { RAC_PARKS } from '@main/providers/rac';
import { unitKindFromName, unitKindOf } from '@main/providers/rac/unit-kinds';
import type { UnitKind } from '@shared/types/provider.types';
import { UNIT_KINDS } from '@shared/types/provider.types';

describe('unitKindFromName', () => {
  it.each<[string, UnitKind]>([
    ['Dorm Room - Sleeps 26', 'dorm'],
    ['Exclusive Use 4 Bed Dorms', 'dorm'],
    ['Bunkhouse', 'dorm'],
    ['Modern Safari Tent', 'glamping'],
    ['Glamping Tent', 'glamping'],
    ['Bell Tent', 'glamping'],
    ['Powered Big Rig Site', 'campsite'],
    ['Pet Friendly Powered Site', 'campsite'],
    ['Unpowered Camping', 'campsite'],
    ['Ensuite Site - Natural Ground - No Pets', 'campsite'],
    ['Two Bedroom Cabin (Sleeps 4)', 'cabin'],
    ['Studio Room', 'cabin'],
    ['4 Bedroom Eco Lodge', 'cabin'],
    ['The Azure Lodge', 'cabin'],
    ['Three Bedroom Chalet - Family Lake View', 'cabin'],
    ['2 Bedroom Beachfront Villa', 'cabin'],
    ['Garden Cottage', 'cabin'],
    ['Beach Bungalow', 'cabin'],
    ['One Bedroom Apartment', 'cabin'],
    ['Budget Room Shared Bathroom', 'room'],
    ['Lakeside Room Queen', 'room'],
    ['Family Suite', 'room'],
    ['Blue Reef Motel', 'room'],
  ])('"%s" is %s', (name, kind) => {
    expect(unitKindFromName(name)).toBe(kind);
  });

  it('matches whole words only: a bedroom is not a room, a campervan not a camp', () => {
    expect(unitKindFromName('Two Bedroom Queen')).toBeUndefined();
    expect(unitKindFromName('Campervan Bay')).toBeUndefined();
    expect(unitKindFromName('Blue Reef Queen')).toBeUndefined();
  });
});

describe('unitKindOf', () => {
  const types: Record<string, UnitKind> = { '1': 'room', '2': 'campsite' };

  it("falls back to the park's category type when the name names nothing", () => {
    expect(unitKindOf('Blue Reef Queen', '1', types)).toBe('room');
    // The name wins over the type: type 1 holds Exmouth's cabins too
    expect(unitKindOf('Two Bedroom Cabin', '1', types)).toBe('cabin');
  });

  it('is undefined when neither the name nor the type says (the caller logs it as other)', () => {
    expect(unitKindOf('Blue Reef Queen', '9', types)).toBeUndefined();
    expect(unitKindOf('Blue Reef Queen', undefined, types)).toBeUndefined();
    // Not a prototype key
    expect(unitKindOf('Blue Reef Queen', 'constructor', types)).toBeUndefined();
  });
});

/**
 * Every park's categories (names and NewBook type ids), from the research's captures of
 * 16–17 Oct 2026: the widget parks' book-now pages and the native parks' availability answers.
 * Facts only (category names), no copy.
 */
const CATEGORIES: Record<string, Array<[string, string]>> = {
  busselton: [
    ['Two Bedroom Cabin (Sleeps 4)', '5'],
    ['Two Bedroom Queen Cabin (Sleeps 4)', '5'],
    ['Two Bedroom Cabin (Sleeps 5)', '5'],
    ['Two Bedroom Cabin (Sleeps 6)', '5'],
    ['One Bedroom Cabin (Sleeps 2)', '5'],
    ['One Bedroom Cabin (Sleeps 4)', '5'],
    ['Studio Room', '5'],
    ['Ensuite Site', '2'],
    ['Powered Big Rig Site', '2'],
    ['Powered Site', '2'],
    ['Unpowered Site', '2'],
  ],
  'cable-beach': [
    ['Two Bedroom Palm Cabin (Sleeps 4)', '2'],
    ['Two Bedroom Garden Cabin (Sleeps 4)', '2'],
    ['Two Bedroom Garden Cabin (Sleeps 5)', '2'],
    ['Studio Room', '2'],
    ['Powered Caravan Site', '4'],
    ['Pet Friendly Powered Site', '4'],
  ],
  cervantes: [
    ['Three Bedroom Villa', '1'],
    ['Two Bedroom Villa', '1'],
    ['Two Bedroom Villa - Accessible', '1'],
    ['One Bedroom Studio', '1'],
    ['Powered Firm Ground Site', '2'],
    ['Powered Campervan Site', '2'],
    ['Powered Tent Site', '2'],
    ['Unpowered Van Site', '2'],
    ['Unpowered Camping Site', '2'],
  ],
  esperance: [
    ['The Azure Lodge', '5'],
    ['Three Bedroom Bay Villa', '5'],
    ['Two Bedroom Pool Villa', '5'],
    ['Accessible One Bedroom Garden Villa', '5'],
    ['One Bedroom Bay Studio', '5'],
    ['Two Bedroom Pet Friendly Park Cabin', '5'],
    ['Ensuite Powered Site', '2'],
    ['Powered Mat Site', '2'],
    ['Powered Big Rig Slab Site', '2'],
  ],
  'margaret-river': [
    ['4 Bedroom Eco Lodge', '2'],
    ['2 Bedroom Cabin', '2'],
    ['Modern Safari Tent', '2'],
    ['Dorm Room - Sleeps 26', '4'],
    ['Dorm Room - Sleeps 14', '4'],
    ['Dorm Room - Sleeps 5', '4'],
    ['Powered Site', '5'],
  ],
  exmouth: [
    ['Blue Reef Motel', '1'],
    ['Blue Reef Queen', '1'],
    ['Blue Reef Studio', '1'],
    ['Ensuite Site - Slab - No Pets', '2'],
    ['One Bedroom Cabin', '1'],
    ['Two Bedroom Budget Cabin with Shared Bathroom', '1'],
    ['Powered Site - Pets Welcome', '2'],
    ['Unpowered Site - No Pets', '2'],
  ],
  'karri-valley': [
    ['Lakeside Room', '2'],
    ['Lakeside Room Queen', '2'],
    ['Two Bedroom Chalet - Forest View', '2'],
    ['Three Bedroom Chalet - Lake View', '2'],
    ['Ensuite Site', '7'],
    ['Powered Slab Site', '7'],
    ['Unpowered Camper Site', '7'],
  ],
  'monkey-mia': [
    ['Accessible Two Bedroom Beachfront Villa', '1'],
    ['Garden View Room', '1'],
    ['Family Studio', '1'],
    ['Budget Room Shared Bathroom', '1'],
    ['Powered Ensuite Site', '2'],
    ['Unpowered Camping', '2'],
    ['Exclusive Use 4 Bed Dorms', '7'],
    ['Exclusive Use 8 Bed Dorms', '7'],
  ],
};

describe('the seed', () => {
  it.each(RAC_PARKS.map((park) => [park.slug, park] as const))(
    "%s's unit kinds are its categories' kinds, in UNIT_KINDS order, none of them other",
    (slug, park) => {
      const kinds = new Set(
        CATEGORIES[slug].map(([name, type]) => unitKindOf(name, type, park.categoryTypes))
      );
      expect(kinds.has(undefined)).toBe(false);
      expect(park.unitKinds).toEqual(UNIT_KINDS.filter((kind) => kinds.has(kind)));
    }
  );
});
