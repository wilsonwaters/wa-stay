import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { WatchResult } from '../../../../shared/types/common.types';
import { eachNight } from '../../../../shared/utils/calendar-date';
import { PARKSTAY_MANIFEST } from '@tests/utils/renderer/manifests';
import { makeUnit, makeWatch } from '@tests/fixtures/renderer/watches';
import { WatchAvailability } from './WatchAvailability';

const NOW = new Date('2099-12-01T02:00:00Z');
const STATES = ['available', 'booked', 'closed', 'not-released', 'unknown'] as const;

function renderFor(arrival: string, departure: string, units = 2, overrides = {}) {
  const nights = eachNight(arrival, departure);
  const watch = makeWatch({
    stay: { ...makeWatch().stay, arrival, departure },
    lastResult: WatchResult.PARTIAL_FOUND,
    lastCheckedAt: new Date(NOW.getTime() - 10 * 60_000),
    lastAvailability: Array.from({ length: units }, (_, u) =>
      makeUnit(
        String(u + 1),
        nights,
        nights.map((_, i) => STATES[(i + u) % STATES.length])
      )
    ),
    ...overrides,
  });
  renderWithProviders(<WatchAvailability watch={watch} manifest={PARKSTAY_MANIFEST} now={NOW} />);
  return nights;
}

const table = () =>
  within(screen.getByRole('region', { name: /^Availability by night/ })).getByRole('table');
const nightColumns = () => within(table()).getAllByRole('columnheader').slice(1);

describe('WatchAvailability (NightGrid)', () => {
  it('a 2-night stay has exactly 2 night columns, and no check-out column', () => {
    renderFor('2099-12-11', '2099-12-13', 1, {
      lastAvailability: [makeUnit('1', ['2099-12-11', '2099-12-12'])],
    });
    expect(nightColumns().map((th) => th.textContent)).toEqual(['Fri 11 Dec', 'Sat 12']);
    expect(screen.getByText('1 of 1 site free for all 2 nights')).toBeInTheDocument();
  });

  it('21 nights render 21 columns inside the sideways-scrolling region', async () => {
    const nights = renderFor('2099-12-11', '2100-01-01', 2);
    expect(nights).toHaveLength(21);
    expect(nightColumns()).toHaveLength(21);
    const region = screen.getByRole('region', { name: /^Availability by night/ });
    expect(region).toContainElement(table());
    // The rows stay one per unit, whatever the stay's length.
    expect(
      within(table())
        .getAllByRole('rowheader')
        .map((th) => th.textContent)
    ).toEqual(['Site 1', 'Site 2']);
  });

  it('the key lists all 5 states when the check saw them, each in words', async () => {
    renderFor('2099-12-11', '2099-12-16', 2);
    const key = screen.getByRole('list', { name: 'Key' });
    expect(
      within(key)
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    ).toEqual(['Available', 'Booked', 'Closed', 'Not released yet', 'Unknown']);
  });

  it('names every cell in words, never colour alone', () => {
    renderFor('2099-12-11', '2099-12-13', 1, {
      lastAvailability: [
        {
          ...makeUnit('12', ['2099-12-11', '2099-12-12'], ['available', 'booked']),
          nights: [
            { date: '2099-12-11', state: 'available', price: 35 },
            { date: '2099-12-12', state: 'booked' },
          ],
        },
      ],
    });
    const row = within(table()).getByRole('row', { name: /Site 12/ });
    const cells = within(row).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent(/Available, \$35/);
    expect(cells[1]).toHaveTextContent(/Booked/);
  });

  it('says when the watch has not been checked, or its units were not in the check', () => {
    const { unmount } = renderWithProviders(
      <WatchAvailability watch={makeWatch()} manifest={PARKSTAY_MANIFEST} now={NOW} />
    );
    expect(
      screen.getByText('No check yet. Use Check now to see availability.')
    ).toBeInTheDocument();
    unmount();
    renderWithProviders(
      <WatchAvailability
        watch={makeWatch({ unitIds: ['99'], lastAvailability: [], lastCheckedAt: NOW })}
        manifest={PARKSTAY_MANIFEST}
        now={NOW}
      />
    );
    expect(
      screen.getByText('None of the chosen sites were in the last check.')
    ).toBeInTheDocument();
  });

  it('says when the check was, in the provider’s time zone', () => {
    renderFor('2099-12-11', '2099-12-13');
    expect(screen.getByText(/From the check 10 min ago \(9:50 am AWST\)/)).toBeInTheDocument();
  });

  describe('Book on {shortName} (R7)', () => {
    const URL =
      'https://parkstay.dbca.wa.gov.au/search-availability/information/?campground_id=20&arrival=2099/12/11&departure=2099/12/13';
    const NIGHTS = ['2099-12-11', '2099-12-12'];
    const found = (overrides = {}) =>
      makeWatch({
        lastResult: WatchResult.FOUND,
        lastCheckedAt: new Date(NOW.getTime() - 10 * 60_000),
        lastAvailability: [makeUnit('1', NIGHTS)],
        bookingLink: { url: URL, arrival: '2099-12-11', departure: '2099-12-13' },
        ...overrides,
      });
    const show = (watch: ReturnType<typeof makeWatch>, now = NOW) =>
      renderWithProviders(
        <WatchAvailability watch={watch} manifest={PARKSTAY_MANIFEST} now={now} />
      );
    const bookLink = () =>
      screen.queryByRole('link', { name: 'Book on ParkStay (opens in your browser)' });

    it('a found watch links its booking page, in the browser, right after the result line', () => {
      show(found());
      const link = bookLink();
      expect(link).toHaveAttribute('href', URL);
      expect(link).toHaveAttribute('target', '_blank');
      expect(screen.queryByText(/^For /)).toBeNull();

      // Reading order: the result line, at once the link, then the nights
      const resultLine = screen.getByText(/^From the check/);
      expect(resultLine).toHaveTextContent('1 site available');
      expect(resultLine.nextElementSibling).toContainElement(link);
      expect(
        link!.compareDocumentPosition(table()) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    it('a partial match says which nights the link is for, as text', () => {
      show(
        found({
          lastResult: WatchResult.PARTIAL_FOUND,
          stay: { ...makeWatch().stay, arrival: '2099-11-02', departure: '2099-11-06' },
          lastAvailability: [
            makeUnit(
              '1',
              ['2099-11-02', '2099-11-03', '2099-11-04', '2099-11-05'],
              ['booked', 'available', 'available', 'booked']
            ),
          ],
          bookingLink: { url: URL, arrival: '2099-11-03', departure: '2099-11-05' },
        }),
        new Date('2099-10-01T02:00:00Z')
      );
      expect(bookLink()).toHaveAttribute('href', URL);
      expect(screen.getByText('For 3–5 Nov')).toBeVisible();
    });

    it.each([
      ['held', { lastResult: WatchResult.HELD }],
      ['not found', { lastResult: WatchResult.NOT_FOUND, bookingLink: undefined }],
      ['found with no link from main', { bookingLink: undefined }],
    ])('a %s watch shows no link', (_name, overrides) => {
      show(found(overrides));
      expect(bookLink()).toBeNull();
      expect(screen.queryByRole('link', { name: /^Book on/ })).toBeNull();
    });

    it('shows none once the stay has begun where the provider is (Perth midnight)', () => {
      // 10 Dec 23:59 in Perth: the day before arrival
      const { unmount } = show(found(), new Date('2099-12-10T15:59:00Z'));
      expect(bookLink()).not.toBeNull();
      unmount();
      // 11 Dec 00:00 in Perth (still 10 Dec in UTC): the stay has begun
      show(found(), new Date('2099-12-10T16:00:00Z'));
      expect(bookLink()).toBeNull();
    });
  });
});
