import { render, screen } from '@testing-library/react';
import { VisuallyHidden } from './VisuallyHidden';

describe('VisuallyHidden', () => {
  it('keeps text in the accessibility tree, for example as part of a name', () => {
    render(
      <button type="button">
        Bookings <VisuallyHidden>, coming soon</VisuallyHidden>
      </button>
    );
    expect(screen.getByRole('button')).toHaveAccessibleName('Bookings , coming soon');
  });
});
