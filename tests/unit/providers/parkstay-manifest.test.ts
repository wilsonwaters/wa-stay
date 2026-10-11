/**
 * The ParkStay manifest: identity, the capabilities V3's modules back, the stay fields and
 * release modes, and an AA brand colour for the white monogram.
 */

import { parkstayFactory, parkstayManifest } from '@main/providers/parkstay';
import { ProviderRegistry } from '@main/providers/registry';
import { ProviderManifestSchema } from '@shared/types/provider.types';
import { contrastRatio } from '../../../src/renderer/styles/contrast';
import { createTestProviderContext } from '@tests/utils/fake-provider';

describe('ParkStay provider manifest', () => {
  it('has a valid manifest with the agreed identity', () => {
    expect(ProviderManifestSchema.safeParse(parkstayManifest).success).toBe(true);
    expect(parkstayManifest).toMatchObject({
      id: 'parkstay',
      name: 'ParkStay WA',
      shortName: 'ParkStay',
      website: 'https://parkstay.dbca.wa.gov.au',
      integration: 'api',
      timezone: 'Australia/Perth',
      currency: 'AUD',
      limits: { minWatchIntervalMinutes: 15, maxConcurrentRequests: 4, catalogTtlHours: 24 },
      brand: { monogram: 'PS' },
      locationKinds: [
        'campground',
        'holiday-park',
        'caravan-park',
        'cabin',
        'hut',
        'glamping',
        'farm-stay',
        'other',
      ],
    });
  });

  it('offers catalogue, availability, bulk availability, watches, snipes, holds and the queue gate; no booking import; an optional account (§12.32)', () => {
    expect(parkstayManifest.capabilities).toEqual({
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
    });
  });

  it('describes its stay fields: gear type, vehicles and postcode', () => {
    expect(parkstayManifest.stayFields).toEqual([
      expect.objectContaining({
        key: 'gearType',
        type: 'select',
        default: 'all',
        options: [
          { value: 'all', label: 'Any' },
          { value: 'tent', label: 'Tent' },
          { value: 'campervan', label: 'Campervan' },
          { value: 'caravan', label: 'Caravan' },
        ],
        appliesTo: ['watch', 'snipe'],
      }),
      expect.objectContaining({
        key: 'numVehicles',
        type: 'number',
        min: 0,
        max: 5,
        default: 1,
        appliesTo: ['snipe', 'hold'],
      }),
      expect.objectContaining({
        key: 'postcode',
        type: 'text',
        pattern: '^\\d{4}$',
        appliesTo: ['snipe', 'hold'],
      }),
    ]);
    expect(new RegExp(parkstayManifest.stayFields![2].pattern!).test('6000')).toBe(true);
    expect(new RegExp(parkstayManifest.stayFields![2].pattern!).test('600')).toBe(false);
  });

  it('describes daily rollover, scheduled and cancellation releases; only cancellation skips the queue', () => {
    expect(parkstayManifest.releaseModes?.map((m) => [m.id, m.usesAccessGate])).toEqual([
      ['daily_rollover', true],
      ['scheduled', true],
      ['cancellation', false],
    ]);
  });

  it('uses a brand colour a white monogram passes WCAG AA on', () => {
    expect(contrastRatio(parkstayManifest.brand.color, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });

  it('registers with every module its capabilities need, and links each campground to its search page', () => {
    const registry = new ProviderRegistry();
    const provider = registry.register(parkstayFactory, createTestProviderContext);

    expect(provider.links.location('20')).toBe(
      'https://parkstay.dbca.wa.gov.au/search-availability/information/?campground_id=20'
    );
    expect(Object.keys(provider).sort()).toEqual([
      'access',
      'auth',
      'availability',
      'catalog',
      'dispose',
      'holds',
      'links',
      'manifest',
      'release',
    ]);
    expect(provider.manifest).toEqual(parkstayManifest);
    expect(Object.isFrozen(provider.manifest.capabilities)).toBe(true);
    // No request is made until something asks.
    expect(provider.access!.status().state).toBe('idle');
    provider.access!.dispose();
  });
});
