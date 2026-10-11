import { contract } from '../../../../shared/contracts';
import { makeBooking } from '@tests/fixtures/renderer/bookings';
import { FAKE_MANIFEST, PARKSTAY_MANIFEST } from '@tests/utils/renderer/manifests';
import {
  emptyBookingValues,
  existingBooking,
  parseAmount,
  toBookingInput,
  validateDetails,
  type AddBookingValues,
} from './addBookingForm';

const NO_CATALOG = {
  ...FAKE_MANIFEST,
  capabilities: { ...FAKE_MANIFEST.capabilities, catalog: false },
};

const filled = (over: Partial<AddBookingValues> = {}): AddBookingValues => ({
  ...emptyBookingValues('parkstay'),
  location: { externalId: '20', name: 'Osprey Bay', areaName: 'Cape Range National Park' },
  areaName: 'Cape Range National Park',
  arrival: '2026-12-12',
  departure: '2026-12-14',
  reference: '  PB123456 ',
  ...over,
});

describe('add booking form', () => {
  it('asks for a place, dates and a reference', () => {
    expect(validateDetails(emptyBookingValues('parkstay'), PARKSTAY_MANIFEST)).toEqual({
      location: 'Choose the place you booked',
      dates: 'Choose your check-in and check-out dates',
      reference: 'Enter the booking reference',
    });
    expect(validateDetails(emptyBookingValues('fakestay'), NO_CATALOG).location).toBe(
      "Enter the place's name"
    );
  });

  it('accepts lowercase letters and dashes in a reference, up to 50 characters', () => {
    expect(validateDetails(filled({ reference: 'abc-123-xy' }), PARKSTAY_MANIFEST)).toEqual({});
    expect(validateDetails(filled({ reference: 'x'.repeat(50) }), PARKSTAY_MANIFEST)).toEqual({});
    expect(validateDetails(filled({ reference: 'x'.repeat(51) }), PARKSTAY_MANIFEST)).toEqual({
      reference: 'Use 50 characters or fewer',
    });
  });

  it('checks the dates, the guests and the cost', () => {
    expect(
      validateDetails(
        filled({ departure: '2026-12-12', adults: 0, totalCost: 'about 80' }),
        PARKSTAY_MANIFEST
      )
    ).toEqual({
      dates: 'Check-out must be after check-in',
      adults: 'Add at least one guest',
      totalCost: 'Enter an amount like 105.50, or leave it empty',
    });
    expect(parseAmount('$1,050.50')).toBe(1050.5);
    expect(parseAmount('')).toBeUndefined();
  });

  it('sends calendar dates, the catalogue place and the reference as typed (trimmed)', () => {
    const input = toBookingInput(
      filled({ reference: ' pb-77a ', unit: ' Site 12 ', totalCost: '105.50', notes: ' Hi ' }),
      PARKSTAY_MANIFEST
    );
    expect(input).toEqual({
      providerId: 'parkstay',
      bookingReference: 'pb-77a',
      location: { externalId: '20', name: 'Osprey Bay', areaName: 'Cape Range National Park' },
      stay: { arrival: '2026-12-12', departure: '2026-12-14', adults: 2, children: 0, infants: 0 },
      unitIds: ['Site 12'],
      totalCost: 105.5,
      notes: 'Hi',
    });
    expect(contract.bookings.create.request.parse(input)).toEqual(input);
  });

  it('sends a typed place with no id for a provider without a catalogue', () => {
    const input = toBookingInput(
      filled({ providerId: 'fakestay', location: null, locationName: ' Lucky Bay ', areaName: '' }),
      NO_CATALOG
    );
    expect(input.location).toEqual({ name: 'Lucky Bay' });
    expect(input).not.toHaveProperty('unitIds');
    expect(input).not.toHaveProperty('totalCost');
  });

  it('finds a booking already stored under the same provider and reference', () => {
    const stored = makeBooking({ id: 7, bookingReference: 'PB123456' });
    expect(existingBooking([stored], 'parkstay', ' PB123456 ')).toBe(stored);
    expect(existingBooking([stored], 'fakestay', 'PB123456')).toBeUndefined();
  });
});
