/**
 * WCAG 2.x contrast maths and the list of colour pairs WA Stay promises to keep accessible.
 *
 * Pure module: no DOM, no CSS imports. The contrast test reads `tokens.css` from disk,
 * and the `/__design` preview reads the same file, so a drifting token fails both.
 */

export type ContrastKind = 'text' | 'large-text' | 'ui';

export interface ContrastPair {
  /** Foreground token name, without the `--ws-` prefix. */
  fg: string;
  /** Background token name, without the `--ws-` prefix. */
  bg: string;
  kind: ContrastKind;
  /** Minimum WCAG ratio: 4.5 for text, 3 for large text and UI. */
  min: number;
  usage: string;
}

export const MIN_RATIO: Record<ContrastKind, number> = {
  text: 4.5,
  'large-text': 3,
  ui: 3,
};

const pair = (fg: string, bg: string, kind: ContrastKind, usage: string): ContrastPair => ({
  fg,
  bg,
  kind,
  min: MIN_RATIO[kind],
  usage,
});

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  pair('fg', 'canvas', 'text', 'Body text on the page'),
  pair('fg', 'surface', 'text', 'Body text on cards, dialogs and the header'),
  pair('fg', 'surface-subtle', 'text', 'Text on subtle fills (selected rows, chips)'),
  pair('fg-secondary', 'surface', 'text', 'Secondary text: descriptions, metadata'),
  pair('fg-secondary', 'canvas', 'text', 'Secondary text on the page'),
  pair('fg-secondary', 'surface-subtle', 'text', 'Secondary text on subtle fills, table headers'),
  pair('fg-muted', 'surface', 'text', 'Muted text: hints, timestamps, placeholders'),
  pair('fg-muted', 'canvas', 'text', 'Muted text on the page'),
  pair(
    'fg-muted',
    'surface-subtle',
    'text',
    'Muted text on subtle fills, booked nights, full and not-open map pills'
  ),
  pair('fg-inverse', 'surface-inverse', 'text', 'Tooltips, hovered and selected map pills'),
  pair('accent-fg', 'accent', 'text', 'Primary button label'),
  pair('accent-fg', 'accent-hover', 'text', 'Primary button label on hover'),
  pair('accent-hover', 'surface', 'text', 'Coral text, the rare case it is needed'),
  pair('accent-hover', 'accent-subtle', 'text', 'Accent badge'),
  pair('brand', 'surface', 'text', 'Brand-coloured text and icons'),
  pair('brand', 'canvas', 'text', 'Brand-coloured text on the page'),
  pair('brand-strong', 'surface', 'text', 'Links'),
  pair('brand-strong', 'canvas', 'text', 'Links on the page'),
  pair('brand-strong', 'brand-subtle', 'text', 'Selected chip, brand badge'),
  pair('fg-inverse', 'brand', 'text', 'Text on a solid brand fill (checked control)'),
  pair('warning-fg', 'warning-subtle', 'text', 'Warning notice, not-yet-released nights'),
  pair('warning-fg', 'sun-subtle', 'text', '"Soon" pill, sun badge'),
  pair('warning-fg', 'surface', 'text', 'Release times and warning text on cards'),
  pair('available-fg', 'available-subtle', 'text', 'Available badge and notice'),
  pair('available-fg', 'surface', 'text', 'Available text on cards and tables'),
  pair('available', 'available-subtle', 'text', 'Available night glyph'),
  pair('fg-inverse', 'available', 'text', 'Available map pill and solid badge'),
  pair('danger-fg', 'danger-subtle', 'text', 'Error notice'),
  pair('danger', 'surface', 'text', 'Field error text and danger outline button'),
  pair('danger', 'canvas', 'text', 'Field error text on the page'),
  pair('danger', 'danger-subtle', 'text', 'Danger outline button on hover'),
  pair('fg-inverse', 'danger-fg', 'text', 'Confirm button in a destructive dialog (solid fill)'),
  pair('focus', 'surface', 'ui', 'Focus ring on cards and dialogs'),
  pair('focus', 'canvas', 'ui', 'Focus ring on the page'),
  pair('focus', 'surface-subtle', 'ui', 'Focus ring on subtle fills'),
  pair('border-strong', 'surface', 'ui', 'Input and checkbox borders'),
  pair('border-strong', 'canvas', 'ui', 'Input borders on the page'),
  pair('accent', 'canvas', 'ui', 'Primary button shape against the page'),
  pair('ocean-500', 'surface', 'ui', 'Active-nav brushstroke'),
  pair('brand', 'ocean-100', 'ui', 'Kind icon on the photo-placeholder dab'),
  pair('coral-400', 'surface', 'ui', 'Logo coral accent, a large graphic and never text'),
  pair('available', 'surface', 'ui', 'Available map pill against white map land'),
  pair('available', 'canvas', 'ui', 'Available map pill and pin against sand map land'),
];

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function channels(hex: string): [number, number, number] {
  const match = HEX.exec(hex.trim());
  if (!match) throw new Error(`"${hex}" is not a hex colour`);
  const digits =
    match[1].length === 3
      ? match[1]
          .split('')
          .map((d) => d + d)
          .join('')
      : match[1];
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as [number, number, number];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two hex colours (`#rgb` or `#rrggbb`), from 1 to 21. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

export interface TokenSheet {
  /** Every `--ws-*` declaration in the main `:root` block, keyed without the prefix. */
  values: Record<string, string>;
  /** Every colour token resolved to `#RRGGBB`, aliases included. */
  colors: Record<string, string>;
}

const TRIPLE = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/;
const ALIAS = /^var\(--ws-([a-z0-9-]+)\)$/;

const toHex = (rgb: number[]) =>
  '#' + rgb.map((c) => c.toString(16).padStart(2, '0').toUpperCase()).join('');

/** Parses the first `:root { … }` block of `tokens.css`. Media-query overrides are ignored. */
export function parseTokens(css: string): TokenSheet {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const block = /:root\s*\{([^}]*)\}/.exec(withoutComments);
  if (!block) throw new Error('tokens.css has no :root block');

  const values: Record<string, string> = {};
  for (const decl of block[1].matchAll(/--ws-([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    values[decl[1]] = decl[2].trim();
  }

  const colors: Record<string, string> = {};
  const resolve = (name: string, seen: string[]): string | undefined => {
    if (seen.includes(name)) throw new Error(`Token --ws-${name} has a circular alias`);
    const value = values[name];
    if (value === undefined) {
      throw new Error(`Token --ws-${seen[seen.length - 1]} references missing --ws-${name}`);
    }
    const triple = TRIPLE.exec(value);
    if (triple) return toHex(triple.slice(1).map(Number));
    const alias = ALIAS.exec(value);
    if (alias) return resolve(alias[1], [...seen, name]);
    return undefined;
  };
  for (const name of Object.keys(values)) {
    const hex = resolve(name, []);
    if (hex) colors[name] = hex;
  }
  return { values, colors };
}

/** Looks up a colour token, failing loudly when tokens.css does not define it. */
export function tokenHex(sheet: TokenSheet, name: string): string {
  const hex = sheet.colors[name];
  if (!hex) throw new Error(`Colour token --ws-${name} is missing from tokens.css`);
  return hex;
}

export interface CheckedPair extends ContrastPair {
  fgHex: string;
  bgHex: string;
  ratio: number;
  passes: boolean;
}

/** Resolves every pair against a token sheet. Throws if a named token is missing. */
export function checkContrastPairs(
  sheet: TokenSheet,
  pairs: readonly ContrastPair[] = CONTRAST_PAIRS
): CheckedPair[] {
  return pairs.map((p) => {
    const fgHex = tokenHex(sheet, p.fg);
    const bgHex = tokenHex(sheet, p.bg);
    const ratio = contrastRatio(fgHex, bgHex);
    return { ...p, fgHex, bgHex, ratio, passes: ratio >= p.min };
  });
}
