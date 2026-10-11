/**
 * @jest-environment node
 *
 * Keeps docs/design/design-language.md in step with the code: required sections,
 * palette hex values, the contrast table and the location-kind icon table.
 */
import fs from 'fs';
import path from 'path';
import {
  CONTRAST_PAIRS,
  checkContrastPairs,
  parseTokens,
} from '../../../src/renderer/styles/contrast';
import { KIND_ICONS } from '../../../src/renderer/components/ui/kindIcons';

const ROOT = path.resolve(__dirname, '../../..');
const doc = fs.readFileSync(path.join(ROOT, 'docs/design/design-language.md'), 'utf8');
const sheet = parseTokens(
  fs.readFileSync(path.join(ROOT, 'src/renderer/styles/tokens.css'), 'utf8')
);

const REQUIRED_SECTIONS = [
  'Principles',
  'WA rationale',
  'Palette',
  'Contrast pairs',
  'Type',
  'Spacing and layout',
  'Radii',
  'Elevation',
  'Motion',
  'Iconography',
  'Imagery and placeholder',
  'Brushstroke motif',
  'Voice and tone',
  "Do and don't",
];

const REQUIRED_ALIASES = [
  'canvas',
  'surface',
  'surface-subtle',
  'surface-inverse',
  'fg',
  'fg-muted',
  'fg-inverse',
  'border',
  'border-strong',
  'brand',
  'brand-strong',
  'brand-subtle',
  'accent',
  'accent-hover',
  'accent-subtle',
  'accent-fg',
  'focus',
  'available',
  'available-subtle',
  'available-fg',
  'warning-subtle',
  'warning-fg',
  'danger',
  'danger-subtle',
  'danger-fg',
  'sun',
];

/** Splits the doc into `## ` sections, keyed by heading text. */
function sections(markdown: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = markdown.split(/^## /m).slice(1);
  for (const part of parts) {
    const newline = part.indexOf('\n');
    out.set(part.slice(0, newline).trim(), part.slice(newline + 1));
  }
  return out;
}

/** Table rows (not the header or divider) as arrays of trimmed cells, backticks removed. */
function tableRows(body: string): string[][] {
  return body
    .split(/\r?\n/)
    .filter((l) => l.startsWith('|') && !/^\|\s*-/.test(l))
    .map((l) =>
      l
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim().replace(/`/g, ''))
    );
}

const bySection = sections(doc);

describe('design-language.md', () => {
  it('has every required section, each with at least one concrete rule', () => {
    for (const name of REQUIRED_SECTIONS) {
      const body = bySection.get(name);
      expect(body).toBeDefined();
      // A rule is a bullet, a numbered item or a table row.
      expect(body).toMatch(/^(\s*[-*] |\d+\. |\|)/m);
    }
  });

  it('has five principles or fewer', () => {
    const principles = (bySection.get('Principles') ?? '').match(/^\d+\. /gm) ?? [];
    expect(principles.length).toBeGreaterThan(0);
    expect(principles.length).toBeLessThanOrEqual(5);
  });

  it('lists every raw palette token with its exact hex from tokens.css', () => {
    const rows = tableRows(bySection.get('Palette') ?? '');
    const listed = new Map(
      rows.filter((r) => /^#[0-9A-F]{6}$/.test(r[1])).map((r) => [r[0], r[1]])
    );
    const raw = Object.keys(sheet.colors).filter((k) => !sheet.values[k].startsWith('var('));
    for (const family of ['ocean', 'coral', 'sun', 'eucalypt', 'sand', 'ink', 'danger']) {
      expect(raw.some((k) => k.startsWith(`${family}-`))).toBe(true);
    }
    for (const token of raw)
      expect([token, listed.get(token)]).toEqual([token, sheet.colors[token]]);
  });

  it('lists every required semantic alias with the palette value and hex it resolves to', () => {
    const rows = tableRows(bySection.get('Palette') ?? '');
    const aliases = new Map(rows.filter((r) => /^#[0-9A-F]{6}$/.test(r[2])).map((r) => [r[0], r]));
    for (const alias of REQUIRED_ALIASES) {
      const row = aliases.get(alias);
      expect([alias, row?.[1], row?.[2]]).toEqual([
        alias,
        sheet.values[alias].replace(/^var\(--ws-(.+)\)$/, '$1'),
        sheet.colors[alias],
      ]);
    }
  });

  it('has a contrast table that matches CONTRAST_PAIRS one-to-one with computed ratios', () => {
    const rows = tableRows(bySection.get('Contrast pairs') ?? '').filter(
      (r) => r[0] !== 'Foreground'
    );
    const expected = checkContrastPairs(sheet).map((p) => [
      p.fg,
      p.bg,
      p.kind,
      p.ratio.toFixed(2),
      String(p.min),
      p.usage,
    ]);
    expect(rows).toEqual(expected);
    expect(rows).toHaveLength(CONTRAST_PAIRS.length);
  });

  it('names the lucide icon for every location kind, matching kindIcons.ts', () => {
    const rows = new Map(tableRows(bySection.get('Iconography') ?? '').map((r) => [r[0], r[1]]));
    for (const [kind, icon] of Object.entries(KIND_ICONS)) {
      expect([kind, rows.get(kind)]).toEqual([kind, icon.displayName]);
    }
  });

  it('names an icon for amenities and for each night state', () => {
    const icons = tableRows(bySection.get('Iconography') ?? '');
    const meaning = (m: string) => icons.find((r) => r[0] === m)?.[1];
    expect(meaning('Toilets')).toBe('Toilet');
    expect(meaning('Dogs permitted')).toBe('Dog');
    expect(meaning('2WD road access')).toBe('CarFront');
    expect(meaning('Available night')).toBe('Check');
    expect(meaning('Booked night')).toBe('X');
    expect(meaning('Closed night')).toBe('Minus');
    expect(meaning('Not released yet')).toBe('Clock');
    expect(meaning('Unknown')).toBe('CircleQuestionMark');
  });
});
