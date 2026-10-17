import { screen, within } from '@testing-library/react';
import { PARKSTAY_MANIFEST } from '@tests/utils/renderer/createMockApi';
import { makeSnipe } from '@tests/fixtures/renderer/snipes';
import { makeLocationDetail, makeMixedDetail } from '@tests/fixtures/renderer/watches';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import type { UnitSummary } from '../../../../shared/types/catalog.types';
import { SnipeSummary } from './SnipeSummary';

function show(snipe: SiteSnipe, units?: UnitSummary[]) {
  renderWithProviders(
    <SnipeSummary
      snipe={snipe}
      manifest={PARKSTAY_MANIFEST}
      today="2099-01-01"
      now={new Date('2099-01-01T00:00:00Z')}
      units={units}
    />
  );
  return screen.getByRole('region', { name: 'Stay' });
}

describe('SnipeSummary: stay type', () => {
  it('shows the stored stay types', () => {
    const stay = show(makeSnipe({ unitKinds: ['cabin'] }));
    expect(within(stay).getByText('Stay type')).toBeInTheDocument();
    expect(within(stay).getByText('Cabins & villas')).toBeInTheDocument();
  });

  it('shows "Any" at a mixed place with none stored', () => {
    const stay = show(makeSnipe(), makeMixedDetail().units);
    expect(within(stay).getByText('Any')).toBeInTheDocument();
  });

  it('leaves it out at a place of one kind with none stored', () => {
    const stay = show(makeSnipe(), makeLocationDetail().units);
    expect(within(stay).queryByText('Stay type')).toBeNull();
  });
});
