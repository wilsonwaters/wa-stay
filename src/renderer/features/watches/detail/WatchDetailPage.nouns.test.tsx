import { screen, within } from '@testing-library/react';
import { WatchResult } from '../../../../shared/types/common.types';
import type { UnitKind } from '../../../../shared/types/provider.types';
import type { Watch } from '../../../../shared/types/watch.types';
import { PARKSTAY_MANIFEST, ok } from '@tests/utils/renderer/createMockApi';
import { catalogGet, makeMixedDetail, makeUnit, makeWatch } from '@tests/fixtures/renderer/watches';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';

/**
 * A watch's page names its units by their kinds (R9): a watch of cabins says cabins, one whose
 * units are sites and cabins says spots, and a held cabin is a "Cabin held".
 */
const NIGHTS = ['2099-12-11', '2099-12-12'];
const unit = (id: string, unitKind: UnitKind, name: string) =>
  makeUnit(id, NIGHTS, undefined, { unitName: name, unitKind });
const CABINS = [unit('c1', 'cabin', 'Cabin 1'), unit('c2', 'cabin', 'Cabin 2')];

function render(watch: Watch) {
  return renderWithApp({
    route: `/watches/${watch.id}`,
    api: {
      providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST])) },
      watches: {
        get: jest.fn().mockResolvedValue(ok(watch)),
        list: jest.fn().mockResolvedValue(ok([])),
      },
      accounts: { list: jest.fn().mockResolvedValue(ok([])) },
      // Osprey Bay with four sites and two cabins
      catalog: { get: catalogGet(makeMixedDetail()) },
    },
  });
}

const checked = {
  id: 7,
  name: 'Osprey cabins',
  lastResult: WatchResult.FOUND,
  lastCheckedAt: new Date(Date.now() - 5 * 60_000),
};

describe('WatchDetailPage: unit nouns', () => {
  it('names a watch of cabins’ units cabins: result, grid, preferences', async () => {
    render(makeWatch({ ...checked, unitKinds: ['cabin'], lastAvailability: CABINS }));
    expect(await screen.findByText('2 cabins available')).toBeInTheDocument();
    expect(screen.getByText('2 of 2 cabins free for all 2 nights')).toBeInTheDocument();
    const preferences = screen.getByRole('region', { name: 'Preferences' });
    expect(within(preferences).getByText('Preferred cabins')).toBeInTheDocument();
    expect(within(preferences).getByText('Any cabin')).toBeInTheDocument();
  });

  it('names units of more than one kind spots', async () => {
    render(
      makeWatch({ ...checked, lastAvailability: [unit('1', 'campsite', 'Site 1'), CABINS[0]] })
    );
    expect(await screen.findByText('2 spots available')).toBeInTheDocument();
    expect(screen.getByText('2 of 2 spots free for all 2 nights')).toBeInTheDocument();
    const preferences = screen.getByRole('region', { name: 'Preferences' });
    expect(within(preferences).getByText('Preferred spots')).toBeInTheDocument();
    expect(within(preferences).getByText('Any spot')).toBeInTheDocument();
  });

  it('calls a held cabin a cabin, in its status and its automatic hold line', async () => {
    render(
      makeWatch({
        ...checked,
        lastResult: WatchResult.HELD,
        autoHold: true,
        lastAvailability: [unit('1', 'campsite', 'Site 1'), CABINS[0]],
        hold: { reference: 'H1', unitId: 'c1', expiresAt: new Date(Date.now() + 20 * 60_000) },
      })
    );
    const status = await screen.findByRole('region', { name: 'Status' });
    expect(within(status).getByText('Cabin held')).toBeInTheDocument();
    const hold = await screen.findByRole('region', { name: 'Hold at Osprey Bay' });
    expect(within(hold).getByText('Cabin 1 is held for you')).toBeInTheDocument();
  });
});
