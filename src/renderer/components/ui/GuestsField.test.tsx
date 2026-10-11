import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GuestsField, guestsSummary, type Guests } from './GuestsField';

let latest: Guests | undefined;

function Party({ initial }: { initial?: Guests }) {
  const [value, setValue] = useState<Guests | undefined>(initial);
  latest = value;
  return <GuestsField value={value} onChange={setValue} />;
}

describe('GuestsField', () => {
  it('reads "Add guests" until chosen; "Increase adults" increments; "Decrease adults" is disabled at 1', async () => {
    const user = userEvent.setup();
    render(<Party />);
    await user.click(screen.getByRole('button', { name: 'Guests Add guests' }));
    const popover = screen.getByRole('dialog', { name: 'Choose guests' });
    const decrease = within(popover).getByRole('button', { name: 'Decrease adults' });
    expect(decrease).toBeDisabled();

    await user.click(within(popover).getByRole('button', { name: 'Increase adults' }));
    expect(latest).toEqual({ adults: 2, children: 0, infants: 0 });
    expect(decrease).toBeEnabled();
    await user.click(within(popover).getByRole('button', { name: 'Increase children' }));
    expect(screen.getByRole('button', { name: 'Guests 2 adults, 1 child' })).toBeInTheDocument();

    await user.click(decrease);
    expect(latest?.adults).toBe(1);
    expect(decrease).toBeDisabled();
  });

  it('shows the default hints for each age group', async () => {
    render(<Party initial={{ adults: 2, children: 0, infants: 1 }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Guests 2 adults, 1 infant' }));
    expect(screen.getByRole('group', { name: 'Adults' })).toHaveAccessibleDescription('18 or over');
    expect(screen.getByRole('group', { name: 'Children' })).toHaveAccessibleDescription('6–17');
    expect(screen.getByRole('group', { name: 'Infants' })).toHaveAccessibleDescription('Under 6');
  });

  it('caps each age group at its limit (adults 16)', async () => {
    const user = userEvent.setup();
    render(<Party initial={{ adults: 15, children: 0, infants: 0 }} />);
    await user.click(screen.getByRole('button', { name: /^Guests/ }));
    const increase = screen.getByRole('button', { name: 'Increase adults' });
    await user.click(increase);
    expect(latest?.adults).toBe(16);
    expect(increase).toBeDisabled();
  });

  it('in a segment, surfaces its error: described by it, invalid, error shown', () => {
    const { rerender } = render(<GuestsField appearance="segment" onChange={jest.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Guests Add guests' });
    expect(trigger).not.toHaveAttribute('aria-describedby');
    expect(trigger).not.toHaveAttribute('aria-invalid');

    rerender(
      <GuestsField appearance="segment" onChange={jest.fn()} error="Add at least one adult" />
    );
    const id = trigger.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(id)).toBeInTheDocument();
    expect(trigger).toHaveAccessibleDescription('Add at least one adult');
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    expect(trigger).toHaveAccessibleName('Guests Add guests');
    expect(screen.getByText('Add at least one adult')).toBeVisible();
  });

  it('summarises guests with singular and plural words', () => {
    expect(guestsSummary(undefined)).toBeUndefined();
    expect(guestsSummary({ adults: 1, children: 0, infants: 0 })).toBe('1 adult');
    expect(guestsSummary({ adults: 2, children: 3, infants: 2 })).toBe(
      '2 adults, 3 children, 2 infants'
    );
  });
});
