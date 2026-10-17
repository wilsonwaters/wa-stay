import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UnitSummary } from '../../../shared/types/catalog.types';
import { nounForKinds } from '../../../shared/utils/unit-noun';
import { UnitPicker } from './UnitPicker';

/**
 * The unit choice names units by their kinds (R9): its heading, summary and disclosure take the
 * noun it is given, and in a stay-type group of units with no unit type the group's own noun,
 * with no "Other" heading under the stay type ("Dorms › All bunks (2)").
 */
const site = (n: number): UnitSummary => ({
  unitId: `s${n}`,
  unitName: `Site ${n}`,
  unitType: 'Powered',
  unitKind: 'campsite',
});
const hut = (n: number, unitType?: string): UnitSummary => ({
  unitId: `h${n}`,
  unitName: `Hut ${n}`,
  unitKind: 'dorm',
  ...(unitType ? { unitType } : {}),
});

async function open(units: UnitSummary[], kinds: Parameters<typeof nounForKinds>[0]) {
  const noun = nounForKinds(kinds);
  render(<UnitPicker units={units} value={[]} onChange={jest.fn()} noun={noun} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: `Choose ${noun.many}` }));
}

describe('UnitPicker nouns', () => {
  it('reads "Preferred cabins", "Any cabin" and "Choose cabins" at a place of cabins', async () => {
    const cabins = [1, 2].map((n) => ({
      unitId: `c${n}`,
      unitName: `Cabin ${n}`,
      unitKind: 'cabin' as const,
    }));
    await open(cabins, ['cabin']);
    expect(screen.getByText('Preferred cabins')).toBeInTheDocument();
    expect(screen.getByText('Any cabin.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Cabin 1' })).toBeInTheDocument();
  });

  it('puts untyped huts straight under "Dorms", as "All bunks", with no "Other" heading', async () => {
    await open([site(1), site(2), hut(1), hut(2)], ['campsite', 'dorm']);
    expect(screen.getByText('Preferred spots')).toBeInTheDocument();
    const dorms = screen.getByRole('group', { name: 'Dorms' });
    expect(within(dorms).queryByRole('group', { name: 'Other' })).toBeNull();
    expect(within(dorms).getByRole('checkbox', { name: 'All bunks (2)' })).toBeInTheDocument();
    expect(within(dorms).queryByRole('checkbox', { name: /sites/ })).toBeNull();
    // A real unit type keeps its heading
    const camping = screen.getByRole('group', { name: 'Camping' });
    expect(within(camping).getByRole('group', { name: 'Powered' })).toBeInTheDocument();
  });

  it('keeps "Other" beside a typed group, naming its units by the stay type', async () => {
    await open([site(1), hut(1, 'Bunkhouse'), hut(2), hut(3)], ['campsite', 'dorm']);
    const dorms = screen.getByRole('group', { name: 'Dorms' });
    const other = within(dorms).getByRole('group', { name: 'Other' });
    expect(
      within(other).getByRole('checkbox', { name: 'All other bunks (2)' })
    ).toBeInTheDocument();
  });
});
