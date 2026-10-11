import { useNow } from '../hooks/useNow';
import { countdownLabel, formatCountdown, type CountdownFormat } from './countdownFormat';
import { cx } from './ui/cx';

export interface CountdownProps {
  /** The instant counted down to: an ISO timestamp or a Date. */
  to: string | Date;
  /** `clock` (default): "4h 05m", "23:10"; `minutes`: "12 min". */
  format?: CountdownFormat;
  /**
   * The timer's accessible name from the time left in words ("2 days 4 hours"), e.g.
   * `(left) => \`Opens in ${left}\``. It changes at most once a minute while the visible text
   * ticks. Without it the timer is named by its text.
   */
  label?: (left: string) => string;
  className?: string;
}

/**
 * The time left until `to`, as a `role="timer"` (not a live region: changes are announced, if
 * at all, by whoever owns the countdown). Countdowns re-render from the shared `useNow`
 * tickers (one second for `clock`, one minute for `minutes`; stopped while the window is
 * hidden), and only this leaf re-renders on each tick. Never negative. A `label` names it in
 * words, minute by minute.
 */
export function Countdown({ to, format = 'clock', label, className }: CountdownProps) {
  // A minute-only countdown changes once a minute: tick with the minute clock.
  const now = useNow(format === 'minutes' ? 60_000 : 1000);
  const target = typeof to === 'string' ? Date.parse(to) : to.getTime();
  return (
    <span
      role="timer"
      aria-label={label?.(countdownLabel(target - now.getTime()))}
      className={cx('tabular-nums', className)}
    >
      {formatCountdown(target - now.getTime(), format)}
    </span>
  );
}

export default Countdown;
