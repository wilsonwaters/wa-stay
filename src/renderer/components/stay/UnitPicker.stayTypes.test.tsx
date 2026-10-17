import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UnitSummary } from '../../../shared/types/catalog.types';
import type { UnitKind } from '../../../shared/types/provider.types';
import { UnitPicker } from './UnitPicker';

/** Sites, cabins and a unit the provider gives no kind. */
const MIXED: UnitSummary[] = [
  { unitId: 's1', unitName: 'Site 1', unitType: 'Powered', unitKind: 'campsite' },
  { unitId: 's2', unitName: 'Site 2', unitType: 'Powered', unitKind: 'campsite' },
  { unitId: 'c1', unitName: 'Cabin 1', unitType: 'Two bedroom', unitKind: 'cabin' },
  { unitId: 'c2', unitName: 'Cabin 2', unitType: 'Two bedroom', unitKind: 'cabin' },
  { unitId: 'x1', unitName: 'Bunkhouse', unitType: 'Bunkhouse' },
];

interface PickerProps {
  kinds?: UnitKind[];
  start?: string[];
  onChange?: jest.Mock;
}

/** The picker holding its own value; `kinds` comes from the test, so a rerender changes them. */
function Picker({ kinds, start = [], onChange = jest.fn() }: PickerProps) {
  const [value, setValue] = useState<string[]>(start);
  return (
    <UnitPicker
      units={MIXED}
      value={value}
      kinds={kinds}
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

/** Whether `elements` are in document order. */
const inOrder = (elements: HTMLElement[]) =>
  elements.every(
    (el, i) =>
      i === 0 ||
      Boolean(elements[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
  );

describe('UnitPicker with more than one stay type', () => {
  it('groups the units by stay type, then by unit type; units with no kind go last, under "Other"', async () => {
    render(<Picker />);
    await open();
    const groups = ['Camping', 'Cabins & villas', 'Other'].map((name) =>
      screen.getByRole('group', { name })
    );
    expect(inOrder(groups)).toBe(true);
    const [camping, cabins, other] = groups;
    expect(within(camping).getByRole('group', { name: 'Powered' })).toBeInTheDocument();
    expect(
      within(cabins).getByRole('checkbox', { name: 'All Two bedroom (2)' })
    ).toBeInTheDocument();
    expect(within(cabins).queryByRole('checkbox', { name: 'Site 1' })).toBeNull();
    expect(within(other).getByRole('checkbox', { name: 'Bunkhouse' })).toBeInTheDocument();
  });

  it('lists only the units of the chosen stay types, with one kind as a place of one kind is', async () => {
    render(<Picker kinds={['cabin']} />);
    await open();
    expect(screen.queryByRole('group', { name: 'Cabins & villas' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Two bedroom' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Cabin 1' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Site 1' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Bunkhouse' })).toBeNull();
  });

  it('unticks the units of a stay type turned off, saying so in a polite status line', () => {
    const onChange = jest.fn();
    const start = ['s1', 's2', 'c1'];
    const { rerender } = render(
      <Picker kinds={['campsite', 'cabin']} start={start} onChange={onChange} />
    );
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();

    rerender(<Picker kinds={['cabin']} start={start} onChange={onChange} />);
    expect(onChange).toHaveBeenLastCalledWith(['c1']);
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent('2 sites unticked: not in the chosen stay types');
    expect(screen.getByText(/1 site chosen/)).toBeInTheDocument();

    // Widening the choice unticks nothing, and the line clears.
    rerender(<Picker kinds={[]} start={start} onChange={onChange} />);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(status).toBeEmptyDOMElement();
  });

  it('shows a ticked unit of a kind not chosen (as an edited watch may have) until the kinds change', async () => {
    render(<Picker kinds={['cabin']} start={['s1']} />);
    await open();
    expect(screen.getByRole('checkbox', { name: 'Site 1' })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Site 2' })).toBeNull();
  });

  it('says when no unit of the chosen stay types is listed', () => {
    render(<Picker kinds={['glamping']} />);
    expect(screen.getByText('No sites listed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose sites' })).toBeNull();
  });

  it('has no status line where stay types are not offered', () => {
    render(<Picker />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
