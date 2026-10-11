import tokensCss from '../../styles/tokens.css?raw';
import { contrastRatio, parseTokens } from '../../styles/contrast';

/** Text on a provider's brand colour must reach normal-text AA. */
export const MONOGRAM_MIN_CONTRAST = 4.5;

const tokens = parseTokens(tokensCss);
/** White (`fg-inverse`) and ink (`fg`, ink-900), read from tokens.css so they never drift. */
const LIGHT_TEXT = tokens.colors['fg-inverse'];
const DARK_TEXT = tokens.colors.fg;

export type MonogramStyle =
  { fill: 'solid'; text: 'fg-inverse' | 'fg'; ratio: number } | { fill: 'outlined'; ratio: number };

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * How to draw a monogram on a provider's brand colour (any hex, from data): white or ink
 * text, whichever contrasts more. When neither reaches 4.5:1 (`#777777`: 4.48 and 3.97), or
 * the colour is not a hex, use the outlined style: surface fill, brand border, ink text.
 */
export function readableTextOn(hex: string): MonogramStyle {
  if (!HEX.test(hex.trim())) return { fill: 'outlined', ratio: 0 };
  const light = contrastRatio(hex, LIGHT_TEXT);
  const dark = contrastRatio(hex, DARK_TEXT);
  const text = light >= dark ? 'fg-inverse' : 'fg';
  const ratio = Math.max(light, dark);
  return ratio >= MONOGRAM_MIN_CONTRAST
    ? { fill: 'solid', text, ratio }
    : { fill: 'outlined', ratio };
}
