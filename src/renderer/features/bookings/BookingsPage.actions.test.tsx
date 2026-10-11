import { screen, waitFor, within } from '@testing-library/react';
import type { Booking } from '../../../shared/types/booking.types';
import { PARKSTAY_MANIFEST, fail, ok } from '@tests/utils/renderer/createMockApi';
import { IMPORT_MANIFEST, makeBooking } from '@tests/fixtures/renderer/bookings';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { BookingsPage } from './BookingsPage';

beforeEach(() => window.localStorage.clear());

const OSPREY = makeBooking({ id: 1 });
const DALES = makeBooking({
  id: 2,
  bookingReference: 'PB220011',
  location: { externalId: '7', name: 'Dales Campground', areaName: 'Karijini National Park' },
});

function setup({
  bookings = [OSPREY, DALES],
  manifests = [PARKSTAY_MANIFEST],
  remove = jest.fn().mockResolvedValue(ok(true)),
}: { bookings?: Booking[]; manifests?: unknown[]; remove?: jest.Mock } = {}) {
  let stored = bookings;
  const list = jest.fn(() => Promise.resolve(ok(stored)));
  const deleteBooking = jest.fn(async (id: number) => {
    const response = await remove(id);
    if (response.success) stored = stored.filter((b) => b.id !== id);
    return response;
  });
  const result = renderWithProviders(<BookingsPage />, {
    route: '/bookings',
    api: {
      providers: { list: jest.fn().mockResolvedValue(ok(manifests)) },
      bookings: { list, delete: deleteBooking },
      accounts: { list: jest.fn().mockResolvedValue(ok([])) },
    },
  });
  return { ...result, deleteBooking };
}

const toasts = () => screen.getByRole('region', { name: 'Notifications' });

describe('BookingsPage actions', () => {
  it('removes a booking from its card menu after saying it is not cancelled at the provider', async () => {
    const { user, deleteBooking } = setup();
    const card = await screen.findByRole('article', { name: 'Dales Campground' });
    await user.click(
      within(card).getByRole('button', { name: 'More actions for Dales Campground' })
    );
    await user.click(screen.getByRole('menuitem', { name: 'Remove from WA Stay' }));

    const dialog = screen.getByRole('alertdialog', {
      name: 'Remove Dales Campground from WA Stay?',
    });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(
      'This removes the booking from WA Stay only. It does not cancel it on ParkStay.'
    );
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Remove from WA Stay' }));

    await waitFor(() =>
      expect(screen.queryByRole('article', { name: 'Dales Campground' })).toBeNull()
    );
    expect(deleteBooking).toHaveBeenCalledWith(2);
    expect(within(toasts()).getByText('Removed Dales Campground from WA Stay')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('article', { name: 'Osprey Bay' })).toBeInTheDocument();
  });

  it('keeps the booking and shows an error toast when removing fails', async () => {
    const remove = jest.fn().mockResolvedValue(fail('The database is locked'));
    const { user } = setup({ remove });
    const card = await screen.findByRole('article', { name: 'Osprey Bay' });
    await user.click(within(card).getByRole('button', { name: 'More actions for Osprey Bay' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from WA Stay' }));
    await user.click(screen.getByRole('button', { name: 'Remove from WA Stay' }));

    expect(
      await within(toasts()).findByText("Osprey Bay couldn't be removed: The database is locked")
    ).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Osprey Bay' })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('closes the remove confirmation on Escape, returning focus to the menu button', async () => {
    const { user, deleteBooking } = setup();
    const card = await screen.findByRole('article', { name: 'Osprey Bay' });
    const more = within(card).getByRole('button', { name: 'More actions for Osprey Bay' });
    await user.click(more);
    await user.click(screen.getByRole('menuitem', { name: 'Remove from WA Stay' }));
    expect(screen.getByRole('alertdialog')).toHaveAttribute('aria-modal', 'true');
    await user.tab();
    await user.tab();
    expect(screen.getByRole('alertdialog')).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(more).toHaveFocus();
    expect(deleteBooking).not.toHaveBeenCalled();
  });

  it('has no Import booking button when no provider can import (ParkStay cannot)', async () => {
    setup();
    await screen.findByRole('article', { name: 'Osprey Bay' });
    expect(screen.queryByRole('button', { name: 'Import booking' })).toBeNull();
  });

  it('offers Import booking when a provider can import, also from the empty state', async () => {
    const { user } = setup({ bookings: [], manifests: [PARKSTAY_MANIFEST, IMPORT_MANIFEST] });
    expect(await screen.findByRole('button', { name: 'Import booking' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import a booking' }));
    expect(screen.getByRole('dialog', { name: 'Import booking' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();

    const header = screen.getByRole('button', { name: 'Import booking' });
    await user.click(header);
    const dialog = screen.getByRole('dialog', { name: 'Import booking' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    await within(dialog).findByRole('textbox', { name: 'Booking reference' });
    for (let i = 0; i < 5; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await user.keyboard('{Escape}');
    expect(header).toHaveFocus();
  });

  it('opens Add booking on the provider step and returns focus to the button on Escape', async () => {
    const { user } = setup();
    const add = screen.getByRole('button', { name: 'Add booking' });
    await user.click(add);
    const dialog = screen.getByRole('dialog', { name: 'Add booking' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(
      within(dialog).getByRole('heading', { level: 2, name: /Provider$/ })
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(add).toHaveFocus();
  });
});
