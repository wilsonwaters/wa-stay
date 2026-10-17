/**
 * RAC's manifest (`src/main/providers/rac/manifest.ts`), links (`links.ts`) and seed
 * (`parks.ts`): who RAC is and its limits (terms rules 2–4), its badge (a text monogram whose
 * white text passes WCAG AA), what it does not do (no bookings module, rule 10), links to RAC's
 * own pages and never its cart (rule 6), and a seed of facts with no photo or copy (rule 6).
 */

import fs from 'fs';
import path from 'path';
import { RAC_PARKS, racFactory, racLinks, racManifest } from '@main/providers/rac';
import { ProviderRegistry } from '@main/providers/registry';
import { contrastRatio } from '@renderer/styles/contrast';
import type { StayQuery } from '@shared/types/provider.types';
import { createTestProviderContext } from '@tests/utils/fake-provider';

const RAC = 'https://parksandresorts.rac.com.au';
const STAY: StayQuery = {
  arrival: '2026-11-06',
  departure: '2026-11-08',
  adults: 2,
  children: 1,
  infants: 1,
};

describe('racManifest', () => {
  it('is RAC Parks & Resorts, "RAC" for short, on its own site, in Perth and AUD', () => {
    expect(racManifest).toMatchObject({
      id: 'rac',
      name: 'RAC Parks & Resorts',
      shortName: 'RAC',
      website: RAC,
      integration: 'api',
      locationKinds: ['holiday-park'],
      timezone: 'Australia/Perth',
      currency: 'AUD',
    });
  });

  it('has a catalogue and nothing else yet, and no account', () => {
    expect(racManifest.capabilities).toEqual({
      catalog: true,
      catalogMode: 'full',
      availability: false,
      bulkAvailability: false,
      watches: false,
      snipes: false,
      holds: false,
      bookingImport: false,
      accessGate: false,
      account: 'none',
    });
  });

  it('asks politely: one request at a time, 10 s apart, watches every 15 minutes at most (rules 2–4)', () => {
    expect(racManifest.limits).toEqual({
      minWatchIntervalMinutes: 15,
      maxConcurrentRequests: 1,
      minRequestIntervalMs: 10_000,
      catalogTtlHours: 24,
    });
  });

  it('has a plain "RAC" monogram in a dark colour a white monogram passes WCAG AA on', () => {
    expect(racManifest.brand.monogram).toBe('RAC');
    expect(contrastRatio(racManifest.brand.color, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });

  it("uses an app token colour, not ParkStay's", async () => {
    const { parkstayManifest } = await import('@main/providers/parkstay');
    const tokens = fs.readFileSync(
      path.join(__dirname, '../../../../src/renderer/styles/tokens.css'),
      'utf8'
    );
    const hex = racManifest.brand.color.replace('#', '');
    const rgb = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(' ');
    expect(tokens).toMatch(new RegExp(`--ws-[a-z]+-\\d+: ${rgb};`));
    expect(racManifest.brand.color).not.toBe(parkstayManifest.brand.color);
  });

  it('registers with only links and a catalogue: no bookings module, so it can never change a booking (rule 10)', () => {
    const registry = new ProviderRegistry();
    const provider = registry.register(racFactory, createTestProviderContext);
    expect(Object.keys(provider).sort()).toEqual(['catalog', 'links', 'manifest']);
    expect(provider.bookings).toBeUndefined();
    expect(provider.manifest.capabilities.bookingImport).toBe(false);
  });
});

describe('racLinks', () => {
  it("links a park to its home page and its book-now page on RAC's site", () => {
    expect(racLinks.location('busselton')).toBe(`${RAC}/busselton/`);
    expect(racLinks.booking('margaret-river')).toBe(`${RAC}/margaret-river/book-now/`);
  });

  it("prefills the book-now page's own search with the stay, as a non-member with no pets", () => {
    const url = racLinks.booking('busselton', STAY);
    expect(url).toBe(
      `${RAC}/busselton/book-now/?available_from=2026-11-06&available_to=2026-11-08` +
        '&adults=2&children=1&infants=1&pets=0&membership_type=non-member'
    );
    expect(url).not.toMatch(/cart|rest_api_data_id|\/booking\//);
  });

  it('counts no children or infants when the stay has none', () => {
    expect(racLinks.booking('exmouth', { ...STAY, children: undefined, infants: undefined })).toBe(
      `${RAC}/exmouth/book-now/?available_from=2026-11-06&available_to=2026-11-08` +
        '&adults=2&children=0&infants=0&pets=0&membership_type=non-member'
    );
  });

  it('has no link for a park the seed does not have, and no manage-booking link', () => {
    expect(racLinks.location('ningaloo')).toBeNull();
    expect(racLinks.booking('ningaloo')).toBeNull();
    expect(racLinks.booking('ningaloo', STAY)).toBeNull();
    expect(racLinks.manageBooking).toBeUndefined();
  });

  it('takes a unit and leaves it out: the book-now page lists every category for the stay', () => {
    const booking = racLinks.booking as (
      externalId: string,
      stay?: StayQuery,
      unitId?: string
    ) => string | null;
    expect(booking('busselton', STAY, 'cat:4')).toBe(racLinks.booking('busselton', STAY));
  });

  it("links every seeded park to RAC's own pages only, on the manifest's website (rule 6)", () => {
    const website = new URL(racManifest.website).origin;
    expect(website).toBe(RAC);
    for (const park of RAC_PARKS) {
      for (const url of [
        racLinks.location(park.slug),
        racLinks.booking(park.slug),
        racLinks.booking(park.slug, STAY),
      ]) {
        expect(new URL(url!).origin).toBe(website);
        expect(url).not.toMatch(/cart|rest_api_data_id/);
      }
    }
  });
});

describe('RAC_PARKS', () => {
  it('has the eight open parks, without Ningaloo or Rose Gardens', () => {
    expect(RAC_PARKS.map((park) => [park.slug, park.blogId, park.bookNow])).toEqual([
      ['busselton', 6, 'widget'],
      ['cable-beach', 9, 'widget'],
      ['cervantes', 5, 'widget'],
      ['esperance', 10, 'widget'],
      ['margaret-river', 8, 'widget'],
      ['exmouth', 3, 'native'],
      ['karri-valley', 7, 'native'],
      ['monkey-mia', 2, 'native'],
    ]);
  });

  it("keeps each park's school-holiday release hour and its part in the member pre-sale", () => {
    expect(Object.fromEntries(RAC_PARKS.map((park) => [park.slug, park.schoolHolidays]))).toEqual({
      busselton: { hour: 8, presaleExcludes: [] },
      'cable-beach': null,
      cervantes: { hour: 9, presaleExcludes: [] },
      esperance: { hour: 7, presaleExcludes: [] },
      'margaret-river': { hour: 7, presaleExcludes: ['dorm'] },
      exmouth: { hour: 9, presaleExcludes: [] },
      'karri-valley': { hour: 8, presaleExcludes: [] },
      'monkey-mia': { hour: 8, presaleExcludes: [] },
    });
  });

  it("is facts only: no photo, description, summary or amenity of RAC's (rule 6)", () => {
    const allowed = [
      'slug',
      'blogId',
      'name',
      'bookNow',
      'area',
      'address',
      'lat',
      'lng',
      'unitKinds',
      'categoryTypes',
      'schoolHolidays',
    ];
    for (const park of RAC_PARKS) expect(Object.keys(park).sort()).toEqual([...allowed].sort());
    expect(JSON.stringify(RAC_PARKS)).not.toMatch(/https?:|\.jpg|newbook/i);
  });
});
