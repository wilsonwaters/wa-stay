/**
 * @jest-environment node
 *
 * The brand SVGs (B1): present, generated, hygienic, and every concept swappable.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { BRAND_DIR, BRAND_SVGS, CONCEPTS_DIR, allBrandSvgFiles, read, rel } from './brand-files';
import * as logo from '../../../scripts/brand/logo';
import { checkXml } from '../../../scripts/generate-icons';

/** Everything an SVG must not contain to stay portable and font-independent. */
function hygieneProblems(svg: string): string[] {
  const problems: string[] = [];
  for (const el of ['text', 'image', 'filter', 'foreignObject', 'script', 'style']) {
    if (new RegExp(`<${el}[\\s>/]`, 'i').test(svg)) problems.push(`<${el}>`);
  }
  for (const m of svg.matchAll(/(?:xlink:)?href\s*=\s*"([^"]*)"/g)) {
    if (!m[1].startsWith('#')) problems.push(`external href ${m[1]}`);
  }
  if (/data:/i.test(svg)) problems.push('embedded data: URI');
  if (/url\(\s*['"]?(?!#)/i.test(svg)) problems.push('external url()');
  return problems;
}

const viewBoxOf = (svg: string) => /<svg[^>]*\sviewBox="([^"]+)"/.exec(svg)?.[1];

describe('brand SVGs', () => {
  it('resources/brand holds the six SVGs and a README', () => {
    for (const name of BRAND_SVGS) {
      expect(fs.existsSync(path.join(BRAND_DIR, name))).toBe(true);
    }
    expect(fs.existsSync(path.join(BRAND_DIR, 'README.md'))).toBe(true);
  });

  it.each(allBrandSvgFiles().map((f) => [rel(f), f]))(
    '%s has no text, image, filter, foreignObject, external href or data: URI',
    (_name, file) => {
      expect(hygieneProblems(read(file))).toEqual([]);
    }
  );

  it.each(allBrandSvgFiles().map((f) => [rel(f), f]))(
    '%s is well-formed XML on a whole-number viewBox, and librsvg opens it',
    async (_name, file) => {
      const svg = read(file);
      expect(() => checkXml(svg)).not.toThrow();
      const viewBox = viewBoxOf(svg);
      expect(viewBox).toMatch(/^0 0 \d+ \d+$/);
      const meta = await sharp(Buffer.from(svg)).metadata();
      expect(meta.format).toBe('svg');
      expect(`0 0 ${meta.width} ${meta.height}`).toBe(viewBox);
    }
  );

  it('the hygiene check catches each forbidden construct', () => {
    expect(hygieneProblems('<svg><text>WA</text></svg>')).toEqual(['<text>']);
    expect(hygieneProblems('<svg><image href="x.png"/></svg>')).toEqual([
      '<image>',
      'external href x.png',
    ]);
    expect(hygieneProblems('<svg><filter id="f"/><foreignObject/></svg>')).toEqual([
      '<filter>',
      '<foreignObject>',
    ]);
    expect(hygieneProblems('<svg><path fill="url(data:image/png;base64,AA)"/></svg>')).toEqual([
      'embedded data: URI',
      'external url()',
    ]);
    expect(hygieneProblems('<svg><use href="#a"/><path fill="url(#g)"/></svg>')).toEqual([]);
  });

  it('the small mark is at most three solid shapes on its plate, with no strokes', () => {
    const svg = read(path.join(BRAND_DIR, 'wa-stay-mark-small.svg'));
    expect(viewBoxOf(svg)).toBe('0 0 32 32');
    expect((svg.match(/<path\b/g) ?? []).length).toBeLessThanOrEqual(3);
    expect((svg.match(/<rect\b/g) ?? []).length).toBe(1); // the plate
    expect(svg).not.toMatch(/\sstroke(-width)?=/);
  });

  it('the readme banner is 1280 x 640 (the GitHub social preview size)', () => {
    expect(viewBoxOf(read(path.join(BRAND_DIR, 'readme-banner.svg')))).toBe('0 0 1280 640');
  });
});

describe('logo generator (scripts/brand/logo.js)', () => {
  it('ships one of its concepts', () => {
    expect(Object.keys(logo.CONCEPTS)).toContain(logo.CONCEPT);
    expect(Object.keys(logo.CONCEPTS).length).toBeGreaterThanOrEqual(3);
  });

  it('reproduces every committed brand SVG byte for byte (they are never hand-edited)', () => {
    for (const [name, svg] of Object.entries(logo.brandFiles())) {
      expect({ name, svg }).toEqual({ name, svg: read(path.join(BRAND_DIR, name)) });
    }
  });

  it('reproduces the committed concept review set', () => {
    const files = logo.conceptFiles();
    expect(Object.keys(files).length).toBe(3 * Object.keys(logo.CONCEPTS).length);
    for (const [name, svg] of Object.entries(files)) {
      expect({ name, svg }).toEqual({ name, svg: read(path.join(CONCEPTS_DIR, name)) });
    }
  });

  it.each(Object.keys(logo.CONCEPTS))(
    'builds a complete, clean brand set for the "%s" concept, so CONCEPT can be swapped',
    (id) => {
      const files = logo.brandFiles(id);
      expect(Object.keys(files).sort()).toEqual([...BRAND_SVGS].sort());
      for (const svg of Object.values(files)) {
        expect(hygieneProblems(svg)).toEqual([]);
        expect(() => checkXml(svg)).not.toThrow();
      }
      const small = files['wa-stay-mark-small.svg'];
      expect((small.match(/<path\b/g) ?? []).length).toBeLessThanOrEqual(3);
    }
  );

  it('centres the roofline mark on its roof apex, not on the brushstroke bounds', () => {
    // The chevron is the first path in each file, and its outline starts at the apex.
    const apexX = (svg: string) => Number(/<path\b[^>]*\sd="M(-?[\d.]+) /.exec(svg)?.[1]);
    const files = logo.brandFiles('roofline');
    expect(apexX(files['wa-stay-mark.svg'])).toBe(128);
    expect(apexX(files['wa-stay-mark-mono.svg'])).toBe(128);
    expect(apexX(files['wa-stay-mark-small.svg'])).toBe(16);
    expect(apexX(logo.installerArtboards('roofline').sidebar)).toBe(164 / 2);
  });

  it('rejects an unknown concept', () => {
    expect(() => logo.brandFiles('swan')).toThrow('Unknown concept "swan"');
  });

  it('is deterministic', () => {
    expect(logo.brandFiles()).toEqual(logo.brandFiles());
  });
});
