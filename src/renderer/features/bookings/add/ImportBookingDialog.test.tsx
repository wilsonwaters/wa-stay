import { screen, waitFor, within } from '@testing-library/react';
import type { Booking } from '../../../../shared/types/booking.types';
import type { ProviderAccount } from '../../../../shared/types/provider.types';
import { PARKSTAY_MANIFEST, fail, ok } from '@tests/utils/renderer/createMockApi';
import { IMPORT_MANIFEST, makeBooking } from '@tests/fixtures/renderer/bookings';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { ImportBookingDialog } from './ImportBookingDialog';

const SIGNED_OUT: ProviderAccount = {
  providerId: 'tripco',
  requirement: 'required',
  status: 'signed-out',
};

function setup({
  bookings = [] as Booking[],
  importBooking = jest
    .fn()
    .mockResolvedValue(
      ok(makeBooking({ id: 40, providerId: 'tripco', bookingReference: 'tc-9001' }))
    ),
  accounts = [] as ProviderAccount[],
} = {}) {
  const onClose = jest.fn();
  const onImported = jest.fn();
  const result = renderWithProviders(
    <ImportBookingDialog open onClose={onClose} bookings={bookings} onImported={onImported} />,
    {
      api: {
        providers: { list: jest.fn().mockResolvedValue(ok([PARKSTAY_MANIFEST, IMPORT_MANIFEST])) },
        bookings: { import: importBooking },
        accounts: { list: jest.fn().mockResolvedValue(ok(accounts)) },
      },
    }
  );
  return { ...result, onClose, onImported, importBooking };
}

const reference = () => screen.findByRole('textbox', { name: 'Booking reference' });

describe('ImportBookingDialog', () => {
  it('is a named modal that lists only providers that can import', async () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: 'Import booking' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const radio = await within(dialog).findByRole('radio', { name: 'TripCo Holiday Parks' });
    expect(within(dialog).getAllByRole('radio')).toHaveLength(1);
    await waitFor(() => expect(radio).toBeChecked());
    expect(within(dialog).queryByRole('radio', { name: 'ParkStay WA' })).toBeNull();
    expect(await reference()).toHaveAccessibleDescription(
      'Find it in your TripCo confirmation email.'
    );
  });

  it('imports through bookings.import with the provider and the reference as typed', async () => {
    const { user, importBooking, onImported, onClose } = setup();
    await user.type(await reference(), ' tc-9001 ');
    await user.click(screen.getByRole('button', { name: 'Import booking' }));
    await waitFor(() => expect(importBooking).toHaveBeenCalledWith('tripco', 'tc-9001'));
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ id: 40 }));
    expect(onClose).toHaveBeenCalled();
  });

  it('says a reference is already in your bookings, with a link to it', async () => {
    const stored = makeBooking({ id: 8, providerId: 'tripco', bookingReference: 'tc-9001' });
    const { user, importBooking } = setup({ bookings: [stored] });
    await user.type(await reference(), 'tc-9001');
    await user.click(screen.getByRole('button', { name: 'Import booking' }));
    expect(await screen.findByText(/Already in your bookings/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Osprey Bay' })).toHaveAttribute(
      'href',
      '#/bookings/8'
    );
    expect(await reference()).toHaveFocus();
    expect(importBooking).not.toHaveBeenCalled();
  });

  it('keeps the dialog open with the reference when the provider fails', async () => {
    const importBooking = jest
      .fn()
      .mockResolvedValue(fail('TripCo did not answer in time', 'PROVIDER_ERROR'));
    const { user, onClose } = setup({ importBooking });
    await user.type(await reference(), 'tc-1');
    await user.click(screen.getByRole('button', { name: 'Import booking' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("The booking couldn't be imported");
    expect(alert).toHaveTextContent('TripCo did not answer in time');
    expect(await reference()).toHaveValue('tc-1');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('links to Settings → Accounts when the provider needs an account and is signed out', async () => {
    setup({ accounts: [SIGNED_OUT] });
    const link = await screen.findByRole('link', { name: 'Connect TripCo' });
    expect(link).toHaveAttribute('href', '#/settings/accounts?provider=tripco');
    expect(screen.getByText('Sign in to TripCo first')).toBeInTheDocument();
  });

  it('asks for a provider first when several can import', async () => {
    const other = { ...IMPORT_MANIFEST, id: 'staysco', name: 'Stays Co', shortName: 'Stays' };
    const importBooking = jest.fn();
    const { user } = renderWithProviders(
      <ImportBookingDialog open onClose={jest.fn()} bookings={[]} onImported={jest.fn()} />,
      {
        api: {
          providers: { list: jest.fn().mockResolvedValue(ok([IMPORT_MANIFEST, other])) },
          bookings: { import: importBooking },
          accounts: { list: jest.fn().mockResolvedValue(ok([])) },
        },
      }
    );
    expect(await screen.findAllByRole('radio')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Import booking' }));
    expect(screen.getByText('Choose a provider to continue.')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Stays Co' }));
    expect(screen.queryByText('Choose a provider to continue.')).toBeNull();
    expect(await reference()).toHaveAccessibleDescription(
      'Find it in your Stays confirmation email.'
    );
    expect(importBooking).not.toHaveBeenCalled();
  });

  it('asks for a reference before importing', async () => {
    const { user, importBooking } = setup();
    await reference();
    await user.click(screen.getByRole('button', { name: 'Import booking' }));
    expect(screen.getByText('Enter the booking reference')).toBeInTheDocument();
    expect(importBooking).not.toHaveBeenCalled();
  });
});
