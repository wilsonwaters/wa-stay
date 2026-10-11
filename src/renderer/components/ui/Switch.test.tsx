import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switch } from './Switch';

describe('Switch', () => {
  it('is a native checkbox with role="switch", named by its label', async () => {
    const onChange = jest.fn();
    render(
      <Switch
        label="Desktop notifications"
        description="Shown when a watch finds a site"
        onChange={onChange}
      />
    );
    const toggle = screen.getByRole('switch', { name: 'Desktop notifications' });
    expect(toggle.tagName).toBe('INPUT');
    expect(toggle).toHaveAttribute('type', 'checkbox');
    expect(toggle).toHaveAccessibleDescription('Shown when a watch finds a site');
    expect(toggle).not.toBeChecked();

    await userEvent.click(toggle);
    expect(toggle).toBeChecked();
    await userEvent.keyboard(' ');
    expect(toggle).not.toBeChecked();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('can start on and be disabled', () => {
    render(<Switch label="Start minimised" defaultChecked disabled />);
    const toggle = screen.getByRole('switch', { name: 'Start minimised' });
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
  });
});
