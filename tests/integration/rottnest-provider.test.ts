/**
 * Stay Rottnest (`src/main/providers/rottnest/`): the provider contract suite, the catalogue, a
 * stay's check, Explore's free counts and the shared search, on the stakeholder's capture of a
 * results page (trimmed, `tests/fixtures/providers/rottnest/`). A FixtureHttpClient serves it,
 * so nothing is sent anywhere.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { isProviderBookingLink } from '@main/core/booking-link';
import { ProviderError, ProviderParseError, type HttpClient } from '@main/providers/sdk';
import { ProviderRegistry } from '@main/providers/registry';
import {
  createRottnestModules,
  ROTTNEST_PRECINCTS,
  rottnestFactory,
  rottnestManifest,
} from '@main/providers/rottnest';
import { ROTTNEST_SEARCH_TTL_MS } from '@main/providers/rottnest/availability';
import { FixtureHttpClient } from '@main/testing/fixture-http-client';
import type { StayQuery } from '@shared/types/provider.types';
import { createTestProviderContext } from '@tests/utils/fake-provider';
import { describeProviderContract } from '@tests/utils/provider-contract';

const FIXTURES_DIR = path.join(__dirname, '../fixtures/providers');
const UNEXPECTED_LOG = path.join(os.tmpdir(), `rottnest-unexpected-${process.pid}.log`);
/** The captured stay: 28 Jun – 1 Jul 2027, one adult. */
const STAY: StayQuery = { arrival: '2027-06-28', departure: '2027-07-01', adults: 1 };
/** A stay the fixtures answer with every type unavailable. */
const SOLD_OUT: StayQuery = { arrival: '2027-06-14', departure: '2027-06-17', adults: 2 };
const NIGHTS = ['2027-06-28', '2027-06-29', '2027-06-30'];
/** The capture's day, 18 Oct 2026 (10 am Perth): June 2027 has been on sale since 7 Oct. */
const NOW = new Date('2026-10-18T02:00:00.000Z');
const clock = () => NOW;

/** A fixture client that counts what it is asked. */
function countingFixtures(): { http: HttpClient; count: () => number } {
  const fixtures = new FixtureHttpClient({
    providerId: 'rottnest',
    fixturesDir: FIXTURES_DIR,
    logFile: UNEXPECTED_LOG,
  });
  let sent = 0;
  const http = Object.create(fixtures) as HttpClient;
  http.request = (...args: Parameters<HttpClient['request']>) => {
    sent++;
    return fixtures.request(...args);
  };
  return { http, count: () => sent };
}

function fixtureContext() {
  return createTestProviderContext(rottnestManifest, {
    http: new FixtureHttpClient({
      providerId: 'rottnest',
      fixturesDir: FIXTURES_DIR,
      logFile: UNEXPECTED_LOG,
    }),
    clock,
  });
}

afterAll(() => fs.rmSync(UNEXPECTED_LOG, { force: true }));

describeProviderContract('rottnest', () => ({
  provider: rottnestFactory(fixtureContext()),
  sample: { externalId: 'geordie-bay', stay: STAY },
  unknownExternalId: 'does-not-exist',
}));

describe('Stay Rottnest: catalogue', () => {
  const registry = new ProviderRegistry();
  registry.register(rottnestFactory, () => fixtureContext());
  const provider = registry.require('rottnest', 'availability');

  it('lists the nine precincts from the seed, sending nothing', async () => {
    const { http, count } = countingFixtures();
    const quiet = rottnestFactory(createTestProviderContext(rottnestManifest, { http, clock }));
    const places = await quiet.catalog!.listLocations!();
    expect(places.map((place) => place.key)).toEqual(
      ROTTNEST_PRECINCTS.map((precinct) => `rottnest:${precinct.slug}`)
    );
    expect(places.find((place) => place.externalId === 'geordie-bay')).toEqual({
      key: 'rottnest:geordie-bay',
      providerId: 'rottnest',
      externalId: 'geordie-bay',
      name: 'Geordie Bay',
      kind: 'cabin',
      bookingMode: 'online',
      lat: -31.9909,
      lng: 115.5227,
      area: { name: 'Rottnest Island', region: 'Swan' },
      summary: 'Units around the sheltered bay on the north coast, with its own store and café.',
      imageUrls: [],
      amenities: [],
      unitKinds: ['cabin'],
      unitCount: 6,
      infoUrl: 'https://www.stayrottnest.com/accommodation-maps',
      bookingUrl: 'https://bookings.stayrottnest.com/search-rates',
    });
    await quiet.catalog!.getLocation('kingstown');
    expect(count()).toBe(0);
  });

  it("lists a precinct's room types as types, with their kinds and most people", async () => {
    const detail = await provider.catalog!.getLocation('kingstown');
    expect(detail.unitsAreTypes).toBe(true);
    expect(detail.units[0]).toEqual({
      unitId: 'KYB01',
      unitName: 'Kingstown Hostel Bed',
      unitKind: 'dorm',
      unitType: 'Dorms',
      maxPeople: 1,
    });
    expect(detail.units.find((unit) => unit.unitId === 'KGC18')).toMatchObject({
      unitKind: 'cabin',
      unitType: 'Cabins & villas',
      maxPeople: 18,
    });
  });

  it('rejects a precinct it does not have', async () => {
    await expect(provider.catalog!.getLocation('pinky-beach')).rejects.toBeInstanceOf(
      ProviderError
    );
  });
});

describe('Stay Rottnest: a stay', () => {
  const provider = rottnestFactory(fixtureContext());

  it("answers each room type for the whole stay: free ones' nights, price and rate", async () => {
    const result = await provider.availability!.check('fays-bay', STAY);
    expect(result.key).toBe('rottnest:fays-bay');
    expect(result.units.map((unit) => [unit.unitId, unit.fullyAvailable])).toEqual([
      ['FPR04', true],
      ['FPR06', false],
      ['FPV04', true],
      ['FPV06', true],
    ]);
    const free = result.units[0];
    expect(free).toEqual({
      unitId: 'FPR04',
      unitName: "Fay's Bay Premium - 4 Beds",
      unitKind: 'cabin',
      nights: NIGHTS.map((date) => ({ date, state: 'available' })),
      fullyAvailable: true,
      freeCount: 1,
      total: 699,
      priceNote: '25% deposit when booked',
      bookingUrl:
        'https://bookings.stayrottnest.com/rates-room1?hotel=62607&arrival=2027-06-28&departure=2027-07-01&rooms=1&adults%5B1%5D=1&children%5B1%5D=0&roomCategories%5B%5D=38',
    });
    expect(isProviderBookingLink(rottnestManifest, free.bookingUrl!)).toBe(true);
    expect(result.bookingUrl).toBe(free.bookingUrl);
  });

  it('reads an unavailable type as unknown nights, never booked or free, with no price', async () => {
    const result = await provider.availability!.check('fays-bay', STAY);
    expect(result.units[1]).toMatchObject({
      unitId: 'FPR06',
      nights: NIGHTS.map((date) => ({
        date,
        state: 'unknown',
        label: 'Unavailable for these dates',
      })),
      fullyAvailable: false,
      freeCount: 0,
    });
    expect(result.units[1].total).toBeUndefined();
  });

  it('refuses a party too big for a type, whatever the page says', async () => {
    const result = await provider.availability!.check('fays-bay', {
      ...STAY,
      adults: 5,
      children: 2,
    });
    expect(result.units[0]).toMatchObject({
      unitId: 'FPR04',
      fullyAvailable: false,
      nights: NIGHTS.map((date) => ({ date, state: 'unknown', label: 'Sleeps 6 at most' })),
    });
    expect(result.units[2].fullyAvailable).toBe(false);
    expect(result.units[3]).toMatchObject({ unitId: 'FPV06', fullyAvailable: true });
  });

  it('notes the campground and hostel are paid in full', async () => {
    const camp = await provider.availability!.check('campground', STAY);
    expect(camp.units[0]).toMatchObject({
      unitId: 'CG06',
      unitKind: 'campsite',
      total: 135,
      priceNote: 'Paid in full when booked',
    });
    const kingstown = await provider.availability!.check('kingstown', STAY);
    expect(kingstown.units[0]).toMatchObject({
      unitId: 'KYB01',
      priceNote: 'Paid in full when booked',
    });
  });

  it('keeps only the units asked for', async () => {
    const result = await provider.availability!.check('geordie-bay', STAY, { unitIds: ['GPV08'] });
    expect(result.units.map((unit) => unit.unitId)).toEqual(['GPV08']);
  });

  it('reads a sold-out stay as nothing free', async () => {
    const result = await provider.availability!.check('geordie-bay', SOLD_OUT);
    expect(result.units.every((unit) => !unit.fullyAvailable && unit.freeCount === 0)).toBe(true);
  });
});

describe("Stay Rottnest: Explore's free counts", () => {
  it('counts free room types per precinct, by kind where a precinct has several', async () => {
    const provider = rottnestFactory(fixtureContext());
    const entries = await provider.availability!.search!(STAY);
    expect(Object.fromEntries(entries.map((entry) => [entry.key, entry.availableUnits]))).toEqual({
      'rottnest:thomson-bay-north': 12,
      'rottnest:thomson-bay-south': 4,
      'rottnest:kingstown': 7,
      'rottnest:campground': 1,
      'rottnest:caroline-thomson-cabins': 1,
      'rottnest:bathurst': 0,
      'rottnest:longreach-bay': 0,
      'rottnest:fays-bay': 3,
      'rottnest:geordie-bay': 6,
    });
    expect(entries.find((entry) => entry.key === 'rottnest:kingstown')?.byKind).toEqual({
      dorm: { availableUnits: 1 },
      room: { availableUnits: 1 },
      cabin: { availableUnits: 5 },
    });
    // A free count, never a total of the precinct's units, but for one nothing can be booked at:
    // Bathurst is closed through June 2027 (its guide), so it was not looked for in the answer
    expect(entries.find((entry) => entry.key === 'rottnest:bathurst')).toEqual({
      key: 'rottnest:bathurst',
      availableUnits: 0,
      bookableUnits: 0,
      refused: 'Bathurst is closed from 27 Apr 2027 to 30 June 2027.',
    });
    expect(
      entries
        .filter((entry) => entry.key !== 'rottnest:bathurst')
        .every((entry) => entry.bookableUnits === undefined)
    ).toBe(true);
  });
});

describe('Stay Rottnest: one shared search', () => {
  it('serves the bulk search, every check and every caller at once from one request', async () => {
    const { http, count } = countingFixtures();
    const provider = rottnestFactory(createTestProviderContext(rottnestManifest, { http, clock }));
    await Promise.all([
      provider.availability!.search!(STAY),
      provider.availability!.check('geordie-bay', STAY),
      provider.availability!.check('kingstown', STAY),
    ]);
    await provider.availability!.check('bathurst', STAY);
    expect(count()).toBe(1);
    // Another party is another search
    await provider.availability!.check('geordie-bay', { ...STAY, adults: 2 });
    expect(count()).toBe(2);
  });

  it('asks again once the answer is two minutes old', async () => {
    let now = NOW;
    const { http, count } = countingFixtures();
    const provider = rottnestFactory(
      createTestProviderContext(rottnestManifest, { http, clock: () => now })
    );
    await provider.availability!.check('geordie-bay', STAY);
    now = new Date(now.getTime() + ROTTNEST_SEARCH_TTL_MS - 1);
    await provider.availability!.check('geordie-bay', STAY);
    expect(count()).toBe(1);
    now = new Date(now.getTime() + 2);
    await provider.availability!.check('geordie-bay', STAY);
    expect(count()).toBe(2);
  });

  it('keeps no failed search: a page with no room types is a parse error, and the next asks again', async () => {
    let body = '<html><body>Maintenance</body></html>';
    let sent = 0;
    const http = Object.create(fixtureContext().http) as HttpClient;
    http.request = async () => {
      sent++;
      const text = body;
      return {
        status: 200,
        ok: true,
        url: 'https://bookings.stayrottnest.com/rates-room1',
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => text,
        json: async () => ({}),
      };
    };
    const modules = createRottnestModules(
      createTestProviderContext(rottnestManifest, { http, clock })
    );
    await expect(modules.availability!.check('geordie-bay', STAY)).rejects.toBeInstanceOf(
      ProviderParseError
    );
    body = fs.readFileSync(
      path.join(FIXTURES_DIR, 'rottnest/results-2027-06-28-3n-1a.html'),
      'utf8'
    );
    await expect(modules.availability!.check('geordie-bay', STAY)).resolves.toMatchObject({
      key: 'rottnest:geordie-bay',
    });
    expect(sent).toBe(2);
  });
});

describe('Stay Rottnest: nothing asked for a stay that cannot be booked', () => {
  /** A July 2027 stay: not on sale until Wed 4 Nov 2026, 8:30 am Perth. */
  const JULY: StayQuery = { arrival: '2027-07-06', departure: '2027-07-08', adults: 2 };

  it('a stay not on sale yet: every night not released, when it opens, and no request', async () => {
    const { http, count } = countingFixtures();
    const provider = rottnestFactory(createTestProviderContext(rottnestManifest, { http, clock }));
    const result = await provider.availability!.check('geordie-bay', JULY);
    expect(result.release).toEqual({ open: false, opensAt: '2026-11-04T00:30:00.000Z' });
    expect(
      result.units.every(
        (unit) =>
          !unit.fullyAvailable &&
          unit.freeCount === 0 &&
          unit.nights.every((night) => night.state === 'not-released')
      )
    ).toBe(true);
    expect(count()).toBe(0);
  });

  it('a stay its rules refuse: every night unknown, labelled why, and no request', async () => {
    const { http, count } = countingFixtures();
    const provider = rottnestFactory(createTestProviderContext(rottnestManifest, { http, clock }));
    const result = await provider.availability!.check('bathurst', STAY);
    expect(result.release).toBeUndefined();
    expect(result.units[0].nights[0]).toEqual({
      date: '2027-06-28',
      state: 'unknown',
      label: 'Bathurst is closed from 27 Apr 2027 to 30 June 2027.',
    });
    expect(result.units.every((unit) => !unit.fullyAvailable)).toBe(true);
    expect(count()).toBe(0);
  });

  it("Explore's counts for a stay nowhere on sale yet send nothing, and say when each place opens", async () => {
    const { http, count } = countingFixtures();
    const provider = rottnestFactory(createTestProviderContext(rottnestManifest, { http, clock }));
    const entries = await provider.availability!.search!(JULY);
    expect(entries).toHaveLength(ROTTNEST_PRECINCTS.length);
    expect(entries[0]).toEqual({
      key: 'rottnest:thomson-bay-north',
      availableUnits: 0,
      bookableUnits: 0,
      opensAt: '2026-11-04T00:30:00.000Z',
    });
    expect(count()).toBe(0);
  });

  it('offers its booking rules as a module, which the place page reads', () => {
    const provider = rottnestFactory(fixtureContext());
    expect(
      provider.stayRules!.check({ externalId: 'geordie-bay', stay: JULY, now: NOW }).release
    ).toMatchObject({ open: false });
  });
});
