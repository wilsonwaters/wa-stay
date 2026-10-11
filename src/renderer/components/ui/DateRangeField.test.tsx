import { createRef, useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DateRange } from './calendar';
import { DateRangeField } from './DateRangeField';

/** jsdom has no matchMedia: report a window of the given width. */
function setWindowWidth(width: number) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => {
      const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
      return {
        matches: width >= min,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      };
    },
  });
}

let latest: DateRange = {};

function Stay(props: { minDate?: string; maxNights?: number; initial?: DateRange }) {
  const [value, setValue] = useState<DateRange>(props.initial ?? {});
  latest = value;
  return (
    <DateRangeField
      value={value}
      onChange={setValue}
      minDate={props.minDate ?? '2030-10-01'}
      maxNights={props.maxNights}
    />
  );
}

const day = (name: string) => screen.getByRole('button', { name });
const openPicker = () => userEvent.click(screen.getByRole('button', { name: /^Dates/ }));

beforeEach(() => {
  latest = {};
  setWindowWidth(1024);
});

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe('DateRangeField', () => {
  it('keyboard flow: arrow to a date, Enter, arrow 2 days, Enter sets {arrival, departure} and "2 nights"', async () => {
    const user = userEvent.setup();
    render(<Stay />);
    expect(screen.getByRole('button', { name: 'Dates Add dates' })).toBeInTheDocument();
    await openPicker();
    const popover = screen.getByRole('dialog', { name: 'Choose dates' });
    // Focus starts on the first selectable day (minDate is after today).
    expect(day('Tuesday 1 October 2030')).toHaveFocus();

    await user.keyboard('{ArrowRight}{Enter}');
    expect(latest).toEqual({ arrival: '2030-10-02', departure: undefined });
    expect(day('Wednesday 2 October 2030, check-in')).toHaveFocus();

    await user.keyboard('{ArrowRight}{ArrowRight}{Enter}');
    expect(latest).toEqual({ arrival: '2030-10-02', departure: '2030-10-04' });
    expect(typeof latest.arrival).toBe('string');
    expect(within(popover).getByText('Wed 2 – Fri 4 Oct · 2 nights')).toBeInTheDocument();
    expect(day('Friday 4 October 2030, check-out')).toBeInTheDocument();

    await user.click(within(popover).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dates Wed 2 – Fri 4 Oct' })).toHaveFocus();
  });

  it('cannot choose dates before minDate', async () => {
    const user = userEvent.setup();
    render(<Stay minDate="2030-10-15" />);
    await openPicker();
    // Focus starts on minDate, and arrowing left from it stays there.
    expect(day('Tuesday 15 October 2030')).toHaveFocus();
    await user.keyboard('{ArrowLeft}{Enter}');
    expect(day('Tuesday 15 October 2030, check-in')).toHaveFocus();
    expect(latest).toEqual({ arrival: '2030-10-15', departure: undefined });

    // Earlier days are shown but disabled: clicking one changes nothing.
    const before = day('Monday 14 October 2030');
    expect(before).toHaveAttribute('aria-disabled', 'true');
    await user.click(before);
    expect(latest).toEqual({ arrival: '2030-10-15', departure: undefined });
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled();
  });

  it('navigates across the month boundary (31 Oct → 1 Nov), by week, page and Home/End', async () => {
    const user = userEvent.setup();
    setWindowWidth(500);
    render(<Stay initial={{ arrival: '2030-10-31' }} />);
    await openPicker();
    // One month below 640 px.
    expect(screen.getAllByRole('grid')).toHaveLength(1);
    expect(screen.getByRole('grid', { name: 'October 2030' })).toBeInTheDocument();
    expect(day('Thursday 31 October 2030, check-in')).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(day('Friday 1 November 2030')).toHaveFocus();
    expect(screen.getByRole('grid', { name: 'November 2030' })).toBeInTheDocument();
    await user.keyboard('{End}');
    expect(day('Sunday 3 November 2030')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(day('Monday 28 October 2030')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(day('Monday 4 November 2030')).toHaveFocus();
    await user.keyboard('{ArrowUp}{PageDown}');
    expect(day('Thursday 28 November 2030')).toHaveFocus();
    await user.keyboard('{PageUp}');
    expect(day('Monday 28 October 2030')).toHaveFocus();
  });

  it('counts every arrow press even when key repeat beats the focus move', async () => {
    render(<Stay />);
    await openPicker();
    const start = day('Tuesday 1 October 2030');
    // Both presses land on the day that had focus when the key went down.
    fireEvent.keyDown(start, { key: 'ArrowRight' });
    fireEvent.keyDown(start, { key: 'ArrowRight' });
    expect(day('Thursday 3 October 2030')).toHaveFocus();
  });

  it('shows two months at 640 px and wider, weeks starting on Monday', async () => {
    render(<Stay />);
    await openPicker();
    const grids = screen.getAllByRole('grid');
    expect(grids.map((g) => g.getAttribute('aria-labelledby') && g)).toHaveLength(2);
    expect(screen.getByRole('grid', { name: 'October 2030' })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'November 2030' })).toBeInTheDocument();
    const headers = within(grids[0]).getAllByRole('columnheader');
    expect(headers[0]).toHaveAttribute('abbr', 'Monday');
    expect(headers[6]).toHaveAttribute('abbr', 'Sunday');
  });

  it('a pick on or before the arrival restarts the range', async () => {
    const user = userEvent.setup();
    render(<Stay initial={{ arrival: '2030-10-16' }} />);
    await openPicker();
    await user.click(day('Monday 14 October 2030'));
    expect(latest).toEqual({ arrival: '2030-10-14', departure: undefined });
  });

  it('disables departures beyond maxNights and says why', async () => {
    const user = userEvent.setup();
    render(<Stay maxNights={3} initial={{ arrival: '2030-10-16' }} />);
    await openPicker();
    const tooFar = day('Sunday 20 October 2030');
    expect(tooFar).toHaveAttribute('aria-disabled', 'true');
    expect(tooFar).toHaveAccessibleDescription(
      'Stays can be up to 3 nights, so later dates are unavailable.'
    );
    expect(day('Saturday 19 October 2030')).not.toHaveAttribute('aria-disabled');
    await user.click(tooFar);
    expect(latest).toEqual({ arrival: '2030-10-16' });
  });

  it('Clear resets both values', async () => {
    const user = userEvent.setup();
    render(<Stay initial={{ arrival: '2030-10-02', departure: '2030-10-04' }} />);
    await openPicker();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(latest).toEqual({});
    expect(screen.getByText('Choose a check-in date')).toBeInTheDocument();
  });

  it('marks the chosen days as selected cells', async () => {
    render(<Stay initial={{ arrival: '2030-10-02', departure: '2030-10-04' }} />);
    await openPicker();
    expect(day('Wednesday 2 October 2030, check-in').closest('td')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(day('Thursday 3 October 2030').closest('td')).toHaveAttribute('aria-selected', 'true');
    expect(day('Saturday 5 October 2030').closest('td')).toHaveAttribute('aria-selected', 'false');
  });

  it('renders the segment appearance with its label and value in the name', () => {
    render(
      <DateRangeField
        appearance="segment"
        value={{ arrival: '2030-10-02', departure: '2030-10-04' }}
        onChange={jest.fn()}
      />
    );
    const trigger = screen.getByRole('button', { name: 'Dates Wed 2 – Fri 4 Oct' });
    expect(trigger).not.toHaveAttribute('aria-describedby');
    expect(trigger).not.toHaveAttribute('aria-invalid');
  });

  it('in a segment, surfaces its hint and error: described by both, invalid, error shown', () => {
    render(
      <DateRangeField
        appearance="segment"
        value={{ arrival: '2030-10-02' }}
        onChange={jest.fn()}
        hint="Up to 14 nights"
        error="Choose a check-out date"
      />
    );
    const trigger = screen.getByRole('button', { name: /^Dates/ });
    const ids = (trigger.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(document.getElementById(id)).toBeInTheDocument();
    expect(trigger).toHaveAccessibleDescription('Up to 14 nights Choose a check-out date');
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Choose a check-out date')).toBeVisible();
    // The name stays label + value; the hint and error are the description.
    expect(trigger).toHaveAccessibleName('Dates Wed 2 Oct – add check-out');
  });

  it('hands its trigger to triggerRef, so the calendar can be opened from elsewhere', async () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <DateRangeField appearance="segment" value={{}} onChange={jest.fn()} triggerRef={ref} />
    );
    expect(ref.current).toBe(screen.getByRole('button', { name: /^Dates/ }));
    act(() => ref.current?.click());
    expect(await screen.findByRole('dialog', { name: 'Choose dates' })).toBeInTheDocument();
  });
});
