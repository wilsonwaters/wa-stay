import { createRef, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChevronDown } from 'lucide-react';
import { Chip } from './Chip';
import { Popover } from './Popover';

describe('Chip', () => {
  it('is a button named by its text, and never submits a form', async () => {
    const onSubmit = jest.fn((e) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Chip>Region</Chip>
      </form>
    );
    const chip = screen.getByRole('button', { name: 'Region' });
    expect(chip).not.toHaveAttribute('aria-pressed');
    await userEvent.click(chip);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('is an on/off toggle with `pressed`, and shows a decorative tick while on', async () => {
    function Toggle() {
      const [on, setOn] = useState(false);
      return (
        <Chip pressed={on} onClick={() => setOn(!on)}>
          Book online
        </Chip>
      );
    }
    render(<Toggle />);
    const chip = screen.getByRole('button', { name: 'Book online' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(chip.querySelector('svg')).toBeNull();
    await userEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(chip.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    // The tick does not change the name.
    expect(screen.getByRole('button', { name: 'Book online' })).toBe(chip);
  });

  it('opens a Popover as its trigger, and focus returns to it on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Popover
        label="Region"
        trigger={
          <Chip selected aria-label="Region, 1 selected" trailingIcon={<ChevronDown />}>
            Region · 1
          </Chip>
        }
      >
        <button type="button">Pilbara</button>
      </Popover>
    );
    const chip = screen.getByRole('button', { name: 'Region, 1 selected' });
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Region' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect(chip).toHaveFocus();
  });

  it('forwards its ref and can be disabled', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Chip ref={ref} disabled>
        Type
      </Chip>
    );
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Type' }));
    expect(ref.current).toBeDisabled();
  });

  it('stays focusable but ignores presses while aria-disabled, so a tooltip can say why', async () => {
    const onClick = jest.fn();
    const user = userEvent.setup();
    render(
      <Chip pressed={false} aria-disabled onClick={onClick}>
        Available only
      </Chip>
    );
    const chip = screen.getByRole('button', { name: 'Available only' });
    await user.tab();
    expect(chip).toHaveFocus();
    await user.click(chip);
    await user.keyboard('{Enter}');
    expect(onClick).not.toHaveBeenCalled();
    expect(chip).toHaveAttribute('aria-disabled', 'true');
    expect(chip).toHaveAttribute('aria-pressed', 'false');
  });
});
