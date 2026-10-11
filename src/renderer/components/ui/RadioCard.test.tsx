import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Badge } from './Badge';
import { RadioCard, RadioCardGroup } from './RadioCard';

function Providers({ onValueChange = jest.fn() }) {
  return (
    <RadioCardGroup
      label="Provider"
      hint="Where to watch"
      defaultValue="parkstay"
      onValueChange={onValueChange}
    >
      <RadioCard value="parkstay" title="ParkStay WA" description="National park campgrounds" />
      <RadioCard
        value="rac"
        title="RAC Parks & Resorts"
        description="Holiday parks"
        trailing={<Badge tone="sun">Soon</Badge>}
      />
      <RadioCard value="hipcamp" title="Hipcamp" description="Private land" />
    </RadioCardGroup>
  );
}

describe('RadioCardGroup and RadioCard', () => {
  it('names each card by its title and describes it by its description', () => {
    render(<Providers />);
    expect(screen.getByRole('radiogroup', { name: 'Provider' })).toHaveAccessibleDescription(
      'Where to watch'
    );
    const rac = screen.getByRole('radio', { name: 'RAC Parks & Resorts' });
    expect(rac).toHaveAccessibleDescription('Holiday parks');
    expect(screen.getByRole('radio', { name: 'ParkStay WA' })).toBeChecked();
  });

  it('moves the checked card with the arrow keys', async () => {
    const onValueChange = jest.fn();
    render(<Providers onValueChange={onValueChange} />);
    screen.getByRole('radio', { name: 'ParkStay WA' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'RAC Parks & Resorts' })).toBeChecked();
    expect(onValueChange).toHaveBeenLastCalledWith('rac');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Hipcamp' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'ParkStay WA' })).not.toBeChecked();
  });

  it('selects on click and skips disabled cards', async () => {
    render(
      <RadioCardGroup label="Provider">
        <RadioCard value="parkstay" title="ParkStay WA" />
        <RadioCard value="rac" title="RAC Parks & Resorts" disabled />
      </RadioCardGroup>
    );
    await userEvent.click(screen.getByText('ParkStay WA'));
    expect(screen.getByRole('radio', { name: 'ParkStay WA' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'RAC Parks & Resorts' })).toBeDisabled();
  });
});
