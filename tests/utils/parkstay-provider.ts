/**
 * The real ParkStay provider module for tests: registered in its own `ProviderRegistry`
 * (so every manifest and module rule is checked), on a `NodeHttpClient` pointed at a
 * `startParkStayFixtureServer()`, with in-memory state, a recording logger and a fixed
 * clock (FIXED_NOW, 2 Oct 2026 10:00 AWST).
 */

import { createParkStayModules, parkstayManifest } from '@main/providers/parkstay';
import type { AccessGateTimings } from '@main/providers/parkstay/queue/access-gate';
import type {
  RawCampsite,
  RawCampsiteAvailabilityView,
  RawNightTuple,
} from '@main/providers/parkstay/types';
import { ProviderRegistry, type ProviderWith } from '@main/providers/registry';
import {
  defineProvider,
  InMemoryKeyValueStore,
  NodeHttpClient,
  type ProviderContext,
} from '@main/providers/sdk';
import {
  createMemoryLogger,
  createTestProviderContext,
  FIXED_NOW,
  type MemoryLogger,
} from './fake-provider';
import {
  parkStayFixture,
  type ClassSite,
  type ParkStayFixtureServer,
} from './parkstay-fixture-server';

export type ParkStayUnderTest = ProviderWith<'snipes'> &
  ProviderWith<'catalog'> &
  ProviderWith<'bulkAvailability'> &
  ProviderWith<'accessGate'>;

export interface TestParkStay {
  provider: ParkStayUnderTest;
  ctx: ProviderContext;
  http: NodeHttpClient;
  state: InMemoryKeyValueStore;
  logger: MemoryLogger;
  registry: ProviderRegistry;
}

export interface TestParkStayOptions {
  clock?: () => Date;
  accessTimings?: Partial<AccessGateTimings>;
}

export function createTestParkStay(
  server: Pick<ParkStayFixtureServer, 'endpoints'>,
  options: TestParkStayOptions = {}
): TestParkStay {
  const http = new NodeHttpClient({ providerId: 'parkstay' });
  const state = new InMemoryKeyValueStore();
  const logger = createMemoryLogger();
  const ctx = createTestProviderContext(parkstayManifest, {
    http,
    state,
    logger,
    clock: options.clock ?? (() => FIXED_NOW),
  });
  const factory = defineProvider(parkstayManifest, (c) =>
    createParkStayModules(c, { endpoints: server.endpoints, accessTimings: options.accessTimings })
  );
  const registry = new ProviderRegistry();
  const provider = registry.register(factory, ctx) as ParkStayUnderTest;
  return { provider, ctx, http, state, logger, registry };
}

/** The fixture's stay: Bungarra (id 20), 10–12 Nov 2026, one adult. */
export const BUNGARRA_STAY = { arrival: '2026-11-10', departure: '2026-11-12', adults: 1 };

/** Lucky Bay (43), listed by site class: the stay of its recorded view, 6–9 Nov 2026. */
export const LUCKY_BAY_STAY = { arrival: '2026-11-06', departure: '2026-11-09', adults: 1 };

/** Lucky Bay's one class, "One site - select on arrival", as a unit. */
export const LUCKY_BAY_CLASS = 'class:117';

/**
 * Lucky Bay's recorded view (no site free for the whole stay; a breakdown of its 56 sites),
 * or, given `freeSite`, the class as ParkStay answers while that site is free for the whole
 * stay (`api.py:1503-1524`): `id` is that site, every night is bookable, no breakdown.
 */
export function luckyBayView(freeSite?: number): RawCampsiteAvailabilityView {
  const view = parkStayFixture<RawCampsiteAvailabilityView>(
    'campsite_availablity_view_43_classes.json'
  );
  if (freeSite === undefined) return view;
  return {
    ...view,
    sites: view.sites.map((entry): RawCampsite => ({
      ...entry,
      id: freeSite,
      price: '$60.00',
      site_left: '1',
      availability: entry.availability.map((night): RawNightTuple => [
        true,
        `$${night[2]}`,
        night[2],
        [0, 0],
        null,
        night[5],
      ]),
      breakdown: [],
    })),
  };
}

/**
 * Lucky Bay's 56 sites for the fixture server's `create_booking`, from the recorded
 * breakdown: each site's free nights, plus every night of the stay for the sites named in
 * `freeForStay`. Ids are made up (309 + the site's place by name; the view gave 309 for the
 * first, "01"), in id order as ParkStay lists them.
 */
export function luckyBaySites(freeForStay: string[] = []): ClassSite[] {
  const [entry] = luckyBayView().sites;
  const dates = entry.availability.map((night) => night[5]);
  return (entry.breakdown ?? []).map((row, i) => ({
    id: 309 + i,
    name: row.name,
    campsiteClass: String(entry.type),
    freeNights: freeForStay.includes(row.name)
      ? dates
      : dates.filter((_, offset) => row.availability[offset]?.[0] === true),
  }));
}
