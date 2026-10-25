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

describe('WatchSummary: alerts on stays that move between units (§12.36)', () => {
  const alerts = (watch: Watch) => within(show(watch)).getByText(/whole stay|some nights/);

  it('says so only when the watch asks for them', () => {
    expect(alerts(makeWatch())).toHaveTextContent(
      /^When the whole stay is free; stops after the first alert$/
    );
  });

  it('adds them after what else it alerts on', () => {
    expect(alerts(makeWatch({ allowSplitStay: true }))).toHaveTextContent(
      /^When the whole stay is free; also when it's free only if you move sites; stops after the first alert$/
    );
  });

  it('keeps partial availability beside them', () => {
    expect(
      alerts(makeWatch({ allowSplitStay: true, allowPartialMatch: true, notifyOnly: false }))
    ).toHaveTextContent(
      /^Also when only some nights are free; also when it's free only if you move sites; keeps checking after alerts$/
    );
  });
});
