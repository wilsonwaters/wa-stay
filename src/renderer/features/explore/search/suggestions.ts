/**
 * "Where" suggestions for the search pill, from the local catalogue only (no geocoding). Pure.
 *
 * Up to 8, grouped Regions, Areas, Places. Within a group, a name that starts with the text
 * beats one with a word that starts with it, which beats one that merely contains it; ties go
 * to the alphabet.
 */

import type { LocationSummary } from '../../../../shared/types/catalog.types';

export type SuggestionKind = 'region' | 'area' | 'place';

export interface Suggestion {
  kind: SuggestionKind;
  /** Unique across kinds: `region:Pilbara`, `area:Cape Range National Park`, `place:<key>`. */
  value: string;
  label: string;
  /** The second line: "Region · 39 places", "Pilbara · 4 places", "Cape Range NP · Pilbara". */
  description: string;
  /** The group heading. */
  group: 'Regions' | 'Areas' | 'Places';
  /** For a region or area, its name; for a place, its location key. */
  target: string;
}

/** A name and its normalised form, worked out once so typing only compares strings. */
interface Named {
  name: string;
  norm: string;
}

export interface SuggestionIndex {
  regions: (Named & { count: number })[];
  areas: (Named & { region?: string; count: number })[];
  places: (Named & { place: LocationSummary })[];
}

export const MAX_SUGGESTIONS = 8;
/** At most this many regions and areas, so places always have room. */
const GROUP_CAPS = { region: 2, area: 3 } as const;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const placesCount = (n: number) => plural(n, 'place', 'places');

/** Lower case without accents, so "Kalbarri" matches "kalbárri". */
export function normalise(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** `matchScore` on text that is already normalised. */
function scoreNormalised(t: string, q: string): number {
  if (!q) return -1;
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  const at = t.indexOf(q);
  if (at < 0) return -1;
  // A word start: after anything that is not a letter or digit.
  for (let i = at; i >= 0; i = t.indexOf(q, i + 1)) {
    if (i > 0 && !/[\p{L}\p{N}]/u.test(t[i - 1])) return 2;
  }
  return 3;
}

/** 0 exact, 1 starts with, 2 a word starts with, 3 contains, -1 no match. */
export function matchScore(text: string, query: string): number {
  return scoreNormalised(normalise(text), normalise(query));
}

/** Counts regions and areas, and normalises every name, once: typing then only ranks. */
export function buildSuggestionIndex(items: readonly LocationSummary[]): SuggestionIndex {
  const regions = new Map<string, number>();
  const areas = new Map<string, { name: string; region?: string; count: number }>();
  for (const item of items) {
    const region = item.area?.region;
    if (region) regions.set(region, (regions.get(region) ?? 0) + 1);
    const area = item.area?.name;
    if (area) {
      const entry = areas.get(area) ?? { name: area, region, count: 0 };
      entry.count += 1;
      areas.set(area, entry);
    }
  }
  return {
    regions: [...regions].map(([name, count]) => ({ name, norm: normalise(name), count })),
    areas: [...areas.values()].map((area) => ({ ...area, norm: normalise(area.name) })),
    places: items.map((place) => ({ name: place.name, norm: normalise(place.name), place })),
  };
}

/** The entries that match, best first: by score, then by name. */
function ranked<T extends Named>(entries: readonly T[], query: string): T[] {
  const matches: { entry: T; score: number }[] = [];
  for (const entry of entries) {
    const score = scoreNormalised(entry.norm, query);
    if (score >= 0) matches.push({ entry, score });
  }
  return matches
    .sort(
      (a, b) =>
        a.score - b.score ||
        (a.entry.norm < b.entry.norm ? -1 : a.entry.norm > b.entry.norm ? 1 : 0)
    )
    .map((m) => m.entry);
}

const byName = <T extends Named>(a: T, b: T) => (a.norm < b.norm ? -1 : a.norm > b.norm ? 1 : 0);

/**
 * The suggestions for `query`. With no text, the regions (a starting point). Otherwise up to
 * 8: at most 2 regions and 3 areas, the rest places; spare room goes back to areas, then
 * regions.
 */
export function suggest(index: SuggestionIndex, query: string): Suggestion[] {
  const regionOf = (entry: Named & { count: number }): Suggestion => ({
    kind: 'region',
    value: `region:${entry.name}`,
    label: entry.name,
    description: `Region · ${placesCount(entry.count)}`,
    group: 'Regions',
    target: entry.name,
  });

  const q = normalise(query);
  if (!q) {
    return [...index.regions].sort(byName).slice(0, MAX_SUGGESTIONS).map(regionOf);
  }

  const regions = ranked(index.regions, q);
  const areas = ranked(index.areas, q);
  const places = ranked(index.places, q).map((entry) => entry.place);

  let regionTake = Math.min(regions.length, GROUP_CAPS.region);
  let areaTake = Math.min(areas.length, GROUP_CAPS.area);
  const placeTake = Math.min(places.length, MAX_SUGGESTIONS - regionTake - areaTake);
  let spare = MAX_SUGGESTIONS - regionTake - areaTake - placeTake;
  const extraAreas = Math.min(spare, areas.length - areaTake);
  areaTake += extraAreas;
  spare -= extraAreas;
  regionTake += Math.min(spare, regions.length - regionTake);

  return [
    ...regions.slice(0, regionTake).map(regionOf),
    ...areas.slice(0, areaTake).map((entry): Suggestion => ({
      kind: 'area',
      value: `area:${entry.name}`,
      label: entry.name,
      description: [entry.region, placesCount(entry.count)].filter(Boolean).join(' · '),
      group: 'Areas',
      target: entry.name,
    })),
    ...places.slice(0, placeTake).map((place): Suggestion => ({
      kind: 'place',
      value: `place:${place.key}`,
      label: place.name,
      description: [place.area?.name, place.area?.region].filter(Boolean).join(' · '),
      group: 'Places',
      target: place.key,
    })),
  ];
}
