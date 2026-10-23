/**
 * `describeProviderContract(name, makeSubject)`: the conformance suite every provider runs.
 *
 *   describeProviderContract('parkstay', async () => ({
 *     provider: registry.get('parkstay'),
 *     sample: { externalId: '20', stay: { arrival: '2026-11-10', departure: '2026-11-12', adults: 1 } },
 *   }));
 *
 * It checks that the manifest is valid, the capabilities match the modules, location keys
 * round-trip, every module honours `AbortSignal`, failures are `ProviderError`s, links are
 * absolute https URLs, and every booking link a check returns (the location's and each
 * unit's `bookingUrl`) is on the provider's own site (`bookingLinkViolations`, the core's
 * `isProviderBookingLink`), and that a stay under a unit's minimum is refused: the unit is
 * not `fullyAvailable` and its nights with room are `min-stay`, never `available`
 * (`stayRuleViolations`), and that free counts are whole numbers on every unit or none
 * (`freeCountViolations`). A split stay a unit reports is one (`splitStayViolations`): not
 * free, every night free or `split`, a known way to book, parts that cover the stay, and a
 * contact page on the provider's own site when it is booked through the place; and a bulk
 * entry flags one only where nothing is free (`bulkSplitViolations`). Modules the
 * provider does not have are skipped. For a
 * browser-driven provider, `openPages` lets it check that no call leaves a page open.
 *
 * A `search`-mode catalogue is also checked over `searchBbox` (`searchAreaViolations`): its
 * items are inside the box, it pages by cursor and stops, and every page honours
 * `AbortSignal`; `catalog.searchText`, if any, must find this provider's locations for
 * `searchText`. The checks are exported, so a provider's own tests can name what is wrong.
 */

import {
  isAbortError,
  ProviderError,
  type AccommodationProvider,
  type CatalogAreaPage,
  type CatalogModule,
  type ProviderContext,
} from '@main/providers/sdk';
import { isProviderBookingLink } from '@main/core/booking-link';
import { isFreeNight, minimumNights } from '@main/core/watches/matching';
import { TEXT_SEARCH_MIN_CHARS } from '@main/core/catalog/location-catalog.service';
import { providerViolations, ProviderRegistry } from '@main/providers/registry';
import type { BoundingBox, LocationSummary } from '@shared/types/catalog.types';
import {
  ProviderManifestSchema,
  SPLIT_STAY_BOOKINGS,
  type BulkAvailabilityEntry,
  type LocationAvailability,
  type NightStatus,
  type ProviderManifest,
  type StayQuery,
} from '@shared/types/provider.types';
import { eachNight, isCalendarDate, nightsBetween } from '@shared/utils/calendar-date';
import { makeLocationKey, parseLocationKey } from '@shared/utils/location-key';
import { createTestProviderContext } from './fake-provider';

export interface ProviderContractSubject {
  provider: AccommodationProvider;
  /**
   * A location and stay the provider can answer for. Defaults to the first catalogue location
   * and a two-night stay starting 30 days from today.
   */
  sample?: { externalId?: string; stay?: StayQuery };
  /** An external id the provider does not know. Default `does-not-exist-0`. */
  unknownExternalId?: string;
  /** Builds the context used for the registration check. Defaults to `createTestProviderContext`. */
  makeContext?: (manifest: ProviderManifest) => ProviderContext;
  /**
   * The map area a `search` catalogue is listed and checked with: give one with some (not
   * all) of its locations. Default: the whole world.
   */
  searchBbox?: BoundingBox;
  /**
   * A text `catalog.searchText` finds locations for. Default: `defaultSearchText` of the
   * first location's name (its first word of 3 or more characters).
   */
  searchText?: string;
  /** Called after the suite (e.g. to stop a fixture server). */
  cleanup?: () => Promise<void> | void;
  /**
   * For a browser-driven provider: how many pages its browser has open
   * (`context.pages().length`). After each test it must be back to 0.
   */
  openPages?: () => number;
}

/** Waits up to `ms` for `done()`; an aborted call closes its page as it unwinds. */
async function settle(done: () => boolean, ms = 2_000): Promise<void> {
  const until = Date.now() + ms;
  while (!done() && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 10));
}

const day = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const WORLD: BoundingBox = [-180, -90, 180, 90];

/** Every location: `listLocations`, or every page of `searchArea` over `bbox`. */
async function listAll(catalog: CatalogModule, bbox: BoundingBox): Promise<LocationSummary[]> {
  if (catalog.listLocations) return catalog.listLocations();
  const items: LocationSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const result = await catalog.searchArea!({ bbox, cursor });
    items.push(...result.items);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return items;
}

/**
 * The text the suite gives `catalog.searchText` by default for a location named `name`: its
 * first word of at least `TEXT_SEARCH_MIN_CHARS` (3) letters or digits, as the app asks with
 * no shorter text; else the whole name.
 */
export function defaultSearchText(name: string): string {
  return (
    name.split(/[^\p{L}\p{N}]+/u).find((word) => word.length >= TEXT_SEARCH_MIN_CHARS) ??
    name.trim()
  );
}

/** How far outside its box a `searchArea` item may be, for rounding: 0.01° (about 1 km). */
export const SEARCH_BBOX_TOLERANCE = 0.01;
/** The most `searchArea` pages the checks follow before they call the cursor endless. */
export const SEARCH_PAGE_LIMIT = 100;

/**
 * What is wrong with `catalog.searchArea` over `bbox`, as messages ([] when nothing): a page
 * that is not `{ items, nextCursor? }`, an item outside the box (by more than
 * `SEARCH_BBOX_TOLERANCE`), a cursor that comes back unchanged, or one that has not ended
 * after `pageLimit` pages.
 */
export async function searchAreaViolations(
  catalog: CatalogModule,
  bbox: BoundingBox,
  pageLimit = SEARCH_PAGE_LIMIT
): Promise<string[]> {
  if (!catalog.searchArea) return ['catalog.searchArea is missing'];
  const [west, south, east, north] = bbox;
  const t = SEARCH_BBOX_TOLERANCE;
  const violations: string[] = [];
  let cursor: string | undefined;
  for (let page = 1; page <= pageLimit; page++) {
    const result: unknown = await catalog.searchArea({ bbox, cursor });
    const { items, nextCursor } = (result ?? {}) as Partial<CatalogAreaPage>;
    if (!Array.isArray(items)) return [...violations, `page ${page} has no items array`];
    for (const item of items) {
      const inside =
        item.lng >= west - t &&
        item.lng <= east + t &&
        item.lat >= south - t &&
        item.lat <= north + t;
      if (!inside) {
        violations.push(
          `page ${page}: ${item.key} at (${item.lng}, ${item.lat}) is outside [${bbox.join(', ')}]`
        );
      }
    }
    if (nextCursor === undefined) return violations;
    if (typeof nextCursor !== 'string' || nextCursor === '') {
      return [...violations, `page ${page}: nextCursor must be a non-empty string or absent`];
    }
    if (nextCursor === cursor) {
      return [
        ...violations,
        `page ${page}: nextCursor "${nextCursor}" repeats the cursor it was given`,
      ];
    }
    cursor = nextCursor;
  }
  return [...violations, `searchArea still had a nextCursor after ${pageLimit} pages`];
}

/**
 * What is wrong with how `run` honours its signal: undefined when it rejects with an
 * AbortError both for a signal aborted before the call and for one aborted during it.
 */
export async function abortViolation(
  run: (signal: AbortSignal) => Promise<unknown>
): Promise<string | undefined> {
  const outcomeOf = (pending: Promise<unknown>): Promise<string> =>
    pending.then(
      () => 'resolved',
      (error: unknown) => (isAbortError(error) ? 'aborted' : `rejected with ${String(error)}`)
    );
  const call = (signal: AbortSignal): Promise<unknown> => {
    try {
      return Promise.resolve(run(signal));
    } catch (error) {
      return Promise.reject(error);
    }
  };

  const before = new AbortController();
  before.abort();
  const early = await outcomeOf(call(before.signal));
  if (early !== 'aborted') return `${early} although its signal was aborted before the call`;

  const during = new AbortController();
  const pending = call(during.signal);
  during.abort();
  const late = await outcomeOf(pending);
  if (late !== 'aborted') return `${late} although its signal was aborted during the call`;
  return undefined;
}

/**
 * What is wrong with `catalog.searchText` for `text`, as messages ([] when nothing): it found
 * nothing, or an item does not name `providerId`.
 */
export async function searchTextViolations(
  catalog: CatalogModule,
  providerId: string,
  text: string
): Promise<string[]> {
  if (!catalog.searchText) return ['catalog.searchText is missing'];
  const items: unknown = await catalog.searchText(text);
  if (!Array.isArray(items)) return [`searchText("${text}") did not return an array`];
  if (items.length === 0) return [`searchText("${text}") found nothing`];
  return (items as LocationSummary[])
    .filter((item) => item.key !== makeLocationKey(providerId, item.externalId))
    .map((item) => `searchText("${text}"): ${item.key} is not a location of ${providerId}`);
}

/**
 * What is wrong with the booking links of a check's answer, as messages ([] when nothing):
 * a `bookingUrl` (the location's, or a unit's) that the core would refuse, because it is not
 * https on the provider's own site (`isProviderBookingLink`: the website's host, or a
 * subdomain of it, with no user name or password). Alerts never carry such a link.
 */
export function bookingLinkViolations(
  manifest: Pick<ProviderManifest, 'website'>,
  result: Pick<LocationAvailability, 'bookingUrl' | 'units'>
): string[] {
  const links: Array<[string, string | undefined]> = [
    ['the location', result.bookingUrl],
    ...result.units.map((unit): [string, string | undefined] => [
      `unit ${unit.unitId}`,
      unit.bookingUrl,
    ]),
  ];
  return links
    .filter(([, url]) => url !== undefined && !isProviderBookingLink(manifest, url))
    .map(([owner, url]) => `${owner}'s bookingUrl ${url} is not on ${manifest.website}`);
}

/**
 * What is wrong with the stay rules of a check's answer for `stay`, as messages ([] when
 * nothing). A unit whose minimum for the stay (the core's `minimumNights`: the arrival night's
 * `minNights`, else the unit's) is more than the stay's nights must not be `fullyAvailable`,
 * and must not have an `available` night with no reason: the stay is refused, so its nights
 * with room are `unknown` with `reason: 'min-stay'`. Nor may a `min-stay` night be
 * `available`. A watch must never alert on a stay the provider would refuse, and the night grid
 * must not show it free.
 */
export function stayRuleViolations(
  stay: Pick<StayQuery, 'arrival' | 'departure'>,
  result: Pick<LocationAvailability, 'units'>
): string[] {
  const stayNights = nightsBetween(stay.arrival, stay.departure);
  const violations: string[] = [];
  for (const unit of result.units) {
    const arrivalNight = unit.nights.find((night) => night.date === stay.arrival);
    const minimum = minimumNights(unit, arrivalNight);
    if (minimum > stayNights) {
      if (unit.fullyAvailable) {
        violations.push(
          `unit ${unit.unitId} is fullyAvailable for ${stayNights} nights, under its minNights ${minimum}`
        );
      }
      const free = unit.nights.filter(
        (night) => night.state === 'available' && night.reason === undefined
      );
      if (free.length > 0) {
        violations.push(
          `unit ${unit.unitId}'s nights ${free.map((night) => night.date).join(', ')} are ` +
            `available with no reason, under its ${minimum}-night minimum for ${stayNights} ` +
            `nights (they are min-stay)`
        );
      }
    }
    for (const night of unit.nights) {
      if (night.reason === 'min-stay' && night.state === 'available') {
        violations.push(`unit ${unit.unitId}'s night ${night.date} is min-stay but available`);
      }
    }
  }
  return violations;
}

/**
 * What is wrong with the free counts of a check's answer, as messages ([] when nothing). A
 * unit's `freeCount` (the units it stands for that are free for the whole stay) is a whole
 * number: at least 1 when the unit is `fullyAvailable`, else 0. A provider sets it on every unit
 * of a check or on none, so a count of what is free can tell whether the provider has a total
 * ("2 of 5 sites free") or not ("51 spots free").
 */
export function freeCountViolations(result: Pick<LocationAvailability, 'units'>): string[] {
  const violations: string[] = [];
  const counted = result.units.filter((unit) => unit.freeCount !== undefined);
  if (counted.length > 0 && counted.length < result.units.length) {
    const missing = result.units.filter((unit) => unit.freeCount === undefined);
    violations.push(
      `units ${missing.map((unit) => unit.unitId).join(', ')} have no freeCount, but others do`
    );
  }
  for (const unit of counted) {
    const count = unit.freeCount;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      violations.push(`unit ${unit.unitId}'s freeCount ${String(count)} is not a whole number`);
    } else if (unit.fullyAvailable && count < 1) {
      violations.push(`unit ${unit.unitId} is fullyAvailable with freeCount ${count}`);
    } else if (!unit.fullyAvailable && count !== 0) {
      violations.push(`unit ${unit.unitId} is not fullyAvailable, but its freeCount is ${count}`);
    }
  }
  return violations;
}

/**
 * Why `parts` do not cover the stay from `arrival` to `departure`, or undefined when they do:
 * at least 2 parts, in date order, each of at least one night, the first arriving on the stay's
 * arrival, each next one arriving the morning the one before departs, the last departing on the
 * stay's departure.
 */
function partsProblem(parts: unknown, arrival: string, departure: string): string | undefined {
  if (!Array.isArray(parts)) return 'are not a list';
  if (parts.length < 2) return `are ${parts.length}, not 2 or more`;
  let at = arrival;
  for (const [i, part] of (parts as Array<{ arrival?: unknown; departure?: unknown }>).entries()) {
    const from = part?.arrival;
    const to = part?.departure;
    const dated =
      typeof from === 'string' &&
      typeof to === 'string' &&
      isCalendarDate(from) &&
      isCalendarDate(to);
    if (!dated) return `have part ${i + 1} without two calendar dates`;
    if (from !== at) return `have part ${i + 1} arriving ${from}, not ${at}`;
    if (nightsBetween(from, to) < 1) return `have part ${i + 1} of no night (${from} to ${to})`;
    at = to;
  }
  return at === departure ? undefined : `end on ${at}, not the stay's departure ${departure}`;
}

/** A `split` night with room (`unknown` or `available`), as the core takes one. */
const isSplitWithRoom = (night: NightStatus): boolean =>
  night.reason === 'split' && (night.state === 'unknown' || night.state === 'available');

/**
 * What is wrong with the split stays a check's answer reports (`UnitAvailability.splitStay`),
 * as messages ([] when nothing). A unit that reports one stands for several places and is not
 * free for the stay: it is not `fullyAvailable`, counts no free unit (`freeCount` 0 or none),
 * and has every night of the stay, each free (`available` with no reason) or `split` with room
 * (`unknown` or `available`), at least one `split`. Its `booking` is `contact` or `separate`;
 * its `units`, if any, a whole number of at least 2; its `parts`, if any, at least 2 that cover
 * the stay exactly, in order; and no more units than parts when it gives both. One booked
 * through the place (`contact`) needs `links.contact`, giving the place's contact page as a link
 * the core keeps (`isProviderBookingLink`: https on the provider's own site).
 */
export function splitStayViolations(
  manifest: Pick<ProviderManifest, 'website'>,
  provider: Pick<AccommodationProvider, 'links'>,
  stay: Pick<StayQuery, 'arrival' | 'departure'>,
  result: Pick<LocationAvailability, 'key' | 'units'>
): string[] {
  const dates = eachNight(stay.arrival, stay.departure);
  const violations: string[] = [];
  let contactProblem: string | undefined;
  let contactAsked = false;
  for (const unit of result.units) {
    const report = unit.splitStay;
    if (report === undefined) continue;
    const owner = `unit ${unit.unitId}'s split stay`;
    if (unit.fullyAvailable) violations.push(`${owner}: the unit is fullyAvailable`);
    if (unit.freeCount !== undefined && unit.freeCount !== 0) {
      violations.push(`${owner}: the unit counts ${String(unit.freeCount)} free`);
    }
    const nights = dates.map((date) => unit.nights.find((night) => night.date === date));
    const missing = dates.filter((_, i) => nights[i] === undefined);
    if (missing.length > 0) violations.push(`${owner}: no night for ${missing.join(', ')}`);
    for (const night of nights) {
      if (!night || isFreeNight(night) || isSplitWithRoom(night)) continue;
      if (night.reason === 'split') {
        violations.push(`${owner}: ${night.date} is split but ${night.state}, with no room`);
        continue;
      }
      const reason = night.reason ? ` (${night.reason})` : '';
      violations.push(`${owner}: ${night.date} is ${night.state}${reason}, neither free nor split`);
    }
    if (!nights.some((night) => night !== undefined && isSplitWithRoom(night))) {
      violations.push(`${owner}: no night is split`);
    }
    if (!(SPLIT_STAY_BOOKINGS as readonly unknown[]).includes(report.booking)) {
      violations.push(
        `${owner}: booking "${String(report.booking)}" is neither contact nor separate`
      );
    }
    const units = report.units as unknown;
    if (
      units !== undefined &&
      !(typeof units === 'number' && Number.isInteger(units) && units >= 2)
    ) {
      violations.push(`${owner}: units ${String(units)} is not a whole number of at least 2`);
    }
    if (report.parts !== undefined) {
      const problem = partsProblem(report.parts, stay.arrival, stay.departure);
      if (problem) violations.push(`${owner}: its parts ${problem}`);
    }
    // Each part is on one place, so a stay of N parts moves across N places at most
    if (typeof units === 'number' && Array.isArray(report.parts) && units > report.parts.length) {
      violations.push(
        `${owner}: units ${String(units)} is more than its ${String(report.parts.length)} parts`
      );
    }
    if (report.booking === 'contact') {
      if (!contactAsked) {
        contactAsked = true;
        contactProblem = contactLinkProblem(manifest, provider, result.key);
      }
      if (contactProblem)
        violations.push(`${owner} is booked through the place, but ${contactProblem}`);
    }
  }
  return violations;
}

/** Why the place's contact page is no link the core keeps, or undefined when it is one. */
function contactLinkProblem(
  manifest: Pick<ProviderManifest, 'website'>,
  provider: Pick<AccommodationProvider, 'links'>,
  key: string
): string | undefined {
  if (!provider.links.contact) return 'the provider has no links.contact';
  let externalId: string;
  try {
    externalId = parseLocationKey(key).externalId;
  } catch {
    return `the location key ${key} cannot be read`;
  }
  const url = provider.links.contact(externalId);
  if (url === null || url === undefined) return `links.contact("${externalId}") gives none`;
  return isProviderBookingLink(manifest, url)
    ? undefined
    : `links.contact("${externalId}") gives ${url}, not a page on ${manifest.website}`;
}

/**
 * What is wrong with the split stays bulk entries flag, as messages ([] when nothing): an entry
 * (or a kind in its `byKind`) has `splitStay` only as `true`, and only with `availableUnits` 0,
 * since a split stay is what is left when nothing is free for the whole stay.
 */
export function bulkSplitViolations(entries: readonly BulkAvailabilityEntry[]): string[] {
  const violations: string[] = [];
  const check = (
    owner: string,
    counts: { availableUnits: number; splitStay?: unknown } | undefined
  ): void => {
    if (counts?.splitStay === undefined) return;
    if (counts.splitStay !== true) {
      violations.push(`${owner}'s splitStay is ${String(counts.splitStay)}, not true`);
    }
    if (counts.availableUnits !== 0) {
      violations.push(
        `${owner} flags a split stay with ${String(counts.availableUnits)} available units`
      );
    }
  };
  for (const entry of entries) {
    check(entry.key, entry);
    for (const [kind, counts] of Object.entries(entry.byKind ?? {})) {
      check(`${entry.key} (${kind})`, counts);
    }
  }
  return violations;
}

/** A promise that rejects with an AbortError (the caller aborted). */
async function expectAbort(run: (signal: AbortSignal) => Promise<unknown>): Promise<void> {
  const before = new AbortController();
  before.abort();
  const early = await run(before.signal).then(
    () => 'resolved',
    (error: unknown) => error
  );
  expect(isAbortError(early)).toBe(true);

  const during = new AbortController();
  const pending = run(during.signal);
  during.abort();
  const late = await pending.then(
    () => 'resolved',
    (error: unknown) => error
  );
  expect(isAbortError(late)).toBe(true);
}

export function describeProviderContract(
  name: string,
  makeSubject: () => ProviderContractSubject | Promise<ProviderContractSubject>
): void {
  describe(`provider contract: ${name}`, () => {
    let subject: ProviderContractSubject;
    let provider: AccommodationProvider;
    let externalId: string;
    let stay: StayQuery;

    beforeAll(async () => {
      subject = await makeSubject();
      provider = subject.provider;
      stay = subject.sample?.stay ?? { arrival: day(30), departure: day(32), adults: 2 };
      externalId =
        subject.sample?.externalId ??
        (provider.catalog ? (await listAll(provider.catalog, bbox()))[0]?.externalId : '1') ??
        '1';
    });

    afterEach(async () => {
      const openPages = subject?.openPages;
      if (!openPages) return;
      await settle(() => openPages() === 0);
      expect(openPages()).toBe(0);
    });

    afterAll(async () => {
      await subject?.cleanup?.();
    });

    const unknownId = (): string => subject.unknownExternalId ?? 'does-not-exist-0';
    const bbox = (): BoundingBox => subject.searchBbox ?? WORLD;

    it('has a manifest that passes ProviderManifestSchema', () => {
      const parsed = ProviderManifestSchema.safeParse(provider.manifest);
      expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    });

    it('has a module behind every capability it claims, and consistent flags', () => {
      expect(providerViolations(provider)).toEqual([]);
    });

    it('declares a currency and, if any, sensible limits', () => {
      expect(provider.manifest.currency).toMatch(/^[A-Z]{3}$/);
      const limits = provider.manifest.limits;
      if (limits) {
        expect(limits.minWatchIntervalMinutes).toBeGreaterThanOrEqual(1);
        expect(limits.maxConcurrentRequests).toBeGreaterThanOrEqual(1);
        expect(limits.catalogTtlHours).toBeGreaterThan(0);
      }
    });

    it('supports every release mode it describes, and describes some when it snipes', () => {
      const modes = provider.manifest.releaseModes ?? [];
      if (provider.manifest.capabilities.snipes) expect(modes.length).toBeGreaterThan(0);
      for (const mode of modes)
        expect([mode.id, provider.release?.supports(mode.id)]).toEqual([mode.id, true]);
    });

    it('registers in a ProviderRegistry under its manifest id, modules unchanged', () => {
      const { id } = provider.manifest;
      const registry = new ProviderRegistry();
      const factory = Object.assign(() => provider, { id, manifest: provider.manifest });
      const registered = registry.register(
        factory,
        (manifest) => subject.makeContext?.(manifest) ?? createTestProviderContext(manifest)
      );
      expect(registered.manifest).toEqual(provider.manifest);
      expect(Object.isFrozen(registered.manifest)).toBe(true);
      for (const module of ['catalog', 'availability', 'access', 'release', 'holds'] as const) {
        expect([module, registered[module]]).toEqual([module, provider[module]]);
      }
      expect(registry.list()).toEqual([provider.manifest]);
    });

    it('builds absolute https links (or none)', () => {
      const urls = [
        provider.links.location(externalId),
        provider.links.booking(externalId),
        provider.links.booking(externalId, stay),
        provider.links.manageBooking?.('REF-1') ?? null,
        provider.links.contact?.(externalId) ?? null,
      ];
      for (const url of urls) {
        if (url !== null) expect(url).toMatch(/^https:\/\/[^/\s]+/);
      }
    });

    describe('catalog', () => {
      it('lists locations whose keys round-trip and name this provider', async () => {
        if (!provider.catalog) return;
        const locations = await listAll(provider.catalog, bbox());
        expect(locations.length).toBeGreaterThan(0);
        for (const location of locations) {
          expect(location.providerId).toBe(provider.manifest.id);
          expect(location.key).toBe(makeLocationKey(provider.manifest.id, location.externalId));
          expect(parseLocationKey(location.key)).toEqual({
            providerId: provider.manifest.id,
            externalId: location.externalId,
          });
          expect(provider.manifest.locationKinds).toContain(location.kind);
        }
        expect(new Set(locations.map((l) => l.key)).size).toBe(locations.length);
      });

      it('returns a detail with the same key', async () => {
        if (!provider.catalog) return;
        const detail = await provider.catalog.getLocation(externalId);
        expect(detail.key).toBe(makeLocationKey(provider.manifest.id, externalId));
        expect(Array.isArray(detail.units)).toBe(true);
      });

      it('honours AbortSignal', async () => {
        const catalog = provider.catalog;
        if (!catalog) return;
        if (catalog.listLocations) {
          const listLocations = catalog.listLocations.bind(catalog);
          await expectAbort((signal) => listLocations(signal));
        }
        if (catalog.searchArea) {
          const searchArea = catalog.searchArea.bind(catalog);
          await expectAbort((signal) => searchArea({ bbox: bbox() }, signal));
        }
        await expectAbort((signal) => catalog.getLocation(externalId, signal));
      });

      it('rejects an unknown location with a ProviderError', async () => {
        if (!provider.catalog) return;
        await expect(provider.catalog.getLocation(unknownId())).rejects.toBeInstanceOf(
          ProviderError
        );
      });
    });

    describe('search-mode catalogue', () => {
      const searchCatalog = (): CatalogModule | undefined =>
        provider.manifest.capabilities.catalogMode === 'search' ? provider.catalog : undefined;

      it('searchArea returns items inside the box, pages by cursor and stops', async () => {
        const catalog = searchCatalog();
        if (!catalog) return;
        expect(await searchAreaViolations(catalog, bbox())).toEqual([]);
      });

      it('searchArea honours AbortSignal on a first and a next page', async () => {
        const catalog = searchCatalog();
        if (!catalog?.searchArea) return;
        const searchArea = catalog.searchArea.bind(catalog);
        expect(await abortViolation((signal) => searchArea({ bbox: bbox() }, signal))).toBe(
          undefined
        );
        const { nextCursor: cursor } = await searchArea({ bbox: bbox() });
        if (cursor === undefined) return;
        expect(await abortViolation((signal) => searchArea({ bbox: bbox(), cursor }, signal))).toBe(
          undefined
        );
      });

      it("searchText, if any, finds this provider's locations and honours AbortSignal", async () => {
        const catalog = searchCatalog();
        if (!catalog?.searchText) return;
        const text =
          subject.searchText ?? defaultSearchText((await listAll(catalog, bbox()))[0]?.name ?? '');
        expect(await searchTextViolations(catalog, provider.manifest.id, text)).toEqual([]);
        const searchText = catalog.searchText.bind(catalog);
        expect(await abortViolation((signal) => searchText(text, signal))).toBe(undefined);
      });
    });

    describe('availability', () => {
      it('checks a stay: nights inside the stay, under the location key', async () => {
        if (!provider.availability) return;
        const result = await provider.availability.check(externalId, stay);
        expect(result.key).toBe(makeLocationKey(provider.manifest.id, externalId));
        expect(Number.isNaN(Date.parse(result.checkedAt))).toBe(false);
        for (const unit of result.units) {
          for (const night of unit.nights) {
            expect(night.date >= stay.arrival && night.date < stay.departure).toBe(true);
          }
        }
      });

      it("returns booking links on the provider's own site (https, its website's host)", async () => {
        if (!provider.availability) return;
        const result = await provider.availability.check(externalId, stay);
        expect(bookingLinkViolations(provider.manifest, result)).toEqual([]);
      });

      it('never offers a stay its own stay rules refuse', async () => {
        if (!provider.availability) return;
        const result = await provider.availability.check(externalId, stay);
        expect(stayRuleViolations(stay, result)).toEqual([]);
      });

      it('counts free units as whole numbers, on every unit or none (freeCount)', async () => {
        if (!provider.availability) return;
        const result = await provider.availability.check(externalId, stay);
        expect(freeCountViolations(result)).toEqual([]);
      });

      it('reports a split stay only on a unit free every night but not for the whole stay, with how to book it', async () => {
        if (!provider.availability) return;
        const result = await provider.availability.check(externalId, stay);
        expect(splitStayViolations(provider.manifest, provider, stay, result)).toEqual([]);
      });

      it('searches with keys of this provider', async () => {
        const search = provider.availability?.search;
        if (!search) return;
        const entries = await search(stay);
        for (const entry of entries)
          expect(parseLocationKey(entry.key).providerId).toBe(provider.manifest.id);
      });

      it('flags a split stay in a search only where nothing is free for the whole stay', async () => {
        const search = provider.availability?.search;
        if (!search) return;
        expect(bulkSplitViolations(await search(stay))).toEqual([]);
      });

      it('honours AbortSignal', async () => {
        const availability = provider.availability;
        if (!availability) return;
        await expectAbort((signal) => availability.check(externalId, stay, { signal }));
        if (availability.search) {
          const search = availability.search.bind(availability);
          await expectAbort((signal) => search(stay, signal));
        }
      });

      it('rejects an unknown location with a ProviderError', async () => {
        if (!provider.availability) return;
        await expect(provider.availability.check(unknownId(), stay)).rejects.toBeInstanceOf(
          ProviderError
        );
      });
    });

    describe('access gate', () => {
      it('reports its own status and unsubscribes listeners', () => {
        const gate = provider.access;
        if (!gate) return;
        expect(gate.status().providerId).toBe(provider.manifest.id);
        const listener = jest.fn();
        const unsubscribe = gate.onStatus(listener);
        expect(typeof unsubscribe).toBe('function');
        unsubscribe();
        const release = gate.holdOpen();
        release();
        release(); // a second release is harmless
      });

      it('honours AbortSignal in ensure()', async () => {
        const gate = provider.access;
        if (!gate) return;
        await expectAbort((signal) => gate.ensure({ signal }));
      });
    });

    describe('release policy', () => {
      it('computes a release for every described mode, honouring AbortSignal', async () => {
        const release = provider.release;
        if (!release) return;
        expect(release.pollFloorMs.window).toBeGreaterThan(0);
        expect(release.pollFloorMs.continuous).toBeGreaterThan(0);
        for (const mode of provider.manifest.releaseModes ?? []) {
          const at = await release.computeReleaseAt({
            mode: mode.id,
            externalId,
            stay,
            requestedAt: new Date(Date.now() + 86_400_000),
            now: new Date(),
          });
          expect(at === null || at instanceof Date).toBe(true);
        }
        const [first] = provider.manifest.releaseModes ?? [];
        if (first) {
          await expectAbort((signal) =>
            release.computeReleaseAt({ mode: first.id, externalId, stay, now: new Date(), signal })
          );
        }
      });
    });

    describe('holds', () => {
      it('honours AbortSignal', async () => {
        const holds = provider.holds;
        if (!holds) return;
        await expectAbort((signal) => holds.create({ externalId, stay }, signal));
      });
    });

    describe('auth', () => {
      it('has a signed-in check, and https sign-in origins for a browser session', async () => {
        const auth = provider.auth;
        if (!auth) return;
        expect(typeof auth.isSignedIn).toBe('function');
        if (auth.kind !== 'browser-session') return;
        expect(auth.signInUrl).toMatch(/^https:\/\//);
        for (const origin of auth.allowedOrigins) expect(origin).toMatch(/^https:\/\/[^/]+$/);
      });
    });
  });
}
