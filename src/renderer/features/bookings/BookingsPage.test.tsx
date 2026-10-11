import { screen, waitFor, within } from '@testing-library/react';
import { BookingStatus } from '../../../shared/types/common.types';
import type { Booking } from '../../../shared/types/booking.types';
import { FAKE_MANIFEST, PARKSTAY_MANIFEST, ok } from '@tests/utils/renderer/createMockApi';
import { freezeDateAt, makeBooking } from '@tests/fixtures/renderer/bookings';
import { currentRoute } from '@tests/utils/renderer/renderWithApp';
import { politeAnnouncement, renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { BookingsPage } from './BookingsPage';

freezeDateAt('2026-12-13T02:00:00Z');
beforeEach(() => window.localStorage.clear());

const stay = (arrival: string, departure: string) => ({
  ...makeBooking().stay,
  arrival,
  departure,
});
const OSPREY = makeBooking({ id: 1, stay: stay('2026-12-12', '2026-12-14') });
const DALES = makeBooking({
  id: 2,
  bookingReference: 'PB220011',
  location: { externalId: '7', name: 'Dales Campground', areaName: 'Karijini National Park' },
  stay: stay('2026-12-08', '2026-12-10'),
});
const LUCKY = makeBooking({
  id: 3,
  providerId: 'fakestay',
  bookingReference: 'lb-0042',
  location: { externalId: 'lb', name: 'Lucky Bay', areaName: 'Cape Le Grand' },
  stay: stay('2027-01-04', '2027-01-06'),
  status: BookingStatus.CANCELLED,
});
const PENDING = makeBooking({
  id: 4,
  bookingReference: 'PB330022',
  location: { externalId: '9', name: 'Fortescue Falls', areaName: 'Karijini National Park' },
  stay: stay('2027-03-01', '2027-03-03'),
  status: BookingStatus.PENDING,
});

function setup(route = '/bookings', bookings: Booking[] = [OSPREY, DALES, LUCKY, PENDING]) {
  return renderWithProviders(<BookingsPage />, {
    route,
    api: {
      providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST, FAKE_MANIFEST])) },
      bookings: { list: jest.fn().mockResolvedValue(ok(bookings)) },
    },
  });
}

const cardNames = () =>
  screen.queryAllByRole('article').map((card) => within(card).getByRole('heading').textContent);
const tab = (name: RegExp) => screen.getByRole('tab', { name });

describe('BookingsPage', () => {
  it('shows the banner, one h1, Add booking and three counted tabs with Upcoming selected', async () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Bookings' })).toBeInTheDocument();
    expect(screen.getByText('Your trips across every provider.')).toBeInTheDocument();
    expect(screen.getByText(/Bookings is still being finalised/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add booking' })).toBeInTheDocument();

    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(3));
    expect(screen.getAllByRole('tab').map((t) => t.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(tab(/^Upcoming/)).toHaveAccessibleName('Upcoming, 2 trips');
    expect(tab(/^Past/)).toHaveAccessibleName('Past, 1 trip');
    expect(tab(/^Cancelled/)).toHaveAccessibleName('Cancelled, 1 trip');
  });

  it('buckets by the 13 December clock: under way, departed, cancelled', async () => {
    const { user } = setup();
    await waitFor(() => expect(cardNames()).toEqual(['Osprey Bay', 'Fortescue Falls']));
    const osprey = screen.getByRole('article', { name: 'Osprey Bay' });
    expect(within(osprey).getByText('Happening now')).toBeInTheDocument();
    const pending = screen.getByRole('article', { name: 'Fortescue Falls' });
    expect(within(pending).getByText('Pending')).toBeInTheDocument();
    expect(within(pending).queryByText('Happening now')).toBeNull();

    await user.click(tab(/^Past/));
    expect(cardNames()).toEqual(['Dales Campground']);
    expect(currentRoute()).toBe('/bookings?tab=past');

    await user.click(tab(/^Cancelled/));
    expect(cardNames()).toEqual(['Lucky Bay']);
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName(/^Cancelled/);
  });

  it('moves between tabs with the arrow keys, Home and End', async () => {
    const { user } = setup();
    await waitFor(() => expect(cardNames()).toHaveLength(2));
    tab(/^Upcoming/).focus();
    await user.keyboard('{ArrowRight}');
    expect(tab(/^Past/)).toHaveFocus();
    expect(tab(/^Past/)).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(tab(/^Cancelled/)).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tab(/^Upcoming/)).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(tab(/^Cancelled/)).toHaveFocus();
    await user.keyboard('{Home}');
    expect(tab(/^Upcoming/)).toHaveAttribute('aria-selected', 'true');
    expect(cardNames()).toEqual(['Osprey Bay', 'Fortescue Falls']);
  });

  it('narrows by provider and by search, and recounts the tabs', async () => {
    const { user } = setup();
    await waitFor(() => expect(cardNames()).toHaveLength(2));
    const provider = screen.getByRole('radiogroup', { name: 'Provider' });
    expect(
      within(provider)
        .getAllByRole('radio')
        .map((r) => r.closest('label')?.textContent)
    ).toEqual(['All', 'ParkStay', 'Fake Stay']);

    await user.click(within(provider).getByRole('radio', { name: 'Fake Stay' }));
    expect(currentRoute()).toBe('/bookings?provider=fakestay');
    expect(screen.getByText('No upcoming trips')).toBeInTheDocument();
    expect(tab(/^Cancelled/)).toHaveAccessibleName('Cancelled, 1 trip');

    await user.click(within(provider).getByRole('radio', { name: 'All' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search trips' }), 'karijini');
    expect(cardNames()).toEqual(['Fortescue Falls']);
    expect(tab(/^Past/)).toHaveAccessibleName('Past, 1 trip');
    await waitFor(() => expect(politeAnnouncement()).toBe('1 trip'));

    await user.clear(screen.getByRole('searchbox', { name: 'Search trips' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search trips' }), 'pb3300');
    expect(cardNames()).toEqual(['Fortescue Falls']);
  });

  it('restores ?tab=past&q=karijini on load', async () => {
    setup('/bookings?tab=past&q=karijini');
    await waitFor(() => expect(cardNames()).toEqual(['Dales Campground']));
    expect(tab(/^Past/)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('searchbox', { name: 'Search trips' })).toHaveValue('karijini');
  });

  it('says when a search matches nothing, and Clear search brings the trips back', async () => {
    const { user } = setup('/bookings?q=broome');
    expect(await screen.findByText('No trips match "broome"')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(currentRoute()).toBe('/bookings');
    expect(cardNames()).toEqual(['Osprey Bay', 'Fortescue Falls']);
  });

  it('shows "No trips yet" with a way to add one when there are no bookings', async () => {
    setup('/bookings', []);
    expect(await screen.findByRole('heading', { name: 'No trips yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add your first booking' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('button', { name: /import/i })).toBeNull();
  });

  it('shows each provider on its cards, and an unknown provider as such', async () => {
    const orphan = makeBooking({ id: 9, providerId: 'gone', location: { name: 'Old Camp' } });
    setup('/bookings', [OSPREY, orphan]);
    const known = await screen.findByRole('article', { name: 'Osprey Bay' });
    expect(within(known).getByRole('img', { name: 'ParkStay WA' })).toBeInTheDocument();
    const unknown = screen.getByRole('article', { name: 'Old Camp' });
    expect(within(unknown).getByRole('img', { name: 'Unknown provider' })).toBeInTheDocument();
  });
});
