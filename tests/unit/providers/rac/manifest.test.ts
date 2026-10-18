/**
 * RAC's manifest (`src/main/providers/rac/manifest.ts`), links (`links.ts`) and seed
 * (`parks.ts`): who RAC is and its limits (terms rules 2–4), its bulk cache key (the POST's stay
 * fields), its pets stay field (rule 16), its
 * badge (a text monogram whose white text passes WCAG AA), what it does not do (no bookings
 * module, rule 10), links to RAC's own pages and never its cart (rule 6), and a seed of facts
 * with no photo or copy (rule 6). Auto-cart (R19) ships off: `holds` is false, the `autoCart`
 * experiment turns it on, `holdRelease` is declared, the equipment fields apply to a hold only,
 * and the factory builds `holds` only with the experiment on.
 */

import fs from 'fs';
import path from 'path';
import { applyExperiments, withExperiments } from '@main/providers/experiments';
import {
  RAC_AUTO_CART_EXPERIMENT,
  RAC_PARKS,
  racFactory,
  racLinks,
  racManifest,
} from '@main/providers/rac';
import { RAC_EQUIPMENT_TYPES } from '@main/providers/rac/manifest';
import { effectiveIntervalMinutes } from '@main/core/watches/next-check';
import { resolveStayParams } from '@main/core/stay-params';
import { readBookNowPage } from '@main/providers/rac/book-now';
import { categoryIdOf, racBookingPage } from '@main/providers/rac/links';
import { racPark } from '@main/providers/rac/parks';
import { MANIFEST_RULES, ProviderRegistry, providerViolations } from '@main/providers/registry';
import { AppError } from '@main/utils/app-error';
import { contrastRatio } from '@renderer/styles/contrast';
import { ProviderManifestSchema, type StayQuery } from '@shared/types/provider.types';
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

  it('has a catalogue, availability (free counts on Explore too), watches and release alerts (snipes without holds), and an optional account (the member number)', () => {
    expect(racManifest.capabilities).toEqual({
      catalog: true,
      catalogMode: 'full',
      availability: true,
      bulkAvailability: true,
      watches: true,
      snipes: true,
      holds: false,
      bookingImport: false,
      accessGate: false,
      account: 'optional',
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

  it('keys bulk answers by what the POST sends: both dates, the party and the pets', () => {
    expect(racManifest.bulkAvailabilityStayFields).toEqual([
      'arrival',
      'departure',
      'adults',
      'children',
      'infants',
      'params.pets',
    ]);
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

  it('runs watches every 15 minutes at most, whatever a watch asks (rule 3)', () => {
    expect(effectiveIntervalMinutes(5, racManifest)).toBe(15);
    expect(effectiveIntervalMinutes(15, racManifest)).toBe(15);
    expect(effectiveIntervalMinutes(60, racManifest)).toBe(60);
  });

  it('has a pets stay field, 0 to 2, 0 by default, for checks, watches and snipes (rule 16), and the equipment for a hold only (R19)', () => {
    expect(racManifest.stayFields).toEqual([
      expect.objectContaining({
        key: 'pets',
        label: 'Pets',
        type: 'number',
        min: 0,
        max: 2,
        default: 0,
        appliesTo: ['availability', 'watch', 'snipe'],
      }),
      expect.objectContaining({ key: 'equipmentType', type: 'select', appliesTo: ['hold'] }),
      expect.objectContaining({ key: 'equipmentLength', type: 'text', appliesTo: ['hold'] }),
      expect.objectContaining({ key: 'equipmentWidth', type: 'text', appliesTo: ['hold'] }),
    ]);
    expect(resolveStayParams(racManifest, ['watch'], {})).toEqual({ pets: 0 });
    expect(resolveStayParams(racManifest, ['watch'], { pets: 2 })).toEqual({ pets: 2 });
  });

  it.each([3, -1, '1', 1.5])(
    'refuses pets %p with VALIDATION on stayParams.pets (rule 16)',
    (pets) => {
      let error: unknown;
      try {
        resolveStayParams(racManifest, ['watch'], { pets });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'VALIDATION', issues: ['stayParams.pets'] });
    }
  );

  it("offers NewBook's 15 equipment types, after none (a cabin or a room), and lengths in metres", () => {
    const [, type, length, width] = racManifest.stayFields ?? [];
    expect(type.options).toEqual([
      { value: '', label: 'None (a cabin or a room)' },
      ...RAC_EQUIPMENT_TYPES,
    ]);
    expect(RAC_EQUIPMENT_TYPES).toHaveLength(15);
    expect(new Set(RAC_EQUIPMENT_TYPES.map((option) => option.value))).toEqual(
      new Set(Array.from({ length: 15 }, (_, at) => String(at + 1)))
    );
    // The equipment is a hold's: a watch that does not hold, and a check, never ask for it
    expect(resolveStayParams(racManifest, ['watch'], {})).toEqual({ pets: 0 });
    expect(
      resolveStayParams(racManifest, ['watch', 'hold'], {
        equipmentType: '1',
        equipmentLength: '6.5',
        equipmentWidth: '2.5',
      })
    ).toEqual({ pets: 0, equipmentType: '1', equipmentLength: '6.5', equipmentWidth: '2.5' });
    for (const [field, value] of [
      [length, '6.555'],
      [length, '120'],
      [width, 'wide'],
      [type, '99'],
    ] as const) {
      expect(() =>
        resolveStayParams(racManifest, ['watch', 'hold'], { [field.key]: value })
      ).toThrow(AppError);
    }
  });

  it('declares two timed release modes, each checked for at most 30 minutes, and no cancellation mode', () => {
    expect(racManifest.releaseModes).toEqual([
      {
        id: 'daily_rollover',
        label: 'When these dates open',
        description: expect.any(String),
        usesAccessGate: false,
        maxWindowMinutes: 30,
      },
      {
        id: 'scheduled',
        label: 'At a time you set',
        description: expect.any(String),
        usesAccessGate: false,
        maxWindowMinutes: 30,
      },
    ]);
    expect(racManifest.releaseModes?.map((mode) => mode.id)).not.toContain('cancellation');
  });

  it('registers with links, a catalogue, availability, a release policy and a credentials sign-in: no holds, and no bookings module, so it can never change a booking (rule 10)', () => {
    const registry = new ProviderRegistry();
    const provider = registry.register(racFactory, createTestProviderContext);
    expect(Object.keys(provider).sort()).toEqual([
      'auth',
      'availability',
      'catalog',
      'links',
      'manifest',
      'release',
    ]);
    // The registry accepts RAC's member number sign-in (`authViolation` found nothing)
    expect(provider.auth?.kind).toBe('credentials');
    expect(registry.require('rac', 'snipes').release).toBe(provider.release);
    expect(provider.holds).toBeUndefined();
    expect(provider.bookings).toBeUndefined();
    expect(provider.manifest.capabilities.bookingImport).toBe(false);
  });
});

describe('auto-cart, off by default (R19)', () => {
  it('ships holds off, with the autoCart experiment that turns them on, its warning, and holdRelease', () => {
    expect(racManifest.capabilities.holds).toBe(false);
    expect(racManifest.holdRelease).toBe(true);
    expect(racManifest.experiments).toEqual([
      {
        id: RAC_AUTO_CART_EXPERIMENT,
        label: 'Put stays in my RAC cart automatically',
        description:
          'When a watch or a snipe finds your stay, WA Stay adds it to your RAC cart. ' +
          "You check out and pay on RAC's own page.",
        warning:
          'Experimental: not yet checked with a real booking. A cart is not a booking: ' +
          'only a paid booking secures your stay.',
        turnsOn: ['holds'],
      },
    ]);
    expect(RAC_AUTO_CART_EXPERIMENT).toBe('autoCart');
  });

  it('is a valid manifest, off and on, that keeps the flag rules', () => {
    const on = applyExperiments(racManifest, [RAC_AUTO_CART_EXPERIMENT]);
    for (const manifest of [racManifest, on]) {
      expect(ProviderManifestSchema.safeParse(manifest).success).toBe(true);
      expect(MANIFEST_RULES.map((rule) => rule.violation(manifest)).filter(Boolean)).toEqual([]);
    }
    expect(on.capabilities.holds).toBe(true);
  });

  it('with the experiment off, the registry accepts holdRelease alone, and RAC has no holds', () => {
    const provider = new ProviderRegistry().register(racFactory, createTestProviderContext);
    expect(provider.manifest.holdRelease).toBe(true);
    expect(provider.holds).toBeUndefined();
    expect(providerViolations(provider)).toEqual([]);
  });

  it('with it on (withExperiments), RAC registers with holds: the cart page to pay, RAC alone in the window, release on close, never booked', () => {
    const registry = new ProviderRegistry();
    const provider = registry.register(
      withExperiments(racFactory, [RAC_AUTO_CART_EXPERIMENT]),
      createTestProviderContext
    );
    expect(provider.manifest.capabilities.holds).toBe(true);
    expect(providerViolations(provider)).toEqual([]);
    const holds = registry.require('rac', 'holds').holds;
    expect(typeof holds.create).toBe('function');
    expect(typeof holds.release).toBe('function');
    expect(holds.releaseOnPaymentClose).toBe(true);
    expect(holds.paymentOrigins).toEqual([RAC]);
    expect(holds.bookedReference).toBeUndefined();
    expect(
      holds.paymentUrl({
        ok: true,
        reference: 'rac-cart:busselton:2026-11-06:0a1b2c',
        expiresAt: new Date(),
      })
    ).toBe(`${RAC}/busselton/booking/`);
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

  it("links a category (cat:<id>) to the park's booking page for it, in online_booking_url's form", () => {
    const url = racLinks.booking('busselton', STAY, 'cat:4');
    expect(url).toBe(
      `${RAC}/busselton/booking/?available_from=2026-11-06&available_to=2026-11-08` +
        '&force_category_id=4&adults=2&children=1&infants=1&animals=0'
    );
    expect(url).not.toMatch(/cart|rest_api_data_id/);
    expect(racBookingPage(url!, 'busselton')).toBe(url);
  });

  it("takes the stay's pets, 0 when it has none or one no stay can have", () => {
    const withPets = { ...STAY, params: { pets: 2 } };
    expect(new URL(racLinks.booking('busselton', withPets)!).searchParams.get('pets')).toBe('2');
    expect(
      new URL(racLinks.booking('busselton', withPets, 'cat:4')!).searchParams.get('animals')
    ).toBe('2');
    for (const pets of [3, -1, 'two']) {
      const url = racLinks.booking('busselton', { ...STAY, params: { pets } }, 'cat:4');
      expect(new URL(url!).searchParams.get('animals')).toBe('0');
    }
  });

  it('links to the book-now page for a unit that is not a category, or with no stay', () => {
    expect(racLinks.booking('busselton', STAY, 'site-4')).toBe(racLinks.booking('busselton', STAY));
    expect(racLinks.booking('busselton', undefined, 'cat:4')).toBe(`${RAC}/busselton/book-now/`);
    expect(racLinks.booking('ningaloo', STAY, 'cat:4')).toBeNull();
    expect([categoryIdOf('cat:30'), categoryIdOf('cat:'), categoryIdOf('30')]).toEqual([
      '30',
      undefined,
      undefined,
    ]);
  });

  it("links every seeded park to RAC's own pages only, on the manifest's website (rule 6)", () => {
    const website = new URL(racManifest.website).origin;
    expect(website).toBe(RAC);
    for (const park of RAC_PARKS) {
      for (const url of [
        racLinks.location(park.slug),
        racLinks.booking(park.slug),
        racLinks.booking(park.slug, STAY),
        racLinks.booking(park.slug, STAY, 'cat:4'),
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
    const all = (hour: number) => ({
      hour,
      memberPreSale: true,
      presaleExcludes: [],
      presaleExcludedCategoryIds: [],
    });
    expect(Object.fromEntries(RAC_PARKS.map((park) => [park.slug, park.schoolHolidays]))).toEqual({
      busselton: all(8),
      // Neither in the school-holiday releases nor in the pre-sale: the rolling window only
      'cable-beach': null,
      cervantes: all(9),
      esperance: all(7),
      // Its dorms (category type 4) are left out of the pre-sale
      'margaret-river': {
        hour: 7,
        memberPreSale: true,
        presaleExcludes: ['dorm'],
        presaleExcludedCategoryIds: ['2', '3', '4'],
      },
      exmouth: all(9),
      'karri-valley': all(8),
      'monkey-mia': all(8),
    });
  });

  it("keeps Cable Beach's dry season, 15 May to 15 October, released on its own days; no other park has one", () => {
    expect(Object.fromEntries(RAC_PARKS.map((park) => [park.slug, park.seasonalRelease]))).toEqual({
      busselton: null,
      'cable-beach': { name: 'dry-season', first: '05-15', last: '10-15' },
      cervantes: null,
      esperance: null,
      'margaret-river': null,
      exmouth: null,
      'karri-valley': null,
      'monkey-mia': null,
    });
  });

  it("leaves out of the pre-sale exactly Margaret River's dorm categories on its book-now page", () => {
    const page = readBookNowPage(
      fs.readFileSync(
        path.join(__dirname, '../../../fixtures/providers/rac/book-now-margaret-river.html'),
        'utf8'
      )
    )!;
    const dorms = page.categories.filter((category) => category.typeId === '4');
    expect(dorms.map((category) => category.title)).toEqual([
      'Dorm Room - Sleeps 26',
      'Dorm Room - Sleeps 5',
    ]);
    const excluded = racPark('margaret-river')!.schoolHolidays!.presaleExcludedCategoryIds;
    // The trimmed page keeps two of the three dorms; the 14-bed one is category 2
    for (const dorm of dorms) expect(excluded).toContain(dorm.catId);
    const others = page.categories.filter((category) => category.typeId !== '4');
    for (const other of others) expect(excluded).not.toContain(other.catId);
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
      'seasonalRelease',
    ];
    for (const park of RAC_PARKS) expect(Object.keys(park).sort()).toEqual([...allowed].sort());
    expect(JSON.stringify(RAC_PARKS)).not.toMatch(/https?:|\.jpg|newbook/i);
  });
});
