import { render, screen, within } from '@testing-library/react';
import { SnipeStatus } from '../../../../shared/types/common.types';
import { makeHeldSnipe, makeSnipe } from '@tests/fixtures/renderer/snipes';
import { SnipeTimeline } from './SnipeTimeline';

const items = () => within(screen.getByRole('list', { name: 'Progress' })).getAllByRole('listitem');

describe('SnipeTimeline', () => {
  it('is an ordered list with the current step marked, each state in words', () => {
    render(
      <SnipeTimeline snipe={makeSnipe({ status: SnipeStatus.SNIPING, accessGateEnabled: true })} />
    );
    const list = screen.getByRole('list', { name: 'Progress' });
    expect(list.tagName).toBe('OL');
    expect(items().map((li) => li.textContent)).toEqual([
      'ArmedDonedone',
      'QueueingDonedone',
      'Waiting for releaseDonedone',
      'SnipingNowcurrent step',
      'HeldNot yetnot yet',
      'BookedNot yetnot yet',
    ]);
    expect(items()[3]).toHaveAttribute('aria-current', 'step');
    expect(items().filter((li) => li.hasAttribute('aria-current'))).toHaveLength(1);
  });

  it('leaves the queue out when the snipe does not use it', () => {
    render(<SnipeTimeline snipe={makeHeldSnipe()} />);
    expect(items().map((li) => li.textContent)).toEqual([
      'ArmedDonedone',
      'Waiting for releaseDonedone',
      'SnipingDonedone',
      'HeldNowcurrent step',
      'BookedNot yetnot yet',
    ]);
  });

  it('ends a failed snipe on a terminal step', () => {
    render(<SnipeTimeline snipe={makeSnipe({ status: SnipeStatus.FAILED, isActive: false })} />);
    const last = items().at(-1);
    expect(last).toHaveTextContent('FailedNow');
    expect(last).toHaveAttribute('aria-current', 'step');
    expect(items()[1]).toHaveTextContent('Waiting for releaseNot reachednot reached');
  });

  it('counts the same steps in every state: a hold is step 4 of 5, a booking step 5 of 5', () => {
    const { rerender } = render(<SnipeTimeline snipe={makeSnipe()} compact />);
    expect(screen.getByText('Step 1 of 5: Armed')).toBeInTheDocument();
    rerender(<SnipeTimeline snipe={makeHeldSnipe()} compact />);
    expect(screen.getByText('Step 4 of 5: Held')).toBeInTheDocument();
    rerender(
      <SnipeTimeline
        snipe={makeHeldSnipe(10, { status: SnipeStatus.BOOKED, bookedReference: 'PB123' })}
        compact
      />
    );
    expect(screen.getByText('Step 5 of 5: Booked')).toBeInTheDocument();
  });

  it('shows a card only where the snipe is', () => {
    const { rerender } = render(<SnipeTimeline snipe={makeHeldSnipe()} compact />);
    expect(screen.getByText('Step 4 of 5: Held')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
    rerender(<SnipeTimeline snipe={makeSnipe({ status: SnipeStatus.FAILED })} compact />);
    expect(screen.getByText('Stopped: Failed')).toBeInTheDocument();
    rerender(
      <SnipeTimeline snipe={makeSnipe({ status: SnipeStatus.DISABLED, isActive: false })} compact />
    );
    expect(screen.getByText('Not running')).toBeInTheDocument();
  });
});
