/**
 * A watch's card when its last check found a stay free every night only by moving between
 * units (`SPLIT_FOUND`, §12.36): its result line and Check now's toast, never "available".
 */
import { screen, within } from '@testing-library/react';
import { WatchResult } from '../../../../shared/types/common.types';
import type { Watch, WatchExecutionResult } from '../../../../shared/types/watch.types';
import { PARKSTAY_MANIFEST, ok } from '@tests/utils/renderer/createMockApi';
import { makeUnit, makeWatch } from '@tests/fixtures/renderer/watches';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { providerToday } from '../../../components/stay/providerToday';
import { watchStateOf } from '../shared/watchState';
import { WatchCard } from './WatchCard';

const NOW = new Date();
const NIGHTS = ['2099-12-11', '2099-12-12'];

function renderCard(watch: Watch, api = {}) {
  const today = providerToday(PARKSTAY_MANIFEST, NOW);
  return renderWithProviders(
    <WatchCard
      watch={watch}
      state={watchStateOf(watch, today, NOW)}
      manifest={PARKSTAY_MANIFEST}
      now={NOW}
      today={today}
    />,
    { route: '/watches', api }
  );
}

const card = () => screen.getByRole('article');
const toasts = () => screen.getByRole('region', { name: 'Notifications' });
const found: WatchExecutionResult = {
  watchId: 1,
  success: true,
  found: true,
  checkedAt: NOW,
  matches: [],
};

describe('WatchCard: a stay free only if you move', () => {
  it('says a stay free only if you move for what it is, never "available"', async () => {
    const runNow = jest.fn().mockResolvedValue(
      ok({
        ...found,
        matches: [],
        splitStays: [
          { unitKind: 'campsite', booking: 'contact', unitId: 'cat:4', unitName: 'Powered Site' },
        ],
      })
    );
    const { user } = renderCard(
      makeWatch({
        lastResult: WatchResult.SPLIT_FOUND,
        lastCheckedAt: new Date(NOW.getTime() - 5 * 60_000),
        lastAvailability: [makeUnit('3', NIGHTS, ['available', 'booked'])],
        splitStays: [
          {
            unitKind: 'campsite',
            booking: 'separate',
            units: 2,
            parts: [
              { unitId: '3', unitName: 'Site 3', arrival: NIGHTS[0], departure: NIGHTS[1] },
              { unitId: '4', unitName: 'Site 4', arrival: NIGHTS[1], departure: '2099-12-13' },
            ],
          },
        ],
      }),
      { watches: { runNow, list: jest.fn().mockResolvedValue(ok([])) } }
    );
    expect(within(card()).getByText('Free across 2 sites')).toBeInTheDocument();
    expect(within(card()).queryByText(/available/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Check now' }));
    expect(
      await within(toasts()).findByText('Free if you move sites at Osprey Bay')
    ).toBeInTheDocument();
  });
});
