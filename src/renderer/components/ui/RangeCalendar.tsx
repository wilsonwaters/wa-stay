import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from './IconButton';
import {
  addDaysIso,
  addMonthsIso,
  choosingDeparture,
  clampIso,
  dayLabel,
  endOfWeekIso,
  isDayDisabled,
  isInRange,
  monthGrid,
  monthLabel,
  pickDate,
  startOfMonthIso,
  startOfWeekIso,
  todayIso,
  type DateRange,
  type IsoDate,
} from './calendar';
import { cx } from './cx';

const WEEKDAYS: [string, string][] = [
  ['Mo', 'Monday'],
  ['Tu', 'Tuesday'],
  ['We', 'Wednesday'],
  ['Th', 'Thursday'],
  ['Fr', 'Friday'],
  ['Sa', 'Saturday'],
  ['Su', 'Sunday'],
];

export interface RangeCalendarProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  minDate?: IsoDate;
  maxDate?: IsoDate;
  maxNights?: number;
  /** Months side by side. DateRangeField shows 2 at 640 px and wider, 1 below. */
  months?: 1 | 2;
  /** Focus the current day on mount, as inside a popover. */
  autoFocus?: boolean;
  /** Described-by id for days disabled by `maxNights` (the hint that explains why). */
  maxNightsHintId?: string;
}

/**
 * A range-picking calendar following the WAI-ARIA date picker grid: ←/→ day, ↑/↓ week,
 * PgUp/PgDn month, Home/End start and end of the week (Monday to Sunday). The first pick sets
 * the arrival and the second the departure; a pick on or before the arrival starts again.
 */
export function RangeCalendar({
  value,
  onChange,
  minDate,
  maxDate,
  maxNights,
  months = 2,
  autoFocus,
  maxNightsHintId,
}: RangeCalendarProps) {
  const id = useId();
  const rules = { minDate, maxDate, maxNights };
  const [focused, setFocusedState] = useState<IsoDate>(() =>
    clampIso(value.arrival ?? todayIso(), minDate, maxDate)
  );
  const [view, setView] = useState<IsoDate>(() => startOfMonthIso(focused));
  // Key repeat can deliver the next arrow before DOM focus has moved, so moves start from
  // this ref, not from the event target.
  const focusedRef = useRef(focused);
  const setFocused = (date: IsoDate) => {
    focusedRef.current = date;
    setFocusedState(date);
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const focusPending = useRef(Boolean(autoFocus));

  const visibleMonths = Array.from({ length: months }, (_, i) => addMonthsIso(view, i));
  const lastVisible = visibleMonths[visibleMonths.length - 1];
  const isVisible = (date: IsoDate) =>
    startOfMonthIso(date) >= view && startOfMonthIso(date) <= lastVisible;
  // The roving tab stop: the focused day if it is on screen, else the first day shown.
  const tabStop = isVisible(focused) ? focused : clampIso(view, minDate, maxDate);

  useLayoutEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-date="${tabStop}"]`)?.focus();
  });

  const moveFocus = (next: IsoDate) => {
    const date = clampIso(next, minDate, maxDate);
    const month = startOfMonthIso(date);
    setView((current) => {
      const last = addMonthsIso(current, months - 1);
      if (month < current) return month;
      if (month > last) return addMonthsIso(month, -(months - 1));
      return current;
    });
    setFocused(date);
    focusPending.current = true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target as HTMLElement).dataset.date) return;
    const date = focusedRef.current;
    const next: Record<string, () => IsoDate> = {
      ArrowLeft: () => addDaysIso(date, -1),
      ArrowRight: () => addDaysIso(date, 1),
      ArrowUp: () => addDaysIso(date, -7),
      ArrowDown: () => addDaysIso(date, 7),
      PageUp: () => addMonthsIso(date, -1),
      PageDown: () => addMonthsIso(date, 1),
      Home: () => startOfWeekIso(date),
      End: () => endOfWeekIso(date),
    };
    const to = next[event.key];
    if (!to) return;
    event.preventDefault();
    moveFocus(to());
  };

  const pick = (date: IsoDate) => {
    setFocused(date);
    if (isDayDisabled(date, value, rules)) return;
    onChange(pickDate(value, date));
  };

  const shiftView = (by: number) => {
    const next = addMonthsIso(view, by);
    setView(next);
    setFocused(clampIso(addMonthsIso(focused, by), minDate, maxDate));
    // The pressed button disables at a limit; keep focus on the other one.
    if (by > 0 && maxDate && addMonthsIso(next, months - 1) >= startOfMonthIso(maxDate)) {
      previousRef.current?.focus();
    }
    if (by < 0 && minDate && next <= startOfMonthIso(minDate)) nextRef.current?.focus();
  };

  const today = todayIso();
  const canGoBack = !minDate || view > startOfMonthIso(minDate);
  const canGoForward = !maxDate || lastVisible < startOfMonthIso(maxDate);
  const pickingDeparture = choosingDeparture(value);

  return (
    <div ref={rootRef} onKeyDown={onKeyDown} className="relative">
      <div className="absolute inset-x-0 top-0 flex justify-between">
        <IconButton
          ref={previousRef}
          label="Previous month"
          icon={<ChevronLeft />}
          size="sm"
          onClick={() => shiftView(-1)}
          disabled={!canGoBack}
        />
        <IconButton
          ref={nextRef}
          label="Next month"
          icon={<ChevronRight />}
          size="sm"
          onClick={() => shiftView(1)}
          disabled={!canGoForward}
        />
      </div>
      <div className={cx('grid gap-8', months === 2 && 'grid-cols-2')}>
        {visibleMonths.map((month) => {
          const headingId = `${id}-${month}`;
          return (
            <div key={month}>
              <h3
                id={headingId}
                className="flex h-8 items-center justify-center text-sm font-semibold text-fg"
              >
                {monthLabel(month)}
              </h3>
              <table role="grid" aria-labelledby={headingId} className="mt-3 border-collapse">
                <thead>
                  <tr>
                    {WEEKDAYS.map(([short, long]) => (
                      <th
                        key={short}
                        scope="col"
                        abbr={long}
                        className="h-8 w-10 text-xs font-medium text-fg-muted"
                      >
                        {short}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {monthGrid(month).map((week, row) => (
                    <tr key={row}>
                      {week.map((date, col) => {
                        if (!date) return <td key={col} className="h-10 w-10" />;
                        const disabled = isDayDisabled(date, value, rules);
                        const end = date === value.arrival || date === value.departure;
                        const between = isInRange(date, value);
                        // The stay is one band from arrival to departure, rounded where a
                        // week row or the month breaks it; the endpoints sit on it as circles.
                        const rowStart = col === 0 || !week[col - 1];
                        const rowEnd = col === week.length - 1 || !week[col + 1];
                        const bandFrom = date === value.departure && !rowStart;
                        const bandTo =
                          date === value.arrival && Boolean(value.departure) && !rowEnd;
                        const byMaxNights =
                          disabled &&
                          pickingDeparture &&
                          maxNights !== undefined &&
                          !(minDate && date < minDate) &&
                          !(maxDate && date > maxDate);
                        return (
                          <td
                            key={date}
                            aria-selected={end || between}
                            className="relative h-10 w-10 p-0"
                          >
                            {(between || bandFrom || bandTo) && (
                              <span
                                aria-hidden="true"
                                className={cx(
                                  'absolute inset-y-0 bg-surface-subtle',
                                  between && 'inset-x-0',
                                  between && rowStart && 'rounded-l-full',
                                  between && rowEnd && 'rounded-r-full',
                                  bandFrom && 'left-0 right-1/2',
                                  bandTo && 'left-1/2 right-0'
                                )}
                              />
                            )}
                            <button
                              type="button"
                              data-date={date}
                              tabIndex={date === tabStop ? 0 : -1}
                              aria-label={dayLabel(date, value)}
                              aria-disabled={disabled || undefined}
                              aria-current={date === today ? 'date' : undefined}
                              aria-describedby={byMaxNights ? maxNightsHintId : undefined}
                              onClick={() => pick(date)}
                              onFocus={() => {
                                // Focus that arrives by Tab or pointer becomes the move origin.
                                if (!focusPending.current) focusedRef.current = date;
                              }}
                              className={cx(
                                'relative h-10 w-10 rounded-full text-sm tabular-nums transition-colors duration-fast ease-standard',
                                end
                                  ? 'bg-surface-inverse font-semibold text-fg-inverse'
                                  : disabled
                                    ? 'cursor-not-allowed text-fg-muted line-through'
                                    : between
                                      ? 'text-fg hover:ring-1 hover:ring-inset hover:ring-fg'
                                      : 'text-fg hover:bg-surface-subtle',
                                date === today &&
                                  !end &&
                                  'font-semibold underline underline-offset-4'
                              )}
                            >
                              {Number(date.slice(8))}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default RangeCalendar;
