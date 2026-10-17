/**
 * The watch page's "Book on {shortName}" (R7): main derives `bookingLink` for a found or partly
 * found watch, and the page offers it in its availability, opening in the browser. A held watch
 * is paid for in the app: Pay now, never the booking page.
 */
import { screen, within } from '@testing-library/react';
import { WatchResult } from '../../../../shared/types/common.types';
import type { Watch } from '../../../../shared/types/watch.types';
import { PARKSTAY_MANIFEST, ok } from '@tests/utils/renderer/createMockApi';
import { makeUnit, makeWatch } from '@tests/fixtures/renderer/watches';
import { renderWithApp } from '@tests/utils/renderer/renderWithApp';

const URL =
  'https://parkstay.dbca.wa.gov.au/search-availability/information/?campground_id=20&arrival=2099/12/11&departure=2099/12/13';
const NIGHTS = ['2099-12-11', '2099-12-12'];
const WATCH = makeWatch({
  id: 7,
  name: 'Osprey summer',
  lastResult: WatchResult.FOUND,
  lastCheckedAt: new Date(Date.now() - 5 * 60_000),
  lastAvailability: [makeUnit('1', NIGHTS), makeUnit('2', NIGHTS)],
  bookingLink: { url: URL, arrival: '2099-12-11', departure: '2099-12-13' },
});

function api(watch: Watch) {
  return {
    providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST])) },
    watches: {
      get: jest.fn().mockResolvedValue(ok(watch)),
      list: jest.fn().mockResolvedValue(ok([])),
    },
    accounts: { list: jest.fn().mockResolvedValue(ok([])) },
  };
}

describe('WatchDetailPage: Book on ParkStay', () => {
  it('a found watch offers the booking page in its availability, opening in the browser', async () => {
    renderWithApp({ route: '/watches/7', api: api(WATCH) });
    const availability = await screen.findByRole('region', { name: 'Availability' });
    const link = within(availability).getByRole('link', {
      name: 'Book on ParkStay (opens in your browser)',
    });
    expect(link).toHaveAttribute('href', URL);
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('a held watch offers Pay now in the app, never the booking page', async () => {
    const held = {
      ...WATCH,
      lastResult: WatchResult.HELD,
      hold: { reference: 'PB1', unitId: '1', expiresAt: new Date(Date.now() + 20 * 60_000) },
    };
    renderWithApp({ route: '/watches/7', api: api(held) });
    await screen.findByRole('region', { name: 'Hold at Osprey Bay' });
    expect(screen.getAllByRole('button', { name: 'Pay now' })).toHaveLength(1);
    expect(screen.queryByRole('link', { name: /^Book on/ })).toBeNull();
  });
});
