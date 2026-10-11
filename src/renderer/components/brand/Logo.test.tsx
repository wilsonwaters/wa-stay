import { render, screen } from '@testing-library/react';
import { Logo } from './Logo';

describe('Logo', () => {
  // Named Jest URL stubs (tests/utils/asset-urls/) keep the file name, so a swapped import fails.
  it.each([
    ['lockup', '/assets/brand/logo-lockup.svg'],
    ['mark', '/assets/brand/logo-mark.svg'],
  ] as const)('renders the %s as an image named "WA Stay" from %s', (variant, src) => {
    render(<Logo variant={variant} />);
    const logo = screen.getByRole('img', { name: 'WA Stay' });
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute('src', src);
  });

  it('names a link it sits in, with nothing else needed', () => {
    render(
      <a href="#/">
        <Logo variant="lockup" />
      </a>
    );
    expect(screen.getByRole('link')).toHaveAccessibleName('WA Stay');
  });

  it('is hidden from assistive technology when decorative', () => {
    const { container } = render(
      <h1>
        <Logo variant="mark" decorative />
        WA Stay
      </h1>
    );
    // Not in the accessibility tree, and it adds nothing to the heading's name.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName('WA Stay');
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('aria-hidden', 'true');
  });
});
