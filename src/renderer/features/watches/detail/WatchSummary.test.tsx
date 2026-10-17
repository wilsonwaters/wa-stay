import { screen, within } from '@testing-library/react';
import { PARKSTAY_MANIFEST } from '@tests/utils/renderer/createMockApi';
import { makeLocationDetail, makeMixedDetail, makeWatch } from '@tests/fixtures/renderer/watches';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import type { Watch } from '../../../../shared/types/watch.types';
import type { UnitSummary } from '../../../../shared/types/catalog.types';
import { WatchSummary } from './WatchSummary';

const NOW = new Date('2099-01-01T00:00:00Z');

function show(watch: Watch, units?: UnitSummary[]) {
  renderWithProviders(
    <WatchSummary
      watch={watch}
      state="active"
      manifest={PARKSTAY_MANIFEST}
      today="2099-01-01"
      now={NOW}
      units={units}
    />
  );
  return screen.getByRole('region', { name: 'Preferences' });
}

describe('WatchSummary: stay type', () => {
  it('shows the stored stay types', () => {
    const preferences = show(makeWatch({ unitKinds: ['room', 'cabin'] }));
    expect(within(preferences).getByText('Stay type')).toBeInTheDocument();
    expect(within(preferences).getByText('Cabins & villas, Rooms')).toBeInTheDocument();
  });

  it('shows "Any" at a mixed place with none stored', () => {
    const preferences = show(makeWatch(), makeMixedDetail().units);
    expect(within(preferences).getByText('Stay type')).toBeInTheDocument();
    expect(within(preferences).getByText('Any')).toBeInTheDocument();
  });

  it('leaves it out at a place of one kind with none stored', () => {
    const preferences = show(makeWatch(), makeLocationDetail().units);
    expect(within(preferences).queryByText('Stay type')).toBeNull();
  });
});
