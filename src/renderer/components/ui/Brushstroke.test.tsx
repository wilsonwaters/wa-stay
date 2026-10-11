import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import { BRUSH_TONE_TOKENS, Brushstroke, type BrushstrokeVariant } from './Brushstroke';

const brushFile = (variant: BrushstrokeVariant) =>
  fs.readFileSync(path.join(__dirname, '../../assets/brush', `${variant}.svg`), 'utf8');

const pathsIn = (svg: string) => Array.from(svg.matchAll(/<path[^>]*\sd="([^"]+)"/g), (m) => m[1]);

describe('Brushstroke', () => {
  it.each<BrushstrokeVariant>(['underline', 'dab', 'swash'])(
    'renders the original %s artwork from assets/brush',
    (variant) => {
      const file = brushFile(variant);
      const { container } = render(<Brushstroke variant={variant} />);
      const svg = container.querySelector('svg');

      expect(svg).not.toBeNull();
      expect(svg?.getAttribute('viewBox')).toBe(/viewBox="([^"]+)"/.exec(file)?.[1]);
      const rendered = Array.from(svg?.querySelectorAll('path') ?? [], (p) => p.getAttribute('d'));
      expect(rendered.length).toBeGreaterThan(1);
      expect(rendered).toEqual(pathsIn(file));
    }
  );

  it('gives each variant different artwork', () => {
    const [u, d, s] = (['underline', 'dab', 'swash'] as const).map((v) => pathsIn(brushFile(v))[0]);
    expect(new Set([u, d, s]).size).toBe(3);
  });

  it('is decorative: hidden from assistive technology and without an accessible name', () => {
    const { container } = render(
      <button type="button">
        Explore
        <Brushstroke variant="underline" />
      </button>
    );
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg).not.toHaveAttribute('role');
    expect(svg?.querySelector('title')).toBeNull();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('graphics-document')).not.toBeInTheDocument();
    // The stroke adds nothing to the name of the control it decorates.
    expect(screen.getByRole('button')).toHaveAccessibleName('Explore');
  });

  it('only paints in the allowed brush tones (ocean-500, ocean-100, sun-400, sun-100)', () => {
    expect(BRUSH_TONE_TOKENS).toEqual({
      ocean: 'ocean-500',
      'ocean-soft': 'ocean-100',
      sun: 'sun-400',
      'sun-soft': 'sun-100',
    });
  });
});
