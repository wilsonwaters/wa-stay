import { makeBooking } from '@tests/fixtures/renderer/bookings';
import { FAKE_MANIFEST, PARKSTAY_MANIFEST } from '@tests/utils/renderer/manifests';
import {
  formatCost,
  fullDayLabel,
  stayParamRows,
  tripDatesLabel,
  tripNightsLabel,
  unitLabel,
} from './bookingFormat';

const stay = (arrival: string, departure: string) => ({
  ...makeBooking().stay,
  arrival,
  departure,
});

describe('booking dates', () => {
  it('reads like "Sat 12 – Mon 14 Dec", with the year outside this year', () => {
    expect(tripDatesLabel(stay('2026-12-12', '2026-12-14'), '2026-12-13')).toBe(
      'Sat 12 – Mon 14 Dec'
    );
    expect(tripDatesLabel(stay('2025-12-12', '2025-12-14'), '2026-12-13')).toBe(
      'Fri 12 – Sun 14 Dec 2025'
    );
    expect(fullDayLabel('2026-12-12')).toBe('Sat 12 Dec 2026');
  });

  it('counts nights between calendar dates, also across a daylight-saving change', () => {
    expect(tripNightsLabel(stay('2026-12-12', '2026-12-14'))).toBe('2 nights');
    // Sydney moves its clocks on 4 Oct 2026; calendar nights don't care.
    expect(tripNightsLabel(stay('2026-10-03', '2026-10-05'))).toBe('2 nights');
    expect(tripNightsLabel(stay('2027-04-03', '2027-04-04'))).toBe('1 night');
  });

  it('shows a stored date that is not a calendar date as it is, never throwing', () => {
    const odd = stay('2026-02-30', '2026-03-02');
    expect(tripDatesLabel(odd, '2026-01-01')).toBe('2026-02-30 – 2026-03-02');
    expect(tripNightsLabel(odd)).toBeUndefined();
    expect(fullDayLabel('soon')).toBe('soon');
  });
});

describe('cost', () => {
  it('formats Australian dollars, and another currency by its code', () => {
    expect(formatCost(105, 'AUD')).toBe('$105.00');
    expect(formatCost(1050.5, undefined)).toBe('$1,050.50');
    expect(formatCost(80, 'USD')).toMatch(/^USD\s80\.00$/);
    expect(formatCost(80, 'XX1')).toBe('XX1 80.00');
  });
});

describe('units', () => {
  it('names a bare number with the provider’s unit noun, and keeps typed text', () => {
    expect(unitLabel(makeBooking({ unitIds: ['12'] }), PARKSTAY_MANIFEST)).toBe('Site 12');
    expect(unitLabel(makeBooking({ unitIds: ['Cabin 4, lakeside'] }), FAKE_MANIFEST)).toBe(
      'Cabin 4, lakeside'
    );
    expect(unitLabel(makeBooking({ unitIds: [] }), PARKSTAY_MANIFEST)).toBeUndefined();
    // Text that merely contains a colon is the person's, and shows as typed.
    expect(unitLabel(makeBooking({ unitIds: ['Site: 12'] }), FAKE_MANIFEST)).toBe('Site: 12');
    expect(unitLabel(makeBooking({ unitIds: ['CAMPSITE 07'] }), PARKSTAY_MANIFEST)).toBe(
      'CAMPSITE 07'
    );
  });

  it('names internal ids from the place’s units, never renaming a site number', () => {
    const booking = makeBooking({ unitIds: ['class:7', '12'] });
    const units = [
      { unitId: 'class:7', unitName: 'Unpowered site' },
      // ParkStay's own id 12 is another site: a booking's "12" is the site the person typed.
      { unitId: '12', unitName: 'CAMPSITE 07' },
    ];
    expect(unitLabel(booking, PARKSTAY_MANIFEST)).toBe('Site 12');
    expect(unitLabel(booking, PARKSTAY_MANIFEST, units)).toBe('Unpowered site, Site 12');
    expect(unitLabel(makeBooking({ unitIds: ['class:7'] }), PARKSTAY_MANIFEST)).toBeUndefined();
  });
});

describe('stay params', () => {
  it('shows declared fields by their labels, a v1 site type, and never internal ids', () => {
    expect(
      stayParamRows(
        { parkId: '17', gearType: 'tent', numVehicles: 1, postcode: '6000', siteType: 'Powered' },
        PARKSTAY_MANIFEST
      )
    ).toEqual([
      { label: 'Camping with', value: 'Tent' },
      { label: 'Vehicles', value: '1' },
      { label: 'Postcode', value: '6000' },
      { label: 'Site type', value: 'Powered' },
    ]);
    expect(stayParamRows({}, undefined)).toEqual([]);
  });
});
