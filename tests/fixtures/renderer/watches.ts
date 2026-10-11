/**
 * Watches and locations as the renderer receives them, for component tests. Stays are far in
 * the future (2099) so they never "end" while the suite runs, unless a test says otherwise.
 */
import type {
  LocationDetail,
  LocationSummary,
  UnitSummary,
} from '../../../src/shared/types/catalog.types';
import type { UnitAvailability } from '../../../src/shared/types/provider.types';
import type { Watch } from '../../../src/shared/types/watch.types';

export function makeWatch(overrides: Partial<Watch> = {}): Watch {
  const providerId = overrides.providerId ?? 'parkstay';
  const location = overrides.location ?? {
    externalId: '20',
    name: 'Osprey Bay',
    areaName: 'Cape Range National Park',
  };
  return {
    id: 1,
    userId: 1,
    providerId,
    locationKey: `${providerId}:${location.externalId}`,
    location,
    name: 'Osprey Bay · Fri 11 – Sun 13 Dec',
    stay: {
      arrival: '2099-12-11',
      departure: '2099-12-13',
      adults: 2,
      children: 0,
      infants: 0,
      concessions: 0,
    },
    unitIds: [],
    stayParams: {},
    checkIntervalMinutes: 60,
    isActive: true,
    foundCount: 0,
    autoHold: false,
    notifyOnly: true,
    allowPartialMatch: false,
    createdAt: new Date('2099-01-01T00:00:00Z'),
    updatedAt: new Date('2099-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** One unit's nights for a stay, all in one state unless `states` says otherwise. */
export function makeUnit(
  unitId: string,
  nights: string[],
  states: UnitAvailability['nights'][number]['state'][] = nights.map(() => 'available'),
  extra: Partial<UnitAvailability> = {}
): UnitAvailability {
  return {
    unitId,
    unitName: `Site ${unitId}`,
    nights: nights.map((date, i) => ({ date, state: states[i] ?? 'unknown' })),
    fullyAvailable: states.every((s) => s === 'available'),
    ...extra,
  };
}

export function makeLocation(overrides: Partial<LocationSummary> = {}): LocationSummary {
  const providerId = overrides.providerId ?? 'parkstay';
  const externalId = overrides.externalId ?? '20';
  return {
    key: `${providerId}:${externalId}`,
    providerId,
    externalId,
    name: 'Osprey Bay',
    kind: 'campground',
    bookingMode: 'online',
    lat: -22.2,
    lng: 113.8,
    area: { name: 'Cape Range National Park', region: 'Coral Coast' },
    imageUrls: [],
    amenities: [],
    unitCount: 24,
    ...overrides,
  };
}

/** A location's detail: the summary plus its units (four powered and two unpowered sites). */
export function makeLocationDetail(overrides: Partial<LocationDetail> = {}): LocationDetail {
  const units: UnitSummary[] = [1, 2, 3, 4, 5, 6].map((n) => ({
    unitId: String(n),
    unitName: `Site ${n}`,
    unitType: n <= 4 ? 'Powered' : 'Unpowered',
  }));
  return { ...makeLocation(), units, ...overrides };
}

/** `catalog.get` answering `detail` for its key and NOT_FOUND for any other. */
export function catalogGet(detail: LocationDetail = makeLocationDetail()) {
  return jest.fn(async (key: string) =>
    key === detail.key
      ? { success: true, data: detail }
      : { success: false, code: 'NOT_FOUND', error: `There is no location ${key}` }
  );
}
