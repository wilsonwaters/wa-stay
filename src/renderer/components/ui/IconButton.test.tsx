import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';

describe('IconButton', () => {
  it('uses label as its accessible name', () => {
    render(<IconButton label="Close" icon={<X />} />);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('aria-label', 'Close');
  });

  it('shows a tooltip with the same text on focus, without describing the button with it', async () => {
    render(<IconButton label="Dismiss notification" icon={<X />} />);
    await userEvent.tab();
    const button = screen.getByRole('button', { name: 'Dismiss notification' });
    expect(button).toHaveFocus();
    // The tooltip repeats the name, so it is hidden from assistive technology.
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('Dismiss notification');
    expect(button).not.toHaveAttribute('aria-describedby');
    expect(button).toHaveAccessibleDescription('');
  });

  it('passes clicks and disabled through to the button', async () => {
    const onClick = jest.fn();
    const { rerender } = render(<IconButton label="Remove" icon={<X />} onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<IconButton label="Remove" icon={<X />} onClick={onClick} disabled />);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
  });
});
