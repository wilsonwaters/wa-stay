import { useState } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import type { Booking, BookingInput } from '../../../../shared/types/booking.types';
import { FAKE_MANIFEST, PARKSTAY_MANIFEST, fail, ok } from '@tests/utils/renderer/createMockApi';
import { freezeDateAt, makeBooking } from '@tests/fixtures/renderer/bookings';
import { makeLocation } from '@tests/fixtures/renderer/watches';
import { renderWithProviders } from '@tests/utils/renderer/renderWithProviders';
import { AddBookingDialog } from './AddBookingDialog';

freezeDateAt('2026-12-13T02:00:00Z');

const NO_CATALOG = {
  ...FAKE_MANIFEST,
  capabilities: { ...FAKE_MANIFEST.capabilities, catalog: false },
};

function Harness({ bookings, onAdded }: { bookings: Booking[]; onAdded: jest.Mock }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open add
      </button>
      <AddBookingDialog
        open={open}
        onClose={() => setOpen(false)}
        bookings={bookings}
        onAdded={onAdded}
      />
    </>
  );
}

function setup({
  manifests = [PARKSTAY_MANIFEST],
  bookings = [] as Booking[],
  conflict = false,
} = {}) {
  const create = jest.fn((input: BookingInput) =>
    conflict
      ? Promise.resolve(fail('This booking is already in your bookings', 'CONFLICT'))
      : Promise.resolve(
          ok(makeBooking({ id: 30, ...input, stay: { ...makeBooking().stay, ...input.stay } }))
        )
  );
  const onAdded = jest.fn();
  const result = renderWithProviders(<Harness bookings={bookings} onAdded={onAdded} />, {
    api: {
      providers: { list: jest.fn().mockResolvedValue(ok(manifests)) },
      bookings: { create },
      catalog: {
        search: jest.fn().mockResolvedValue(ok({ items: [makeLocation()], total: 1 })),
        status: jest
          .fn()
          .mockResolvedValue(
            ok({ providers: [{ providerId: 'parkstay', count: 1, stale: false, syncing: false }] })
          ),
      },
    },
  });
  return { ...result, create, onAdded };
}

async function open(user: ReturnType<typeof setup>['user']) {
  await user.click(screen.getByRole('button', { name: 'Open add' }));
  return screen.getByRole('dialog', { name: 'Add booking' });
}

async function pickTwoNights(user: ReturnType<typeof setup>['user']) {
  await user.click(screen.getByRole('button', { name: /^Dates/ }));
  await user.keyboard('{ArrowRight}{Enter}{ArrowRight}{ArrowRight}{Enter}');
  await user.click(
    within(screen.getByRole('dialog', { name: 'Choose dates' })).getByRole('button', {
      name: 'Done',
    })
  );
}

describe('AddBookingDialog', () => {
  it('opens on the provider step as a named modal that keeps focus and returns it', async () => {
    const { user } = setup({ manifests: [PARKSTAY_MANIFEST, FAKE_MANIFEST] });
    const dialog = await open(user);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(
      within(dialog).getByRole('heading', { level: 2, name: /Provider$/ })
    ).toBeInTheDocument();
    expect(await within(dialog).findAllByRole('radio')).toHaveLength(2);

    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open add' })).toHaveFocus();
  });

  it('asks for the place with the catalogue for a provider that has one', async () => {
    const { user } = setup();
    await open(user);
    await waitFor(() => expect(screen.getByRole('radio', { name: 'ParkStay WA' })).toBeChecked());
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('combobox', { name: 'Location' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Location' })).toBeNull();
  });

  it('asks for the place as text for a provider without a catalogue', async () => {
    const { user } = setup({ manifests: [NO_CATALOG] });
    await open(user);
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Fake Stay Holidays' })).toBeChecked()
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('textbox', { name: 'Location' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Location' })).toBeNull();
  });

  it('checks the details, focusing the first problem', async () => {
    const { user, create } = setup({ manifests: [NO_CATALOG] });
    await open(user);
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Fake Stay Holidays' })).toBeChecked()
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Add booking' }));
    expect(screen.getByRole('textbox', { name: 'Location' })).toHaveFocus();
    expect(screen.getByText("Enter the place's name")).toBeInTheDocument();
    expect(screen.getByText('Enter the booking reference')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('submits through bookings.create with the provider and calendar dates', async () => {
    const { user, create, onAdded } = setup();
    await open(user);
    await waitFor(() => expect(screen.getByRole('radio', { name: 'ParkStay WA' })).toBeChecked());
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(await screen.findByRole('combobox', { name: 'Location' }), 'Osp');
    await user.click(await screen.findByRole('option', { name: /Osprey Bay/ }));
    expect(screen.getByRole('textbox', { name: 'Area (optional)' })).toHaveValue(
      'Cape Range National Park'
    );
    await pickTwoNights(user);
    await user.type(screen.getByRole('textbox', { name: 'Booking reference' }), ' pb-77a ');
    await user.click(screen.getByRole('button', { name: 'Add booking' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const input = create.mock.calls[0][0];
    expect(input).toMatchObject({
      providerId: 'parkstay',
      bookingReference: 'pb-77a',
      location: { externalId: '20', name: 'Osprey Bay', areaName: 'Cape Range National Park' },
      stay: { adults: 2, children: 0, infants: 0 },
    });
    expect(input.stay.arrival).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(input.stay.departure).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(expect.objectContaining({ id: 30 })));
    expect(screen.queryByRole('dialog', { name: 'Add booking' })).toBeNull();
  });

  it('shows main’s CONFLICT at the reference when the booking was added meanwhile', async () => {
    const { user, create } = setup({ manifests: [NO_CATALOG], conflict: true });
    await open(user);
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Fake Stay Holidays' })).toBeChecked()
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(await screen.findByRole('textbox', { name: 'Location' }), 'Lucky Bay');
    await pickTwoNights(user);
    await user.type(screen.getByRole('textbox', { name: 'Booking reference' }), 'lb-1');
    await user.click(screen.getByRole('button', { name: 'Add booking' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const reference = screen.getByRole('textbox', { name: 'Booking reference' });
    expect(reference).toHaveAccessibleDescription(
      expect.stringContaining('This booking is already in your bookings')
    );
    expect(reference).toHaveFocus();
    expect(screen.queryByText("The booking couldn't be added")).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Add booking' })).toBeInTheDocument();
  });

  it('says a reference is already in your bookings, with a link to it', async () => {
    const stored = makeBooking({ id: 7, bookingReference: 'PB123456' });
    const { user, create } = setup({
      manifests: [NO_CATALOG],
      bookings: [{ ...stored, providerId: 'fakestay' }],
    });
    await open(user);
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Fake Stay Holidays' })).toBeChecked()
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(await screen.findByRole('textbox', { name: 'Location' }), 'Lucky Bay');
    await pickTwoNights(user);
    await user.type(screen.getByRole('textbox', { name: 'Booking reference' }), 'PB123456');
    await user.click(screen.getByRole('button', { name: 'Add booking' }));

    expect(await screen.findByText(/Already in your bookings/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Osprey Bay' })).toHaveAttribute(
      'href',
      '#/bookings/7'
    );
    expect(create).not.toHaveBeenCalled();
  });
});
