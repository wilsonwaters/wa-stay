/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';
import {
  CONTRAST_PAIRS,
  MIN_RATIO,
  checkContrastPairs,
  contrastRatio,
  parseTokens,
  tokenHex,
} from '../../../src/renderer/styles/contrast';

const TOKENS_PATH = path.resolve(__dirname, '../../../src/renderer/styles/tokens.css');
const tokensCss = fs.readFileSync(TOKENS_PATH, 'utf8');
const sheet = parseTokens(tokensCss);

describe('contrastRatio', () => {
  it('gives 21:1 for black on white, in either order', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
  });

  it('gives 1:1 for the same colour', () => {
    expect(contrastRatio('#3A74B8', '#3a74b8')).toBeCloseTo(1, 10);
  });

  it('parses shorthand hex', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#fff', '#ffffff')).toBeCloseTo(1, 10);
  });

  it('matches a known WCAG value (#767676 on white is 4.54:1)', () => {
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
  });

  it('rejects anything that is not a hex colour', () => {
    expect(() => contrastRatio('rgb(0 0 0)', '#fff')).toThrow(/not a hex colour/);
  });
});

describe('tokens.css', () => {
  it('stores colours as space-separated RGB channels so Tailwind alpha works', () => {
    expect(sheet.values['coral-600']).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
    expect(sheet.values.accent).toBe('var(--ws-coral-600)');
  });

  it('anchors ocean, sun and coral on the colours sampled from the reference image', () => {
    // Dominant brushstroke #3870B0 to #3A74B8, sun #E8B858, beak #D05830.
    expect(tokenHex(sheet, 'ocean-500')).toBe('#3A74B8');
    expect(tokenHex(sheet, 'sun-400')).toBe('#E8B858');
    expect(tokenHex(sheet, 'coral-400')).toBe('#D05830');
  });

  it('resolves semantic aliases to their palette hex', () => {
    expect(tokenHex(sheet, 'accent')).toBe(tokenHex(sheet, 'coral-600'));
    expect(tokenHex(sheet, 'focus')).toBe(tokenHex(sheet, 'ocean-600'));
    expect(tokenHex(sheet, 'fg-muted')).toBe(tokenHex(sheet, 'sand-600'));
  });

  it('fails with a named error when a token is missing', () => {
    expect(() => tokenHex(sheet, 'not-a-token')).toThrow(
      'Colour token --ws-not-a-token is missing from tokens.css'
    );
  });

  it('fails a contrast check naming the token when tokens.css drops one', () => {
    const withoutAccent = tokensCss.replace(/^\s*--ws-accent:.*$/m, '');
    expect(() => checkContrastPairs(parseTokens(withoutAccent))).toThrow(
      'Colour token --ws-accent is missing from tokens.css'
    );
  });

  it('fails naming both tokens when an alias points at a missing palette value', () => {
    const brokenAlias = tokensCss.replace(/^\s*--ws-coral-600:.*$/m, '');
    expect(() => parseTokens(brokenAlias)).toThrow(
      'Token --ws-accent references missing --ws-coral-600'
    );
  });
});

describe('CONTRAST_PAIRS', () => {
  it('uses 4.5:1 for text and 3:1 for large text and UI', () => {
    for (const p of CONTRAST_PAIRS) expect(p.min).toBe(MIN_RATIO[p.kind]);
    expect(MIN_RATIO).toEqual({ text: 4.5, 'large-text': 3, ui: 3 });
  });

  it('lists each pair once', () => {
    const keys = CONTRAST_PAIRS.map((p) => `${p.fg} on ${p.bg}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(checkContrastPairs(sheet).map((p) => [`${p.fg} on ${p.bg}`, p] as const))(
    '%s meets its minimum',
    (_name, p) => {
      expect(p.ratio).toBeGreaterThanOrEqual(p.min);
    }
  );

  it('keeps muted text at 4.5:1 or more on surface, canvas and surface-subtle (replaces gray-400)', () => {
    for (const bg of ['surface', 'canvas', 'surface-subtle']) {
      const pair = CONTRAST_PAIRS.find((p) => p.fg === 'fg-muted' && p.bg === bg);
      expect(pair?.kind).toBe('text');
      expect(
        contrastRatio(tokenHex(sheet, 'fg-muted'), tokenHex(sheet, bg))
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the focus ring at 3:1 or more on surface and canvas', () => {
    for (const bg of ['surface', 'canvas']) {
      expect(CONTRAST_PAIRS.some((p) => p.fg === 'focus' && p.bg === bg)).toBe(true);
      expect(contrastRatio(tokenHex(sheet, 'focus'), tokenHex(sheet, bg))).toBeGreaterThanOrEqual(
        3
      );
    }
  });

  it('never puts text on or in the decorative coral-400, sun-400 or sun', () => {
    const decorative = ['coral-400', 'sun-400', 'sun'];
    for (const p of CONTRAST_PAIRS) {
      if (p.kind !== 'ui') {
        expect(decorative).not.toContain(p.fg);
        expect(decorative).not.toContain(p.bg);
      }
      // Sun gold is too light to be a meaningful mark on a light surface at all.
      expect(['sun-400', 'sun']).not.toContain(p.fg);
    }
  });

  it('lets coral-400 be a large graphic only, at 3:1 or more on surface', () => {
    const coral = CONTRAST_PAIRS.filter((p) => p.fg === 'coral-400');
    expect(coral).toEqual([expect.objectContaining({ bg: 'surface', kind: 'ui' })]);
    expect(
      contrastRatio(tokenHex(sheet, 'coral-400'), tokenHex(sheet, 'surface'))
    ).toBeGreaterThanOrEqual(3);
  });
});
