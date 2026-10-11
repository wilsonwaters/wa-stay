import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Stepper } from './Stepper';

function Vehicles({ initial = 1 }: { initial?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <Stepper
      label="Vehicles"
      hint="Including trailers"
      value={value}
      onChange={setValue}
      min={0}
      max={2}
    />
  );
}

describe('Stepper', () => {
  it('is a group named by its label, with the value in a polite output', () => {
    render(<Vehicles />);
    const group = screen.getByRole('group', { name: 'Vehicles' });
    expect(group).toHaveAccessibleDescription('Including trailers');
    const output = group.querySelector('output');
    expect(output).toHaveAttribute('aria-live', 'polite');
    expect(output).toHaveTextContent('1');
  });

  it('shows an error, read with the group, which is marked invalid and can take focus', () => {
    render(
      <Stepper
        label="Vehicles"
        hint="Including trailers"
        value={1}
        onChange={jest.fn()}
        error="At most 5"
      />
    );
    const group = screen.getByRole('group', { name: 'Vehicles' });
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group).toHaveAccessibleDescription('Including trailers At most 5');
    group.focus();
    expect(group).toHaveFocus();
  });

  it('is not invalid or focusable without an error', () => {
    render(<Vehicles />);
    const group = screen.getByRole('group', { name: 'Vehicles' });
    expect(group).not.toHaveAttribute('aria-invalid');
    expect(group).not.toHaveAttribute('tabindex');
  });

  it('respects min and max, disabling the button at each limit', async () => {
    const user = userEvent.setup();
    render(<Vehicles />);
    const decrease = screen.getByRole('button', { name: 'Decrease vehicles' });
    const increase = screen.getByRole('button', { name: 'Increase vehicles' });
    await user.click(increase);
    expect(screen.getByRole('group')).toHaveTextContent('2');
    expect(increase).toBeDisabled();
    // Focus moves to the other button rather than being lost on a disabled one.
    expect(decrease).toHaveFocus();
    await user.click(decrease);
    await user.click(decrease);
    expect(screen.getByRole('group')).toHaveTextContent('0');
    expect(decrease).toBeDisabled();
    expect(increase).toHaveFocus();
  });

  it('honours step', async () => {
    function Nights() {
      const [value, setValue] = useState(2);
      return <Stepper label="Nights" value={value} onChange={setValue} min={1} max={14} step={7} />;
    }
    render(<Nights />);
    await userEvent.click(screen.getByRole('button', { name: 'Increase nights' }));
    expect(screen.getByRole('group')).toHaveTextContent('9');
    await userEvent.click(screen.getByRole('button', { name: 'Increase nights' }));
    expect(screen.getByRole('group')).toHaveTextContent('14');
  });

  it('clamps a value from props outside the limits, with a dev warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<Vehicles initial={9} />);
    expect(screen.getByRole('group').querySelector('output')).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: 'Increase vehicles' })).toBeDisabled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('value 9 is outside 0–2'));
    warn.mockRestore();
  });
});
