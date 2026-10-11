import { act, render, screen } from '@testing-library/react';
import { Countdown } from './Countdown';
import { countdownLabel, formatCountdown } from './countdownFormat';

const MINUTE = 60_000;

describe('formatCountdown', () => {
  it('clock: days and hours, hours and minutes, then minutes and seconds', () => {
    expect(formatCountdown(2 * 86_400_000 + 4 * 3_600_000 + 5 * MINUTE)).toBe('2d 4h');
    expect(formatCountdown(4 * 3_600_000 + 5 * MINUTE + 30_000)).toBe('4h 05m');
    expect(formatCountdown(23 * MINUTE + 10_000)).toBe('23:10');
    expect(formatCountdown(999)).toBe('00:01');
    // The last half second of the hour rounds up to the hour, never "60:00".
    expect(formatCountdown(3_599_500)).toBe('1h 00m');
    expect(formatCountdown(3_599_000)).toBe('59:59');
    expect(formatCountdown(86_399_500)).toBe('1d 0h');
  });

  it('minutes: rounded up, with hours past the hour', () => {
    expect(formatCountdown(12 * MINUTE, 'minutes')).toBe('12 min');
    expect(formatCountdown(11 * MINUTE + 1, 'minutes')).toBe('12 min');
    expect(formatCountdown(20_000, 'minutes')).toBe('1 min');
    expect(formatCountdown(65 * MINUTE, 'minutes')).toBe('1 h 05 min');
  });

  it('never goes negative', () => {
    expect(formatCountdown(-5000)).toBe('now');
    expect(formatCountdown(0)).toBe('now');
    expect(formatCountdown(-5000, 'minutes')).toBe('0 min');
    expect(formatCountdown(Number.NaN, 'minutes')).toBe('0 min');
  });
});

describe('Countdown', () => {
  afterEach(() => jest.useRealTimers());

  it('is a timer that counts down from the shared ticker and stops at zero', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-09T07:00:00Z'));
    const { unmount } = render(<Countdown to="2026-10-09T07:12:00Z" format="minutes" />);
    const timer = screen.getByRole('timer');
    expect(timer).toHaveTextContent('12 min');
    expect(timer).not.toHaveAttribute('aria-live');

    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(timer).toHaveTextContent('11 min');

    act(() => {
      jest.advanceTimersByTime(20 * 60_000);
    });
    expect(timer).toHaveTextContent('0 min');

    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
  it('names the timer in words that change at most once a minute', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-09T07:00:00Z'));
    const { unmount } = render(
      <Countdown to="2026-10-11T11:00:00Z" label={(left) => `Opens in ${left}`} />
    );
    expect(screen.getByRole('timer', { name: 'Opens in 2 days 4 hours' })).toHaveTextContent(
      '2d 4h'
    );
    unmount();

    render(<Countdown to="2026-10-09T07:12:00Z" label={(left) => `Pay within ${left}`} />);
    const timer = screen.getByRole('timer', { name: 'Pay within 12 minutes' });
    let names = 0;
    let texts = 0;
    for (let s = 0; s < 120; s += 1) {
      const [name, text] = [timer.getAttribute('aria-label'), timer.textContent];
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      if (timer.getAttribute('aria-label') !== name) names += 1;
      if (timer.textContent !== text) texts += 1;
    }
    expect(texts).toBe(120);
    expect(names).toBe(2);
    expect(timer).toHaveAccessibleName('Pay within 10 minutes');
  });
});

describe('countdownLabel', () => {
  it('reads days and hours, hours and minutes, or minutes, rounded up to the minute', () => {
    expect(countdownLabel(2 * 86_400_000 + 4 * 3_600_000)).toBe('2 days 4 hours');
    expect(countdownLabel(86_400_000)).toBe('1 day');
    expect(countdownLabel(4 * 3_600_000 + 5 * MINUTE)).toBe('4 hours 5 minutes');
    expect(countdownLabel(3_600_000)).toBe('1 hour');
    expect(countdownLabel(11 * MINUTE + 1)).toBe('12 minutes');
    expect(countdownLabel(1000)).toBe('1 minute');
    expect(countdownLabel(-1)).toBe('now');
  });
});
