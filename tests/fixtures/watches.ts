/**
 * Watch Test Fixtures
 */

import { Watch, WatchInput } from '@shared/types';
import { WatchResult } from '@shared/types/common.types';
import { addDays } from '@shared/utils/calendar-date';

/**
 * Fixed reference date for generated watch dates, instead of the real clock. It is far in
 * the future because WatchService.create rejects arrival dates before today.
 */
const WATCH_FIXTURE_REFERENCE_DATE = '2099-01-15';

function daysAfterReference(days: number): string {
  return addDays(WATCH_FIXTURE_REFERENCE_DATE, days);
}

export const mockWatchInput: WatchInput = {
  providerId: 'parkstay',
  name: 'Karijini Watch',
  location: {
    externalId: 'CG001',
    name: 'Dales Campground',
    areaName: 'Karijini National Park',
  },
  stay: { arrival: '2024-07-01', departure: '2024-07-05', adults: 2 },
  unitIds: ['Site 1', 'Site 2', 'Site 3'],
  stayParams: { parkId: 'PARK001', gearType: 'tent' },
  checkIntervalMinutes: 60,
  autoHold: false,
  notifyOnly: true,
  maxPrice: 50.0,
  notes: 'Looking for unpowered sites',
};

export const mockWatch: Watch = {
  id: 1,
  userId: 1,
  providerId: 'parkstay',
  locationKey: 'parkstay:CG001',
  location: {
    externalId: 'CG001',
    name: 'Dales Campground',
    areaName: 'Karijini National Park',
  },
  name: 'Karijini Watch',
  stay: {
    arrival: '2024-07-01',
    departure: '2024-07-05',
    adults: 2,
    children: 0,
    infants: 0,
    concessions: 0,
  },
  unitIds: ['Site 1', 'Site 2', 'Site 3'],
  stayParams: { parkId: 'PARK001', gearType: 'tent' },
  checkIntervalMinutes: 60,
  isActive: true,
  foundCount: 0,
  autoHold: false,
  notifyOnly: true,
  allowPartialMatch: false,
  maxPrice: 50.0,
  notes: 'Looking for unpowered sites',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

export const mockActiveWatch: Watch = {
  ...mockWatch,
  id: 2,
  isActive: true,
  lastCheckedAt: new Date('2024-01-01T10:00:00Z'),
  nextCheckAt: new Date('2024-01-01T10:05:00Z'),
  lastResult: WatchResult.NOT_FOUND,
};

export const mockInactiveWatch: Watch = {
  ...mockWatch,
  id: 3,
  isActive: false,
  lastResult: WatchResult.FOUND,
  foundCount: 1,
};

export const mockWatchWithAutoHold: Watch = {
  ...mockWatch,
  id: 4,
  autoHold: true,
  notifyOnly: false,
};

export const mockDueWatch: Watch = {
  ...mockWatch,
  id: 5,
  isActive: true,
  lastCheckedAt: new Date('2024-01-01T09:55:00Z'),
  nextCheckAt: new Date('2024-01-01T10:00:00Z'),
};

export const invalidWatchInputs = [
  {
    ...mockWatchInput,
    stay: { arrival: '2000-01-15', departure: '2000-01-18', adults: 2 }, // In the past
    expectedError: 'Arrival date must be today or in the future',
  },
  {
    ...mockWatchInput,
    stay: { arrival: '2099-07-05', departure: '2099-07-01', adults: 2 },
    expectedError: 'Departure date must be after arrival date',
  },
];

export function createMockWatch(overrides: Partial<Watch> = {}): Watch {
  return {
    ...mockWatch,
    ...overrides,
  };
}

/** A creatable watch input: its stay is 30 to 34 days after the reference date unless given. */
export function createMockWatchInput(overrides: Partial<WatchInput> = {}): WatchInput {
  return {
    ...mockWatchInput,
    stay: { arrival: daysAfterReference(30), departure: daysAfterReference(34), adults: 2 },
    ...overrides,
  };
}

export function createMultipleMockWatches(count: number, userId: number = 1): Watch[] {
  return Array.from({ length: count }, (_, i) => {
    const externalId = `CG${String(i + 1).padStart(3, '0')}`;
    return createMockWatch({
      id: i + 1,
      userId,
      name: `Watch ${i + 1}`,
      locationKey: `parkstay:${externalId}`,
      location: { ...mockWatch.location, externalId },
      stay: {
        ...mockWatch.stay,
        arrival: daysAfterReference((i + 1) * 7),
        departure: daysAfterReference((i + 1) * 7 + 3),
      },
    });
  });
}
