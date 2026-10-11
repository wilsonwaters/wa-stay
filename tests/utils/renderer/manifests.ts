/**
 * Provider manifests for renderer tests: ParkStay as main registers it (stay fields and all;
 * tests/unit/renderer/mock-manifests.test.ts pins it to the real manifest), and a second,
 * fake provider for multi-provider behaviour (the master plan's "fake second provider").
 */
import type { ProviderManifest } from '../../../src/shared/types/provider.types';

/** The ParkStay manifest (architecture-notes §3), as `providers.list()` returns it. */
export const PARKSTAY_MANIFEST: ProviderManifest = {
  id: 'parkstay',
  name: 'ParkStay WA',
  shortName: 'ParkStay',
  description: "Campgrounds in Western Australia's national parks",
  website: 'https://parkstay.dbca.wa.gov.au',
  integration: 'api',
  brand: { color: '#2F6B3A', monogram: 'PS' }, // token-guard-ignore: provider brand data
  locationKinds: ['campground'],
  timezone: 'Australia/Perth',
  currency: 'AUD',
  capabilities: {
    catalog: true,
    catalogMode: 'full',
    availability: true,
    bulkAvailability: true,
    watches: true,
    snipes: true,
    holds: true,
    bookingImport: false,
    accessGate: true,
    account: 'optional',
  },
  limits: { minWatchIntervalMinutes: 15, maxConcurrentRequests: 4, catalogTtlHours: 24 },
  bulkAvailabilityStayFields: ['arrival', 'departure', 'equipment', 'params.gearType'],
  stayFields: [
    {
      key: 'gearType',
      label: 'Camping with',
      type: 'select',
      options: [
        { value: 'all', label: 'Any' },
        { value: 'tent', label: 'Tent' },
        { value: 'campervan', label: 'Campervan' },
        { value: 'caravan', label: 'Caravan' },
      ],
      default: 'all',
      appliesTo: ['watch', 'snipe'],
    },
    {
      key: 'numVehicles',
      label: 'Vehicles',
      type: 'number',
      min: 0,
      max: 5,
      default: 1,
      appliesTo: ['snipe', 'hold'],
    },
    {
      key: 'postcode',
      label: 'Postcode',
      help: 'Your four-digit Australian postcode, which ParkStay asks for with a booking.',
      type: 'text',
      pattern: '^\\d{4}$',
      appliesTo: ['snipe', 'hold'],
    },
  ],
  releaseModes: [
    {
      id: 'daily_rollover',
      label: 'When new dates open',
      description:
        "Each day ParkStay opens one more date, 180 days ahead, at the campground's release time.",
      usesAccessGate: true,
    },
    {
      id: 'scheduled',
      label: 'At a scheduled time',
      description:
        'For campgrounds whose dates are released in blocks (such as Ningaloo), at a time you set.',
      usesAccessGate: true,
    },
    {
      id: 'cancellation',
      label: 'When someone cancels',
      description: 'Keeps checking for a site that comes free.',
      usesAccessGate: false,
    },
  ],
};

/** A second provider: watches but no holds, no account and no stay fields of its own. */
export const FAKE_MANIFEST: ProviderManifest = {
  id: 'fakestay',
  name: 'Fake Stay Holidays',
  shortName: 'Fake Stay',
  description: 'Holiday parks for testing more than one provider',
  website: 'https://fake.example.com',
  integration: 'api',
  brand: { color: '#5A3E8C', monogram: 'FS' }, // token-guard-ignore: provider brand data
  locationKinds: ['holiday-park'],
  timezone: 'Australia/Perth',
  currency: 'AUD',
  capabilities: {
    catalog: true,
    catalogMode: 'full',
    availability: true,
    bulkAvailability: false,
    watches: true,
    snipes: false,
    holds: false,
    bookingImport: false,
    accessGate: false,
    account: 'none',
  },
};

/** A provider that offers neither watches nor holds: never listed by a watch flow. */
export const BROWSE_ONLY_MANIFEST: ProviderManifest = {
  ...FAKE_MANIFEST,
  id: 'browseonly',
  name: 'Browse Only',
  shortName: 'Browse Only',
  brand: { color: '#1F5F7A', monogram: 'BO' }, // token-guard-ignore: provider brand data
  capabilities: { ...FAKE_MANIFEST.capabilities, watches: false },
};
