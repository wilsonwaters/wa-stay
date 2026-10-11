/**
 * A stay as a cache key over the fields an answer depends on (E3): two stays that differ only
 * in other fields share the key, so a provider that ignores the party is not asked again when
 * the guests change. Shared by main's bulk availability cache and the renderer's. Pure.
 */

import { STAY_KEY_FIELDS, type StayKeyField, type StayQuery } from '../types/provider.types';

function valueOf(stay: StayQuery, field: StayKeyField): unknown {
  if (field.startsWith('params.')) return stay.params?.[field.slice('params.'.length)] ?? null;
  switch (field) {
    case 'arrival':
      return stay.arrival;
    case 'departure':
      return stay.departure;
    case 'adults':
      return stay.adults;
    case 'equipment':
      return stay.equipment ?? '';
    default:
      // children, infants, concessions: absent counts as 0.
      return stay[field as 'children' | 'infants' | 'concessions'] ?? 0;
  }
}

/**
 * The key of `stay` over `fields` (in any order), or over every field and stay param when
 * `fields` is absent.
 */
export function stayKeyFor(stay: StayQuery, fields?: readonly StayKeyField[]): string {
  const keyed: StayKeyField[] = fields
    ? [...fields]
    : [
        ...STAY_KEY_FIELDS,
        ...Object.keys(stay.params ?? {}).map((key) => `params.${key}` as const),
      ];
  const unique = [...new Set(keyed)].sort();
  return JSON.stringify(unique.map((field) => [field, valueOf(stay, field)]));
}
