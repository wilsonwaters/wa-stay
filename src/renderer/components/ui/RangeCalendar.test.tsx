import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DateRange } from './calendar';
import { RangeCalendar } from './RangeCalendar';

function Standalone({ months = 1 as 1 | 2 }) {
  const [value, setValue] = useState<DateRange>({ arrival: '2030-10-30' });
  return (
    <>
      <RangeCalendar
        value={value}
        onChange={setValue}
        minDate="2030-10-01"
        maxDate="2030-12-31"
        months={months}
      />
      <p>
        {value.arrival} to {value.departure ?? 'unset'}
      </p>
    </>
  );
}

describe('RangeCalendar', () => {
  it('works on its own: a labelled grid per month, a single tab stop, picking by click', async () => {
    render(<Standalone />);
    expect(screen.getByRole('grid', { name: 'October 2030' })).toBeInTheDocument();
    const tabStops = screen
      .getAllByRole('button')
      .filter((b) => b.dataset.date && b.getAttribute('tabindex') === '0');
    expect(tabStops.map((b) => b.dataset.date)).toEqual(['2030-10-30']);

    await userEvent.click(screen.getByRole('button', { name: 'Thursday 31 October 2030' }));
    expect(screen.getByText('2030-10-30 to 2030-10-31')).toBeInTheDocument();
  });

  it('pages months with the previous and next buttons, within minDate and maxDate', async () => {
    const user = userEvent.setup();
    render(<Standalone />);
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('grid', { name: 'November 2030' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('grid', { name: 'December 2030' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
    // Focus is not lost on the now-disabled button: it moves to Previous month.
    expect(screen.getByRole('button', { name: 'Previous month' })).toHaveFocus();
    // The day tab stop follows the visible month: Tab lands on 30 Dec.
    await user.tab();
    expect(document.activeElement).toHaveAttribute('data-date', '2030-12-30');
  });

  it('cannot move focus past maxDate', async () => {
    const user = userEvent.setup();
    render(<Standalone months={2} />);
    screen.getByRole('button', { name: 'Wednesday 30 October 2030, check-in' }).focus();
    await user.keyboard('{PageDown}{PageDown}{PageDown}');
    expect(document.activeElement).toHaveAttribute('data-date', '2030-12-31');
    expect(screen.getByRole('grid', { name: 'December 2030' })).toBeInTheDocument();
  });
});
