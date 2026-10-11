import { render, screen } from '@testing-library/react';
import { Card } from './Card';

describe('Card', () => {
  it('renders as a div by default and as the element given by `as`', () => {
    const { container } = render(<Card>Plain</Card>);
    expect(container.firstElementChild?.tagName).toBe('DIV');
    render(
      <Card as="article" aria-label="Lucky Bay">
        Campground
      </Card>
    );
    expect(screen.getByRole('article', { name: 'Lucky Bay' })).toHaveTextContent('Campground');
  });

  it('can be an interactive link, focusable like any link', () => {
    render(
      <Card as="a" href="#/places/parkstay/1" interactive>
        Lucky Bay
      </Card>
    );
    const link = screen.getByRole('link', { name: 'Lucky Bay' });
    link.focus();
    expect(link).toHaveFocus();
    expect(link).toHaveAttribute('href', '#/places/parkstay/1');
  });
});
