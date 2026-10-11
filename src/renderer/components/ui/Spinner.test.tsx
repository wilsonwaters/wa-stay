import { render, screen } from '@testing-library/react';
import { Spinner } from './Spinner';

describe('Spinner', () => {
  it('is a status named "Loading" by default', () => {
    render(<Spinner />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('takes a visually hidden label', () => {
    render(<Spinner label="Loading watches" size="lg" />);
    const status = screen.getByRole('status', { name: 'Loading watches' });
    expect(status.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
