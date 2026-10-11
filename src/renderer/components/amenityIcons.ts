import {
  Accessibility,
  CarFront,
  CookingPot,
  Dog,
  Droplet,
  Flame,
  Footprints,
  MapPin,
  PlugZap,
  Sailboat,
  ShowerHead,
  Toilet,
  Waves,
  type LucideIcon,
} from 'lucide-react';

/**
 * Icons for amenities, which arrive as the provider's own words ("Toilet", "Dogs permitted",
 * "Road access for 2WD/SUV"). Matched by meaning, so another provider's "Toilets" or "Dog
 * friendly" gets the same icon. The table in docs/design/design-language.md ("Amenities") is
 * the reference; anything not recognised gets a map pin.
 */
const RULES: [pattern: RegExp, icon: LucideIcon][] = [
  [/\btoilets?\b/i, Toilet],
  [/\bshowers?\b/i, ShowerHead],
  [/\b(drinking|potable) water\b/i, Droplet],
  [/\bpower(ed)?\b/i, PlugZap],
  [/\b(camp ?fires?|fire ?pits?)\b/i, Flame],
  [/\b(kitchen|barbecues?|bbqs?)\b/i, CookingPot],
  [/\bdogs?\b/i, Dog],
  [/\b2wd\b/i, CarFront],
  [/\b(wheelchair|accessible|accessibility)\b/i, Accessibility],
  [/\bboat\b/i, Sailboat],
  [/\b(beach|swim(ming)?)\b/i, Waves],
  [/\b(walk(ing)?|trails?)\b/i, Footprints],
];

/** The icon for an amenity, or `MapPin` for one it does not recognise. */
export function amenityIcon(amenity: string): LucideIcon {
  return RULES.find(([pattern]) => pattern.test(amenity))?.[1] ?? MapPin;
}
