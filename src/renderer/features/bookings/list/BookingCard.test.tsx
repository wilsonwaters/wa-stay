import { screen, waitFor, within } from '@testing-library/react';
import { BookingStatus } from '../../../../shared/types/common.types';
import { PARKSTAY_MANIFEST, ok } from '@tests/utils/renderer/createMockApi';
import { freezeDateAt, makeBooking, makeLegacyBooking } from '@tests/fixtures/renderer/bookings';
import { makeLocation } from '@tests/fixtures/renderer/watches';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { BookingsPage } from '../BookingsPage';
import { BookingCard } from './BookingCard';

freezeDateAt('2026-12-13T02:00:00Z');

const PHOTO = 'https://parkstay.dbca.wa.gov.au/media/osprey.jpg';
const OSPREY = makeBooking({
  id: 1,
  stay: { ...makeBooking().stay, arrival: '2026-12-12', departure: '2026-12-14', children: 1 },
});

function renderCard(booking = OSPREY, place?: { imageUrls: string[] }) {
  const onRemove = jest.fn();
  const result = renderWithProviders(
    <BookingCard
      booking={booking}
      manifest={PARKSTAY_MANIFEST}
      today="2026-12-13"
      place={place ? { ...place, kind: 'campground' } : undefined}
      onRemove={onRemove}
    />,
    { route: '/bookings' }
  );
  return { ...result, onRemove };
}

describe('BookingCard', () => {
  it('shows the provider, the place, the dates, the party, the unit and the reference', async () => {
    renderCard(OSPREY, { imageUrls: [PHOTO] });
    const card = screen.getByRole('article', { name: 'Osprey Bay' });
    expect(await within(card).findByRole('img', { name: 'ParkStay WA' })).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Osprey Bay' })).toHaveAttribute(
      'href',
      '#/bookings/1'
    );
    expect(within(card).getByText('Cape Range National Park')).toBeInTheDocument();
    expect(
      within(card).getByText('Sat 12 – Mon 14 Dec · 2 nights · 2 adults, 1 child')
    ).toBeVisible();
    expect(card).toHaveTextContent('Site 12 · Ref PB123456');
    // Confirmed is the norm and goes unsaid; a trip under way says so.
    expect(within(card).queryByText('Confirmed')).toBeNull();
    expect(within(card).getByText('Happening now')).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: 'Osprey Bay' })).toHaveAttribute('src', PHOTO);
  });

  it('shows a neutral placeholder when the place is not in the catalogue (a v6 booking)', () => {
    renderCard(makeLegacyBooking({ status: BookingStatus.PENDING }));
    const card = screen.getByRole('article', { name: 'Dales Campground' });
    expect(
      within(card).getByRole('img', { name: 'No photo available for Dales Campground' })
    ).toBeInTheDocument();
    expect(within(card).getByText('Karijini National Park')).toBeInTheDocument();
    expect(within(card).getByText('Pending')).toBeInTheDocument();
    expect(card).toHaveTextContent('Ref BK123456');
  });

  it('offers "Remove from WA Stay" in its More actions menu', async () => {
    const { user, onRemove } = renderCard();
    await user.click(screen.getByRole('button', { name: 'More actions for Osprey Bay' }));
    const menu = screen.getByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent)
    ).toEqual(['Remove from WA Stay']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Remove from WA Stay' }));
    expect(onRemove).toHaveBeenCalledWith(OSPREY);
  });

  it('takes every photo from one search of the local catalogue, never a request per card', async () => {
    const search = jest
      .fn()
      .mockResolvedValue(ok({ items: [makeLocation({ imageUrls: [PHOTO] })], total: 1 }));
    const get = jest.fn();
    const dales = makeLegacyBooking({ id: 2 });
    renderWithProviders(<BookingsPage />, {
      route: '/bookings',
      api: {
        bookings: { list: jest.fn().mockResolvedValue(ok([OSPREY, dales])) },
        catalog: { search, get },
      },
    });
    const card = await screen.findByRole('article', { name: 'Osprey Bay' });
    await waitFor(() =>
      expect(within(card).getByRole('img', { name: 'Osprey Bay' })).toHaveAttribute('src', PHOTO)
    );
    expect(search).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
  });
});
