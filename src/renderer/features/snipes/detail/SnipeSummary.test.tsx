import { screen, within } from '@testing-library/react';
import { PARKSTAY_MANIFEST } from '@tests/utils/renderer/createMockApi';
import { ALERT_ONLY_MANIFEST, makeSnipe } from '@tests/fixtures/renderer/snipes';
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

describe('SnipeSummary: what it does when free, and how long it keeps trying', () => {
  function release(snipe: SiteSnipe, manifest = PARKSTAY_MANIFEST) {
    renderWithProviders(
      <SnipeSummary
        snipe={snipe}
        manifest={manifest}
        today="2099-01-01"
        now={new Date('2099-01-01T00:00:00Z')}
      />
    );
    const group = screen.getByRole('region', { name: 'Release' });
    const value = (label: string) => within(group).getByText(label).nextElementSibling;
    return { group, value };
  }

  it('"When free: Alert me" for an alert snipe', () => {
    const { value } = release(makeSnipe({ action: 'alert' }));
    expect(value('When free')).toHaveTextContent('Alert me');
  });

  it('"Hold a site" for a hold snipe', () => {
    const { value } = release(makeSnipe({ action: 'hold' }));
    expect(value('When free')).toHaveTextContent('Hold a site');
  });

  it('keeps trying for the window it runs with: an older, longer one cut to the mode’s limit', () => {
    const { value } = release(
      makeSnipe({ providerId: 'alertstay', action: 'alert', windowDurationMs: 60 * 60_000 }),
      ALERT_ONLY_MANIFEST
    );
    expect(value('Keeps trying')).toHaveTextContent('For 30 minutes');
  });

  it('keeps a window within the limit, and any window where the mode sets none', () => {
    const { value } = release(makeSnipe({ windowDurationMs: 60 * 60_000 }));
    expect(value('Keeps trying')).toHaveTextContent('For 60 minutes');
  });
});
