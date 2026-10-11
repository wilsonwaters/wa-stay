/**
 * Bookings in the app (U3), against a fake api that stores bookings in memory and sends
 * `booking:updated` the way main does: add a booking by hand → it appears in Upcoming → open
 * it → remove it from WA Stay → it is gone.
 */
import { screen, waitFor, within } from '@testing-library/react';
import type { Booking, BookingInput } from '../../../src/shared/types/booking.types';
import { BookingStatus } from '../../../src/shared/types/common.types';
import { nightsBetween } from '../../../src/shared/utils/calendar-date';
import {
  FAKE_MANIFEST,
  PARKSTAY_MANIFEST,
  createMockApi,
  ok,
} from '../../utils/renderer/createMockApi';
import { currentRoute, renderWithApp } from '../../utils/renderer/renderWithApp';

const NO_CATALOG = {
  ...FAKE_MANIFEST,
  capabilities: { ...FAKE_MANIFEST.capabilities, catalog: false },
};

function fakeBookingsApi() {
  let rows: Booking[] = [];
  let nextId = 1;
  const mock = createMockApi({
    providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST, NO_CATALOG])) },
  });
  const announce = (booking: Booking) => mock.emit('booking:updated', booking);
  const create = jest.fn(async (input: BookingInput) => {
    const booking: Booking = {
      id: nextId++,
      userId: 1,
      providerId: input.providerId,
      location: input.location,
      bookingReference: input.bookingReference,
      stay: { children: 0, infants: 0, concessions: 0, ...input.stay },
      unitIds: input.unitIds ?? [],
      stayParams: input.stayParams ?? {},
      numNights: nightsBetween(input.stay.arrival, input.stay.departure),
      totalCost: input.totalCost,
      currency: 'AUD',
      status: BookingStatus.CONFIRMED,
      notes: input.notes,
      manageUrl: 'https://fake.example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    rows = [...rows, booking];
    setTimeout(() => announce(booking));
    return ok(booking);
  });
  const remove = jest.fn(async (id: number) => {
    const booking = rows.find((b) => b.id === id);
    rows = rows.filter((b) => b.id !== id);
    if (booking) setTimeout(() => announce(booking));
    return ok(true);
  });
  Object.assign(mock.api.bookings, {
    list: jest.fn(async () => ok(rows)),
    get: jest.fn(async (id: number) => ok(rows.find((b) => b.id === id) ?? null)),
    create,
    delete: remove,
  });
  return { mock, create, remove };
}

describe('bookings, end to end', () => {
  beforeEach(() => window.localStorage.clear());

  it('adds a booking by hand, finds it in Upcoming, opens it and removes it', async () => {
    const { mock, create, remove } = fakeBookingsApi();
    const { user } = renderWithApp({ route: '/bookings', api: mock });

    // Empty to start with; add from the header.
    expect(await screen.findByRole('heading', { name: 'No trips yet' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add booking' }));
    const dialog = screen.getByRole('dialog', { name: 'Add booking' });

    // 1. Provider: both are offered (adding needs no capability).
    await user.click(await within(dialog).findByRole('radio', { name: 'Fake Stay Holidays' }));
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));

    // 2. Details: a provider without a catalogue takes the place as text.
    await user.type(await within(dialog).findByRole('textbox', { name: 'Location' }), 'Lucky Bay');
    await user.type(within(dialog).getByRole('textbox', { name: 'Area (optional)' }), 'Esperance');
    await user.click(within(dialog).getByRole('button', { name: /^Dates/ }));
    await user.keyboard('{ArrowRight}{Enter}{ArrowRight}{ArrowRight}{Enter}');
    await user.click(
      within(screen.getByRole('dialog', { name: 'Choose dates' })).getByRole('button', {
        name: 'Done',
      })
    );
    await user.type(within(dialog).getByRole('textbox', { name: 'Site (optional)' }), '14');
    await user.type(within(dialog).getByRole('textbox', { name: 'Booking reference' }), 'lb-2041');
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Total cost (optional)' }),
      '96.50'
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add booking' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const input = create.mock.calls[0][0];
    expect(input).not.toHaveProperty('userId');
    expect(input).toMatchObject({
      providerId: 'fakestay',
      bookingReference: 'lb-2041',
      location: { name: 'Lucky Bay', areaName: 'Esperance' },
      unitIds: ['14'],
      totalCost: 96.5,
    });
    expect(input.stay.arrival).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(nightsBetween(input.stay.arrival, input.stay.departure)).toBe(2);

    // It appears in Upcoming, with its provider.
    const card = await screen.findByRole('article', { name: 'Lucky Bay' });
    expect(screen.getByRole('tab', { name: 'Upcoming, 1 trip' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(within(card).getByRole('img', { name: 'Fake Stay Holidays' })).toBeInTheDocument();
    expect(card).toHaveTextContent('Site 14 · Ref lb-2041');
    // The empty state's button is gone; focus is on the header's "Add booking".
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add booking' })).toHaveFocus());

    // Open it.
    await user.click(within(card).getByRole('link', { name: 'Lucky Bay' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Lucky Bay' })).toBeInTheDocument();
    expect(currentRoute()).toBe('/bookings/1');
    expect(
      screen.getByRole('link', { name: 'Manage on Fake Stay (opens in your browser)' })
    ).toHaveAttribute('href', 'https://fake.example.com');
    expect(screen.getByRole('region', { name: 'Cost' })).toHaveTextContent('$96.50');

    // Remove it from WA Stay.
    await user.click(screen.getByRole('button', { name: 'More actions for Lucky Bay' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from WA Stay' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove from WA Stay' })
    );

    await waitFor(() => expect(currentRoute()).toBe('/bookings'));
    expect(remove).toHaveBeenCalledWith(1);
    expect(await screen.findByRole('heading', { name: 'No trips yet' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Lucky Bay' })).toBeNull();
  });
});
