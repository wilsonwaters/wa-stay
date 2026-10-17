/**
 * RAC availability (`src/main/providers/rac/availability.ts`, `mapping.ts`) over the trimmed
 * answers in `tests/fixtures/providers/rac/`, one case per research sample, plus variants of
 * them written in the test: the request RAC's page sends, prices from the cheapest public
 * tariff that RAC took, RAC's site and tariff codes as nights, the stay rules, and booking links
 * that are never a cart address. A FixtureHttpClient or a recording client answers every
 * request, so nothing is sent anywhere.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  defineProvider,
  isAbortError,
  ProviderError,
  ProviderHttpError,
  ProviderParseError,
  type ProviderContext,
} from '@main/providers/sdk';
import { createRacModules, racFactory, racManifest } from '@main/providers/rac';
import { partialMatches } from '@main/core/watches/matching';
import { RAC_AVAILABILITY_PATH } from '@main/providers/rac/availability';
import { isMemberTariff } from '@main/providers/rac/mapping';
import { unitTypeOfKind } from '@main/providers/rac/unit-kinds';
import { FixtureHttpClient } from '@main/testing/fixture-http-client';
import type {
  LocationAvailability,
  StayQuery,
  UnitAvailability,
} from '@shared/types/provider.types';
import { createMemoryLogger, createTestProviderContext } from '@tests/utils/fake-provider';
import { RecordingHttpClient, type HopAnswer } from '@tests/utils/fake-paced-provider';
import { stayRuleViolations } from '@tests/utils/provider-contract';

const FIXTURES_DIR = path.join(__dirname, '../fixtures/providers');
const RAC_FIXTURES = path.join(FIXTURES_DIR, 'rac');
const UNEXPECTED_LOG = path.join(os.tmpdir(), `rac-availability-unexpected-${process.pid}.log`);
const RAC = 'https://parksandresorts.rac.com.au';
const AJAX = `${RAC}${RAC_AVAILABILITY_PATH}`;
/** The day after the answers were recorded, 10 am in Perth. */
const NOW = new Date('2026-10-17T02:00:00.000Z');

const BUSSELTON: StayQuery = { arrival: '2026-11-06', departure: '2026-11-08', adults: 2 };
const SCHOOL_HOLIDAYS: StayQuery = { arrival: '2027-09-25', departure: '2027-09-27', adults: 2 };
const LEAVERS: StayQuery = { arrival: '2027-11-20', departure: '2027-11-21', adults: 2 };
const WINDOW_EDGE: StayQuery = { arrival: '2027-10-13', departure: '2027-10-19', adults: 2 };
const AFTER_MIDNIGHT: StayQuery = { arrival: '2027-10-15', departure: '2027-10-18', adults: 2 };
const EXMOUTH_CLOSED: StayQuery = { arrival: '2027-10-13', departure: '2027-10-20', adults: 2 };

const POWERED_SITE_LINK =
  `${RAC}/busselton/booking/?available_from=2026-11-06&available_to=2026-11-08` +
  '&force_category_id=4&adults=2&children=0&infants=0&animals=0';

afterAll(() => fs.rmSync(UNEXPECTED_LOG, { force: true }));

function fixtureContext(overrides: Partial<Omit<ProviderContext, 'id'>> = {}): ProviderContext {
  return createTestProviderContext(racManifest, {
    http: new FixtureHttpClient({
      providerId: 'rac',
      fixturesDir: FIXTURES_DIR,
      logFile: UNEXPECTED_LOG,
    }),
    clock: () => NOW,
    ...overrides,
  });
}

const fixtureProvider = () => racFactory(fixtureContext());

/** A provider whose every request is answered by `respond` and recorded. */
function recordingProvider(respond: () => HopAnswer = () => ({ body: answer('2026-11-06-2n') })) {
  const http = new RecordingHttpClient({ providerId: 'rac', respond });
  const logger = createMemoryLogger();
  const provider = racFactory(
    createTestProviderContext(racManifest, { http, logger, clock: () => NOW })
  );
  return { http, logger, provider };
}

/** A fixture answer's text, by the end of its file name. */
function answer(name: string): string {
  const [file] = fs
    .readdirSync(RAC_FIXTURES)
    .filter((f) => f.startsWith('availability-') && f.endsWith(`${name}.json`));
  return fs.readFileSync(path.join(RAC_FIXTURES, file), 'utf8');
}

/** A fixture answer as JSON, changed by `edit` and written back out. */
function edited(name: string, edit: (json: RawAnswer) => void): string {
  const json = JSON.parse(answer(name)) as RawAnswer;
  edit(json);
  return JSON.stringify(json);
}

interface RawAnswer {
  data: Record<
    string,
    Record<string, unknown> & { tariffs_available: Array<Record<string, unknown>> }
  >;
}

const unit = (result: LocationAvailability, unitId: string): UnitAvailability => {
  const found = result.units.find((u) => u.unitId === unitId);
  if (!found) throw new Error(`no unit ${unitId} in ${result.units.map((u) => u.unitId).join()}`);
  return found;
};

const states = (u: UnitAvailability) => u.nights.map((night) => [night.date, night.state]);

describe('RAC availability: the request', () => {
  it("POSTs RAC's own form once: blog_id, D MMM YYYY dates, the party, no pets, every equipment type", async () => {
    const { http, provider } = recordingProvider();
    await provider.availability!.check('busselton', { ...BUSSELTON, children: 1, infants: 1 });
    expect(http.requests).toHaveLength(1);
    const [request] = http.requests;
    expect([request.method, request.url]).toEqual(['POST', AJAX]);
    expect(Object.fromEntries(new URLSearchParams(request.body))).toEqual({
      blog_id: '6',
      available_from: '6 Nov 2026',
      available_to: '8 Nov 2026',
      adults: '2',
      children: '1',
      infants: '1',
      animals: '0',
      equipment_type_ids: 'all',
      equipment_measurement_unit: 'm',
      equipment_length: '',
      equipment_width: '',
    });
    expect(request.headers).toMatchObject({
      'x-requested-with': 'XMLHttpRequest',
      origin: RAC,
      referer: `${RAC}/busselton/book-now/`,
    });
    expect(Object.keys(request.headers)).not.toContain('user-agent');
  });

  it("sends the stay's pets as animals, and sends nothing for pets RAC never takes", async () => {
    const { http, provider } = recordingProvider();
    await provider.availability!.check('busselton', { ...BUSSELTON, params: { pets: 2 } });
    expect(new URLSearchParams(http.requests[0].body).get('animals')).toBe('2');
    for (const pets of [3, -1, 1.5, '1']) {
      await expect(
        provider.availability!.check('busselton', { ...BUSSELTON, params: { pets } })
      ).rejects.toBeInstanceOf(ProviderError);
    }
    expect(http.requests).toHaveLength(1);
  });

  it('writes dates as RAC does, from the calendar strings, across months and years', async () => {
    const { http, provider } = recordingProvider();
    await provider.availability!.check('cable-beach', {
      arrival: '2026-12-31',
      departure: '2027-01-02',
      adults: 1,
    });
    const form = new URLSearchParams(http.requests[0].body);
    expect([form.get('blog_id'), form.get('available_from'), form.get('available_to')]).toEqual([
      '9',
      '31 Dec 2026',
      '2 Jan 2027',
    ]);
  });

  it('rejects an unknown park, or a stay that is not two dates in order, sending nothing', async () => {
    const { http, provider } = recordingProvider();
    for (const id of ['ningaloo', 'rose-gardens', '6']) {
      await expect(provider.availability!.check(id, BUSSELTON)).rejects.toBeInstanceOf(
        ProviderError
      );
    }
    for (const stay of [
      { ...BUSSELTON, departure: BUSSELTON.arrival },
      { ...BUSSELTON, arrival: '6 Nov 2026' },
      { ...BUSSELTON, departure: '2026-02-30' },
    ]) {
      await expect(provider.availability!.check('busselton', stay)).rejects.toBeInstanceOf(
        ProviderError
      );
    }
    expect(http.requests).toHaveLength(0);
  });

  it('honours an aborted signal: nothing is sent, and an abort while in flight rejects', async () => {
    const { http, provider } = recordingProvider(() => ({
      body: answer('2026-11-06-2n'),
      delayMs: 50,
    }));
    const before = new AbortController();
    before.abort();
    const early = await provider
      .availability!.check('busselton', BUSSELTON, { signal: before.signal })
      .catch((e: unknown) => e);
    expect(isAbortError(early)).toBe(true);
    expect(http.requests).toHaveLength(0);

    const during = new AbortController();
    const pending = provider.availability!.check('busselton', BUSSELTON, {
      signal: during.signal,
    });
    during.abort();
    expect(isAbortError(await pending.catch((e: unknown) => e))).toBe(true);
    expect(http.requests.length).toBeLessThanOrEqual(1);
  });
});

describe('RAC availability: what is no answer', () => {
  it("RAC's guard text (sent without X-Requested-With) is a ProviderParseError, never an empty answer", async () => {
    const error = await fixtureProvider()
      .availability!.check('busselton', {
        arrival: '2026-12-01',
        departure: '2026-12-02',
        adults: 2,
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderParseError);
    expect((error as Error).message).toMatch(/No direct file access/);
  });

  it.each<[string, string]>([
    ['not JSON', '<html><body>Maintenance</body></html>'],
    ['another shape', '{"success":"true","data":{"4":{"category_name":"Powered Site"}}}'],
    ['success other than "true"', '{"success":"false","message":"<b>Bad dates</b>","data":[]}'],
    ['no success at all', '{"data":{}}'],
  ])('%s is a ProviderParseError', async (_, body) => {
    const { provider } = recordingProvider(() => ({ body }));
    await expect(provider.availability!.check('busselton', BUSSELTON)).rejects.toBeInstanceOf(
      ProviderParseError
    );
  });

  it('says what RAC said, as plain text', async () => {
    const { provider } = recordingProvider(() => ({
      body: '{"success":"false","message":"<b>Bad dates</b>","data":[]}',
    }));
    await expect(provider.availability!.check('busselton', BUSSELTON)).rejects.toThrow(
      /it said "Bad dates"$/
    );
  });

  it('reads an empty answer written by PHP ([] for a map) as no categories', async () => {
    const { provider } = recordingProvider(() => ({ body: '{"success":"true","data":[]}' }));
    const result = await provider.availability!.check('busselton', BUSSELTON);
    expect(result.units).toEqual([]);
  });

  it('a 520 is a retryable ProviderHttpError, with no cool-down', async () => {
    let status = 520;
    const { http, provider } = recordingProvider(() =>
      status === 520 ? { status, body: 'unknown error' } : { body: answer('2026-11-06-2n') }
    );
    const error = await provider
      .availability!.check('busselton', BUSSELTON)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect([(error as ProviderHttpError).status, (error as ProviderHttpError).retryable]).toEqual([
      520,
      true,
    ]);
    status = 200;
    await expect(provider.availability!.check('busselton', BUSSELTON)).resolves.toBeDefined();
    expect(http.requests).toHaveLength(2);
  });
});

describe('RAC availability: Busselton, 6–8 Nov 2026', () => {
  let result: LocationAvailability;

  beforeAll(async () => {
    result = await fixtureProvider().availability!.check('busselton', BUSSELTON);
  });

  it("lists every category as a unit, in RAC's order, under the park's key", () => {
    expect(result.key).toBe('rac:busselton');
    expect(result.checkedAt).toBe(NOW.toISOString());
    expect(result.units.map((u) => [u.unitId, u.unitName, u.unitKind, u.unitType])).toEqual([
      ['cat:7', 'Ensuite Site', 'campsite', 'Sites'],
      ['cat:4', 'Powered Site', 'campsite', 'Sites'],
    ]);
  });

  it('the powered site is fully available at 75 and 75, 150 in all, on the Standard Rate', () => {
    expect(unit(result, 'cat:4')).toEqual({
      unitId: 'cat:4',
      unitName: 'Powered Site',
      unitType: 'Sites',
      unitKind: 'campsite',
      nights: [
        { date: '2026-11-06', state: 'available', price: 75, minNights: 1 },
        { date: '2026-11-07', state: 'available', price: 75, minNights: 1 },
      ],
      fullyAvailable: true,
      total: 150,
      bookingUrl: POWERED_SITE_LINK,
    });
  });

  it('ignores the member rate (136) and the refused "Stay & Save" tariff (a 3-night minimum)', () => {
    const powered = unit(result, 'cat:4');
    expect(powered.total).toBe(150);
    expect(powered.priceNote).toBeUndefined();
    expect(powered.minNights).toBeUndefined();
    expect(powered.nights.every((night) => night.minNights === 1)).toBe(true);
  });

  it('the ensuite site is booked both nights, not fully available, with no price', () => {
    const ensuite = unit(result, 'cat:7');
    expect(ensuite.nights).toEqual([
      { date: '2026-11-06', state: 'booked' },
      { date: '2026-11-07', state: 'booked' },
    ]);
    expect(ensuite.fullyAvailable).toBe(false);
    expect(ensuite.total).toBeUndefined();
  });

  it("links each category to RAC's booking page for it, and the place to its book-now page", () => {
    expect(unit(result, 'cat:7').bookingUrl).toBe(
      POWERED_SITE_LINK.replace('force_category_id=4', 'force_category_id=7')
    );
    expect(result.bookingUrl).toBe(
      `${RAC}/busselton/book-now/?available_from=2026-11-06&available_to=2026-11-08` +
        '&adults=2&children=0&infants=0&pets=0&membership_type=non-member'
    );
  });

  it('keeps only the units asked for (unitIds); a category that no longer exists gives none', async () => {
    const provider = fixtureProvider();
    const only = await provider.availability!.check('busselton', BUSSELTON, {
      unitIds: ['cat:4'],
    });
    expect(only.units.map((u) => u.unitId)).toEqual(['cat:4']);
    const gone = await provider.availability!.check('busselton', BUSSELTON, {
      unitIds: ['cat:99'],
    });
    expect(gone.units).toEqual([]);
  });
});

describe('RAC availability: stays RAC refuses are never free (terms rule 16)', () => {
  it('school holidays, 25 Sep 2027: min-stay, a 3-night minimum, no arrivals on the 25th', async () => {
    const result = await fixtureProvider().availability!.check('busselton', SCHOOL_HOLIDAYS);
    const powered = unit(result, 'cat:4');
    expect(powered.nights).toEqual([
      {
        date: '2027-09-25',
        state: 'unknown',
        reason: 'min-stay',
        minNights: 3,
        noArrival: true,
        noDeparture: true,
      },
      {
        date: '2027-09-26',
        state: 'unknown',
        reason: 'min-stay',
        minNights: 3,
        noArrival: true,
        noDeparture: true,
      },
    ]);
    expect(powered.minNights).toBe(3);
    expect(powered.fullyAvailable).toBe(false);
    expect(powered.total).toBeUndefined();
    expect(stayRuleViolations(SCHOOL_HOLIDAYS, result)).toEqual([]);
  });

  it('gives a category the book-now page leaves out (Busselton 30) its kind and type', async () => {
    const result = await fixtureProvider().availability!.check('busselton', SCHOOL_HOLIDAYS);
    const petFriendly = unit(result, 'cat:30');
    expect([petFriendly.unitName, petFriendly.unitKind, petFriendly.unitType]).toEqual([
      'Pet Friendly Powered Site',
      'campsite',
      'Sites',
    ]);
    expect(states(petFriendly)).toEqual([
      ['2027-09-25', 'booked'],
      ['2027-09-26', 'booked'],
    ]);
  });

  it("Exmouth: the closed category and its stop-sold tariffs are closed, in RAC's words, with no price", async () => {
    const result = await fixtureProvider().availability!.check('exmouth', EXMOUTH_CLOSED);
    const cabin = unit(result, 'cat:4');
    expect(cabin.unitName).toBe('One Bedroom Family Cabin with External Bathroom');
    expect(cabin.unitKind).toBe('cabin');
    expect(cabin.nights).toHaveLength(7);
    for (const night of cabin.nights) {
      expect(night).toEqual({
        date: night.date,
        state: 'closed',
        label: 'This Site is closed as of Tue 9 Jun 2026',
      });
    }
    expect(cabin.fullyAvailable).toBe(false);
    expect(cabin.total).toBeUndefined();
  });

  it('Karri Valley: sold-out categories whose stay-through reason is a retired site are booked, not closed', async () => {
    const result = await fixtureProvider().availability!.check('karri-valley', {
      arrival: '2026-10-31',
      departure: '2026-11-01',
      adults: 2,
    });
    // RAC's stay-through code 2 ("This Site is closed as of …") with live tariffs: the
    // Lakeside Room Queen's Standard Rate succeeds; the chalets' are refused for a minimum stay
    for (const [unitId, name] of [
      ['cat:10', 'Lakeside Room Queen'],
      ['cat:6', 'Two Bedroom Chalet - Lake View'],
      ['cat:11', 'Two Bedroom Accessible Forest View Chalet'],
    ]) {
      const category = unit(result, unitId);
      expect([category.unitName, states(category)]).toEqual([name, [['2026-10-31', 'booked']]]);
      expect(category.nights[0].label).toBeUndefined();
    }
  });

  it("Exmouth, 31 Oct 2026: categories closed for the stay with stop-sold tariffs are closed, in RAC's words", async () => {
    const result = await fixtureProvider().availability!.check('exmouth', {
      arrival: '2026-10-31',
      departure: '2026-11-01',
      adults: 2,
    });
    for (const unitId of ['cat:4', 'cat:8', 'cat:31', 'cat:39']) {
      expect(unit(result, unitId).nights).toEqual([
        {
          date: '2026-10-31',
          state: 'closed',
          label: expect.stringMatching(/^This Site is closed as of /),
        },
      ]);
    }
    // Sold out with live tariffs (stay-through code 3): booked
    expect(states(unit(result, 'cat:2'))).toEqual([['2026-10-31', 'booked']]);
  });

  it('stop-sold tariffs (code 11) close free nights, labelled with the tariff message', async () => {
    const { provider } = recordingProvider(() => ({
      body: edited('2026-11-06-2n', (json) => {
        for (const tariff of json.data['4'].tariffs_available) {
          Object.assign(tariff, {
            tariff_success: 'false',
            tariff_code: 11,
            tariff_message: 'This Rate is Stop Sold',
          });
        }
      }),
    }));
    const powered = unit(await provider.availability!.check('busselton', BUSSELTON), 'cat:4');
    expect(powered.nights).toEqual([
      { date: '2026-11-06', state: 'closed', label: 'This Rate is Stop Sold' },
      { date: '2026-11-07', state: 'closed', label: 'This Rate is Stop Sold' },
    ]);
    expect(powered.fullyAvailable).toBe(false);
  });

  it('Leavers, 20 Nov 2027: not released, with no price despite the 999', async () => {
    const result = await fixtureProvider().availability!.check('busselton', LEAVERS);
    expect(unit(result, 'cat:4')).toMatchObject({
      nights: [{ date: '2027-11-20', state: 'not-released' }],
      fullyAvailable: false,
    });
    expect(unit(result, 'cat:4').total).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('999');
  });

  it('the window edge, 13–18 Oct 2027: 13–15 available, 16–18 not released (never booked)', async () => {
    const result = await fixtureProvider().availability!.check('busselton', WINDOW_EDGE);
    const powered = unit(result, 'cat:4');
    expect(powered.nights.map((n) => [n.date, n.state, n.price])).toEqual([
      ['2027-10-13', 'available', 70],
      ['2027-10-14', 'available', 70],
      ['2027-10-15', 'available', 73],
      ['2027-10-16', 'not-released', undefined],
      ['2027-10-17', 'not-released', undefined],
      ['2027-10-18', 'not-released', undefined],
    ]);
    expect(powered.fullyAvailable).toBe(false);
    expect(powered.total).toBeUndefined();
  });

  it('after midnight, 15–17 Oct 2027: 15 and 16 available, 17 not released; the placeholder 999 is no price', async () => {
    const result = await fixtureProvider().availability!.check('busselton', AFTER_MIDNIGHT);
    const powered = unit(result, 'cat:4');
    expect(powered.nights.map((n) => [n.date, n.state, n.price])).toEqual([
      ['2027-10-15', 'available', 73],
      ['2027-10-16', 'available', undefined],
      ['2027-10-17', 'not-released', undefined],
    ]);
    expect(powered.fullyAvailable).toBe(false);
    expect(JSON.stringify(result)).not.toContain('999');
  });
});

describe('RAC availability: the mapping of a stay', () => {
  /** The Busselton answer's powered site, changed by `edit`. */
  async function poweredSite(edit: (site: RawAnswer['data'][string]) => void) {
    const { provider } = recordingProvider(() => ({
      body: edited('2026-11-06-2n', (json) => edit(json.data['4'])),
    }));
    return unit(await provider.availability!.check('busselton', BUSSELTON), 'cat:4');
  }

  it('every night free but no site for the whole stay (stay-through 0 with code 3): split, not free', async () => {
    const site = await poweredSite((s) =>
      Object.assign(s, {
        stay_through_sites_available: 0,
        stay_through_sites_code: 3,
        stay_through_sites_message: 'There is no longer availability for the dates given',
      })
    );
    expect(site.nights).toEqual([
      { date: '2026-11-06', state: 'unknown', reason: 'split' },
      { date: '2026-11-07', state: 'unknown', reason: 'split' },
    ]);
    expect(site.fullyAvailable).toBe(false);
    expect(site.total).toBeUndefined();
  });

  it('a minimum above the stay comes before split: the nights are min-stay', async () => {
    const site = await poweredSite((s) => {
      Object.assign(s, { stay_through_sites_available: 0, stay_through_sites_code: 3 });
      for (const quote of Object.values(s.tariffs_available[0].tariffs_quoted as object)) {
        Object.assign(quote, { minimum_periods: '3' });
      }
    });
    expect(site.nights.map((n) => [n.state, n.reason, n.minNights])).toEqual([
      ['unknown', 'min-stay', 3],
      ['unknown', 'min-stay', 3],
    ]);
    expect(site.fullyAvailable).toBe(false);
  });

  it('a whole-stay count lower than every night (51 against 53 and 55) is still bookable above 0', async () => {
    const site = await poweredSite((s) => Object.assign(s, { stay_through_sites_available: 1 }));
    expect(site.fullyAvailable).toBe(true);
  });

  it('every public tariff refused while the member rate succeeds: not free (min-stay by the Standard Rate)', async () => {
    const site = await poweredSite((s) => {
      const standard = s.tariffs_available[0];
      Object.assign(standard, {
        tariff_success: 'false',
        tariff_code: 6,
        tariff_message: 'This Rate has a <strong>3 Night</strong> Minimum',
      });
      for (const quote of Object.values(standard.tariffs_quoted as Record<string, object>)) {
        Object.assign(quote, { minimum_periods: '3' });
      }
    });
    expect(site.fullyAvailable).toBe(false);
    expect(states(site)).toEqual([
      ['2026-11-06', 'unknown'],
      ['2026-11-07', 'unknown'],
    ]);
    expect(site.nights.every((n) => n.reason === 'min-stay' && n.price === undefined)).toBe(true);
    expect(site.minNights).toBe(3);
  });

  it('with no public Standard Rate, the first public tariff decides: code 5 is not released', async () => {
    const site = await poweredSite((s) => {
      s.tariffs_available = s.tariffs_available
        .filter((t) => t.tariff_label !== 'Standard Rate')
        .map((t) => ({ ...t, tariff_success: 'false', tariff_code: 5 }));
      // The promotion's own 3-night minimum would refuse the stay first
      const promo = s.tariffs_available.find((t) => t.tariff_label === 'Stay & Save This Spring');
      for (const quote of Object.values(promo!.tariffs_quoted as object)) {
        Object.assign(quote, { minimum_periods: '1' });
      }
    });
    expect(states(site)).toEqual([
      ['2026-11-06', 'not-released'],
      ['2026-11-07', 'not-released'],
    ]);
  });

  it("the deciding tariff's own minimum refuses a stay shorter than it, whatever its code", async () => {
    const site = await poweredSite((s) => {
      s.tariffs_available = s.tariffs_available
        .filter((t) => t.tariff_label !== 'Standard Rate')
        .map((t) => ({ ...t, tariff_success: 'false', tariff_code: 5 }));
    });
    expect(site.nights.map((n) => [n.state, n.reason, n.minNights])).toEqual([
      ['unknown', 'min-stay', 3],
      ['unknown', 'min-stay', 3],
    ]);
  });

  it.each([2, 3, 4, 8])('tariff code %d closes the free nights', async (code) => {
    const site = await poweredSite((s) => {
      for (const t of s.tariffs_available)
        Object.assign(t, { tariff_success: 'false', tariff_code: code });
    });
    expect(states(site).map(([, state]) => state)).toEqual(['closed', 'closed']);
  });

  it.each([7, 9, 10])('tariff code %d is a stay rule: min-stay', async (code) => {
    const site = await poweredSite((s) => {
      for (const t of s.tariffs_available)
        Object.assign(t, { tariff_success: 'false', tariff_code: code });
    });
    expect(site.nights.map((n) => n.reason)).toEqual(['min-stay', 'min-stay']);
  });

  it('a category with no tariff at all is not free', async () => {
    const site = await poweredSite((s) => Object.assign(s, { tariffs_available: [] }));
    expect(site.fullyAvailable).toBe(false);
    expect(states(site)).toEqual([
      ['2026-11-06', 'unknown'],
      ['2026-11-07', 'unknown'],
    ]);
  });

  it('stay-through code 4 (a special date) closes the free nights, in plain words', async () => {
    const site = await poweredSite((s) =>
      Object.assign(s, {
        stay_through_sites_available: 0,
        stay_through_sites_code: 4,
        stay_through_sites_message:
          'Bookings are not allowed to Arrive on <strong>6 Nov 2026</strong> - Event &amp; Co',
      })
    );
    expect(site.nights).toEqual([
      {
        date: '2026-11-06',
        state: 'closed',
        label: 'Bookings are not allowed to Arrive on 6 Nov 2026 - Event & Co',
      },
      {
        date: '2026-11-07',
        state: 'closed',
        label: 'Bookings are not allowed to Arrive on 6 Nov 2026 - Event & Co',
      },
    ]);
  });

  it("maps every site code: 2/4/6/7/8 closed with RAC's message, 3/5 booked, 9 not released, 1 or none unknown", async () => {
    const codes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12];
    const { provider } = recordingProvider(() => ({
      body: edited('2026-11-06-2n', (json) => {
        const site = json.data['4'];
        const dates = codes.map((_, i) => `2026-11-${String(10 + i).padStart(2, '0')}`);
        site.sites_code = Object.fromEntries(dates.map((d, i) => [d, codes[i]]));
        site.sites_available = Object.fromEntries(dates.map((d, i) => [d, codes[i] ? 0 : 9]));
        site.sites_message = Object.fromEntries(
          dates.map((d, i) => [d, `Reason <em>${codes[i]}</em>; and more`])
        );
      }),
    }));
    const stay = { arrival: '2026-11-10', departure: '2026-11-22', adults: 2 };
    const site = unit(await provider.availability!.check('busselton', stay), 'cat:4');
    expect(site.nights.map((n) => [n.state, n.label])).toEqual([
      ['available', undefined],
      ['unknown', undefined],
      ['closed', 'Reason 2; and more'],
      ['booked', undefined],
      ['closed', 'Reason 4; and more'],
      ['booked', undefined],
      ['closed', 'Reason 6; and more'],
      ['closed', 'Reason 7; and more'],
      ['closed', 'Reason 8; and more'],
      ['not-released', undefined],
      ['unknown', undefined],
      // 2026-11-21 has no entry
      ['unknown', undefined],
    ]);
  });

  it('code 0 with no free sites is booked; keys outside the stay are ignored', async () => {
    const site = await poweredSite((s) => {
      s.sites_available = { '2026-11-05': 9, '2026-11-06': 0, '2026-11-07': 4, '2026-11-08': 9 };
      s.sites_code = { '2026-11-05': 0, '2026-11-06': 0, '2026-11-07': 0, '2026-11-08': 0 };
    });
    expect(states(site)).toEqual([
      ['2026-11-06', 'booked'],
      ['2026-11-07', 'available'],
    ]);
  });

  it('a partial stay keeps its free nights available, with their price and stay rules', async () => {
    const site = await poweredSite((s) => {
      s.sites_code = { '2026-11-06': 3, '2026-11-07': 0 };
      s.sites_available = { '2026-11-06': 0, '2026-11-07': 5 };
      const quotes = s.tariffs_available[0].tariffs_quoted as Record<string, object>;
      Object.assign(quotes['2026-11-07'], { close_departure: 1 });
    });
    expect(site.nights).toEqual([
      { date: '2026-11-06', state: 'booked' },
      { date: '2026-11-07', state: 'available', price: 75, minNights: 1, noDeparture: true },
    ]);
    expect(site.fullyAvailable).toBe(false);
  });

  it("a partial stay shorter than the arrival night's minimum has no free night: min-stay", async () => {
    const site = await poweredSite((s) => {
      s.sites_code = { '2026-11-06': 0, '2026-11-07': 3 };
      s.sites_available = { '2026-11-06': 4, '2026-11-07': 0 };
      for (const quote of Object.values(s.tariffs_available[0].tariffs_quoted as object)) {
        Object.assign(quote, { minimum_periods: '3' });
      }
    });
    expect(site.nights).toEqual([
      { date: '2026-11-06', state: 'unknown', reason: 'min-stay', minNights: 3 },
      { date: '2026-11-07', state: 'booked' },
    ]);
    expect(site.minNights).toBe(3);
    expect(site.fullyAvailable).toBe(false);
  });

  it('a tariff RAC took whose arrival night refuses arrivals is not free (min-stay)', async () => {
    const site = await poweredSite((s) => {
      const quotes = s.tariffs_available[0].tariffs_quoted as Record<string, object>;
      Object.assign(quotes['2026-11-06'], { close_arrival: '1' });
    });
    expect(site.fullyAvailable).toBe(false);
    expect(site.nights[0]).toMatchObject({ state: 'unknown', reason: 'min-stay', noArrival: true });
  });

  it("keeps RAC's closed days on a taken night, so a partial stay never ends on a refused morning", async () => {
    const site = await poweredSite((s) => {
      s.sites_code = { '2026-11-06': 0, '2026-11-07': 3 };
      s.sites_available = { '2026-11-06': 4, '2026-11-07': 0 };
      const quotes = s.tariffs_available[0].tariffs_quoted as Record<string, object>;
      Object.assign(quotes['2026-11-07'], { close_arrival: '1', close_departure: '1' });
    });
    expect(site.nights).toEqual([
      { date: '2026-11-06', state: 'available', price: 75, minNights: 1 },
      { date: '2026-11-07', state: 'booked', noArrival: true, noDeparture: true },
    ]);
    // The core's partial matching: 6 → 7 Nov would leave on a morning RAC refuses
    expect(partialMatches({}, [site])).toEqual([]);
    // Without the closed day, the one free night is a partial match
    const open = await poweredSite((s) => {
      s.sites_code = { '2026-11-06': 0, '2026-11-07': 3 };
      s.sites_available = { '2026-11-06': 4, '2026-11-07': 0 };
    });
    expect(partialMatches({}, [open]).map((m) => [m.arrival, m.departure])).toEqual([
      ['2026-11-06', '2026-11-07'],
    ]);
  });

  it('keeps closed days on closed, not-released and min-stay nights too', async () => {
    const result = await fixtureProvider().availability!.check('busselton', LEAVERS);
    expect(unit(result, 'cat:4').nights).toEqual([
      { date: '2027-11-20', state: 'not-released', noArrival: true, noDeparture: true },
    ]);
  });

  it.each([
    'RAC Members Special',
    'Members-Only Spring Rate',
    'Members Only Rate',
    'RAC member rate',
  ])(
    "a members' tariff (%s) never counts, even when RAC takes it and it is cheapest",
    async (label) => {
      const site = await poweredSite((s) => {
        const promo = s.tariffs_available[2];
        Object.assign(promo, {
          tariff_label: label,
          tariff_success: 'true',
          tariff_code: 0,
          tariff_total: 100,
        });
        for (const quote of Object.values(promo.tariffs_quoted as object)) {
          Object.assign(quote, { amount: 50, minimum_periods: '1' });
        }
      });
      expect([site.total, site.priceNote, site.nights.map((n) => n.price)]).toEqual([
        150,
        undefined,
        [75, 75],
      ]);
    }
  );

  it("tells members' tariffs from public ones by their label", () => {
    for (const label of [
      'RAC Member Rate',
      'Stay & Save This Spring - RAC Member',
      'RAC Members Special',
      'Members-Only Spring Rate',
      'Members Only',
      'member rate',
    ]) {
      expect([label, isMemberTariff({ tariff_label: label })]).toEqual([label, true]);
    }
    for (const label of [
      'Standard Rate',
      'Stay & Save This Spring',
      'Non-Member Rate',
      'Non Member Rate',
      'Nonmember Rate',
      'Membership Week Special',
      'Remember Me Rate',
    ]) {
      expect([label, isMemberTariff({ tariff_label: label })]).toEqual([label, false]);
    }
  });

  it('a Non-Member tariff is public: it counts, and its label is the price note', async () => {
    const site = await poweredSite((s) => {
      const promo = s.tariffs_available[2];
      Object.assign(promo, {
        tariff_label: 'Non-Member Saver',
        tariff_success: 'true',
        tariff_code: 0,
        tariff_total: 140,
      });
      for (const quote of Object.values(promo.tariffs_quoted as object)) {
        Object.assign(quote, { amount: 70, minimum_periods: '1' });
      }
    });
    expect([site.total, site.priceNote]).toEqual([140, 'Non-Member Saver']);
  });

  it('prices come from the cheapest public tariff RAC took, with its label as the price note', async () => {
    const site = await poweredSite((s) => {
      const promo = s.tariffs_available[2];
      Object.assign(promo, {
        tariff_label: 'Stay & Save This Spring',
        tariff_success: 'true',
        tariff_code: 0,
        tariff_total: 130,
      });
      for (const quote of Object.values(promo.tariffs_quoted as object)) {
        Object.assign(quote, { amount: 65, minimum_periods: '1' });
      }
    });
    expect(site.nights.map((n) => n.price)).toEqual([65, 65]);
    expect([site.total, site.priceNote]).toEqual([130, 'Stay & Save This Spring']);
  });
});

describe('RAC availability: unit types', () => {
  it("gives every unit its kind's group as its type, as the place page does", async () => {
    const provider = fixtureProvider();
    const detail = await provider.catalog!.getLocation('busselton');
    const result = await provider.availability!.check('busselton', BUSSELTON);
    for (const u of result.units) {
      expect(u.unitType).toBe(unitTypeOfKind(u.unitKind!));
      const listed = detail.units.find((d) => d.unitId === u.unitId);
      if (listed) expect([u.unitId, u.unitType]).toEqual([listed.unitId, listed.unitType]);
    }
    expect(detail.units.every((d) => d.unitType === unitTypeOfKind(d.unitKind!))).toBe(true);
  });
});

describe('RAC availability: never a cart address', () => {
  const samples: Array<[string, string, StayQuery]> = [
    ['busselton', 'Busselton 6–8 Nov 2026', BUSSELTON],
    ['busselton', 'school holidays', SCHOOL_HOLIDAYS],
    ['busselton', 'Leavers', LEAVERS],
    ['busselton', 'the window edge', WINDOW_EDGE],
    ['busselton', 'after midnight', AFTER_MIDNIGHT],
    ['exmouth', 'Exmouth closed', EXMOUTH_CLOSED],
    [
      'exmouth',
      'Exmouth, 31 Oct 2026',
      { arrival: '2026-10-31', departure: '2026-11-01', adults: 2 },
    ],
    [
      'karri-valley',
      'Karri Valley, 31 Oct 2026',
      { arrival: '2026-10-31', departure: '2026-11-01', adults: 2 },
    ],
    [
      'monkey-mia',
      'Monkey Mia, 31 Oct 2026',
      { arrival: '2026-10-31', departure: '2026-11-01', adults: 2 },
    ],
  ];

  it.each(samples)(
    '%s, %s: no cart key, no rest_api_data_id, nothing redacted',
    async (id, _, stay) => {
      const result = await fixtureProvider().availability!.check(id, stay);
      expect(result.units.length).toBeGreaterThan(0);
      const json = JSON.stringify(result);
      expect(json).not.toMatch(/[?&]cart\b|rest_api_data_id|<redacted>/);
      for (const u of result.units) {
        expect(u.bookingUrl).toMatch(new RegExp(`^${RAC}/${id}/booking/\\?`));
        expect(new URL(u.bookingUrl!).searchParams.get('force_category_id')).toBe(
          u.unitId.slice('cat:'.length)
        );
      }
      expect(stayRuleViolations(stay, result)).toEqual([]);
    }
  );

  it.each([
    `${RAC}/busselton/booking/?cart&rest_api_data_id=x`,
    `${RAC}/busselton/booking/?available_from=2026-11-06&cart=Booking&force_category_id=4`,
    `${RAC}/busselton/booking/?available_from=2026-11-06&rest_api_data_id=x`,
    'http://parksandresorts.rac.com.au/busselton/booking/?force_category_id=4',
    'https://evil.example/busselton/booking/?force_category_id=4',
    `${RAC}/cable-beach/booking/?force_category_id=4`,
    `${RAC}/busselton/book-now/?force_category_id=4`,
    'not a url',
  ])('an online_booking_url %s gets links.booking for the unit instead', async (url) => {
    const { provider } = recordingProvider(() => ({
      body: edited('2026-11-06-2n', (json) => {
        json.data['4'].online_booking_url = url;
      }),
    }));
    const powered = unit(await provider.availability!.check('busselton', BUSSELTON), 'cat:4');
    expect(powered.bookingUrl).toBe(provider.links.booking('busselton', BUSSELTON, 'cat:4'));
    expect(powered.bookingUrl).toBe(POWERED_SITE_LINK);
  });

  it('a category with no online_booking_url gets links.booking too', async () => {
    const { provider } = recordingProvider(() => ({
      body: edited('2026-11-06-2n', (json) => {
        delete json.data['7'].online_booking_url;
      }),
    }));
    const ensuite = unit(await provider.availability!.check('busselton', BUSSELTON), 'cat:7');
    expect(ensuite.bookingUrl).toBe(provider.links.booking('busselton', BUSSELTON, 'cat:7'));
  });
});

describe('RAC availability: releases (release.opensAt)', () => {
  /** 23:36 AWST on 16 Oct 2026, when the window-edge answer was recorded. */
  const EDGE_CHECKED = new Date('2026-10-16T15:36:00.000Z');
  /** Nights 20 and 21 Dec 2027, in the summer 2027–28 holidays (released 5 Feb 2027, 8 am). */
  const HOLIDAYS: StayQuery = { arrival: '2027-12-20', departure: '2027-12-22', adults: 2 };

  /** The Busselton answer (powered site free, ensuite booked) moved to 20–21 Dec 2027. */
  const holidayAnswer = () =>
    answer('2026-11-06-2n')
      .replaceAll('2026-11-06', '2027-12-20')
      .replaceAll('2026-11-07', '2027-12-21');

  /** RAC at `clock`, for a person with a member number or not, answering `body`. */
  function providerAt(clock: Date, member: boolean, body = holidayAnswer()) {
    const http = new RecordingHttpClient({ providerId: 'rac', respond: () => ({ body }) });
    const factory = defineProvider(racManifest, (ctx) =>
      createRacModules(ctx, { isMember: async () => member })
    );
    return factory(createTestProviderContext(racManifest, { http, clock: () => clock }));
  }

  it('the window edge, 13–18 Oct 2027 at 23:36 AWST: 16–18 not released, closed, opening 2026-10-18T16:00Z', async () => {
    const provider = racFactory(fixtureContext({ clock: () => EDGE_CHECKED }));
    const result = await provider.availability!.check('busselton', WINDOW_EDGE);
    expect(states(unit(result, 'cat:4')).slice(3)).toEqual([
      ['2027-10-16', 'not-released'],
      ['2027-10-17', 'not-released'],
      ['2027-10-18', 'not-released'],
    ]);
    // Departure 19 Oct 2027 − 365 days = 19 Oct 2026, 00:00 AWST
    expect(result.release).toEqual({ open: false, opensAt: '2026-10-18T16:00:00.000Z' });
  });

  it('an open stay is open, with no opensAt', async () => {
    const result = await fixtureProvider().availability!.check('busselton', BUSSELTON);
    expect(result.release).toEqual({ open: true });
  });

  it('a stay beyond the window that the policy would refuse has no opensAt', async () => {
    // Leavers, 20 Nov 2027 (site code 9), asked an hour after its rolling window closed
    const provider = racFactory(
      fixtureContext({ clock: () => new Date('2026-11-20T17:00:00.000Z') })
    );
    const result = await provider.availability!.check('busselton', LEAVERS);
    expect(states(unit(result, 'cat:4'))).toEqual([['2027-11-20', 'not-released']]);
    expect(result.release).toEqual({ open: false });
  });

  it('holds back nights RAC does not report free in holidays still to come; a free night stays free', async () => {
    // 20 Jan 2027: the nights are inside the 364-day window, the release is on 5 Feb
    const result = await providerAt(
      new Date('2027-01-20T02:00:00.000Z'),
      false
    ).availability!.check('busselton', HOLIDAYS);
    expect(states(unit(result, 'cat:7'))).toEqual([
      ['2027-12-20', 'not-released'],
      ['2027-12-21', 'not-released'],
    ]);
    // RAC's engine decides (terms rule 16): what it reports free is free
    expect(states(unit(result, 'cat:4'))).toEqual([
      ['2027-12-20', 'available'],
      ['2027-12-21', 'available'],
    ]);
    expect(unit(result, 'cat:4').fullyAvailable).toBe(true);
    expect(result.release).toEqual({ open: false, opensAt: '2027-02-05T00:00:00.000Z' });
  });

  it('with a member number, the pre-sale releases them 48 hours earlier', async () => {
    // 4 Feb 2027: after the pre-sale (3 Feb, 8 am), before the public release (5 Feb, 8 am)
    const between = new Date('2027-02-04T00:00:00.000Z');
    const member = await providerAt(between, true).availability!.check('busselton', HOLIDAYS);
    expect(states(unit(member, 'cat:7'))).toEqual([
      ['2027-12-20', 'booked'],
      ['2027-12-21', 'booked'],
    ]);
    expect(member.release).toEqual({ open: true });
    const everyone = await providerAt(between, false).availability!.check('busselton', HOLIDAYS);
    expect(states(unit(everyone, 'cat:7'))[0]).toEqual(['2027-12-20', 'not-released']);
    expect(everyone.release).toEqual({ open: false, opensAt: '2027-02-05T00:00:00.000Z' });
    // Before the pre-sale, a member's stay opens at it
    const before = await providerAt(new Date('2027-01-20T02:00:00.000Z'), true).availability!.check(
      'busselton',
      HOLIDAYS
    );
    expect(before.release).toEqual({ open: false, opensAt: '2027-02-03T00:00:00.000Z' });
  });

  it("keeps Margaret River's dorms to the public release for a member", async () => {
    // The ensuite answer as the 26-bed dorm (category 3, type 4) at Margaret River
    const body = holidayAnswer().replaceAll('Ensuite Site', 'Dorm Room - Sleeps 26');
    const json = JSON.parse(body) as RawAnswer;
    json.data['7'].category_id = 3;
    json.data['7'].category_type_id = '4';
    const between = new Date('2027-02-04T00:00:00.000Z');
    const result = await providerAt(between, true, JSON.stringify(json)).availability!.check(
      'margaret-river',
      HOLIDAYS
    );
    expect(unit(result, 'cat:3').unitKind).toBe('dorm');
    expect(states(unit(result, 'cat:3'))[0]).toEqual(['2027-12-20', 'not-released']);
    // The member's window has passed, so the stay opens at Margaret River's public time, 7 am
    expect(result.release).toEqual({ open: false, opensAt: '2027-02-04T23:00:00.000Z' });
  });

  it('marks nothing held back at Cable Beach, which is in no school-holiday release', async () => {
    const result = await providerAt(new Date('2027-01-20T02:00:00.000Z'), true).availability!.check(
      'cable-beach',
      HOLIDAYS
    );
    expect(states(unit(result, 'cat:7'))[0]).toEqual(['2027-12-20', 'booked']);
    expect(result.release).toEqual({ open: true });
  });
});
