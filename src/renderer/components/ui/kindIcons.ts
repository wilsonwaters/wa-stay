import {
  BedDouble,
  Caravan,
  House,
  MapPin,
  Tent,
  TentTree,
  Tractor,
  TreePalm,
  TreePine,
  type LucideIcon,
} from 'lucide-react';

/**
 * One lucide icon per location kind (architecture-notes §3 `LocationKind`).
 * Kept in step with the icon table in docs/design/design-language.md.
 */
export const KIND_ICONS = {
  campground: TentTree,
  'caravan-park': Caravan,
  'holiday-park': TreePalm,
  cabin: BedDouble,
  hut: TreePine,
  glamping: Tent,
  'farm-stay': Tractor,
  home: House,
  other: MapPin,
} satisfies Record<string, LucideIcon>;

export type LocationKindName = keyof typeof KIND_ICONS;

/** The icon for a kind. Unknown kinds (new providers, bad data) fall back to `other`. */
export function kindIcon(kind: string | undefined): LucideIcon {
  return (kind && (KIND_ICONS as Record<string, LucideIcon>)[kind]) || KIND_ICONS.other;
}
