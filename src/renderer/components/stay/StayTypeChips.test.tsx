import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UnitKind } from '../../../shared/types/provider.types';
import { StayTypeChips } from './StayTypeChips';

function Chips({ start = [] as UnitKind[], onChange = jest.fn(), error = '' }) {
  const [value, setValue] = useState<UnitKind[]>(start);
  return (
    <StayTypeChips
      options={['campsite', 'cabin', 'dorm']}
      value={value}
      error={error || undefined}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('StayTypeChips', () => {
  it('is a group named "Stay type", with a pressable chip per stay type and the hint', () => {
    render(<Chips start={['dorm']} />);
    const group = screen.getByRole('group', { name: 'Stay type' });
    expect(group).toHaveAccessibleDescription('Leave all off for any stay type.');
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['Camping', 'Cabins & villas', 'Dorms']);
    expect(within(group).getByRole('button', { name: 'Camping' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(within(group).getByRole('button', { name: 'Dorms' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('toggles a stay type, giving the choice back in stay-type order', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(<Chips start={['dorm']} onChange={onChange} />);
    const cabins = screen.getByRole('button', { name: 'Cabins & villas' });
    await user.click(cabins);
    expect(cabins).toHaveAttribute('aria-pressed', 'true');
    expect(onChange).toHaveBeenLastCalledWith(['cabin', 'dorm']);
    await user.click(screen.getByRole('button', { name: 'Dorms' }));
    expect(onChange).toHaveBeenLastCalledWith(['cabin']);
  });

  it('marks the group invalid with its error, focusable for a failed Continue', () => {
    render(<Chips error="Choose a stay type or a site." />);
    const group = screen.getByRole('group', { name: 'Stay type' });
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group).toHaveAttribute('tabindex', '-1');
    expect(group).toHaveAccessibleDescription(
      'Leave all off for any stay type. Choose a stay type or a site.'
    );
  });
});
