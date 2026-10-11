/**
 * The brushstroke generator (scripts/brand/brushstrokes.js) is the source of the committed
 * brush SVGs, so B1 can derive the logo from the same geometry.
 */
import fs from 'fs';
import path from 'path';
import { BRUSH_DIR, SPECS, generate, massCentre } from '../../scripts/brand/brushstrokes';
import { BRUSH_MASS_CENTRE } from '../../src/renderer/components/ui/Brushstroke';

const VARIANTS = ['underline', 'dab', 'swash'] as const;
const committed = (name: string) => fs.readFileSync(path.join(BRUSH_DIR, `${name}.svg`), 'utf8');

describe('brushstroke generator', () => {
  it('has a spec for every Brushstroke variant', () => {
    expect(Object.keys(SPECS).sort()).toEqual([...VARIANTS].sort());
  });

  it.each(VARIANTS)('reproduces the committed %s.svg byte for byte', (name) => {
    expect(generate(name)).toBe(committed(name));
  });

  it('is deterministic', () => {
    expect(generate('dab')).toBe(generate('dab'));
  });

  it.each(VARIANTS)('measures the %s paint centre that Brushstroke publishes', (name) => {
    const { x, y } = massCentre(committed(name));
    expect(x).toBeCloseTo(BRUSH_MASS_CENTRE[name].x, 2);
    expect(y).toBeCloseTo(BRUSH_MASS_CENTRE[name].y, 2);
  });

  it('finds the centre of a plain rectangle', () => {
    const square =
      '<svg viewBox="0 0 100 50"><path d="M10 10C10 10 30 10 30 10C30 10 30 40 30 40C30 40 10 40 10 40C10 40 10 10 10 10Z"/></svg>';
    const { x, y } = massCentre(square);
    expect(x).toBeCloseTo(0.2, 3);
    expect(y).toBeCloseTo(0.5, 3);
  });

  it('rejects an unknown stroke', () => {
    expect(() => generate('splat')).toThrow('Unknown brushstroke "splat"');
  });
});
