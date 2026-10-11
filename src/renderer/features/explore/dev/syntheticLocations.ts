/**
 * Synthetic places for checking Explore at scale: a seeded, repeatable set spread across WA's
 * regions, shaped like a provider's catalogue. Used by the DEV-only `?devFixture=N` switch and
 * by tests (tests/fixtures/catalog/synthetic-locations.ts). No photos, so nothing is fetched.
 */

import type { LocationSummary } from '../../../../shared/types/catalog.types';
import type { BookingMode, LocationKind } from '../../../../shared/types/provider.types';

/** A small, fast, seeded PRNG (mulberry32): the same seed gives the same places. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rough boxes for ParkStay's regions: `[west, south, east, north]`. */
const REGIONS: [name: string, box: [number, number, number, number], weight: number][] = [
  ['Kimberley', [122, -18.5, 128.8, -14.5], 1],
  ['Pilbara', [113.6, -23.4, 120.5, -20], 3],
  ['Midwest', [113.4, -29.6, 117.5, -24.5], 3],
  ['Goldfields', [120.2, -33.8, 125.5, -28], 1],
  ['Wheatbelt', [116.6, -33, 119.2, -30.2], 1],
  ['Swan', [115.7, -32.6, 116.4, -31.4], 2],
  ['South West', [114.95, -34.3, 116, -32.7], 3],
  ['Warren', [115.6, -34.95, 117, -34.2], 2],
  ['South Coast', [117.2, -34.9, 123.8, -33.6], 2],
];

const FIRST = ['Red', 'Blue', 'Lucky', 'Whale', 'Banksia', 'Karri', 'Jarrah', 'Granite', 'Coral'];
const SECOND = ['Bluff', 'Bay', 'Creek', 'Gorge', 'Pool', 'Point', 'Springs', 'Rocks', 'Beach'];
const PARKS = ['National Park', 'Conservation Park', 'Nature Reserve', 'Marine Park'];
const KINDS: LocationKind[] = ['campground', 'campground', 'campground', 'caravan-park', 'hut'];
const MODES: BookingMode[] = ['online', 'online', 'online', 'offline', 'external'];
const AMENITIES = [
  'Toilet',
  'Road access for 2WD/SUV',
  'Dogs permitted',
  'Showers',
  'Drinking water',
];

/** `count` places, the same every time for the same `seed`. */
export function syntheticLocations(count: number, seed = 20261004): LocationSummary[] {
  const next = random(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)];
  const totalWeight = REGIONS.reduce((sum, [, , weight]) => sum + weight, 0);
  const pickRegion = () => {
    let roll = next() * totalWeight;
    for (const region of REGIONS) {
      roll -= region[2];
      if (roll <= 0) return region;
    }
    return REGIONS[REGIONS.length - 1];
  };

  const places: LocationSummary[] = [];
  for (let i = 0; i < count; i += 1) {
    const [region, [west, south, east, north]] = pickRegion();
    const externalId = String(100_000 + i);
    const kind = pick(KINDS);
    const area = `${pick(FIRST)} ${pick(SECOND)} ${pick(PARKS)}`;
    places.push({
      key: `parkstay:${externalId}`,
      providerId: 'parkstay',
      externalId,
      name: `${pick(FIRST)} ${pick(SECOND)} ${i + 1}`,
      kind,
      bookingMode: pick(MODES),
      lat: Number((south + next() * (north - south)).toFixed(5)),
      lng: Number((west + next() * (east - west)).toFixed(5)),
      area: { name: area, region },
      imageUrls: [],
      amenities: AMENITIES.filter(() => next() < 0.45),
      unitCount: 1 + Math.floor(next() * 60),
    });
  }
  return places;
}
