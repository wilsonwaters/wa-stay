import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UnitSummary } from '../../../shared/types/catalog.types';
import { UnitPicker } from './UnitPicker';

const UNITS: UnitSummary[] = [
  { unitId: '1', unitName: 'Site 1', unitType: 'Powered' },
  { unitId: '2', unitName: 'Site 2', unitType: 'Powered' },
  { unitId: '3', unitName: 'Site 3', unitType: 'Unpowered' },
];

function Picker({ start = [] as string[], onChange = jest.fn() }) {
  const [value, setValue] = useState<string[]>(start);
  return (
    <UnitPicker
      units={UNITS}
      value={value}
      noun={{ one: 'site', many: 'sites' }}
      onChange={(ids) => {
        setValue(ids);
        onChange(ids);
      }}
    />
  );
}

async function open() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Choose sites' }));
  return user;
}

describe('UnitPicker', () => {
  it('takes its heading and what choosing none means from the caller', () => {
    render(
      <UnitPicker
        units={UNITS}
        value={[]}
        onChange={jest.fn()}
        noun={{ one: 'site', many: 'sites' }}
        label="Sites to try"
        hint="None ticked tries every site."
      />
    );
    expect(screen.getByText('Sites to try')).toBeInTheDocument();
    expect(screen.getByText('Any site. None ticked tries every site.')).toBeInTheDocument();
    expect(screen.queryByText(/told about/)).not.toBeInTheDocument();
  });

  it('starts with any site and groups the sites by type', async () => {
    render(<Picker />);
    expect(screen.getByText(/Any site\./)).toBeInTheDocument();
    await open();
    expect(screen.getByRole('group', { name: 'Powered' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Unpowered' })).toBeInTheDocument();
  });

  it('chooses a whole type with its "All" box, and single sites with theirs', async () => {
    const onChange = jest.fn();
    render(<Picker onChange={onChange} />);
    const user = await open();
    await user.click(screen.getByRole('checkbox', { name: 'All Powered (2)' }));
    expect(onChange).toHaveBeenLastCalledWith(['1', '2']);
    expect(screen.getByText(/2 sites chosen/)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Site 2' }));
    expect(onChange).toHaveBeenLastCalledWith(['1']);
    const all = screen.getByRole('checkbox', { name: 'All Powered (2)' }) as HTMLInputElement;
    expect(all.indeterminate).toBe(true);
    expect(all).not.toBeChecked();
  });

  it('matches older choices by name and keeps ones no longer listed until unticked', async () => {
    const onChange = jest.fn();
    render(<Picker start={['Site 3', 'Site 99']} onChange={onChange} />);
    const user = await open();
    expect(screen.getByRole('checkbox', { name: 'Site 3' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Site 99' })).toBeChecked();
    expect(screen.getByText(/2 sites chosen/)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Site 99' }));
    expect(onChange).toHaveBeenLastCalledWith(['Site 3']);
    await user.click(screen.getByRole('checkbox', { name: 'Site 3' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe('UnitPicker with one unit per class', () => {
  const CLASSES: UnitSummary[] = [
    { unitId: 'c1', unitName: 'Powered site', unitType: 'Powered site' },
    { unitId: 'c2', unitName: 'Unpowered site', unitType: 'Unpowered site' },
  ];

  it('lists the classes as they are, with no groups or "All" boxes', async () => {
    const onChange = jest.fn();
    render(
      <UnitPicker
        units={CLASSES}
        value={[]}
        noun={{ one: 'site', many: 'sites' }}
        onChange={onChange}
      />
    );
    const user = await open();
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /^All / })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Unpowered site' }));
    expect(onChange).toHaveBeenLastCalledWith(['c2']);
  });

  it('works with a single unit', async () => {
    render(
      <UnitPicker
        units={[CLASSES[0]]}
        value={['c1']}
        noun={{ one: 'site', many: 'sites' }}
        onChange={jest.fn()}
      />
    );
    await open();
    expect(screen.getByRole('checkbox', { name: 'Powered site' })).toBeChecked();
    expect(screen.getByText(/1 site chosen/)).toBeInTheDocument();
  });
});
