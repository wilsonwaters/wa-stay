import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Clock } from 'lucide-react';
import { Notice } from './Notice';

describe('Notice', () => {
  it.each(['info', 'success', 'warning'] as const)('the %s tone is a status', (tone) => {
    render(<Notice tone={tone}>Saved</Notice>);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('the danger tone is an alert', () => {
    render(
      <Notice tone="danger" title="ParkStay didn't respond">
        Try again in a minute.
      </Notice>
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("ParkStay didn't respond");
    expect(alert).toHaveTextContent('Try again in a minute.');
    expect(alert.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('is dismissible when given onDismiss', async () => {
    const onDismiss = jest.fn();
    render(
      <Notice tone="info" onDismiss={onDismiss}>
        New: Explore
      </Notice>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('takes an icon that says it better than the tone, still decorative', () => {
    render(
      <Notice tone="warning" icon={Clock}>
        Bookings open 180 days ahead.
      </Notice>
    );
    const icon = screen.getByRole('status').querySelector('svg');
    expect(icon).toHaveClass('lucide-clock');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('is not dismissible by default', () => {
    render(<Notice>Heads up</Notice>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
