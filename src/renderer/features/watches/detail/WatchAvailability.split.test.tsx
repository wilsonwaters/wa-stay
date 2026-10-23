/**
 * A watch whose last check found a stay free every night only by moving between units
 * (`SPLIT_FOUND`, §12.36): how to book it instead of "Book on", and its grid with every row.
 */
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { WatchResult } from '../../../../shared/types/common.types';
import type { SplitStay } from '../../../../shared/types/provider.types';
import { PARKSTAY_MANIFEST, RAC_MANIFEST } from '@tests/utils/renderer/manifests';
import { makeUnit, makeWatch } from '@tests/fixtures/renderer/watches';
import { WatchAvailability } from './WatchAvailability';

const NOW = new Date('2099-12-01T02:00:00Z');
const table = () =>
  within(screen.getByRole('region', { name: /^Availability by night/ })).getByRole('table');

describe('WatchAvailability: a stay free only if you move (SPLIT_FOUND)', () => {
  const NIGHTS = ['2099-12-11', '2099-12-12'];
  const BOOK = 'https://parkstay.dbca.wa.gov.au/search-availability/information/?campground_id=20';
  /** Site 3 free on the 11th, Site 4 on the 12th. */
  const DERIVED: SplitStay = {
    unitKind: 'campsite',
    booking: 'separate',
    units: 2,
    parts: [
      {
        unitId: '3',
        unitName: 'Site 3',
        arrival: NIGHTS[0],
        departure: NIGHTS[1],
        bookingUrl: `${BOOK}&arrival=2099/12/11&departure=2099/12/12`,
      },
      {
        unitId: '4',
        unitName: 'Site 4',
        arrival: NIGHTS[1],
        departure: '2099-12-13',
        bookingUrl: `${BOOK}&arrival=2099/12/12&departure=2099/12/13`,
      },
    ],
  };
  const splitFound = (overrides = {}) =>
    makeWatch({
      lastResult: WatchResult.SPLIT_FOUND,
      allowSplitStay: true,
      lastCheckedAt: new Date(NOW.getTime() - 10 * 60_000),
      lastAvailability: [
        makeUnit('3', NIGHTS, ['available', 'booked']),
        makeUnit('4', NIGHTS, ['booked', 'available']),
      ],
      splitStays: [DERIVED],
      ...overrides,
    });
  const show = (watch: ReturnType<typeof makeWatch>, now = NOW, manifest = PARKSTAY_MANIFEST) =>
    renderWithProviders(<WatchAvailability watch={watch} manifest={manifest} now={now} />);
  const block = () => screen.queryByRole('region', { name: 'Free if you move sites' });

  it('shows how to book it instead of "Book on", after the result line and before the nights', () => {
    // Main gives no booking link for it; one sent anyway is not shown
    show(splitFound({ bookingLink: { url: BOOK, arrival: NIGHTS[0], departure: '2099-12-13' } }));
    const resultLine = screen.getByText(/^From the check/);
    expect(resultLine).toHaveTextContent('Free across 2 sites');
    expect(screen.queryByRole('link', { name: /^Book on/ })).toBeNull();
    const region = block()!;
    expect(
      within(region).getByRole('heading', { level: 3, name: 'Free if you move sites' })
    ).toBeInTheDocument();
    expect(
      within(region).getByRole('link', {
        name: 'Book 11–12 Dec on ParkStay (opens in your browser)',
      })
    ).toHaveAttribute('href', `${BOOK}&arrival=2099/12/11&departure=2099/12/12`);
    expect(
      within(region).getByRole('link', {
        name: 'Book 12–13 Dec on ParkStay (opens in your browser)',
      })
    ).toBeInTheDocument();
    expect(
      resultLine.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(region.compareDocumentPosition(table()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region).not.toHaveTextContent(/available/i);
  });

  it('shows every row of the grid at once, the nights free on each site', () => {
    show(splitFound());
    expect(screen.getByRole('switch', { name: 'Fully available only' })).not.toBeChecked();
    expect(
      within(table())
        .getAllByRole('rowheader')
        .map((th) => th.textContent)
    ).toEqual(['Site 3', 'Site 4']);
  });

  it('asks RAC Busselton to book it, with the contact page', () => {
    const contact = 'https://parksandresorts.rac.com.au/busselton/contact-us/';
    show(
      splitFound({
        providerId: 'rac',
        location: { externalId: 'busselton', name: 'RAC Busselton Holiday Park' },
        lastAvailability: [
          {
            ...makeUnit('cat:4', NIGHTS, ['unknown', 'unknown']),
            unitName: 'Powered Site',
            unitKind: 'campsite',
            nights: NIGHTS.map((date) => ({
              date,
              state: 'unknown' as const,
              reason: 'split' as const,
            })),
            freeCount: 0,
            splitStay: { booking: 'contact' as const },
          },
        ],
        splitStays: [
          {
            unitKind: 'campsite',
            booking: 'contact',
            unitId: 'cat:4',
            unitName: 'Powered Site',
            contactUrl: contact,
          },
        ],
      }),
      NOW,
      RAC_MANIFEST
    );
    expect(screen.getByText(/^From the check/)).toHaveTextContent('Free if you move sites');
    const region = block()!;
    expect(
      within(region).getByRole('heading', { level: 4, name: 'Powered Site' })
    ).toBeInTheDocument();
    expect(
      within(region).getByRole('link', {
        name: 'Contact RAC Busselton Holiday Park (opens in your browser)',
      })
    ).toHaveAttribute('href', contact);
    expect(
      screen.getByText('Free every night, but not on one site for the whole stay.')
    ).toBeInTheDocument();
  });

  it('shows no block once the stay has begun, or without split stays from main', () => {
    const { unmount } = show(splitFound(), new Date('2099-12-10T16:00:00Z'));
    expect(block()).toBeNull();
    unmount();
    show(splitFound({ splitStays: undefined }));
    expect(block()).toBeNull();
    expect(screen.getByText(/^From the check/)).toHaveTextContent('Free if you move sites');
  });
});
