/**
 * @jest-environment node
 *
 * `BRAND_COLORS` (`@shared/constants/brand`) brings the D1 palette to HTML the renderer's CSS
 * never reaches: notification emails and the Gmail sign-in page. Each colour must be its token
 * in tokens.css, and each text/background pair those pages use must pass WCAG AA.
 */
import fs from 'fs';
import { BRAND_COLORS } from '@shared/constants';
import { contrastRatio, parseTokens, tokenHex } from '../../../src/renderer/styles/contrast';
import { TOKENS_CSS } from './brand-files';

const sheet = parseTokens(fs.readFileSync(TOKENS_CSS, 'utf8'));

type BrandColor = keyof typeof BRAND_COLORS;

/** The tokens.css token each brand colour stands for. */
const TOKENS: Record<BrandColor, string> = {
  text: 'fg',
  textSecondary: 'fg-secondary',
  textMuted: 'fg-muted',
  link: 'brand-strong',
  canvas: 'canvas',
  surface: 'surface',
  border: 'border',
  ocean: 'ocean-500',
  accent: 'accent',
  accentText: 'accent-fg',
};

/** [foreground, background, minimum ratio]: what the email and the OAuth page put together. */
const PAIRS: Array<[BrandColor, BrandColor, number]> = [
  ['text', 'surface', 4.5], // wordmark, headings
  ['textSecondary', 'surface', 4.5], // message body
  ['textMuted', 'surface', 4.5], // footer
  ['link', 'surface', 4.5], // location and provider lines
  ['accentText', 'accent', 4.5], // the button label
  ['accent', 'canvas', 3], // the button against the page
  ['ocean', 'surface', 3], // the rule under the wordmark
];

describe('BRAND_COLORS', () => {
  it.each(Object.keys(TOKENS) as BrandColor[])('%s is its D1 token', (name) => {
    expect(BRAND_COLORS[name].toUpperCase()).toBe(tokenHex(sheet, TOKENS[name]));
  });

  it('has a token for every colour', () => {
    expect(Object.keys(BRAND_COLORS).sort()).toEqual(Object.keys(TOKENS).sort());
  });

  it.each(PAIRS)('%s on %s passes %d:1', (fg, bg, min) => {
    expect(contrastRatio(BRAND_COLORS[fg], BRAND_COLORS[bg])).toBeGreaterThanOrEqual(min);
  });
});
