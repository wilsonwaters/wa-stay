/**
 * Snipes as the renderer receives them, for component tests. Stays are far in the future (2099)
 * and the release a day after `NOW`, unless a test says otherwise.
 */
import type { LocationDetail } from '../../../src/shared/types/catalog.types';
import { SnipeReleaseMode, SnipeStatus } from '../../../src/shared/types/common.types';
import type { ProviderManifest } from '../../../src/shared/types/provider.types';
import type { SiteSnipe } from '../../../src/shared/types/site-sniper.types';
import { FAKE_MANIFEST, PARKSTAY_MANIFEST } from '../../utils/renderer/manifests';
import { catalogGet, makeLocationDetail } from './watches';

export function makeSnipe(overrides: Partial<SiteSnipe> = {}): SiteSnipe {
  const providerId = overrides.providerId ?? 'parkstay';
  const location = overrides.location ?? {
    externalId: '20',
    name: 'Osprey Bay',
    areaName: 'Cape Range National Park',
  };
  return {
    id: 7,
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
    releaseMode: SnipeReleaseMode.DAILY_ROLLOVER,
    releaseAt: new Date(Date.now() + 26 * 3_600_000),
    accessGateEnabled: false,
    leadTimeSeconds: 120,
    pollIntervalMs: 1500,
    windowDurationMs: 900_000,
    status: SnipeStatus.ARMED,
    isActive: true,
    attemptsCount: 0,
    maxAttempts: 0,
    createdAt: new Date('2099-01-01T00:00:00Z'),
    updatedAt: new Date('2099-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** A snipe holding site 12 until `minutes` from now (ParkStay's 30-minute hold). */
export function makeHeldSnipe(minutes = 23, overrides: Partial<SiteSnipe> = {}): SiteSnipe {
  return makeSnipe({
    status: SnipeStatus.HELD,
    isActive: false,
    attemptsCount: 3,
    holdReference: '2072968',
    holdExpiresAt: new Date(Date.now() + minutes * 60_000),
    holdUnitId: '12',
    paymentUrl: 'https://parkstay.dbca.wa.gov.au/booking/',
    ...overrides,
  });
}

/**
 * A second provider whose holds need a signed-in account (`required-for-holds`), for the
 * blocking Connect prompt (§12.32): ParkStay's account is optional.
 */
export const ACCOUNT_REQUIRED_MANIFEST: ProviderManifest = {
  ...PARKSTAY_MANIFEST,
  id: 'fakestay',
  name: 'Fake Stay Holidays',
  shortName: 'Fake Stay',
  description: 'Holiday parks whose holds need you signed in',
  website: 'https://fake.example.com',
  brand: { color: '#5A3E8C', monogram: 'FS' }, // token-guard-ignore: provider brand data
  locationKinds: ['holiday-park'],
  capabilities: {
    ...PARKSTAY_MANIFEST.capabilities,
    accessGate: false,
    account: 'required-for-holds',
  },
  stayFields: [],
  releaseModes: [
    {
      id: SnipeReleaseMode.SCHEDULED,
      label: 'At a scheduled time',
      description: 'Dates open at a time you set.',
      usesAccessGate: false,
    },
  ],
};

/** The answer of `catalog.checkLocation` with this release, for the Release step's preview. */
export function checkLocationWith(release: { open: boolean; opensAt?: string }) {
  return jest.fn().mockResolvedValue({
    success: true,
    data: { key: 'parkstay:20', checkedAt: new Date().toISOString(), units: [], release },
  });
}

/** Mon 15 Jun 2099, 12:00 am AWST: when Fri 11 Dec 2099 opens, 180 days ahead. */
export const OPENS_AT = '2099-06-14T16:00:00.000Z';

/** The new-snipe flow's prefill link: ParkStay's Osprey Bay, Fri 11 – Sun 13 Dec 2099. */
export const SNIPE_PREFILL =
  '/site-sniper/new?provider=parkstay&location=20&arrival=2099-12-11&departure=2099-12-13&adults=2';

type Stubs = Record<string, Record<string, jest.Mock>>;

/**
 * `window.api` stubs for the new-snipe flow: ParkStay (and a provider without Site Sniper), the
 * Osprey Bay detail with its release rule, a release preview, and `snipes.create` answering
 * snipe 42. Pass namespaces to replace or add methods.
 */
export function snipeFlowApi(
  overrides: Stubs = {},
  manifests: ProviderManifest[] = [PARKSTAY_MANIFEST, FAKE_MANIFEST],
  detail: LocationDetail = makeLocationDetail({
    releaseInfo: 'Bookings open 180 days ahead at 12:00 am AWST',
  })
): Stubs {
  const created = makeSnipe({ id: 42 });
  const base: Stubs = {
    providers: { list: jest.fn().mockResolvedValue({ success: true, data: manifests }) },
    catalog: {
      get: catalogGet(detail),
      search: jest.fn().mockResolvedValue({ success: true, data: { items: [detail], total: 1 } }),
      status: jest.fn().mockResolvedValue({
        success: true,
        data: { providers: [{ providerId: 'parkstay', count: 6, stale: false, syncing: false }] },
      }),
      checkLocation: checkLocationWith({ open: false, opensAt: OPENS_AT }),
    },
    snipes: {
      list: jest.fn().mockResolvedValue({ success: true, data: [] }),
      create: jest.fn().mockResolvedValue({ success: true, data: created }),
      get: jest.fn().mockResolvedValue({ success: true, data: created }),
    },
  };
  for (const [namespace, methods] of Object.entries(overrides)) {
    base[namespace] = { ...base[namespace], ...methods };
  }
  return base;
}
