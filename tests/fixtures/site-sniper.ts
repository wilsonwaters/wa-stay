/**
 * Site Sniper Test Fixtures
 */

import { SiteSnipe, SiteSnipeInput } from '@shared/types';
import { SnipeReleaseMode, SnipeResult, SnipeStatus } from '@shared/types/common.types';

export const mockSiteSnipeInput: SiteSnipeInput = {
  providerId: 'parkstay',
  name: 'Ningaloo Peak Weekend',
  location: { externalId: '34', name: 'Osprey Bay' },
  stay: {
    arrival: '2026-07-19',
    departure: '2026-07-21',
    adults: 2,
    children: 0,
    infants: 0,
    concessions: 0,
  },
  unitIds: ['136', '137'],
  stayParams: { gearType: 'all', numVehicles: 1, postcode: '6000' },
  releaseMode: SnipeReleaseMode.DAILY_ROLLOVER,
  accessGateEnabled: false,
  leadTimeSeconds: 120,
  pollIntervalMs: 1500,
  windowDurationMs: 900000,
  maxAttempts: 0,
  notes: 'High demand weekend',
};

export const mockSiteSnipe: SiteSnipe = {
  id: 1,
  userId: 1,
  providerId: 'parkstay',
  locationKey: 'parkstay:34',
  location: { externalId: '34', name: 'Osprey Bay' },
  name: 'Ningaloo Peak Weekend',
  stay: {
    arrival: '2026-07-19',
    departure: '2026-07-21',
    adults: 2,
    children: 0,
    infants: 0,
    concessions: 0,
  },
  unitIds: ['136', '137'],
  stayParams: { gearType: 'all', numVehicles: 1, postcode: '6000' },
  releaseMode: SnipeReleaseMode.DAILY_ROLLOVER,
  releaseAt: new Date('2026-01-19T16:00:00Z'),
  accessGateEnabled: false,
  leadTimeSeconds: 120,
  pollIntervalMs: 1500,
  windowDurationMs: 900000,
  status: SnipeStatus.ARMED,
  isActive: true,
  attemptsCount: 0,
  maxAttempts: 0,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

export const mockScheduledSnipe: SiteSnipe = {
  ...mockSiteSnipe,
  id: 2,
  name: 'Ningaloo Scheduled Release',
  releaseMode: SnipeReleaseMode.SCHEDULED,
  releaseAt: new Date('2026-08-04T02:00:00Z'), // first Tuesday Aug 2026, 10:00 AWST
  accessGateEnabled: true,
};

export const mockCancellationSnipe: SiteSnipe = {
  ...mockSiteSnipe,
  id: 3,
  name: 'Cancellation Watch',
  releaseMode: SnipeReleaseMode.CANCELLATION,
  releaseAt: undefined,
  unitIds: [],
  status: SnipeStatus.SNIPING,
};

export const mockHeldSnipe: SiteSnipe = {
  ...mockSiteSnipe,
  id: 4,
  status: SnipeStatus.HELD,
  isActive: false,
  attemptsCount: 3,
  lastResult: SnipeResult.HELD,
  holdReference: '987654',
  holdExpiresAt: new Date('2026-01-19T16:30:00Z'),
  holdUnitId: '136',
  paymentUrl: 'https://parkstay.dbca.wa.gov.au/booking/',
};

export const mockInactiveSnipe: SiteSnipe = {
  ...mockSiteSnipe,
  id: 5,
  isActive: false,
  status: SnipeStatus.DISABLED,
};

export function createMockSiteSnipe(overrides: Partial<SiteSnipe> = {}): SiteSnipe {
  return {
    ...mockSiteSnipe,
    ...overrides,
  };
}

export function createMockSiteSnipeInput(overrides: Partial<SiteSnipeInput> = {}): SiteSnipeInput {
  return {
    ...mockSiteSnipeInput,
    ...overrides,
  };
}
