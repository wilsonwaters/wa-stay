import { render, screen, within } from '@testing-library/react';
import { House, MapPin, TentTree, Tractor } from 'lucide-react';
import { BRUSH_MASS_CENTRE } from './Brushstroke';
import { PhotoPlaceholder } from './PhotoPlaceholder';
import { KIND_ICONS, kindIcon } from './kindIcons';

/** The glyph geometry of a lucide icon, so tests can tell icons apart without class names. */
const glyph = (el: Element | null) => el?.innerHTML;
const glyphOf = (Icon: typeof House) => {
  const { container, unmount } = render(<Icon />, { container: document.createElement('div') });
  const result = glyph(container.querySelector('svg'));
  unmount();
  return result;
};

describe('PhotoPlaceholder', () => {
  it('exposes one image named by its aria-label', () => {
    render(<PhotoPlaceholder kind="campground" aria-label="No photo available for Lucky Bay" />);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(
      screen.getByRole('img', { name: 'No photo available for Lucky Bay' })
    ).toBeInTheDocument();
  });

  it('shows "No photo yet" and the icon for the location kind', () => {
    render(
      <PhotoPlaceholder kind="farm-stay" aria-label="No photo available for Wildflower Farm" />
    );
    const image = screen.getByRole('img', { name: 'No photo available for Wildflower Farm' });

    expect(within(image).getByText('No photo yet')).toBeInTheDocument();
    const svgs = Array.from(image.querySelectorAll('svg'));
    expect(svgs.map(glyph)).toContain(glyphOf(Tractor));
  });

  it('falls back to a map pin for a missing or unknown kind', () => {
    const { rerender } = render(<PhotoPlaceholder aria-label="No photo available for Somewhere" />);
    const pin = glyphOf(MapPin);
    expect(Array.from(screen.getByRole('img').querySelectorAll('svg')).map(glyph)).toContain(pin);

    rerender(
      <PhotoPlaceholder kind="space-station" aria-label="No photo available for Somewhere" />
    );
    expect(Array.from(screen.getByRole('img').querySelectorAll('svg')).map(glyph)).toContain(pin);
  });

  it("sits the kind icon on the dab's paint, not on the centre of its box", () => {
    render(<PhotoPlaceholder kind="campground" aria-label="No photo available for Lucky Bay" />);
    const tent = glyphOf(TentTree);
    const icon = Array.from(screen.getByRole('img').querySelectorAll('svg')).find(
      (svg) => glyph(svg) === tent
    );
    expect(icon).toHaveStyle({
      left: `${(BRUSH_MASS_CENTRE.dab.x * 100).toFixed(1)}%`,
      top: `${(BRUSH_MASS_CENTRE.dab.y * 100).toFixed(1)}%`,
    });
    expect(BRUSH_MASS_CENTRE.dab.x).toBeLessThan(0.5);
  });

  it('keeps the brush dab decorative', () => {
    render(
      <PhotoPlaceholder
        kind="campground"
        size="hero"
        aria-label="No photo available for Lucky Bay"
      />
    );
    const image = screen.getByRole('img');
    const svgs = Array.from(image.querySelectorAll('svg'));
    expect(svgs.length).toBeGreaterThanOrEqual(2);
    for (const svg of svgs) expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('kind icons', () => {
  it('maps every location kind from the provider contract to a lucide icon', () => {
    expect(Object.keys(KIND_ICONS).sort()).toEqual(
      [
        'cabin',
        'campground',
        'caravan-park',
        'farm-stay',
        'glamping',
        'holiday-park',
        'home',
        'hut',
        'other',
      ].sort()
    );
    expect(kindIcon('campground')).toBe(TentTree);
    expect(kindIcon('home')).toBe(House);
    expect(kindIcon(undefined)).toBe(MapPin);
  });
});
