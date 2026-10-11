import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SegmentedControl } from './SegmentedControl';

describe('SegmentedControl', () => {
  it('is a named radiogroup whose arrow keys move the selection', async () => {
    const onValueChange = jest.fn();
    render(
      <SegmentedControl
        label="View"
        options={[
          { value: 'map', label: 'Map' },
          { value: 'list', label: 'List' },
        ]}
        defaultValue="map"
        onValueChange={onValueChange}
      />
    );
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeInTheDocument();
    const map = screen.getByRole('radio', { name: 'Map' });
    expect(map).toBeChecked();
    map.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'List' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'List' })).toHaveFocus();
    expect(onValueChange).toHaveBeenLastCalledWith('list');
  });

  it('follows a controlled value', () => {
    render(
      <SegmentedControl
        label="View"
        options={[
          { value: 'map', label: 'Map' },
          { value: 'list', label: 'List' },
        ]}
        value="list"
      />
    );
    expect(screen.getByRole('radio', { name: 'List' })).toBeChecked();
  });
});
