/**
 * The provider-aware watch, snipe and booking request schemas (V2): every request names its
 * provider, a location and a stay of calendar dates `YYYY-MM-DD`. Instants and ISO
 * timestamps are rejected as stay dates.
 */

import { contract } from '@shared/contracts';
import { SnipeReleaseMode } from '@shared/types/common.types';

const stay = { arrival: '2026-07-19', departure: '2026-07-21', adults: 2 };
const location = { externalId: '34', name: 'Osprey Bay', areaName: 'Cape Range' };

const watch = { providerId: 'parkstay', name: 'Easter', location, stay };
const snipe = {
  providerId: 'parkstay',
  name: 'July',
  location,
  stay,
  releaseMode: SnipeReleaseMode.DAILY_ROLLOVER,
};
const booking = {
  providerId: 'parkstay',
  bookingReference: 'PS0012345',
  location: { name: 'Osprey Bay' },
  stay,
};

const creates = [
  ['watches', contract.watches.create.request, watch],
  ['snipes', contract.snipes.create.request, snipe],
  ['bookings', contract.bookings.create.request, booking],
] as const;

describe('provider-aware request schemas', () => {
  it.each(creates)('%s.create accepts a calendar-date stay', (_name, schema, input) => {
    expect(schema.parse(input)).toMatchObject({ providerId: 'parkstay', stay });
  });

  it.each(creates)(
    '%s.create rejects an ISO timestamp as the arrival, with the path',
    (_name, schema, input) => {
      const result = schema.safeParse({
        ...input,
        stay: { ...stay, arrival: '2026-07-19T00:00:00.000Z' },
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues.map((i) => i.path.join('.'))).toContain('stay.arrival');
    }
  );

  it.each(creates)(
    '%s.create rejects an impossible date, a departure before arrival and a Date object',
    (_name, schema, input) => {
      expect(schema.safeParse({ ...input, stay: { ...stay, arrival: '2026-02-30' } }).success).toBe(
        false
      );
      expect(
        schema.safeParse({ ...input, stay: { ...stay, departure: '2026-07-18' } }).success
      ).toBe(false);
      expect(
        schema.safeParse({ ...input, stay: { ...stay, arrival: new Date('2026-07-19') } }).success
      ).toBe(false);
    }
  );

  it.each(creates)('%s.create requires a valid provider id', (_name, schema, input) => {
    const { providerId: _omit, ...withoutProvider } = input;
    expect(schema.safeParse(withoutProvider).success).toBe(false);
    expect(schema.safeParse({ ...input, providerId: 'Not A Provider' }).success).toBe(false);
  });

  it('accepts stay params of strings, numbers and booleans only', () => {
    const schema = contract.snipes.create.request;
    expect(
      schema.safeParse({ ...snipe, stayParams: { gearType: 'tent', numVehicles: 1, ev: true } })
        .success
    ).toBe(true);
    expect(schema.safeParse({ ...snipe, stayParams: { nested: { a: 1 } } }).success).toBe(false);
  });

  it('updates never carry a provider id', () => {
    const update = contract.watches.update.request.parse({
      id: 1,
      updates: { providerId: 'fake', name: 'Renamed' },
    });
    expect(update.updates).toEqual({ name: 'Renamed' });
  });
});
