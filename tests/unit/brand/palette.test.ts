/**
 * @jest-environment node
 *
 * Brand colours come only from the D1 palette in tokens.css (`--ws-<name>: R G B;`), and the
 * mono variants carry no colour of their own. If a token changes, this fails until
 * `npm run icons` regenerates the artwork.
 */
import fs from 'fs';
import path from 'path';
import { BRAND_DIR, TOKENS_CSS, allBrandSvgFiles, isMono, read, rel } from './brand-files';
import { readPalette } from '../../../scripts/brand/logo';

/** Every RGB triple tokens.css defines, as "R G B". */
function paletteTriples(css: string): Set<string> {
  return new Set(
    Array.from(css.matchAll(/--ws-[a-z0-9-]+:\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g), (m) =>
      [m[1], m[2], m[3]].map(Number).join(' ')
    )
  );
}

function hexToTriple(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).join(' ');
}

/** Every value given to fill, stroke, stop-color or color, as attribute or style property. */
function paints(svg: string): string[] {
  return Array.from(
    svg.matchAll(/(?:^|[\s;"'])(?:fill|stroke|stop-color|color)\s*(?:=\s*"|:\s*)([^";]+)/g),
    (m) => m[1].trim()
  );
}

const PALETTE = paletteTriples(fs.readFileSync(TOKENS_CSS, 'utf8'));
const colourFiles = allBrandSvgFiles().filter((f) => !isMono(f));
const monoFiles = allBrandSvgFiles().filter(isMono);

describe('brand palette', () => {
  it('finds the mono and colour files it is meant to check', () => {
    expect(monoFiles.map((f) => path.basename(f)).sort()).toEqual([
      'logo-mark-mono.svg',
      'wa-stay-lockup-mono.svg',
      'wa-stay-mark-mono.svg',
    ]);
    expect(colourFiles.length).toBeGreaterThanOrEqual(15);
  });

  it.each(colourFiles.map((f) => [rel(f), f]))(
    '%s paints only with D1 palette colours',
    (_name, file) => {
      const values = paints(read(file));
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        expect(value).toMatch(/^#[0-9A-Fa-f]{6}$|^none$/);
        if (value !== 'none') expect(PALETTE.has(hexToTriple(value))).toBe(true);
      }
    }
  );

  it.each(monoFiles.map((f) => [rel(f), f]))('%s uses only currentColor or none', (_name, file) => {
    const svg = read(file);
    const values = paints(svg);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).toMatch(/^(currentColor|none)$/);
    expect(svg).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
  });

  it('reads hex from token triples the same way the generator does', () => {
    const palette = readPalette();
    expect(palette['ocean-500']).toBe('#3A74B8');
    expect(palette['sun-400']).toBe('#E8B858');
    expect(palette['coral-400']).toBe('#D05830');
    expect(hexToTriple(palette['ink-900'])).toBe('21 24 29');
  });

  it('rejects a colour that is not in the palette', () => {
    expect(PALETTE.has(hexToTriple('#1C8CC8'))).toBe(false);
    expect(paints('<path fill="#3A74B8" style="stroke: red"/>')).toEqual(['#3A74B8', 'red']);
  });

  it('uses coral at most once, as one small accent, in the shipped mark and lockup', () => {
    const palette = readPalette();
    for (const name of ['wa-stay-mark.svg', 'wa-stay-lockup.svg']) {
      const svg = read(path.join(BRAND_DIR, name));
      for (const t of ['coral-50', 'coral-600', 'coral-700']) expect(svg).not.toContain(palette[t]);
      const coral = Array.from(
        svg.matchAll(new RegExp(`fill="${palette['coral-400']}" d="([^"]+)"`, 'g')),
        (m) => m[1]
      );
      if (coral.length === 0) continue;
      // All coral paint sits in one small region: one brush pull, not scattered marks.
      const nums = coral.flatMap((d) => (d.match(/-?\d*\.?\d+/g) ?? []).map(Number));
      const xs = nums.filter((_, i) => i % 2 === 0);
      const ys = nums.filter((_, i) => i % 2 === 1);
      const [w, h] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)!.slice(1).map(Number);
      expect((Math.max(...xs) - Math.min(...xs)) / w).toBeLessThan(0.25);
      expect((Math.max(...ys) - Math.min(...ys)) / h).toBeLessThan(0.15);
    }
  });
});
