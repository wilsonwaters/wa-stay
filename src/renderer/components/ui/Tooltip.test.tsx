import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip, TOOLTIP_CLOSE_DELAY_MS, TOOLTIP_DELAY_MS } from './Tooltip';

function setup() {
  jest.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  render(
    <>
      <Tooltip content="Checks every 5 minutes">
        <button type="button">Watch</button>
      </Tooltip>
      <button type="button">Elsewhere</button>
    </>
  );
  return { user, trigger: screen.getByRole('button', { name: 'Watch' }) };
}

afterEach(() => {
  jest.useRealTimers();
});

describe('Tooltip', () => {
  it('describes its trigger with aria-describedby', () => {
    const { trigger } = setup();
    expect(trigger).toHaveAccessibleDescription('Checks every 5 minutes');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('opens on hover only after 400 ms, and closes on leave', async () => {
    const { user, trigger } = setup();
    await user.hover(trigger);
    act(() => {
      jest.advanceTimersByTime(TOOLTIP_DELAY_MS - 50);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(60);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Checks every 5 minutes');
    await user.unhover(trigger);
    act(() => {
      jest.advanceTimersByTime(TOOLTIP_CLOSE_DELAY_MS);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('is hoverable: moving the pointer onto the tooltip keeps it open (WCAG 1.4.13)', async () => {
    const { user, trigger } = setup();
    await user.hover(trigger);
    act(() => {
      jest.advanceTimersByTime(TOOLTIP_DELAY_MS);
    });
    const tooltip = screen.getByRole('tooltip');
    await user.hover(tooltip);
    act(() => {
      jest.advanceTimersByTime(TOOLTIP_CLOSE_DELAY_MS * 10);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    // Back onto the trigger, still open; then away from both, it closes.
    await user.hover(trigger);
    act(() => {
      jest.advanceTimersByTime(TOOLTIP_CLOSE_DELAY_MS * 10);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await user.hover(screen.getByRole('button', { name: 'Elsewhere' }));
    act(() => {
      jest.advanceTimersByTime(TOOLTIP_CLOSE_DELAY_MS);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('opens on focus at once, and closes on Escape and on blur', async () => {
    const { user } = setup();
    await user.tab();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    await user.tab({ shift: true });
    await user.tab();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await user.tab();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
